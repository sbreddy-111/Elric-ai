import './admin.css';
import {
  ApiError, consumeRedirect, countOf, recentSends, ensureFresh, getSession, isOwner, rest, runChecker, sendMagicLink, signOut,
  type Fact, type Feedback,
} from './api';

// ---------- helpers ----------
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const TZ = 'Asia/Kolkata';
const fmt = (d: string | number | Date | null | undefined, withTime = true) => d
  ? new Date(d).toLocaleString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) })
  : '—';
function ago(d: string | number | null | undefined) {
  if (!d) return 'never';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return fmt(d, false);
}
const dayKey = (d: string | Date) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
const FEEDBACK_KINDS = ['wrong_answer', 'thumbs_down'];
const ERROR_KINDS = ['crash', 'stuck'];
const KIND_LABEL: Record<string, string> = { wrong_answer: 'Wrong answer', thumbs_down: 'Not helpful', crash: 'Crash', stuck: 'Stuck on load' };
const STATUS_LABEL: Record<string, string> = { new: 'New', needs_review: 'Needs review', auto_added: 'Resolved', rejected: 'Rejected' };
const isError = (k: string) => ERROR_KINDS.includes(k);
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

/** Pull http(s) links out of an ai_sources / sources JSON value (ignores model names and search candidates). */
function links(v: unknown): string[] {
  const out = new Set<string>();
  const walk = (x: any, key = '') => {
    if (!x || key === 'candidates') return;
    if (typeof x === 'string') { if (/^https?:\/\//i.test(x)) out.add(x); return; }
    if (Array.isArray(x)) { x.forEach((y) => walk(y)); return; }
    if (typeof x === 'object') for (const [k, y] of Object.entries(x)) walk(y, k);
  };
  walk(v);
  return [...out];
}
const linkList = (v: unknown) => {
  const l = links(v);
  if (!l.length) return '<span class="muted">No sources</span>';
  return `<ul class="links">${l.map((u) => {
    let h = u; try { h = new URL(u).hostname.replace(/^www\./, '') + decodeURI(new URL(u).pathname).replace(/\/$/, ''); } catch { /* keep */ }
    return `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(h.length > 70 ? h.slice(0, 68) + '…' : h)}</a></li>`;
  }).join('')}</ul>`;
};
function suggestedFact(v: string | null) {
  const m = (v || '').match(/Suggested fact:\s*(.+)$/s);
  return m ? m[1].trim() : '';
}
function verdictText(v: string | null) {
  return (v || '').replace(/\s*\|\s*Suggested fact:.*$/s, '').trim();
}
const kindChip = (k: string) => `<span class="chip ${isError(k) ? 'c-err' : 'c-fb'}">${isError(k) ? '' : '👎 '}${esc(KIND_LABEL[k] || k)}</span>`;
const statusChip = (s: string) => `<span class="chip s-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;

const I = {
  overview: '<path d="M4 13h6V4H4zm0 7h6v-5H4zm10 0h6v-9h-6zm0-16v5h6V4z"/>',
  review: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
  facts: '<path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h6M8 11h6"/>',
  feedback: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
};
const icon = (n: keyof typeof I) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

// ---------- theme ----------
function applyTheme(t?: string) {
  const theme = t || localStorage.getItem('elric-admin-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
  $('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#F6F6F8' : '#0F0F12');
  return theme;
}
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('elric-admin-theme', t); applyTheme(t); renderChrome();
}

// ---------- toast / confirm ----------
function toast(msg: string, kind: 'ok' | 'err' | '' = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg; el.setAttribute('role', 'status');
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3600);
  setTimeout(() => el.remove(), 4000);
}
function confirmBox(title: string, body: string, okLabel = 'Delete', danger = true): Promise<boolean> {
  return new Promise((res) => {
    const m = document.createElement('div');
    m.className = 'modal-wrap';
    m.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><p class="muted">${esc(body)}</p>
      <div class="row end"><button class="btn" data-a="no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(okLabel)}</button></div></div>`;
    const done = (v: boolean) => { m.remove(); res(v); };
    m.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (a) done(a === 'yes'); else if (e.target === m) done(false);
    });
    document.body.append(m);
    (m.querySelector('[data-a="yes"]') as HTMLElement).focus();
  });
}

// ---------- app state ----------
type View = 'overview' | 'review' | 'facts' | 'feedback';
const VIEWS: { id: View; label: string; ic: keyof typeof I }[] = [
  { id: 'overview', label: 'Overview', ic: 'overview' },
  { id: 'review', label: 'Review queue', ic: 'review' },
  { id: 'facts', label: 'Facts', ic: 'facts' },
  { id: 'feedback', label: 'Feedback & errors', ic: 'feedback' },
];
let view: View = (location.hash.replace('#/', '') as View) || 'overview';
if (!VIEWS.some((v) => v.id === view)) view = 'overview';
let reviewCount: number | null = null;
let checking = false;
const app = document.getElementById('app')!;

const errorBox = (e: unknown, retry: string) => {
  if ((e as ApiError)?.status === 401 || !getSession()) { setTimeout(() => renderLogin('Your session ended. Please sign in again.'), 0); return ''; }
  return `<div class="state err"><b>Couldn't load this.</b><p class="muted">${esc((e as Error)?.message || 'Network error')}</p><button class="btn" data-retry="${retry}">${icon('refresh')} Try again</button></div>`;
};
const loading = (n = 3) => `<div class="skel-list">${'<div class="skel"></div>'.repeat(n)}</div>`;
const empty = (title: string, body: string) => `<div class="state"><div class="state-ic">✓</div><b>${esc(title)}</b><p class="muted">${esc(body)}</p></div>`;

// ---------- sign-in screens ----------
function renderLogin(msg = '', sentTo = '') {
  app.className = 'auth';
  app.innerHTML = `<div class="auth-card">
    <img src="../icons/mark.png" alt="" class="auth-mark" width="48" height="48">
    <h1>Elric AI Admin</h1>
    ${sentTo ? `<div class="sent">${icon('mail')}<div><b>Check your email</b><p class="muted">We sent a sign-in link to <b>${esc(sentTo)}</b>. Tap it once and open it in this browser. Each link works one time, in the first browser that opens it. It can take a minute.</p></div></div>
      <button class="btn block" id="again">Use a different email</button>`
    : `<p class="muted">Sign in with your email to manage feedback, reports and facts.</p>
      <form id="lf" novalidate>
        <label for="em">Email</label>
        <input id="em" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" required>
        ${msg ? `<p class="form-err">${esc(msg)}</p>` : ''}
        <button class="btn primary block" type="submit" id="sb">Send sign-in link</button>
      </form>`}
    <p class="fine">${icon('lock')} Private admin area</p>
  </div>`;
  $('#again')?.addEventListener('click', () => renderLogin());
  $('#lf')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $<HTMLInputElement>('#em').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { renderLogin('Please enter a valid email address.'); return; }
    if (!isOwner(email)) { renderDenied(email); return; }
    const b = $<HTMLButtonElement>('#sb'); b.disabled = true; b.textContent = 'Sending…';
    try { await sendMagicLink(email); renderLogin('', email); }
    catch (err) {
      const msg = (err as Error).message, secs = /after (\d+) seconds?/i.exec(msg);
      let m = msg;
      if (secs) m = `Please wait ${secs[1]} seconds, then send the link again.`;
      else if ((err as ApiError).status === 429 || /rate|limit/i.test(msg)) {
        const first = recentSends()[0];
        const when = first ? new Date(first + 3600e3).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
        m = `Only 2 sign-in emails can be sent per hour, and that limit is used up. ${when ? `Try again after about ${when}.` : 'Try again in about an hour.'} If you already got a link, use the newest one.`;
      }
      renderLogin(m);
    }
  });
  $<HTMLInputElement>('#em')?.focus();
}

function renderDenied(email: string) {
  app.className = 'auth';
  app.innerHTML = `<div class="auth-card">
    <div class="denied-ic">${icon('lock')}</div>
    <h1>Not authorised</h1>
    <p class="muted">Sorry, <b>${esc(email)}</b> doesn't have access to Elric AI Admin. If you think this is a mistake, sign in with the owner account.</p>
    <button class="btn block" id="back">Back to sign in</button>
  </div>`;
  $('#back').addEventListener('click', async () => { await signOut(); renderLogin(); });
}

// ---------- shell ----------
function renderShell() {
  app.className = 'shell';
  app.innerHTML = `
    <aside class="side">
      <div class="brand"><img src="../icons/mark.png" alt="" width="28" height="28"><span>Elric AI <b>Admin</b></span></div>
      <nav class="nav" id="nav"></nav>
      <div class="side-foot" id="sidefoot"></div>
    </aside>
    <div class="main">
      <header class="top">
        <div class="brand m-only"><img src="../icons/mark.png" alt="" width="24" height="24"><span>Elric AI <b>Admin</b></span></div>
        <h2 id="title" class="d-only"></h2>
        <div class="top-actions" id="topactions"></div>
      </header>
      <main id="view" tabindex="-1"></main>
    </div>
    <nav class="tabbar" id="tabbar"></nav>
    <div class="drawer-wrap" id="drawer" hidden><div class="drawer" role="dialog" aria-modal="true"></div></div>
    <div id="toasts" class="toasts" aria-live="polite"></div>`;
  app.addEventListener('click', onClick);
  window.addEventListener('hashchange', () => {
    const v = location.hash.replace('#/', '') as View;
    if (VIEWS.some((x) => x.id === v) && v !== view) { view = v; renderChrome(); renderView(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  renderChrome();
  renderView();
  refreshBadge();
}

function renderChrome() {
  const badge = (id: View) => id === 'review' && reviewCount ? `<span class="badge">${reviewCount > 99 ? '99+' : reviewCount}</span>` : '';
  const items = VIEWS.map((v) => `<a href="#/${v.id}" class="${v.id === view ? 'on' : ''}" ${v.id === view ? 'aria-current="page"' : ''}>${icon(v.ic)}<span>${v.label}</span>${badge(v.id)}</a>`).join('');
  $('#nav').innerHTML = items;
  $('#tabbar').innerHTML = VIEWS.map((v) => `<a href="#/${v.id}" class="${v.id === view ? 'on' : ''}">${icon(v.ic)}<span>${v.label.split(' ')[0]}</span>${badge(v.id)}</a>`).join('');
  $('#title').textContent = VIEWS.find((v) => v.id === view)!.label;
  const light = document.documentElement.dataset.theme === 'light';
  $('#topactions').innerHTML = `
    <button class="btn primary" data-act="run" ${checking ? 'disabled' : ''}>${checking ? '<span class="spin"></span> <span>Checking…</span>' : icon('play') + ' <span>Run checker now</span>'}</button>
    <button class="icon-btn m-only" data-act="theme" aria-label="Switch theme">${icon(light ? 'moon' : 'sun')}</button>
    <button class="icon-btn m-only" data-act="signout" aria-label="Sign out">${icon('out')}</button>`;
  $('#sidefoot').innerHTML = `
    <div class="who" title="${esc(getSession()?.email)}">${esc(getSession()?.email)}</div>
    <button class="side-btn" data-act="theme">${icon(light ? 'moon' : 'sun')} ${light ? 'Dark mode' : 'Light mode'}</button>
    <button class="side-btn" data-act="signout">${icon('out')} Sign out</button>`;
}

async function refreshBadge() {
  try { reviewCount = await countOf('ai_feedback', 'review_status=eq.needs_review'); renderChrome(); } catch { /* ignore */ }
}

function renderView() {
  const el = $('#view');
  el.scrollTop = 0; window.scrollTo(0, 0);
  ({ overview: viewOverview, review: viewReview, facts: viewFacts, feedback: viewFeedback })[view]();
}

// global click handling (actions are data-act attributes)
async function onClick(e: MouseEvent) {
  const t = e.target as HTMLElement;
  const r = t.closest('[data-retry]'); if (r) { renderView(); return; }
  const a = t.closest('[data-act]') as HTMLElement | null;
  if (!a) return;
  const act = a.dataset.act!;
  if (act === 'theme') toggleTheme();
  else if (act === 'signout') { await signOut(); renderLogin(); }
  else if (act === 'run') runNow();
  else if (act === 'close-drawer') closeDrawer();
}

async function runNow() {
  if (checking) return;
  checking = true; renderChrome();
  try {
    const out = await runChecker();
    localStorage.setItem('elric-admin-lastrun', String(Date.now()));
    const n = (k: string) => Number(out[k] || 0);
    const parts = [
      n('checked') && `checked ${n('checked')}`, n('auto_added') && `added ${n('auto_added')} fact${n('auto_added') > 1 ? 's' : ''}`,
      n('needs_review') + n('no_question') && `${n('needs_review') + n('no_question')} to review`, n('rejected') && `${n('rejected')} answer(s) were right`,
      n('duplicate') && `${n('duplicate')} already covered`, n('deferred') && `${n('deferred')} left for next run`,
    ].filter(Boolean);
    toast(parts.length ? 'Checker done: ' + parts.join(' · ') : 'Checker done: nothing new to check.', 'ok');
    if (out.last_error) toast('Some items will be retried next hour.', '');
  } catch (err) { toast((err as Error).message || 'Checker failed', 'err'); }
  checking = false; renderChrome(); refreshBadge(); renderView();
}

// ---------- drawer ----------
function openDrawer(html: string, onMount?: (d: HTMLElement) => void) {
  const w = $('#drawer'); const d = $('.drawer', w);
  d.innerHTML = html; w.hidden = false;
  requestAnimationFrame(() => w.classList.add('open'));
  w.onclick = (e) => { if (e.target === w) closeDrawer(); };
  onMount?.(d);
}
function closeDrawer() {
  const w = $('#drawer'); if (!w || w.hidden) return;
  w.classList.remove('open'); setTimeout(() => { w.hidden = true; }, 200);
}
const drawerHead = (title: string) => `<div class="d-head"><h3>${esc(title)}</h3><button class="icon-btn" data-act="close-drawer" aria-label="Close">${icon('x')}</button></div>`;

// ---------- 1. Overview ----------
async function viewOverview() {
  const el = $('#view');
  el.innerHTML = `<div class="grid-stats">${'<div class="stat skel"></div>'.repeat(5)}</div>${loading(2)}`;
  try {
    const since = isoDaysAgo(7);
    const [recent, needs, autoActive, active, status, lastAuto] = await Promise.all([
      rest<Pick<Feedback, 'kind' | 'created_at' | 'app_version' | 'device' | 'platform' | 'review_status'>[]>(
        `ai_feedback?select=kind,created_at,app_version,device,platform,review_status&created_at=gte.${since}&order=created_at.desc&limit=5000`),
      countOf('ai_feedback', 'review_status=eq.needs_review'),
      countOf('ai_facts', 'source=eq.auto&active=is.true'),
      countOf('ai_facts', 'active=is.true'),
      rest<{ start_time: string | null; status: string | null }>('rpc/ai_admin_checker_status', { method: 'POST', body: '{}' }).then((r) => r.data).catch(() => null),
      rest<{ updated_at: string }[]>('ai_facts?select=updated_at&source=eq.auto&order=updated_at.desc&limit=1').then((r) => r.data[0]?.updated_at || null),
    ]);
    if (view !== 'overview') return;
    reviewCount = needs; renderChrome();
    const rows = recent.data;
    const fb = rows.filter((r) => FEEDBACK_KINDS.includes(r.kind));
    const errs = rows.filter((r) => ERROR_KINDS.includes(r.kind));
    const newFb = fb.filter((r) => r.review_status === 'new').length;
    const days = Array.from({ length: 7 }, (_, i) => dayKey(new Date(Date.now() - (6 - i) * 86400000)));
    const series = (list: { created_at: string }[]) => days.map((d) => list.filter((r) => dayKey(r.created_at) === d).length);
    const spark = (vals: number[], cls: string) => {
      const max = Math.max(1, ...vals);
      return `<div class="spark ${cls}" aria-hidden="true">${vals.map((v, i) => `<i style="height:${Math.max(6, (v / max) * 100)}%" title="${esc(fmt(days[i], false))}: ${v}" class="${v ? '' : 'zero'}"></i>`).join('')}</div>`;
    };
    const lastRun = localStorage.getItem('elric-admin-lastrun');
    const group = (key: 'app_version' | 'device') => {
      const m = new Map<string, number>();
      for (const r of errs) { const k = (key === 'device' ? [r.platform, r.device].filter(Boolean).join(' · ') : r.app_version) || 'Unknown'; m.set(k, (m.get(k) || 0) + 1); }
      const list = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      const max = Math.max(1, ...list.map((x) => x[1]));
      return list.length ? `<ul class="bars">${list.map(([k, v]) => `<li><span class="bl" title="${esc(k)}">${esc(k)}</span><span class="bt"><i style="width:${(v / max) * 100}%"></i></span><b>${v}</b></li>`).join('')}</ul>`
        : '<p class="muted small">No error reports in the last 7 days.</p>';
    };
    const stat = (label: string, value: number, sub: string, extra = '', href = '') =>
      `<${href ? `a href="${href}"` : 'div'} class="stat${href ? ' link' : ''}"><span class="sl">${label}</span><span class="sv">${value}</span><span class="ss">${sub}</span>${extra}</${href ? 'a' : 'div'}>`;
    el.innerHTML = `
      <div class="grid-stats">
        ${stat('New 👎 reports', fb.length, `${newFb} waiting for the checker · 7 days`, spark(series(fb), 'gold'), '#/feedback')}
        ${stat('Needs review', needs, needs ? 'Waiting for you' : 'All clear', '', '#/review')}
        ${stat('Auto-added facts', autoActive, lastAuto ? `Latest ${ago(lastAuto)}` : 'None yet', '', '#/facts')}
        ${stat('Active facts', active, 'Sent to every app', '', '#/facts')}
        ${stat('Error reports', errs.length, 'Crashes & stuck · 7 days', spark(series(errs), 'red'), '#/feedback')}
      </div>
      <div class="grid-2">
        <section class="panel"><h3>Errors by app version <span class="muted small">7 days</span></h3>${group('app_version')}</section>
        <section class="panel"><h3>Errors by device <span class="muted small">7 days</span></h3>${group('device')}</section>
      </div>
      <section class="panel checker">
        <div><h3>Auto-checker</h3><p class="muted small">Runs every hour and checks new 👎 reports against trusted sources.</p></div>
        <dl>
          <div><dt>Last scheduled run</dt><dd>${status?.start_time ? `${ago(status.start_time)} <span class="muted small">(${esc(fmt(status.start_time))}${status.status ? ' · ' + esc(status.status) : ''})</span>` : '<span class="muted">No run recorded yet</span>'}</dd></div>
          <div><dt>Last manual run</dt><dd>${lastRun ? ago(Number(lastRun)) : '<span class="muted">Not from this device</span>'}</dd></div>
          <div><dt>Last auto-added fact</dt><dd>${lastAuto ? ago(lastAuto) : '<span class="muted">None yet</span>'}</dd></div>
        </dl>
      </section>`;
  } catch (e) { if (view === 'overview') el.innerHTML = errorBox(e, 'overview'); }
}

// ---------- 2. Review queue ----------
let reviewFilter: 'all' | 'answers' | 'errors' = 'all';
async function viewReview() {
  const el = $('#view');
  el.innerHTML = loading(3);
  let rows: Feedback[];
  try {
    rows = (await rest<Feedback[]>('ai_feedback?select=*&review_status=eq.needs_review&order=created_at.desc&limit=200')).data;
  } catch (e) { if (view === 'review') el.innerHTML = errorBox(e, 'review'); return; }
  if (view !== 'review') return;
  reviewCount = rows.length; renderChrome();
  const draw = () => {
    const nA = rows.filter((r) => !isError(r.kind)).length, nE = rows.length - nA;
    const list = rows.filter((r) => reviewFilter === 'all' || (reviewFilter === 'errors') === isError(r.kind));
    el.innerHTML = `
      <div class="toolbar"><div class="seg" role="tablist">
        ${(['all', 'answers', 'errors'] as const).map((f) => `<button data-f="${f}" class="${reviewFilter === f ? 'on' : ''}">${{ all: 'All', answers: 'Answers', errors: 'Error reports' }[f]} <span>${{ all: rows.length, answers: nA, errors: nE }[f]}</span></button>`).join('')}
      </div></div>
      ${list.length ? `<div class="cards">${list.map(card).join('')}</div>` : empty('Nothing to review', 'New items appear here when the checker needs your decision.')}`;
    el.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => b.onclick = () => { reviewFilter = b.dataset.f as typeof reviewFilter; draw(); });
    el.querySelectorAll<HTMLElement>('.rcard').forEach((c) => wireCard(c));
  };
  const card = (r: Feedback) => {
    const sug = suggestedFact(r.ai_verdict);
    const err = isError(r.kind);
    return `<article class="rcard" data-id="${esc(r.id)}">
      <header>${kindChip(r.kind)}<span class="muted small">${esc(ago(r.created_at))} · ${esc([r.app_version && 'v' + r.app_version, r.platform].filter(Boolean).join(' · '))}</span></header>
      ${r.question ? `<div class="qa"><div><label>Question</label><p>${esc(r.question)}</p></div>${r.answer ? `<div><label>App answer</label><p class="ans">${esc(r.answer)}</p></div>` : ''}</div>` : `<p class="muted">${err ? esc([r.device, r.backend, r.model].filter(Boolean).join(' · ') || 'No device details') : 'The user did not share the question and answer.'}</p>`}
      ${r.note ? `<div class="note"><label>User note</label><p>${esc(r.note)}</p></div>` : ''}
      ${r.ai_verdict && !/^No question shared/.test(r.ai_verdict) ? `<div class="verdict"><label>Checker verdict</label><p>${esc(verdictText(r.ai_verdict))}</p></div>` : ''}
      ${links(r.ai_sources).length ? `<div><label>Sources</label>${linkList(r.ai_sources)}</div>` : ''}
      ${!err ? `<div class="approve"><label for="f-${esc(r.id)}">Fact to add ${sug ? '<span class="muted small">(suggested — edit if needed)</span>' : ''}</label>
        <textarea id="f-${esc(r.id)}" rows="2" maxlength="300" placeholder="Write one short, correct fact…">${esc(sug)}</textarea></div>` : ''}
      <footer>
        ${!err ? '<button class="btn primary" data-do="approve">Approve & add fact</button>' : ''}
        <button class="btn" data-do="reject">${err ? 'Dismiss' : 'Reject'}</button>
        <button class="btn ghost danger-t" data-do="delete">Delete (spam)</button>
      </footer>
    </article>`;
  };
  const wireCard = (c: HTMLElement) => {
    const id = c.dataset.id!; const row = rows.find((r) => r.id === id)!;
    c.querySelectorAll<HTMLButtonElement>('[data-do]').forEach((b) => b.onclick = async () => {
      const act = b.dataset.do!;
      const busy = (on: boolean) => c.querySelectorAll('button').forEach((x) => ((x as HTMLButtonElement).disabled = on));
      try {
        if (act === 'approve') {
          const fact = (c.querySelector('textarea') as HTMLTextAreaElement).value.trim();
          if (fact.length < 5) { toast('Please write the fact first.', 'err'); (c.querySelector('textarea') as HTMLTextAreaElement).focus(); return; }
          busy(true);
          const lang = /[\u0900-\u097F]/.test(fact + (row.question || '')) ? 'hi' : 'en';
          const src = links(row.ai_sources);
          await rest('ai_facts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
            topic: 'general', fact, lang, active: true, source: 'manual',
            sources: { sources: src.map((uri) => ({ uri })), from_feedback: row.id, approved_by: 'admin' },
          }) });
          await rest(`ai_feedback?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ review_status: 'auto_added', reviewed_at: new Date().toISOString() }) });
          toast('Fact added. Apps will pick it up on their next sync.', 'ok');
        } else if (act === 'reject') {
          busy(true);
          await rest(`ai_feedback?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ review_status: 'rejected', reviewed_at: new Date().toISOString() }) });
          toast(isError(row.kind) ? 'Dismissed.' : 'Rejected.', 'ok');
        } else if (act === 'delete') {
          if (!(await confirmBox('Delete this report?', 'It will be removed permanently. Use this for spam.'))) return;
          busy(true);
          await rest(`ai_feedback?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
          toast('Deleted.', 'ok');
        }
        rows = rows.filter((r) => r.id !== id); reviewCount = rows.length; renderChrome();
        c.classList.add('gone'); setTimeout(draw, 220);
      } catch (e) { busy(false); toast((e as Error).message, 'err'); }
    });
  };
  draw();
}

// ---------- 3. Facts ----------
let factQuery = '';
let factFilter: 'all' | 'active' | 'inactive' | 'manual' | 'auto' = 'all';
async function viewFacts() {
  const el = $('#view');
  el.innerHTML = loading(5);
  let facts: Fact[];
  try { facts = (await rest<Fact[]>('ai_facts?select=*&order=updated_at.desc&limit=1000')).data; }
  catch (e) { if (view === 'facts') el.innerHTML = errorBox(e, 'facts'); return; }
  if (view !== 'facts') return;
  el.innerHTML = `
    <div class="toolbar">
      <div class="search">${icon('search')}<input id="fq" type="search" placeholder="Search facts or topics" value="${esc(factQuery)}" autocomplete="off"></div>
      <select id="ff" aria-label="Filter">
        ${(['all', 'active', 'inactive', 'manual', 'auto'] as const).map((f) => `<option value="${f}" ${factFilter === f ? 'selected' : ''}>${{ all: 'All facts', active: 'Active', inactive: 'Inactive', manual: 'Manual', auto: 'Auto-added' }[f]}</option>`).join('')}
      </select>
      <button class="btn primary" id="addf">${icon('plus')} <span>Add fact</span></button>
    </div>
    <p class="muted small" id="fcount"></p>
    <div id="flist" class="flist"></div>`;
  const draw = () => {
    const q = factQuery.trim().toLowerCase();
    const list = facts.filter((f) =>
      (factFilter === 'all' || (factFilter === 'active' && f.active) || (factFilter === 'inactive' && !f.active) || f.source === factFilter) &&
      (!q || (f.fact + ' ' + (f.topic || '')).toLowerCase().includes(q)));
    $('#fcount').textContent = `${list.length} of ${facts.length} facts · ${facts.filter((f) => f.active).length} active`;
    $('#flist').innerHTML = list.length ? list.map((f) => `
      <div class="frow ${f.active ? '' : 'off'}" data-id="${f.id}">
        <label class="switch" title="${f.active ? 'Active — sent to apps' : 'Inactive'}"><input type="checkbox" ${f.active ? 'checked' : ''} aria-label="Active"><i></i></label>
        <button class="fmain" data-edit>
          <span class="ftext">${esc(f.fact)}</span>
          <span class="fmeta">${f.topic ? `<span class="chip">${esc(f.topic)}</span>` : ''}<span class="chip ${f.source === 'auto' ? 'c-auto' : 'c-man'}">${f.source === 'auto' ? 'Auto' : 'Manual'}</span>${f.lang === 'hi' ? '<span class="chip">हिंदी</span>' : ''}${links(f.sources).length ? `<span class="muted small">${links(f.sources).length} source${links(f.sources).length > 1 ? 's' : ''}</span>` : ''}<span class="muted small">${esc(ago(f.updated_at))}</span></span>
        </button>
      </div>`).join('') : (facts.length ? empty('No matching facts', 'Try a different search or filter.') : empty('No facts yet', 'Add a fact and every app will receive it on its next sync.'));
    $('#flist').querySelectorAll<HTMLElement>('.frow').forEach((row) => {
      const f = facts.find((x) => x.id === Number(row.dataset.id))!;
      const cb = row.querySelector('input') as HTMLInputElement;
      cb.onchange = async () => {
        cb.disabled = true;
        try {
          await rest(`ai_facts?id=eq.${f.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: cb.checked, updated_at: new Date().toISOString() }) });
          f.active = cb.checked; f.updated_at = new Date().toISOString(); toast(cb.checked ? 'Fact is active.' : 'Fact turned off.', 'ok'); draw();
        } catch (e) { cb.checked = !cb.checked; cb.disabled = false; toast((e as Error).message, 'err'); }
      };
      (row.querySelector('[data-edit]') as HTMLElement).onclick = () => factForm(f);
    });
  };
  const factForm = (f?: Fact) => {
    openDrawer(`${drawerHead(f ? 'Edit fact' : 'Add fact')}
      <form class="d-body form" id="factf">
        <label for="ft">Fact</label>
        <textarea id="ft" rows="4" maxlength="300" required placeholder="One short, correct, standalone sentence.">${esc(f?.fact)}</textarea>
        <div class="row2">
          <div><label for="tp">Topic</label><input id="tp" maxlength="60" placeholder="e.g. geography" value="${esc(f?.topic || '')}"></div>
          <div><label for="lg">Language</label><select id="lg"><option value="en">English</option><option value="hi" ${f?.lang === 'hi' ? 'selected' : ''}>हिंदी (Hindi)</option></select></div>
        </div>
        <label class="check"><input type="checkbox" id="ac" ${!f || f.active ? 'checked' : ''}> Active (sent to apps)</label>
        ${f ? `<div class="meta"><div><span>Source</span><b>${f.source === 'auto' ? 'Auto-added by checker' : 'Manual'}</b></div><div><span>Updated</span><b>${esc(fmt(f.updated_at))}</b></div></div>
          <div><label>Sources</label>${linkList(f.sources)}</div>` : ''}
        <div class="d-foot">
          ${f ? '<button type="button" class="btn ghost danger-t" id="delf">Delete</button>' : ''}
          <span class="grow"></span>
          <button type="button" class="btn" data-act="close-drawer">Cancel</button>
          <button type="submit" class="btn primary" id="savef">${f ? 'Save' : 'Add fact'}</button>
        </div>
      </form>`, (d) => {
      const ft = $<HTMLTextAreaElement>('#ft', d);
      setTimeout(() => ft.focus(), 50);
      $('#factf', d).onsubmit = async (e) => {
        e.preventDefault();
        const fact = ft.value.trim();
        if (fact.length < 5) { toast('Please write the fact.', 'err'); ft.focus(); return; }
        const body = { fact, topic: $<HTMLInputElement>('#tp', d).value.trim() || 'general', lang: $<HTMLSelectElement>('#lg', d).value, active: $<HTMLInputElement>('#ac', d).checked, updated_at: new Date().toISOString() };
        const b = $<HTMLButtonElement>('#savef', d); b.disabled = true; b.textContent = 'Saving…';
        try {
          if (f) {
            const { data } = await rest<Fact[]>(`ai_facts?id=eq.${f.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
            Object.assign(f, data[0] || body); toast('Fact saved.', 'ok');
          } else {
            const { data } = await rest<Fact[]>('ai_facts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...body, source: 'manual' }) });
            facts.unshift(data[0]); toast('Fact added.', 'ok');
          }
          closeDrawer(); draw();
        } catch (err) { b.disabled = false; b.textContent = f ? 'Save' : 'Add fact'; toast((err as Error).message, 'err'); }
      };
      const del = $('#delf', d);
      if (del && f) del.onclick = async () => {
        if (!(await confirmBox('Delete this fact?', 'Apps will stop using it after their next sync. To pause it instead, turn it off.'))) return;
        try {
          await rest(`ai_facts?id=eq.${f.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
          facts = facts.filter((x) => x.id !== f.id); toast('Fact deleted.', 'ok'); closeDrawer(); draw();
        } catch (err) { toast((err as Error).message, 'err'); }
      };
    });
  };
  let t: number | undefined;
  $<HTMLInputElement>('#fq').oninput = (e) => { clearTimeout(t); t = window.setTimeout(() => { factQuery = (e.target as HTMLInputElement).value; draw(); }, 120); };
  $<HTMLSelectElement>('#ff').onchange = (e) => { factFilter = (e.target as HTMLSelectElement).value as typeof factFilter; draw(); };
  $('#addf').onclick = () => factForm();
  draw();
}

// ---------- 4. All feedback & error reports ----------
const fbFilter = { type: 'all', status: 'all', version: 'all', range: '30' };
const PAGE = 50;
async function viewFeedback() {
  const el = $('#view');
  el.innerHTML = loading(6);
  let versions: string[] = [];
  try {
    const v = await rest<{ app_version: string | null }[]>('ai_feedback?select=app_version&order=created_at.desc&limit=2000');
    versions = [...new Set(v.data.map((x) => x.app_version).filter(Boolean) as string[])].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch (e) { if (view === 'feedback') el.innerHTML = errorBox(e, 'feedback'); return; }
  if (view !== 'feedback') return;
  const sel = (id: string, label: string, opts: [string, string][], cur: string) =>
    `<label class="fsel"><span>${label}</span><select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  el.innerHTML = `
    <div class="toolbar filters">
      ${sel('ftype', 'Type', [['all', 'All types'], ['feedback', '👎 Feedback'], ['wrong_answer', 'Wrong answer'], ['thumbs_down', 'Not helpful'], ['errors', 'Error reports'], ['crash', 'Crash'], ['stuck', 'Stuck on load']], fbFilter.type)}
      ${sel('fstatus', 'Status', [['all', 'Any status'], ['new', 'New'], ['needs_review', 'Needs review'], ['auto_added', 'Resolved'], ['rejected', 'Rejected']], fbFilter.status)}
      ${sel('fver', 'Version', [['all', 'All versions'], ...versions.map((v) => [v, 'v' + v] as [string, string])], fbFilter.version)}
      ${sel('frange', 'Date', [['1', 'Last 24 hours'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['all', 'All time']], fbFilter.range)}
    </div>
    <p class="muted small" id="fbcount"></p>
    <div id="fbtable"></div>`;
  let rows: Feedback[] = []; let total = 0;
  const query = (offset: number) => {
    const q: string[] = ['select=*', 'order=created_at.desc', `limit=${PAGE}`, `offset=${offset}`];
    const t = fbFilter.type;
    if (t === 'feedback') q.push(`kind=in.(${FEEDBACK_KINDS})`); else if (t === 'errors') q.push(`kind=in.(${ERROR_KINDS})`); else if (t !== 'all') q.push(`kind=eq.${t}`);
    if (fbFilter.status !== 'all') q.push(`review_status=eq.${fbFilter.status}`);
    if (fbFilter.version !== 'all') q.push(`app_version=eq.${encodeURIComponent(fbFilter.version)}`);
    if (fbFilter.range !== 'all') q.push(`created_at=gte.${isoDaysAgo(Number(fbFilter.range))}`);
    return 'ai_feedback?' + q.join('&');
  };
  const load = async (more = false) => {
    const box = $('#fbtable');
    if (!more) box.innerHTML = loading(6);
    try {
      const r = await rest<Feedback[]>(query(more ? rows.length : 0), { count: true });
      if (view !== 'feedback') return;
      rows = more ? rows.concat(r.data) : r.data; total = r.count ?? rows.length; draw();
    } catch (e) { box.innerHTML = errorBox(e, 'feedback'); }
  };
  const draw = () => {
    $('#fbcount').textContent = total ? `Showing ${rows.length} of ${total}` : '';
    const box = $('#fbtable');
    if (!rows.length) { box.innerHTML = empty('No reports here', 'Nothing matches these filters. Try a wider date range.'); return; }
    box.innerHTML = `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th>Type</th><th>Status</th><th class="hide-s">Version</th><th class="hide-s">Device</th><th>Summary</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-i="${i}" tabindex="0">
        <td class="nowrap">${esc(fmt(r.created_at))}</td><td>${kindChip(r.kind)}</td><td>${statusChip(r.review_status)}</td>
        <td class="hide-s nowrap">${esc(r.app_version ? 'v' + r.app_version : '—')}</td>
        <td class="hide-s">${esc([r.platform, r.device].filter(Boolean).join(' · ') || '—')}</td>
        <td class="sum">${esc((r.question || r.note || [r.backend, r.model].filter(Boolean).join(' · ') || '—').slice(0, 140))}</td></tr>`).join('')}</tbody>
    </table></div>
    ${rows.length < total ? '<button class="btn block" id="more">Load more</button>' : ''}`;
    box.querySelectorAll<HTMLElement>('tr[data-i]').forEach((tr) => {
      const open = () => detail(rows[Number(tr.dataset.i)]);
      tr.onclick = open; tr.onkeydown = (e) => { if (e.key === 'Enter') open(); };
    });
    const m = $('#more', box); if (m) m.onclick = () => { m.textContent = 'Loading…'; load(true); };
  };
  const detail = (r: Feedback) => {
    const kv = (k: string, v: string | null | undefined) => v ? `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>` : '';
    openDrawer(`${drawerHead(KIND_LABEL[r.kind] || r.kind)}
      <div class="d-body">
        <div class="row">${kindChip(r.kind)}${statusChip(r.review_status)}</div>
        <div class="meta">${kv('Received', fmt(r.created_at))}${kv('App version', r.app_version && 'v' + r.app_version)}${kv('Platform', r.platform)}${kv('Device', r.device)}${kv('Backend', r.backend)}${kv('Model', r.model)}${kv('Mode', r.mode)}${kv('Reviewed', r.reviewed_at && fmt(r.reviewed_at))}</div>
        ${r.question ? `<div><label>Question</label><p class="block-t">${esc(r.question)}</p></div>` : ''}
        ${r.answer ? `<div><label>App answer</label><p class="block-t ans">${esc(r.answer)}</p></div>` : ''}
        ${r.note ? `<div><label>User note</label><p class="block-t">${esc(r.note)}</p></div>` : ''}
        ${r.ai_verdict ? `<div><label>Checker verdict</label><p class="block-t">${esc(r.ai_verdict)}</p></div>` : ''}
        ${links(r.ai_sources).length ? `<div><label>Sources</label>${linkList(r.ai_sources)}</div>` : ''}
        <div class="d-foot">
          <button class="btn ghost danger-t" id="delr">Delete</button><span class="grow"></span>
          ${r.review_status === 'needs_review' ? '<a class="btn primary" href="#/review" data-act="close-drawer">Open review queue</a>' : ''}
        </div>
      </div>`, (d) => {
      $('#delr', d).onclick = async () => {
        if (!(await confirmBox('Delete this report?', 'It will be removed permanently.'))) return;
        try {
          await rest(`ai_feedback?id=eq.${r.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
          rows = rows.filter((x) => x.id !== r.id); total = Math.max(0, total - 1); toast('Deleted.', 'ok'); closeDrawer(); draw(); refreshBadge();
        } catch (err) { toast((err as Error).message, 'err'); }
      };
    });
  };
  ([['ftype', 'type'], ['fstatus', 'status'], ['fver', 'version'], ['frange', 'range']] as const).forEach(([id, k]) => {
    $<HTMLSelectElement>('#' + id).onchange = (e) => { fbFilter[k] = (e.target as HTMLSelectElement).value; load(); };
  });
  load();
}

// ---------- boot ----------
async function boot() {
  applyTheme();
  app.innerHTML = '<div class="boot"><span class="spin"></span></div>';
  const linkErr = await consumeRedirect();
  if (linkErr) { renderLogin(linkErr); return; }
  let s = getSession();
  if (s) { try { s = await ensureFresh(); } catch { s = getSession(); } }
  if (!s) { renderLogin(); return; }
  if (!isOwner(s.email)) { renderDenied(s.email); return; }
  renderShell();
  // keep the session fresh while the tab is open
  setInterval(() => { ensureFresh().catch(() => {}); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureFresh().then((x) => { if (!x) renderLogin(); }).catch(() => {});
  });
}
boot();
