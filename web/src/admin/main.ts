import './admin.css';
import qrcode from 'qrcode-generator';
import {
  ApiError, consumeRedirect, countOf, ensureFresh, getSession, isOwner, rest, runChecker, sendMagicLink, signInWithCode, signOut, totpSetup,
  type AdminEvent, type Automation, type Fact, type Feedback,
} from './api';

// ---------- helpers ----------
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[];
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const TZ = 'Asia/Kolkata';
const fmt = (d: string | number | Date | null | undefined, withTime = true) => d
  ? new Date(d).toLocaleString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) })
  : '—';
const fmtDay = (d: string | Date) => new Date(d).toLocaleDateString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short' });
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
const STATUS_LABEL: Record<string, string> = { new: 'Being checked', needs_review: 'Waiting for you', auto_added: 'Fixed', rejected: 'Closed', duplicate: 'Repeat' };
const isError = (k: string) => ERROR_KINDS.includes(k);
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const NEWS_DAYS = 30;
const dateInput = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const inDays = (n: number) => new Date(Date.now() + n * 86400000);

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
    return `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${icon('link')}<span>${esc(h.length > 64 ? h.slice(0, 62) + '…' : h)}</span></a></li>`;
  }).join('')}</ul>`;
};
function suggestedFact(v: string | null) {
  const m = (v || '').match(/Suggested fact:\s*(.+)$/s);
  return m ? m[1].trim() : '';
}
/** Checker verdict in plain English (drops the internal "status/category:" prefix and the suggested fact). */
function verdictText(v: string | null) {
  let t = (v || '').replace(/\s*\|\s*Suggested fact:.*$/s, '').replace(/^Re-checked after 24 h:\s*/, '').trim();
  t = t.replace(/\b(correct|wrong|partly_wrong|unsure)\/(general_public_fact|personal|opinion|elric_or_founder|local_business|time_sensitive|other):\s*/g, '');
  t = t.replace(/\bgemini(-[\w.-]+)?/gi, 'AI').replace(/\bgemma(-[\w.-]+)?/gi, 'AI');
  return t
    .replace(/^Needs review \(only (\d) independent source\(s\)\)\.?/, (_, n) => `Found ${n === '1' ? 'only 1 trusted source' : n === '0' ? 'no trusted sources' : n + ' sources'} (needs 2 to fix it alone).`)
    .replace(/^Needs review \(time_sensitive\)\.?/, 'This is news or changes over time.')
    .replace(/^Needs review \(Elric\/founder topic\)\.?/, 'About Elric or the founder, so only you can decide.')
    .replace(/^Needs review \((personal|opinion|local_business|other)\)\.?/, (_, c) => `Not a public fact (${c.replace('_', ' ')}).`)
    .replace(/^Needs review \(similar to fact #(\d+)\)\.?/, 'Very similar to fact #$1 — check it is not a repeat.')
    .replace(/^Needs review \(auto-add is switched off; (\d+) sources agree\)\.?/, 'Proven by $1 sources, but auto-add is switched off.')
    .replace(/^Needs review \(([^)]*)\)\.?/, '$1.')
    .trim();
}
const isNewsVerdict = (v: string | null) => /\/time_sensitive:|time_sensitive\)/.test(v || '');
const kindChip = (k: string) => `<span class="chip ${isError(k) ? 'c-err' : 'c-fb'}">${icon(isError(k) ? 'alert' : 'thumb')}${esc(KIND_LABEL[k] || k)}</span>`;
const statusChip = (s: string) => `<span class="chip s-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;

const I = {
  overview: '<path d="M4 13h6V4H4zm0 7h6v-5H4zm10 0h6v-9h-6zm0-16v5h6V4z"/>',
  review: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
  facts: '<path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h6M8 11h6"/>',
  feedback: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
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
  chat: '<path d="M7 8h10M7 12h6"/><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  broom: '<path d="M14 4l6 6"/><path d="M17 7l-7.5 7.5"/><path d="M9.5 14.5L4 20h7l2-2.5"/><path d="M6 17l2 2"/>',
  merge: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7M8.3 7.2c3.5 1 5.5 2.5 7.4 4M8.3 16.8c3.5-1 5.5-2.5 7.4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  thumb: '<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.7a2 2 0 0 0-2 1.7l-1.4 9A2 2 0 0 0 4.3 15z"/><path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  menu: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
};
const icon = (n: keyof typeof I) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

// ---------- theme ----------
function applyTheme(t?: string) {
  const theme = t || localStorage.getItem('elric-admin-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
  $('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#F5F5F7' : '#0B0B0E');
  return theme;
}
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('elric-admin-theme', t); applyTheme(t); renderChrome();
}

// ---------- toast / confirm ----------
function toast(msg: string, kind: 'ok' | 'err' | '' = '') {
  const box = $('#toasts'); if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.setAttribute('role', 'status');
  el.innerHTML = `${kind === 'ok' ? icon('check') : kind === 'err' ? icon('alert') : ''}<span>${esc(msg)}</span>`;
  box.append(el);
  setTimeout(() => el.classList.add('out'), 3600);
  setTimeout(() => el.remove(), 4000);
}
function confirmBox(title: string, body: string, okLabel = 'Delete', danger = true): Promise<boolean> {
  return new Promise((res) => {
    const m = document.createElement('div');
    m.className = 'modal-wrap';
    m.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3><p class="muted">${esc(body)}</p>
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
type View = 'overview' | 'review' | 'facts' | 'cache' | 'reports' | 'automations';
const VIEWS: { id: View; label: string; short: string; ic: keyof typeof I; sub: string }[] = [
  { id: 'overview', label: 'Overview', short: 'Home', ic: 'overview', sub: 'How Elric AI is doing today' },
  { id: 'review', label: 'Review', short: 'Review', ic: 'inbox', sub: 'Reports that need your decision' },
  { id: 'facts', label: 'Facts', short: 'Facts', ic: 'book', sub: 'What every app knows and uses' },
  { id: 'cache', label: 'Cache', short: 'Cache', ic: 'bolt', sub: 'Ready answers for common questions' },
  { id: 'reports', label: 'Reports', short: 'Reports', ic: 'feedback', sub: 'Every report from users, newest first' },
  { id: 'automations', label: 'Automations', short: 'Auto', ic: 'bolt', sub: 'Jobs that run by themselves every hour' },
];
const hashView = () => { const h = location.hash.replace('#/', '').split('?')[0]; return (h === 'feedback' ? 'reports' : h) as View; };
let view: View = hashView() || 'overview';
if (!VIEWS.some((v) => v.id === view)) view = 'overview';
let reviewCount: number | null = null;
let cacheCount: number | null = null;
let checking = false;
const app = document.getElementById('app')!;

const errorBox = (e: unknown, retry: string) => {
  if ((e as ApiError)?.status === 401 || !getSession()) { setTimeout(() => renderLogin('Your session ended. Please sign in again.'), 0); return ''; }
  return `<div class="state err"><div class="state-ic">${icon('alert')}</div><b>Couldn't load this</b><p class="muted">${esc((e as Error)?.message || 'Network error')}</p><button class="btn" data-retry="${retry}">${icon('refresh')} Try again</button></div>`;
};
const loading = (n = 3) => `<div class="skel-list">${'<div class="skel"></div>'.repeat(n)}</div>`;
const empty = (title: string, body: string, ic: keyof typeof I = 'check') => `<div class="state"><div class="state-ic">${icon(ic)}</div><b>${esc(title)}</b><p class="muted">${esc(body)}</p></div>`;
const pageHead = (extra = '') => {
  const v = VIEWS.find((x) => x.id === view)!;
  return `<div class="page-head"><div><h1>${esc(v.label)}</h1><p class="muted">${esc(v.sub)}</p></div>${extra}</div>`;
};

// ---------- sign-in screens ----------
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LATER = 'Please try again a bit later.';
const friendly = (err: unknown) => {
  const e = err as ApiError, m = e?.message || '';
  return e?.status === 429 || /rate|limit|too many|seconds/i.test(m) ? LATER : (m || LATER);
};

function renderLogin(msg = '', sentTo = '', mode: 'code' | 'link' = 'code') {
  app.className = 'auth';
  const last = localStorage.getItem('elric-admin-email') || '';
  app.innerHTML = `<div class="auth-card">
    <img src="../icons/mark.png" alt="" class="auth-mark" width="48" height="48">
    <h1>Elric AI Admin</h1>
    ${sentTo ? `<div class="sent">${icon('mail')}<div><b>Check your email</b><p class="muted">We sent a sign-in link to <b>${esc(sentTo)}</b>. Open it in this browser. It can take a minute.</p></div></div>
      <button class="btn block" id="again">Back to sign in</button>`
    : mode === 'link' ? `<p class="muted">We'll email you a one-time sign-in link.</p>
      <form id="lf" novalidate>
        <label for="em">Email</label>
        <input id="em" type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="you@example.com" value="${esc(last)}" required>
        ${msg ? `<p class="form-err">${esc(msg)}</p>` : ''}
        <button class="btn primary block" type="submit" id="sb">Email me a link</button>
      </form>
      <button class="linkish" id="tocode">Back to sign in with a code</button>`
    : `<p class="muted">Sign in with your email and the code from your authenticator app.</p>
      <form id="cf" novalidate>
        <label for="em">Email</label>
        <input id="em" type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="you@example.com" value="${esc(last)}" required>
        <label for="cd" class="mt">6-digit code from your authenticator app</label>
        <input id="cd" class="code-in" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="7" placeholder="123 456" required>
        ${msg ? `<p class="form-err">${esc(msg)}</p>` : ''}
        <button class="btn primary block" type="submit" id="sb">Sign in</button>
      </form>
      <button class="linkish" id="tolink">Forgot / not set up yet? Email me a link</button>`}
    <p class="fine">${icon('lock')} Private admin area · stays signed in on this device</p>
  </div>`;
  $('#again')?.addEventListener('click', () => renderLogin());
  $('#tolink')?.addEventListener('click', () => renderLogin('', '', 'link'));
  $('#tocode')?.addEventListener('click', () => renderLogin());
  const em = $<HTMLInputElement>('#em'), cd = $<HTMLInputElement>('#cd');
  const checkEmail = () => {
    const email = em.value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { renderLogin('Please enter a valid email address.', '', mode); return null; }
    if (!isOwner(email)) { renderDenied(email); return null; }
    localStorage.setItem('elric-admin-email', email);
    return email;
  };
  cd?.addEventListener('input', () => {
    const d = cd.value.replace(/\D/g, '').slice(0, 6);
    cd.value = d;
    if (d.length === 6 && EMAIL_RE.test(em.value.trim())) $<HTMLFormElement>('#cf').requestSubmit();
  });
  $('#cf')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = checkEmail(); if (!email) return;
    const code = cd.value.replace(/\D/g, '');
    if (code.length !== 6) { renderLogin('Please enter the 6-digit code.'); return; }
    const b = $<HTMLButtonElement>('#sb'); b.disabled = true; b.textContent = 'Signing in…'; cd.disabled = true;
    try { const s = await signInWithCode(email, code); if (!isOwner(s.email)) { renderDenied(s.email); return; } startApp(); }
    catch (err) { renderLogin(friendly(err)); }
  });
  $('#lf')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = checkEmail(); if (!email) return;
    const b = $<HTMLButtonElement>('#sb'); b.disabled = true; b.textContent = 'Sending…';
    try { await sendMagicLink(email); renderLogin('', email); }
    catch (err) { renderLogin(friendly(err), '', 'link'); }
  });
  (last && cd ? cd : em)?.focus();
}

// ---------- authenticator setup (signed-in owner) ----------
async function openAuthenticator() {
  openDrawer(`${drawerHead('Authenticator app')}<div class="d-body" id="totp">${loading(2)}</div>`);
  const body = () => $('#totp');
  let st: { active: boolean };
  try { st = await totpSetup('status'); } catch (e) { body().innerHTML = `<p class="form-err">${esc(friendly(e))}</p>`; return; }
  body().innerHTML = `
    <p>${st.active ? '<b>✓ Authenticator is set up.</b> You sign in with your email and the 6-digit code from the app.' : 'Set up an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) so you can sign in with a 6-digit code instead of an email link.'}</p>
    <button class="btn primary" id="tstart">${st.active ? 'Reset authenticator' : 'Set up authenticator'}</button>
    ${st.active ? '<p class="muted small">Reset makes a new key. Your current code keeps working until you finish the new setup.</p>' : ''}`;
  $('#tstart').onclick = async () => {
    const b = $<HTMLButtonElement>('#tstart'); b.disabled = true; b.textContent = 'Preparing…';
    let k: { secret: string; uri: string };
    try { k = await totpSetup('start'); } catch (e) { b.disabled = false; b.textContent = 'Try again'; toast(friendly(e), 'err'); return; }
    const grouped = k.secret.match(/.{1,4}/g)!.join(' ');
    body().innerHTML = `
      <div><label>1 · Add this key to your authenticator app</label>
        <div class="totp-key" id="tkey">${esc(grouped)}</div>
        <div class="row"><button class="btn" id="tcopy">Copy key</button><a class="btn primary" href="${esc(k.uri)}">Add to authenticator app</a></div>
        <p class="muted small">In the app choose “Enter a setup key”, account <b>Elric AI Admin</b>, time-based. Or tap “Add to authenticator app” on this phone.</p>
        <details class="qr-alt" id="qrd"><summary>Show QR code instead</summary><div id="qr"></div></details>
      </div>
      <form id="tconf" novalidate>
        <label for="tcd">2 · Enter the 6-digit code the app shows</label>
        <input id="tcd" class="code-in" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" placeholder="123456">
        <p class="form-err" id="terr" hidden></p>
        <button class="btn primary block" id="tok" type="submit">Turn on</button>
      </form>`;
    $('#tcopy').onclick = async () => { try { await navigator.clipboard.writeText(k.secret); toast('Key copied', 'ok'); } catch { getSelection()?.selectAllChildren($('#tkey')); } };
    $('#qrd').addEventListener('toggle', () => {
      if (!$('#qr').innerHTML) { const q = qrcode(0, 'M'); q.addData(k.uri); q.make(); $('#qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }
    });
    const tcd = $<HTMLInputElement>('#tcd');
    tcd.oninput = () => { tcd.value = tcd.value.replace(/\D/g, '').slice(0, 6); };
    $('#tconf').onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#terr');
      if (tcd.value.length !== 6) { err.hidden = false; err.textContent = 'Please enter the 6-digit code.'; return; }
      const ok = $<HTMLButtonElement>('#tok'); ok.disabled = true; ok.textContent = 'Checking…';
      try {
        await totpSetup('confirm', tcd.value);
        body().innerHTML = `<p><b>✓ Authenticator is on.</b></p><p class="muted">Next time, sign in with your email and the 6-digit code from the app. You stay signed in on this device.</p><button class="btn primary" data-act="close-drawer">Done</button>`;
      } catch (x) { ok.disabled = false; ok.textContent = 'Turn on'; err.hidden = false; err.textContent = friendly(x); tcd.select(); }
    };
  };
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
      <div class="brand"><img src="../icons/mark.png" alt="" width="30" height="30"><span>Elric AI <b>Admin</b></span></div>
      <nav class="nav" id="nav" aria-label="Sections"></nav>
      <div class="side-foot" id="sidefoot"></div>
    </aside>
    <div class="main">
      <header class="top">
        <div class="brand m-only"><img src="../icons/mark.png" alt="" width="28" height="28"><span>Elric AI <b>Admin</b></span></div>
        <div class="crumb d-only" id="crumb"></div>
        <div class="top-actions" id="topactions"></div>
      </header>
      <main id="view" tabindex="-1"></main>
    </div>
    <nav class="tabbar" id="tabbar" aria-label="Sections"></nav>
    <div class="drawer-wrap" id="drawer" hidden><div class="drawer" role="dialog" aria-modal="true"></div></div>
    <div id="toasts" class="toasts" aria-live="polite"></div>`;
  if (!shellWired) { shellWired = true; wireShell(); }
  renderChrome();
  renderView();
  refreshBadge();
}
let shellWired = false;
function wireShell() {
  app.addEventListener('click', onClick);
  window.addEventListener('hashchange', () => {
    const v = hashView();
    if (VIEWS.some((x) => x.id === v) && v !== view) { view = v; closeDrawer(); renderChrome(); renderView(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
}

function renderChrome() {
  const badge = (id: View) => {
    const n = id === 'review' ? reviewCount : id === 'cache' ? cacheCount : 0;
    return n ? `<span class="badge" aria-label="${n} waiting">${n > 99 ? '99+' : n}</span>` : '';
  };
  $('#nav').innerHTML = VIEWS.map((v) => `<a href="#/${v.id}" class="${v.id === view ? 'on' : ''}" ${v.id === view ? 'aria-current="page"' : ''}>${icon(v.ic)}<span>${v.label}</span>${badge(v.id)}</a>`).join('');
  $('#tabbar').innerHTML = VIEWS.map((v) => `<a href="#/${v.id}" class="${v.id === view ? 'on' : ''}" ${v.id === view ? 'aria-current="page"' : ''}><span class="tb-ic">${icon(v.ic)}${badge(v.id)}</span><span>${v.short}</span></a>`).join('');
  $('#crumb').innerHTML = `<span class="muted">Admin</span><span class="muted">/</span><b>${esc(VIEWS.find((v) => v.id === view)!.label)}</b>`;
  const light = document.documentElement.dataset.theme === 'light';
  $('#topactions').innerHTML = `
    <button class="btn primary run" data-act="run" ${checking ? 'disabled' : ''} aria-label="Run the checker now">${checking ? '<span class="spin"></span><span>Checking…</span>' : icon('play') + '<span class="run-l">Run checker</span><span class="run-s">Run</span>'}</button>
    <button class="icon-btn m-only" data-act="menu" aria-label="More options">${icon('menu')}</button>`;
  $('#sidefoot').innerHTML = `
    <div class="who" title="${esc(getSession()?.email)}"><span class="avatar">${esc((getSession()?.email || '?')[0].toUpperCase())}</span><span>${esc(getSession()?.email)}</span></div>
    <button class="side-btn" data-act="theme">${icon(light ? 'moon' : 'sun')} ${light ? 'Dark mode' : 'Light mode'}</button>
    <button class="side-btn" data-act="totp">${icon('lock')} Authenticator app</button>
    <button class="side-btn" data-act="signout">${icon('out')} Sign out</button>`;
}

function openMenu() {
  const light = document.documentElement.dataset.theme === 'light';
  openDrawer(`${drawerHead('Menu')}<div class="d-body menu">
    <div class="who big"><span class="avatar">${esc((getSession()?.email || '?')[0].toUpperCase())}</span><div><b>Owner</b><span class="muted small">${esc(getSession()?.email)}</span></div></div>
    <button class="menu-btn" data-act="theme">${icon(light ? 'moon' : 'sun')}<span>${light ? 'Switch to dark mode' : 'Switch to light mode'}</span></button>
    <button class="menu-btn" data-act="totp">${icon('lock')}<span>Authenticator app</span></button>
    <button class="menu-btn danger-t" data-act="signout">${icon('out')}<span>Sign out</span></button>
  </div>`);
}

async function refreshBadge() {
  try { reviewCount = await countOf('ai_feedback', 'review_status=eq.needs_review'); renderChrome(); } catch { /* ignore */ }
  try { cacheCount = await countOf('ai_answer_cache', 'status=eq.pending'); renderChrome(); } catch { cacheCount = null; /* table not there yet */ }
}

function renderView() {
  const el = $('#view');
  el.scrollTop = 0; window.scrollTo(0, 0);
  ({ overview: viewOverview, review: viewReview, facts: viewFacts, cache: viewCache, reports: viewReports, automations: viewAutomations })[view]();
}

// global click handling (actions are data-act attributes)
async function onClick(e: MouseEvent) {
  const t = e.target as HTMLElement;
  const r = t.closest('[data-retry]'); if (r) { renderView(); return; }
  const a = t.closest('[data-act]') as HTMLElement | null;
  if (!a) return;
  const act = a.dataset.act!;
  if (act === 'theme') { toggleTheme(); if (!$('#drawer').hidden) openMenu(); }
  else if (act === 'signout') { closeDrawer(); await signOut(); renderLogin(); }
  else if (act === 'run') runNow();
  else if (act === 'totp') openAuthenticator();
  else if (act === 'menu') openMenu();
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
      n('checked') && `checked ${n('checked')}`, n('auto_added') && `added ${plural(n('auto_added'), 'fact')}`,
      n('needs_review') + n('no_question') && `${n('needs_review') + n('no_question')} need you`, n('rejected') && `${n('rejected')} answer(s) were right`,
      n('duplicate') && `${n('duplicate')} already covered`, n('merged') && `${n('merged')} repeats merged`, n('spam') && `${n('spam')} junk cleaned`,
      n('expired') && `${n('expired')} news facts switched off`, n('deferred') && `${n('deferred')} left for next hour`,
    ].filter(Boolean);
    toast(parts.length ? 'Done: ' + parts.join(' · ') : 'Done: nothing new to check.', 'ok');
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

// ---------- shared review actions ----------
async function approveRow(row: Feedback, fact: string, expires: string | null, topic = 'general') {
  const lang = /[\u0900-\u097F]/.test(fact + (row.question || '')) ? 'hi' : 'en';
  const src = links(row.ai_sources);
  await rest('ai_facts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    topic, fact, lang, active: true, source: 'manual', expires_at: expires,
    sources: { sources: src.map((uri) => ({ uri })), from_feedback: row.id, approved_by: 'admin', ...(expires ? { time_sensitive: true } : {}) },
  }) });
  await rest(`ai_feedback?id=eq.${row.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ review_status: 'auto_added', reviewed_at: new Date().toISOString() }) });
}
async function setStatus(ids: string[], status: string) {
  await rest(`ai_feedback?id=in.(${ids.join(',')})`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ review_status: status, reviewed_at: new Date().toISOString() }) });
}
async function deleteRows(ids: string[]) {
  await rest(`ai_feedback?id=in.(${ids.join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

// ---------- automations metadata ----------
const AUTO: { key: string; name: string; ic: keyof typeof I; desc: string; needs?: string }[] = [
  { key: 'checker', name: 'Check new reports', ic: 'shield', desc: 'Every hour it reads new “wrong answer” reports, checks trusted websites and decides if the app was wrong.' },
  { key: 'auto_add', name: 'Add proven facts', ic: 'sparkle', needs: 'checker', desc: 'When at least 2 different trusted websites agree, it adds the correct fact for every app. A user’s correction note alone is never enough.' },
  { key: 'duplicates', name: 'Merge repeat reports', ic: 'merge', desc: 'When someone reports the same question again, it links it to the first report, so you see one item with a count.' },
  { key: 'spam', name: 'Clean up junk', ic: 'broom', desc: 'Closes empty reports, random letters, test reports older than 7 days and floods (over 20 a day from one device). Nothing is deleted.' },
  { key: 'recheck', name: 'Re-check waiting items', ic: 'refresh', needs: 'checker', desc: 'Items waiting for you over 24 hours are checked once more, because news websites often appear later. At most 10 an hour.' },
  { key: 'expiry', name: 'Expire news facts', ic: 'calendar', desc: 'News and other time-sensitive facts switch off by themselves 30 days after they are added (you can change the date on each fact).' },
  { key: 'daily_summary', name: 'Daily summary', ic: 'clock', desc: 'Once a day it writes a short summary of yesterday into the activity feed below.' },
];
const autoName = (k: string) => AUTO.find((a) => a.key === k)?.name || k;
const autoIcon = (k: string): keyof typeof I => AUTO.find((a) => a.key === k)?.ic || 'bolt';
function nextRun() {
  // pg_cron runs at minute 17 UTC (minute 47 in India)
  const d = new Date(); d.setUTCSeconds(0, 0);
  if (d.getUTCMinutes() >= 17) d.setUTCHours(d.getUTCHours() + 1);
  d.setUTCMinutes(17);
  return d;
}
const feedItem = (e: AdminEvent) => `<li class="feed-i">
  <span class="feed-ic a-${esc(e.automation)}">${icon(autoIcon(e.automation))}</span>
  <div><p>${esc(e.message)}</p><span class="muted small">${esc(autoName(e.automation))} · ${esc(ago(e.created_at))}</span></div></li>`;

// ---------- 1. Overview ----------
let chartSeries: 'questions' | 'reports' = 'questions';
async function viewOverview() {
  const el = $('#view');
  el.innerHTML = `${pageHead()}<div class="kpis">${'<div class="kpi skel"></div>'.repeat(6)}</div>${loading(2)}`;
  try {
    const since = isoDaysAgo(7);
    const like = (s: string) => encodeURIComponent(s);
    const [recent, needs, active, fixed, closed, usage, top, events, status] = await Promise.all([
      rest<Pick<Feedback, 'kind' | 'created_at' | 'app_version' | 'device' | 'platform' | 'review_status'>[]>(
        `ai_feedback?select=kind,created_at,app_version,device,platform,review_status&created_at=gte.${since}&order=created_at.desc&limit=5000`),
      countOf('ai_feedback', 'review_status=eq.needs_review'),
      countOf('ai_facts', 'active=is.true'),
      countOf('ai_feedback', `review_status=eq.auto_added&reviewed_at=gte.${since}&or=(ai_verdict.like.${like('*Added fact*')},ai_verdict.like.${like('*Already covered*')})`),
      countOf('ai_feedback', `review_status=in.(rejected,duplicate)&reviewed_at=gte.${since}&or=(ai_verdict.like.${like('Auto-cleaned*')},ai_verdict.like.${like('Duplicate*')},ai_verdict.like.${like('App answer judged correct*')})`),
      rest<{ today: number; today_devices: number; days: { day: string; questions: number }[] }>('rpc/ai_admin_usage', { method: 'POST', body: '{}' }).then((r) => r.data).catch(() => null),
      rest<Feedback[]>('ai_feedback?select=*&review_status=eq.needs_review&order=created_at.desc&limit=3').then((r) => r.data),
      rest<AdminEvent[]>('ai_admin_events?select=*&order=created_at.desc&limit=6').then((r) => r.data).catch(() => [] as AdminEvent[]),
      rest<{ start_time: string | null; status: string | null }>('rpc/ai_admin_checker_status', { method: 'POST', body: '{}' }).then((r) => r.data).catch(() => null),
    ]);
    if (view !== 'overview') return;
    reviewCount = needs; renderChrome();
    const rows = recent.data;
    const fb = rows.filter((r) => FEEDBACK_KINDS.includes(r.kind));
    const errs = rows.filter((r) => ERROR_KINDS.includes(r.kind));
    const days = Array.from({ length: 7 }, (_, i) => dayKey(new Date(Date.now() - (6 - i) * 86400000)));
    const qByDay = new Map((usage?.days || []).map((d) => [d.day, d.questions]));
    const q7 = days.reduce((s, d) => s + (qByDay.get(d) || 0), 0);
    const kpi = (ic: keyof typeof I, tone: string, label: string, value: number | string, sub: string, href = '') =>
      `<${href ? `a href="${href}"` : 'div'} class="kpi t-${tone}"><span class="kpi-ic">${icon(ic)}</span><span class="kpi-l">${esc(label)}</span><span class="kpi-v">${esc(value)}</span><span class="kpi-s">${esc(sub)}</span></${href ? 'a' : 'div'}>`;
    const h = Number(new Date().toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }));
    const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    el.innerHTML = `
      <div class="page-head"><div><h1>${hello}</h1><p class="muted">${esc(new Date().toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }))}</p></div>
        <span class="pill ${needs ? 'warn' : 'ok'}">${needs ? `${icon('inbox')} ${plural(needs, 'item')} waiting for you` : `${icon('check')} All clear`}</span></div>
      <div class="kpis">
        ${kpi('chat', 'gold', 'Questions today', usage ? usage.today : '—', usage ? `${plural(usage.today_devices, 'device')} online` : 'Not available')}
        ${kpi('users', 'ind', 'Questions · 7 days', usage ? q7 : '—', 'Online answers')}
        ${kpi('inbox', needs ? 'warn' : 'ok', 'Waiting for you', needs, needs ? 'Tap to review' : 'Nothing to do', '#/review')}
        ${kpi('book', 'ok', 'Active facts', active, 'Sent to every app', '#/facts')}
        ${kpi('sparkle', 'gold', 'Auto-fixed', fixed, 'This week, by itself', '#/automations')}
        ${kpi('broom', 'mute', 'Auto-closed', closed, 'Junk & repeats', '#/automations')}
      </div>
      <div class="ov-grid">
        <section class="card chart-card">
          <div class="card-h"><h2>Last 7 days</h2>
            <div class="seg sm" role="tablist" aria-label="Chart">
              <button role="tab" data-s="questions" class="${chartSeries === 'questions' ? 'on' : ''}" aria-selected="${chartSeries === 'questions'}">Questions</button>
              <button role="tab" data-s="reports" class="${chartSeries === 'reports' ? 'on' : ''}" aria-selected="${chartSeries === 'reports'}">Reports</button>
            </div></div>
          <div id="chart"></div>
        </section>
        <section class="card">
          <div class="card-h"><h2>Needs you</h2>${needs > 3 ? `<a href="#/review" class="see">See all ${needs} ${icon('arrow')}</a>` : ''}</div>
          <div id="needs">${top.length ? top.map(needItem).join('') : `<div class="mini-empty">${icon('check')}<div><b>You're all caught up</b><p class="muted small">New items appear here when the checker can't decide alone.</p></div></div>`}</div>
        </section>
        <section class="card">
          <div class="card-h"><h2>Automation activity</h2><a href="#/automations" class="see">All ${icon('arrow')}</a></div>
          ${events.length ? `<ul class="feed">${events.map(feedItem).join('')}</ul>` : `<div class="mini-empty">${icon('bolt')}<div><b>No activity yet</b><p class="muted small">Automations run every hour at :47 (India time). Their work shows here.</p></div></div>`}
          <p class="muted small foot">Last scheduled run: ${status?.start_time ? `${esc(ago(status.start_time))}${status.status && status.status !== 'succeeded' ? ' · ' + esc(status.status) : ''}` : 'not yet'} · Next: ${esc(nextRun().toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }))}</p>
        </section>
        <section class="card">
          <div class="card-h"><h2>App problems</h2><span class="muted small">Crashes & stuck · 7 days</span></div>
          ${errs.length ? groupBars(errs) : `<div class="mini-empty">${icon('shield')}<div><b>No crashes or stuck reports</b><p class="muted small">in the last 7 days.</p></div></div>`}
        </section>
      </div>`;
    const drawChart = () => {
      const vals = chartSeries === 'questions' ? days.map((d) => qByDay.get(d) || 0) : days.map((d) => fb.filter((r) => dayKey(r.created_at) === d).length + errs.filter((r) => dayKey(r.created_at) === d).length);
      const max = Math.max(1, ...vals);
      const total = vals.reduce((a, b) => a + b, 0);
      $('#chart').innerHTML = `<p class="chart-total"><b>${total}</b> <span class="muted">${chartSeries === 'questions' ? 'online questions' : 'reports'} this week</span></p>
        <div class="bars7 ${chartSeries}" role="img" aria-label="${esc(vals.map((v, i) => `${fmtDay(days[i])}: ${v}`).join(', '))}">
        ${vals.map((v, i) => `<div class="b7"><span class="b7v">${v || ''}</span><span class="b7t"><i style="height:${v ? Math.max(4, (v / max) * 100) : 0}%"></i></span><span class="b7d ${i === 6 ? 'today' : ''}">${i === 6 ? 'Today' : esc(new Date(days[i] + 'T12:00:00+05:30').toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short' }))}</span></div>`).join('')}
        </div>`;
    };
    drawChart();
    $$<HTMLButtonElement>('[data-s]', el).forEach((b) => b.onclick = () => {
      chartSeries = b.dataset.s as typeof chartSeries;
      $$<HTMLButtonElement>('[data-s]', el).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
      drawChart();
    });
    wireNeeds(top);
  } catch (e) { if (view === 'overview') el.innerHTML = errorBox(e, 'overview'); }
}
function groupBars(errs: { app_version: string | null; platform: string | null; device: string | null }[]) {
  const m = new Map<string, number>();
  for (const r of errs) { const k = [r.app_version ? 'v' + r.app_version : '', r.platform?.split(' ')[0], r.device].filter(Boolean).join(' · ') || 'Unknown'; m.set(k, (m.get(k) || 0) + 1); }
  const list = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = Math.max(1, ...list.map((x) => x[1]));
  return `<ul class="hbars">${list.map(([k, v]) => `<li><span class="bl" title="${esc(k)}">${esc(k)}</span><span class="bt"><i style="width:${(v / max) * 100}%"></i></span><b>${v}</b></li>`).join('')}</ul>`;
}
const needItem = (r: Feedback) => {
  const sug = suggestedFact(r.ai_verdict);
  return `<div class="need" data-id="${esc(r.id)}">
    <div class="need-top">${kindChip(r.kind)}<span class="muted small">${esc(ago(r.created_at))}</span></div>
    <p class="need-q">${esc(r.question || r.note || [r.device, r.backend].filter(Boolean).join(' · ') || 'No details shared')}</p>
    ${sug ? `<p class="need-s"><span>Suggested fact</span>${esc(sug)}</p>` : r.ai_verdict ? `<p class="muted small clamp2">${esc(verdictText(r.ai_verdict))}</p>` : ''}
    <div class="need-act">
      ${sug && !isError(r.kind) ? '<button class="btn primary sm" data-q="approve">' + icon('check') + ' Add fact</button>' : '<a class="btn sm" href="#/review">Open</a>'}
      <button class="btn sm" data-q="reject">${isError(r.kind) ? 'Dismiss' : 'Reject'}</button>
    </div></div>`;
};
function wireNeeds(rows: Feedback[]) {
  $$<HTMLElement>('.need').forEach((c) => {
    const row = rows.find((r) => r.id === c.dataset.id)!;
    $$<HTMLButtonElement>('[data-q]', c).forEach((b) => b.onclick = async () => {
      $$<HTMLButtonElement>('button', c).forEach((x) => (x.disabled = true));
      try {
        if (b.dataset.q === 'approve') {
          const news = isNewsVerdict(row.ai_verdict);
          await approveRow(row, suggestedFact(row.ai_verdict), news ? inDays(NEWS_DAYS).toISOString() : null);
          toast(news ? `Fact added. It switches off in ${NEWS_DAYS} days.` : 'Fact added. Apps get it on their next sync.', 'ok');
        } else { await setStatus([row.id], 'rejected'); toast(isError(row.kind) ? 'Dismissed.' : 'Rejected.', 'ok'); }
        c.classList.add('gone'); setTimeout(() => { if (view === 'overview') viewOverview(); }, 250);
        refreshBadge();
      } catch (e) { $$<HTMLButtonElement>('button', c).forEach((x) => (x.disabled = false)); toast((e as Error).message, 'err'); }
    });
  });
}

// ---------- 2. Review queue ----------
let reviewFilter: 'all' | 'answers' | 'errors' = 'all';
let reviewQuery = '';
let selectMode = false;
const selected = new Set<string>();
async function viewReview() {
  const el = $('#view');
  el.innerHTML = pageHead() + loading(3);
  let rows: Feedback[];
  const repeats = new Map<string, number>();
  try {
    rows = (await rest<Feedback[]>('ai_feedback?select=*&review_status=eq.needs_review&order=created_at.desc&limit=300')).data;
    if (rows.length) {
      const d = await rest<{ duplicate_of: string }[]>(`ai_feedback?select=duplicate_of&review_status=eq.duplicate&duplicate_of=in.(${rows.map((r) => r.id).join(',')})`).catch(() => ({ data: [] as { duplicate_of: string }[] }));
      for (const x of d.data) repeats.set(x.duplicate_of, (repeats.get(x.duplicate_of) || 0) + 1);
    }
  } catch (e) { if (view === 'review') el.innerHTML = pageHead() + errorBox(e, 'review'); return; }
  if (view !== 'review') return;
  reviewCount = rows.length; renderChrome();
  selected.clear();
  el.innerHTML = `${pageHead(`<button class="btn ${selectMode ? 'on' : ''}" id="selmode" aria-pressed="${selectMode}">${icon('check')} <span>${selectMode ? 'Done' : 'Select'}</span></button>`)}
    <div class="toolbar">
      <div class="search">${icon('search')}<input id="rq" type="search" placeholder="Search questions, notes…" value="${esc(reviewQuery)}" autocomplete="off" aria-label="Search review items"></div>
      <div class="seg" role="tablist" aria-label="Filter" id="rseg"></div>
    </div>
    <div id="rlist"></div>
    <div class="bulkbar" id="bulk" hidden></div>`;
  const visible = () => {
    const q = reviewQuery.trim().toLowerCase();
    return rows.filter((r) => (reviewFilter === 'all' || (reviewFilter === 'errors') === isError(r.kind)) &&
      (!q || [r.question, r.note, r.answer, r.ai_verdict, r.device, r.platform].join(' ').toLowerCase().includes(q)));
  };
  const drawBulk = () => {
    const b = $('#bulk');
    b.hidden = !selectMode;
    if (!selectMode) return;
    const n = selected.size, all = visible();
    b.innerHTML = `<label class="check"><input type="checkbox" id="selall" ${n && n === all.length ? 'checked' : ''}> All</label>
      <span class="grow"><b>${n}</b> selected</span>
      <button class="btn" data-bulk="reject" ${n ? '' : 'disabled'}>${icon('x')} Reject</button>
      <button class="btn danger" data-bulk="delete" ${n ? '' : 'disabled'}>${icon('trash')} Delete</button>`;
    $<HTMLInputElement>('#selall').onchange = (e) => {
      selected.clear(); if ((e.target as HTMLInputElement).checked) all.forEach((r) => selected.add(r.id));
      draw();
    };
    $$<HTMLButtonElement>('[data-bulk]', b).forEach((x) => x.onclick = async () => {
      const ids = [...selected]; if (!ids.length) return;
      const del = x.dataset.bulk === 'delete';
      if (del && !(await confirmBox(`Delete ${plural(ids.length, 'report')}?`, 'They will be removed permanently. Use Reject to keep a record instead.'))) return;
      if (!del && !(await confirmBox(`Reject ${plural(ids.length, 'report')}?`, 'They will be closed and kept in Reports.', 'Reject', false))) return;
      $$<HTMLButtonElement>('button', b).forEach((y) => (y.disabled = true));
      try {
        if (del) await deleteRows(ids); else await setStatus(ids, 'rejected');
        rows = rows.filter((r) => !selected.has(r.id)); selected.clear(); reviewCount = rows.length; renderChrome();
        toast(`${del ? 'Deleted' : 'Rejected'} ${plural(ids.length, 'report')}.`, 'ok'); draw();
      } catch (e) { toast((e as Error).message, 'err'); drawBulk(); }
    });
  };
  const draw = () => {
    const nA = rows.filter((r) => !isError(r.kind)).length, nE = rows.length - nA;
    $('#rseg').innerHTML = (['all', 'answers', 'errors'] as const).map((f) => `<button role="tab" data-f="${f}" class="${reviewFilter === f ? 'on' : ''}" aria-selected="${reviewFilter === f}">${{ all: 'All', answers: 'Answers', errors: 'Errors' }[f]} <span class="cnt">${{ all: rows.length, answers: nA, errors: nE }[f]}</span></button>`).join('');
    $$<HTMLButtonElement>('[data-f]', el).forEach((b) => b.onclick = () => { reviewFilter = b.dataset.f as typeof reviewFilter; selected.clear(); draw(); });
    const list = visible();
    $('#rlist').innerHTML = list.length ? `<div class="cards ${selectMode ? 'selecting' : ''}">${list.map(card).join('')}</div>`
      : rows.length ? empty('No matches', 'Try a different search or filter.', 'search')
      : empty("You're all caught up", 'When the checker can’t decide alone, the item appears here for you.');
    $$<HTMLElement>('.rcard', el).forEach(wireCard);
    drawBulk();
  };
  const card = (r: Feedback) => {
    const sug = suggestedFact(r.ai_verdict);
    const err = isError(r.kind);
    const rep = repeats.get(r.id) || 0;
    const news = isNewsVerdict(r.ai_verdict);
    const vt = r.ai_verdict && !/^No question shared/.test(r.ai_verdict) ? verdictText(r.ai_verdict) : '';
    return `<article class="rcard ${selected.has(r.id) ? 'sel' : ''}" data-id="${esc(r.id)}">
      <header>
        ${selectMode ? `<label class="pick"><input type="checkbox" ${selected.has(r.id) ? 'checked' : ''} aria-label="Select this item"></label>` : ''}
        <div class="chips">${kindChip(r.kind)}${rep ? `<span class="chip c-rep">${icon('merge')}+${rep} same</span>` : ''}${r.recheck_count ? '<span class="chip">Re-checked</span>' : ''}${news ? '<span class="chip c-news">News</span>' : ''}</div>
        <span class="muted small when">${esc(ago(r.created_at))}</span>
      </header>
      ${r.question ? `<div class="q">${esc(r.question)}</div>` : `<p class="err-line">${err ? `${r.kind === 'crash' ? 'The app crashed' : 'The app got stuck while loading'}${r.device ? ' on ' + esc(r.device) : ''}${r.backend ? ` (${esc(r.backend)} mode)` : ''}.` : '<span class="muted">The user did not share the question and answer.</span>'}</p>`}
      ${r.answer ? `<details class="ans"><summary>App answer</summary><p>${esc(r.answer)}</p></details>` : ''}
      ${r.note ? `<div class="note"><span class="lbl">${icon('chat')} User says</span><p>${esc(r.note)}</p></div>` : ''}
      ${vt ? `<div class="verdict"><span class="lbl">${icon('shield')} Checker</span><p>${esc(vt)}</p>${links(r.ai_sources).length ? linkList(r.ai_sources) : ''}</div>` : ''}
      ${!err && !selectMode ? `<div class="approve">
        <div class="lbl-row"><label for="f-${esc(r.id)}">Correct fact to add ${sug ? '<span class="tag">Suggested</span>' : ''}</label><span class="counter" id="c-${esc(r.id)}">${sug.length}/300</span></div>
        <textarea id="f-${esc(r.id)}" rows="3" maxlength="300" placeholder="Write one short, correct sentence…">${esc(sug)}</textarea>
        <label class="check sm"><input type="checkbox" class="newsck" ${news ? 'checked' : ''}> News / changes over time — switch off after ${NEWS_DAYS} days</label>
      </div>` : ''}
      <div class="meta-line muted small">${esc([r.app_version && 'v' + r.app_version, r.platform, r.device].filter(Boolean).join(' · '))}</div>
      ${selectMode ? '' : `<footer>
        ${!err ? `<button class="btn primary lg" data-do="approve">${icon('check')} Approve & add</button>` : ''}
        <button class="btn lg" data-do="reject">${icon('x')} ${err ? 'Dismiss' : 'Reject'}</button>
        <button class="linkbtn danger-t" data-do="delete">${icon('trash')} Delete as spam</button>
      </footer>`}
    </article>`;
  };
  const wireCard = (c: HTMLElement) => {
    const id = c.dataset.id!; const row = rows.find((r) => r.id === id)!;
    const pick = c.querySelector<HTMLInputElement>('.pick input');
    if (pick) {
      const toggle = (on: boolean) => { if (on) selected.add(id); else selected.delete(id); c.classList.toggle('sel', on); drawBulk(); };
      pick.onchange = () => toggle(pick.checked);
      c.onclick = (e) => { if ((e.target as HTMLElement).closest('a,input,label,summary')) return; pick.checked = !pick.checked; toggle(pick.checked); };
      return;
    }
    const ta = c.querySelector<HTMLTextAreaElement>('textarea');
    if (ta) ta.oninput = () => { const n = ta.value.length; const ct = $(`#c-${CSS.escape(id)}`, c); ct.textContent = `${n}/300`; ct.classList.toggle('near', n > 260); };
    $$<HTMLButtonElement>('[data-do]', c).forEach((b) => b.onclick = async () => {
      const act = b.dataset.do!;
      const busy = (on: boolean) => $$<HTMLButtonElement>('button', c).forEach((x) => (x.disabled = on));
      try {
        if (act === 'approve') {
          const fact = ta!.value.trim();
          if (fact.length < 5) { toast('Please write the fact first.', 'err'); ta!.focus(); return; }
          const news = c.querySelector<HTMLInputElement>('.newsck')?.checked;
          busy(true);
          await approveRow(row, fact, news ? inDays(NEWS_DAYS).toISOString() : null);
          toast(news ? `Fact added. It switches off on ${fmtDay(inDays(NEWS_DAYS))}.` : 'Fact added. Apps get it on their next sync.', 'ok');
        } else if (act === 'reject') {
          busy(true); await setStatus([id], 'rejected');
          toast(isError(row.kind) ? 'Dismissed.' : 'Rejected.', 'ok');
        } else if (act === 'delete') {
          if (!(await confirmBox('Delete this report?', 'It will be removed permanently. Use this for spam.'))) return;
          busy(true); await deleteRows([id]); toast('Deleted.', 'ok');
        }
        rows = rows.filter((r) => r.id !== id); reviewCount = rows.length; renderChrome();
        c.classList.add('gone'); setTimeout(draw, 220);
      } catch (e) { busy(false); toast((e as Error).message, 'err'); }
    });
  };
  let t: number | undefined;
  $<HTMLInputElement>('#rq').oninput = (e) => { clearTimeout(t); t = window.setTimeout(() => { reviewQuery = (e.target as HTMLInputElement).value; draw(); }, 150); };
  $('#selmode').onclick = () => { selectMode = !selectMode; viewReviewRedraw(); };
  const viewReviewRedraw = () => {
    selected.clear();
    const b = $('#selmode'); b.classList.toggle('on', selectMode); b.setAttribute('aria-pressed', String(selectMode));
    b.innerHTML = `${icon('check')} <span>${selectMode ? 'Done' : 'Select'}</span>`;
    draw();
  };
  draw();
}

// ---------- 3. Facts ----------
let factQuery = '';
let factTopic = '';
let factFilter: 'all' | 'on' | 'off' | 'news' | 'auto' = 'all';
const expiryChip = (f: Fact) => {
  if (!f.expires_at) return '';
  const past = new Date(f.expires_at).getTime() < Date.now();
  return `<span class="chip ${past ? 'c-err' : 'c-news'}">${icon('calendar')}${past ? 'Expired' : 'Until'} ${esc(fmtDay(f.expires_at))}</span>`;
};
async function viewFacts() {
  const el = $('#view');
  el.innerHTML = pageHead() + loading(5);
  let facts: Fact[];
  try { facts = (await rest<Fact[]>('ai_facts?select=*&order=updated_at.desc&limit=2000')).data; }
  catch (e) { if (view === 'facts') el.innerHTML = pageHead() + errorBox(e, 'facts'); return; }
  if (view !== 'facts') return;
  el.innerHTML = `${pageHead(`<button class="btn primary" id="addf">${icon('plus')} <span>Add fact</span></button>`)}
    <div class="toolbar">
      <div class="search">${icon('search')}<input id="fq" type="search" placeholder="Search facts or topics" value="${esc(factQuery)}" autocomplete="off" aria-label="Search facts"></div>
      <div class="seg" role="tablist" aria-label="Show" id="fseg"></div>
    </div>
    <div class="chips-scroll" id="topics" aria-label="Topics"></div>
    <p class="muted small count" id="fcount"></p>
    <div id="flist" class="flist"></div>`;
  const drawTopics = () => {
    const m = new Map<string, number>();
    for (const f of facts) { const t = (f.topic || 'general').toLowerCase(); m.set(t, (m.get(t) || 0) + 1); }
    const list = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
    if (factTopic && !m.has(factTopic)) factTopic = '';
    $('#topics').innerHTML = list.length > 1 ? [['', facts.length] as [string, number], ...list].map(([t, n]) => `<button class="tchip tp ${factTopic === t ? 'on' : ''}" data-t="${esc(t)}">${esc(t || 'All topics')} <span>${n}</span></button>`).join('') : '';
    $$<HTMLButtonElement>('[data-t]', el).forEach((b) => b.onclick = () => { factTopic = b.dataset.t!; drawTopics(); draw(); });
  };
  const draw = () => {
    const q = factQuery.trim().toLowerCase();
    const counts = { all: facts.length, on: facts.filter((f) => f.active).length, off: facts.filter((f) => !f.active).length, news: facts.filter((f) => f.expires_at).length, auto: facts.filter((f) => f.source === 'auto').length };
    $('#fseg').innerHTML = (['all', 'on', 'off', 'news', 'auto'] as const).map((f) => `<button role="tab" data-ff="${f}" class="${factFilter === f ? 'on' : ''}" aria-selected="${factFilter === f}">${{ all: 'All', on: 'On', off: 'Off', news: 'News', auto: 'Auto' }[f]} <span class="cnt">${counts[f]}</span></button>`).join('');
    $$<HTMLButtonElement>('[data-ff]', el).forEach((b) => b.onclick = () => { factFilter = b.dataset.ff as typeof factFilter; draw(); });
    const list = facts.filter((f) =>
      (factFilter === 'all' || (factFilter === 'on' && f.active) || (factFilter === 'off' && !f.active) || (factFilter === 'news' && !!f.expires_at) || (factFilter === 'auto' && f.source === 'auto')) &&
      (!factTopic || (f.topic || 'general').toLowerCase() === factTopic) &&
      (!q || (f.fact + ' ' + (f.topic || '')).toLowerCase().includes(q)));
    $('#fcount').textContent = `Showing ${list.length} of ${facts.length} · ${counts.on} on and sent to apps`;
    $('#flist').innerHTML = list.length ? list.map((f) => `
      <div class="frow ${f.active ? '' : 'off'}" data-id="${f.id}">
        <button class="fmain" data-edit aria-label="Edit fact">
          <span class="ftext">${esc(f.fact)}</span>
          <span class="fmeta"><span class="chip">${esc(f.topic || 'general')}</span><span class="chip ${f.source === 'auto' ? 'c-auto' : 'c-man'}">${f.source === 'auto' ? icon('sparkle') + 'Auto' : 'Manual'}</span>${f.lang === 'hi' ? '<span class="chip">हिंदी</span>' : ''}${expiryChip(f)}${links(f.sources).length ? `<span class="muted small">${plural(links(f.sources).length, 'source')}</span>` : ''}<span class="muted small">#${f.id} · ${esc(ago(f.updated_at))}</span></span>
        </button>
        <label class="switch" title="${f.active ? 'On — sent to apps' : 'Off'}"><input type="checkbox" ${f.active ? 'checked' : ''} aria-label="${f.active ? 'Turn fact off' : 'Turn fact on'}"><i></i></label>
      </div>`).join('') : (facts.length ? empty('No matching facts', 'Try a different search, topic or filter.', 'search') : empty('No facts yet', 'Add a fact and every app will receive it on its next sync.', 'book'));
    $$<HTMLElement>('.frow', el).forEach((row) => {
      const f = facts.find((x) => x.id === Number(row.dataset.id))!;
      const cb = row.querySelector('input') as HTMLInputElement;
      cb.onchange = async () => {
        cb.disabled = true;
        try {
          const body: Record<string, unknown> = { active: cb.checked, updated_at: new Date().toISOString() };
          if (cb.checked && f.expires_at && new Date(f.expires_at).getTime() < Date.now()) body.expires_at = null; // turning an expired fact back on keeps it on
          await rest(`ai_facts?id=eq.${f.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) });
          Object.assign(f, body); toast(cb.checked ? 'Fact is on. Apps get it on their next sync.' : 'Fact turned off.', 'ok'); draw();
        } catch (e) { cb.checked = !cb.checked; cb.disabled = false; toast((e as Error).message, 'err'); }
      };
      (row.querySelector('[data-edit]') as HTMLElement).onclick = () => factForm(f);
    });
  };
  const factForm = (f?: Fact) => {
    const exp = f?.expires_at ? dateInput(new Date(f.expires_at)) : '';
    openDrawer(`${drawerHead(f ? `Edit fact #${f.id}` : 'Add fact')}
      <form class="d-body form" id="factf" novalidate>
        <div><div class="lbl-row"><label for="ft">Fact</label><span class="counter" id="fct">${(f?.fact || '').length}/300</span></div>
        <textarea id="ft" rows="4" maxlength="300" required placeholder="One short, correct, standalone sentence.">${esc(f?.fact)}</textarea></div>
        <div class="row2">
          <div><label for="tp">Topic</label><input id="tp" maxlength="60" placeholder="e.g. geography" value="${esc(f?.topic || '')}"></div>
          <div><label for="lg">Language</label><select id="lg"><option value="en">English</option><option value="hi" ${f?.lang === 'hi' ? 'selected' : ''}>हिंदी (Hindi)</option></select></div>
        </div>
        <label class="check"><input type="checkbox" id="ac" ${!f || f.active ? 'checked' : ''}> On — send to every app</label>
        <label class="check"><input type="checkbox" id="nw" ${exp ? 'checked' : ''}> News / changes over time — switch off on a date</label>
        <div id="expbox" ${exp ? '' : 'hidden'}><label for="ex">Switch off on</label><input id="ex" type="date" value="${esc(exp || dateInput(inDays(NEWS_DAYS)))}" min="${esc(dateInput(new Date()))}"></div>
        ${f ? `<div class="meta"><div><span>Added by</span><b>${f.source === 'auto' ? 'Checker (automatic)' : 'You'}</b></div><div><span>Updated</span><b>${esc(fmt(f.updated_at))}</b></div></div>
          <div><label>Sources</label>${linkList(f.sources)}</div>` : ''}
        <div class="d-foot">
          ${f ? `<button type="button" class="btn ghost danger-t" id="delf">${icon('trash')} Delete</button>` : ''}
          <span class="grow"></span>
          <button type="button" class="btn" data-act="close-drawer">Cancel</button>
          <button type="submit" class="btn primary" id="savef">${f ? 'Save' : 'Add fact'}</button>
        </div>
      </form>`, (d) => {
      const ft = $<HTMLTextAreaElement>('#ft', d);
      ft.oninput = () => { $('#fct', d).textContent = `${ft.value.length}/300`; };
      $<HTMLInputElement>('#nw', d).onchange = (e) => { $('#expbox', d).hidden = !(e.target as HTMLInputElement).checked; };
      setTimeout(() => ft.focus(), 50);
      $('#factf', d).onsubmit = async (e) => {
        e.preventDefault();
        const fact = ft.value.trim();
        if (fact.length < 5) { toast('Please write the fact.', 'err'); ft.focus(); return; }
        const news = $<HTMLInputElement>('#nw', d).checked, exv = $<HTMLInputElement>('#ex', d).value;
        const body = { fact, topic: $<HTMLInputElement>('#tp', d).value.trim() || 'general', lang: $<HTMLSelectElement>('#lg', d).value, active: $<HTMLInputElement>('#ac', d).checked,
          expires_at: news && exv ? new Date(exv + 'T23:59:00+05:30').toISOString() : null, updated_at: new Date().toISOString() };
        const b = $<HTMLButtonElement>('#savef', d); b.disabled = true; b.textContent = 'Saving…';
        try {
          if (f) {
            const { data } = await rest<Fact[]>(`ai_facts?id=eq.${f.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
            Object.assign(f, data[0] || body); toast('Fact saved.', 'ok');
          } else {
            const { data } = await rest<Fact[]>('ai_facts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...body, source: 'manual' }) });
            facts.unshift(data[0]); toast('Fact added. Apps get it on their next sync.', 'ok');
          }
          closeDrawer(); drawTopics(); draw();
        } catch (err) { b.disabled = false; b.textContent = f ? 'Save' : 'Add fact'; toast((err as Error).message, 'err'); }
      };
      const del = $('#delf', d);
      if (del && f) del.onclick = async () => {
        if (!(await confirmBox('Delete this fact?', 'Apps stop using it after their next sync. To pause it instead, turn it off.'))) return;
        try {
          await rest(`ai_facts?id=eq.${f.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
          facts = facts.filter((x) => x.id !== f.id); toast('Fact deleted.', 'ok'); closeDrawer(); drawTopics(); draw();
        } catch (err) { toast((err as Error).message, 'err'); }
      };
    });
  };
  let t: number | undefined;
  $<HTMLInputElement>('#fq').oninput = (e) => { clearTimeout(t); t = window.setTimeout(() => { factQuery = (e.target as HTMLInputElement).value; draw(); }, 120); };
  $('#addf').onclick = () => factForm();
  drawTopics();
  draw();
}

// ---------- 4. All reports ----------
const fbFilter = { type: 'all', status: 'all', platform: 'all', version: 'all', range: '30', q: '' };
const PAGE = 40;
async function viewReports() {
  const el = $('#view');
  el.innerHTML = pageHead() + loading(6);
  let versions: string[] = [];
  try {
    const v = await rest<{ app_version: string | null }[]>('ai_feedback?select=app_version&order=created_at.desc&limit=3000');
    versions = [...new Set(v.data.map((x) => x.app_version).filter(Boolean) as string[])].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch (e) { if (view === 'reports') el.innerHTML = pageHead() + errorBox(e, 'reports'); return; }
  if (view !== 'reports') return;
  const sel = (id: string, label: string, opts: [string, string][], cur: string) =>
    `<label class="fsel"><span>${label}</span><select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  el.innerHTML = `${pageHead()}
    <div class="toolbar"><div class="search">${icon('search')}<input id="fbq" type="search" placeholder="Search question, note or answer" value="${esc(fbFilter.q)}" autocomplete="off" aria-label="Search reports"></div></div>
    <div class="filters">
      ${sel('ftype', 'Type', [['all', 'All types'], ['feedback', 'Answer reports'], ['wrong_answer', 'Wrong answer'], ['thumbs_down', 'Not helpful'], ['errors', 'App problems'], ['crash', 'Crash'], ['stuck', 'Stuck on load']], fbFilter.type)}
      ${sel('fplat', 'Platform', [['all', 'All'], ['web', 'Web'], ['android', 'Android']], fbFilter.platform)}
      ${sel('fver', 'Version', [['all', 'All versions'], ...versions.map((v) => [v, 'v' + v] as [string, string])], fbFilter.version)}
      ${sel('frange', 'Date', [['1', 'Last 24 hours'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['all', 'All time']], fbFilter.range)}
    </div>
    <div class="chips-scroll" id="stchips" aria-label="Status"></div>
    <p class="muted small count" id="fbcount"></p>
    <div id="fblist"></div>`;
  let rows: Feedback[] = []; let total = 0;
  const base = (withStatus: boolean) => {
    const q: string[] = [];
    const t = fbFilter.type;
    if (t === 'feedback') q.push(`kind=in.(${FEEDBACK_KINDS})`); else if (t === 'errors') q.push(`kind=in.(${ERROR_KINDS})`); else if (t !== 'all') q.push(`kind=eq.${t}`);
    if (withStatus && fbFilter.status !== 'all') q.push(`review_status=eq.${fbFilter.status}`);
    if (fbFilter.platform !== 'all') q.push(`platform=ilike.${fbFilter.platform}*`);
    if (fbFilter.version !== 'all') q.push(`app_version=eq.${encodeURIComponent(fbFilter.version)}`);
    if (fbFilter.range !== 'all') q.push(`created_at=gte.${isoDaysAgo(Number(fbFilter.range))}`);
    const s = fbFilter.q.replace(/[,()*:%\\."']/g, ' ').replace(/\s+/g, ' ').trim();
    if (s) { const e = encodeURIComponent(`*${s}*`); q.push(`or=(question.ilike.${e},note.ilike.${e},answer.ilike.${e})`); }
    return q;
  };
  const STATUSES = ['all', 'needs_review', 'new', 'auto_added', 'rejected', 'duplicate'];
  const counts = async () => {
    const b = base(false).join('&');
    const n = await Promise.all(STATUSES.map((s) => countOf('ai_feedback', [b, s === 'all' ? '' : `review_status=eq.${s}`].filter(Boolean).join('&')).catch(() => 0)));
    if (view !== 'reports') return;
    $('#stchips').innerHTML = STATUSES.map((s, i) => `<button class="tchip st-${s} ${fbFilter.status === s ? 'on' : ''}" data-st="${s}">${s === 'all' ? 'All' : STATUS_LABEL[s]} <span>${n[i]}</span></button>`).join('');
    $$<HTMLButtonElement>('[data-st]', el).forEach((x) => x.onclick = () => { fbFilter.status = x.dataset.st!; $$('[data-st]', el).forEach((y) => y.classList.toggle('on', y === x)); load(); });
  };
  const load = async (more = false) => {
    const box = $('#fblist');
    if (!more) box.innerHTML = loading(6);
    try {
      const q = ['select=*', 'order=created_at.desc', `limit=${PAGE}`, `offset=${more ? rows.length : 0}`, ...base(true)];
      const r = await rest<Feedback[]>('ai_feedback?' + q.join('&'), { count: true });
      if (view !== 'reports') return;
      rows = more ? rows.concat(r.data) : r.data; total = r.count ?? rows.length; draw();
    } catch (e) { box.innerHTML = errorBox(e, 'reports'); }
  };
  const draw = () => {
    $('#fbcount').textContent = total ? `Showing ${rows.length} of ${total}` : '';
    const box = $('#fblist');
    if (!rows.length) { box.innerHTML = empty('No reports here', 'Nothing matches these filters. Try a wider date range.', 'inbox'); return; }
    box.innerHTML = `<div class="rlist">${rows.map((r, i) => `<button class="rrow" data-i="${i}">
        <span class="rr-ic ${isError(r.kind) ? 'err' : 'fb'}">${icon(isError(r.kind) ? 'alert' : 'thumb')}</span>
        <span class="rr-main"><span class="rr-t">${esc((r.question || r.note || (isError(r.kind) ? `${KIND_LABEL[r.kind] || r.kind}${r.device ? ' on ' + r.device : ''}` : 'No question shared')).slice(0, 160))}</span>
          <span class="rr-m">${statusChip(r.review_status)}<span class="muted small">${esc(KIND_LABEL[r.kind] || r.kind)} · ${esc([r.app_version && 'v' + r.app_version, (r.platform || '').split(' ')[0]].filter(Boolean).join(' · '))}</span></span></span>
        <span class="rr-d muted small">${esc(ago(r.created_at))}</span>
      </button>`).join('')}</div>
      ${rows.length < total ? `<button class="btn block" id="more">Load ${Math.min(PAGE, total - rows.length)} more</button>` : ''}`;
    $$<HTMLElement>('.rrow', box).forEach((b) => b.onclick = () => detail(rows[Number(b.dataset.i)]));
    const m = $('#more', box); if (m) m.onclick = () => { m.textContent = 'Loading…'; load(true); };
  };
  const detail = (r: Feedback) => {
    const kv = (k: string, v: string | null | undefined) => v ? `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>` : '';
    openDrawer(`${drawerHead(KIND_LABEL[r.kind] || r.kind)}
      <div class="d-body">
        <div class="row">${kindChip(r.kind)}${statusChip(r.review_status)}</div>
        ${r.question ? `<div><label>Question</label><p class="block-t">${esc(r.question)}</p></div>` : ''}
        ${r.answer ? `<div><label>App answer</label><p class="block-t ans">${esc(r.answer)}</p></div>` : ''}
        ${r.note ? `<div><label>User says</label><p class="block-t">${esc(r.note)}</p></div>` : ''}
        ${r.ai_verdict ? `<div><label>Checker</label><p class="block-t">${esc(verdictText(r.ai_verdict) || r.ai_verdict)}</p>${suggestedFact(r.ai_verdict) ? `<p class="block-t sug"><b>Suggested fact:</b> ${esc(suggestedFact(r.ai_verdict))}</p>` : ''}</div>` : ''}
        ${links(r.ai_sources).length ? `<div><label>Sources</label>${linkList(r.ai_sources)}</div>` : ''}
        <div class="meta">${kv('Received', fmt(r.created_at))}${kv('App version', r.app_version && 'v' + r.app_version)}${kv('Platform', r.platform)}${kv('Device', r.device)}${kv('Answered by', r.backend)}${kv('Mode', r.mode)}${kv('Reviewed', r.reviewed_at && fmt(r.reviewed_at))}</div>
        ${r.model ? `<p class="muted small">Model: ${esc(r.model)}</p>` : ''}
        <div class="d-foot">
          <button class="btn ghost danger-t" id="delr">${icon('trash')} Delete</button><span class="grow"></span>
          ${['rejected', 'duplicate', 'auto_added'].includes(r.review_status) && !isError(r.kind) && r.question ? '<button class="btn" id="reopen">Send to review</button>' : ''}
          ${r.review_status === 'needs_review' ? '<a class="btn primary" href="#/review" data-act="close-drawer">Open review</a>' : ''}
        </div>
      </div>`, (d) => {
      $('#delr', d).onclick = async () => {
        if (!(await confirmBox('Delete this report?', 'It will be removed permanently.'))) return;
        try { await deleteRows([r.id]); rows = rows.filter((x) => x.id !== r.id); total = Math.max(0, total - 1); toast('Deleted.', 'ok'); closeDrawer(); draw(); refreshBadge(); counts(); }
        catch (err) { toast((err as Error).message, 'err'); }
      };
      const ro = $('#reopen', d);
      if (ro) ro.onclick = async () => {
        try { await setStatus([r.id], 'needs_review'); r.review_status = 'needs_review'; toast('Sent to review.', 'ok'); closeDrawer(); draw(); refreshBadge(); counts(); }
        catch (err) { toast((err as Error).message, 'err'); }
      };
    });
  };
  ([['ftype', 'type'], ['fplat', 'platform'], ['fver', 'version'], ['frange', 'range']] as const).forEach(([id, k]) => {
    $<HTMLSelectElement>('#' + id).onchange = (e) => { fbFilter[k] = (e.target as HTMLSelectElement).value; load(); counts(); };
  });
  let t: number | undefined;
  $<HTMLInputElement>('#fbq').oninput = (e) => { clearTimeout(t); t = window.setTimeout(() => { fbFilter.q = (e.target as HTMLInputElement).value; load(); counts(); }, 350); };
  load(); counts();
}

// ---------- 5. Automations ----------
async function viewAutomations() {
  const el = $('#view');
  el.innerHTML = pageHead() + loading(4);
  let settings: Automation[]; let events: AdminEvent[];
  try {
    [settings, events] = await Promise.all([
      rest<Automation[]>('ai_settings?select=*').then((r) => r.data),
      rest<AdminEvent[]>('ai_admin_events?select=*&order=created_at.desc&limit=30').then((r) => r.data),
    ]);
  } catch (e) { if (view === 'automations') el.innerHTML = pageHead() + errorBox(e, 'automations'); return; }
  if (view !== 'automations') return;
  const get = (k: string) => settings.find((s) => s.key === k);
  const on = AUTO.filter((a) => get(a.key)?.enabled !== false).length;
  const next = nextRun();
  el.innerHTML = `${pageHead()}
    <div class="hero card">
      <span class="hero-ic">${icon('bolt')}</span>
      <div><b>${on} of ${AUTO.length} automations on</b><p class="muted small">They run by themselves every hour at :47 (India time). Next run at ${esc(next.toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }))}. They use only the free AI allowance — at most 10 checks an hour.</p></div>
    </div>
    <div class="autos">${AUTO.map((a) => {
      const s = get(a.key); const enabled = s?.enabled !== false;
      const blocked = a.needs && get(a.needs)?.enabled === false;
      const failed = /^Failed/.test(s?.last_result || '');
      return `<div class="auto card ${enabled ? '' : 'off'}" data-k="${a.key}">
        <span class="auto-ic a-${a.key}">${icon(a.ic)}</span>
        <div class="auto-main">
          <div class="auto-h"><h3>${esc(a.name)}${enabled ? '' : ' <span class="chip">Off</span>'}</h3>
            <label class="switch lg"><input type="checkbox" ${enabled ? 'checked' : ''} aria-label="${esc(a.name)}: ${enabled ? 'on' : 'off'}"><i></i></label></div>
          <p class="muted">${esc(a.desc)}</p>
          ${blocked && enabled ? `<p class="hint">${icon('alert')} Works only when “${esc(autoName(a.needs!))}” is on.</p>` : ''}
          <div class="auto-last"><span>${icon('clock')} ${s?.last_run_at ? `Last run ${esc(ago(s.last_run_at))}` : 'Not run yet'}</span>${s?.last_result ? `<span class="res ${failed ? 'danger-t' : ''}">${esc(s.last_result)}</span>` : ''}</div>
        </div></div>`;
    }).join('')}</div>
    <section class="card">
      <div class="card-h"><h2>Activity</h2><span class="muted small">What automations did, newest first</span></div>
      <div id="feed">${events.length ? `<ul class="feed">${events.map(feedItem).join('')}</ul>` : `<div class="mini-empty">${icon('bolt')}<div><b>No activity yet</b><p class="muted small">After the next hourly run, you'll see what each automation did here.</p></div></div>`}</div>
      ${events.length === 30 ? '<button class="btn block" id="morefeed">Show older</button>' : ''}
    </section>`;
  $$<HTMLElement>('.auto', el).forEach((c) => {
    const k = c.dataset.k!; const cb = c.querySelector('input') as HTMLInputElement;
    cb.onchange = async () => {
      cb.disabled = true;
      try {
        const { data } = await rest<Automation[]>(`ai_settings?key=eq.${k}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ enabled: cb.checked, updated_at: new Date().toISOString() }) });
        if (!data.length) throw new Error('Could not save. Please try again.');
        toast(`${autoName(k)} is ${cb.checked ? 'on' : 'off'}.`, 'ok');
        const s = get(k); if (s) s.enabled = cb.checked;
        viewAutomations();
      } catch (e) { cb.checked = !cb.checked; cb.disabled = false; toast((e as Error).message, 'err'); }
    };
  });
  const more = $('#morefeed', el);
  if (more) more.onclick = async () => {
    more.textContent = 'Loading…';
    try {
      const older = (await rest<AdminEvent[]>(`ai_admin_events?select=*&order=created_at.desc&limit=50&offset=${events.length}`)).data;
      events = events.concat(older);
      $('.feed', el).insertAdjacentHTML('beforeend', older.map(feedItem).join(''));
      if (older.length < 50) more.remove(); else more.textContent = 'Show older';
    } catch (e) { more.textContent = 'Show older'; toast((e as Error).message, 'err'); }
  };
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
  startApp();
}

let started = false;
function startApp() {
  renderShell();
  // first time in: offer authenticator setup straight away
  totpSetup('status').then((t) => { if (!t?.active) openAuthenticator(); }).catch(() => {});
  if (started) return;
  started = true;
  // keep the session fresh while the tab is open
  setInterval(() => { ensureFresh().catch(() => {}); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureFresh().then((x) => { if (!x) renderLogin(); }).catch(() => {});
  });
}
boot();

// ---------- 6. Answer cache ----------
type CacheRow = {
  id: number; question_norm: string; lang: string; mode: string; short: boolean; question: string; answer: string;
  kind: 'general' | 'search'; ttl_days: number; devices: number; hits: number; approved: boolean;
  status: 'pending' | 'approved' | 'rejected'; created_at: string; approved_at: string | null; expires_at: string | null;
};
let cacheFilter: 'pending' | 'approved' | 'rejected' = 'pending';
const approveBody = (r: CacheRow, answer?: string) => ({
  ...(answer !== undefined ? { answer } : {}),
  approved: true, status: 'approved', approved_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + Math.max(1, r.ttl_days) * 86400000).toISOString(),
});
async function viewCache() {
  const el = $('#view');
  el.innerHTML = pageHead() + loading(4);
  let rows: CacheRow[];
  try { rows = (await rest<CacheRow[]>('ai_answer_cache?select=*&order=created_at.desc&limit=500')).data; }
  catch (e) { if (view === 'cache') el.innerHTML = pageHead() + errorBox(e, 'cache'); return; }
  if (view !== 'cache') return;
  cacheCount = rows.filter((r) => r.status === 'pending').length; renderChrome();
  el.innerHTML = `${pageHead()}
    <p class="muted small">Common questions asked by 3 or more devices. Approved answers are shown instantly to everyone who asks the same question, without using the online AI, until they expire (news-type 1 day, others 30 days).</p>
    <div class="toolbar"><div class="seg" role="tablist" aria-label="Show" id="cseg"></div></div>
    <div id="clist" class="clist"></div>`;
  const live = (r: CacheRow) => r.status === 'approved' && !!r.expires_at && new Date(r.expires_at).getTime() > Date.now();
  const draw = () => {
    const counts = { pending: 0, approved: 0, rejected: 0 } as Record<CacheRow['status'], number>;
    rows.forEach((r) => counts[r.status]++);
    $('#cseg').innerHTML = (['pending', 'approved', 'rejected'] as const).map((f) => `<button role="tab" data-cf="${f}" class="${cacheFilter === f ? 'on' : ''}" aria-selected="${cacheFilter === f}">${{ pending: 'To approve', approved: 'Approved', rejected: 'Rejected' }[f]} <span class="cnt">${counts[f]}</span></button>`).join('');
    $$<HTMLButtonElement>('[data-cf]', el).forEach((b) => b.onclick = () => { cacheFilter = b.dataset.cf as typeof cacheFilter; draw(); });
    const list = rows.filter((r) => r.status === cacheFilter);
    $('#clist').innerHTML = list.length ? list.map((r) => `
      <article class="card crow" data-id="${r.id}">
        <div class="cq"><b>${esc(r.question)}</b></div>
        <div class="fmeta">
          <span class="chip">${r.lang === 'hi' ? 'हिंदी' : 'English'}</span><span class="chip">${esc(r.mode)}</span><span class="chip">${r.short ? 'Short' : 'Detailed'}</span>
          ${r.kind === 'search' ? `<span class="chip c-news">${icon('calendar')}News · 1 day</span>` : ''}
          <span class="chip">${icon('users')}${plural(r.devices, 'device')}</span>
          ${r.status === 'approved' ? `<span class="chip ${live(r) ? 'c-man' : 'c-err'}">${live(r) ? `Until ${esc(fmt(r.expires_at, false))}` : 'Expired'}</span><span class="chip">${plural(r.hits, 'use')}</span>` : ''}
          <span class="muted small">${esc(ago(r.created_at))}</span>
        </div>
        <div class="ca">${esc(r.answer)}</div>
        <div class="cbtns">
          ${r.status !== 'approved' || !live(r) ? `<button class="btn primary" data-c="approve">${icon('check')} Approve</button>` : ''}
          <button class="btn" data-c="edit">${icon('edit')} Edit</button>
          ${r.status !== 'rejected' ? `<button class="btn" data-c="reject">${icon('x')} ${r.status === 'approved' ? 'Stop using' : 'Reject'}</button>` : ''}
          <button class="btn ghost danger-t" data-c="delete" aria-label="Delete">${icon('trash')}</button>
        </div>
      </article>`).join('') : empty(cacheFilter === 'pending' ? 'Nothing to approve' : 'Nothing here', cacheFilter === 'pending' ? 'When 3 or more devices ask the same general question, it shows here for one-tap approval.' : 'Nothing in this list yet.', cacheFilter === 'pending' ? 'check' : 'inbox');
    $$<HTMLElement>('.crow', el).forEach((card) => {
      const r = rows.find((x) => x.id === Number(card.dataset.id))!;
      const patch = async (body: Record<string, unknown>, msg: string) => {
        $$<HTMLButtonElement>('button', card).forEach((b) => (b.disabled = true));
        try {
          await rest(`ai_answer_cache?id=eq.${r.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) });
          Object.assign(r, body); toast(msg, 'ok'); cacheCount = rows.filter((x) => x.status === 'pending').length; renderChrome(); draw();
        } catch (e) { toast((e as Error).message, 'err'); $$<HTMLButtonElement>('button', card).forEach((b) => (b.disabled = false)); }
      };
      $$<HTMLButtonElement>('[data-c]', card).forEach((b) => b.onclick = async () => {
        const a = b.dataset.c;
        if (a === 'approve') patch(approveBody(r), 'Approved. Everyone asking this now gets this answer.');
        else if (a === 'reject') patch({ approved: false, status: 'rejected' }, r.status === 'approved' ? 'Stopped. This answer is no longer used.' : 'Rejected.');
        else if (a === 'delete') {
          if (!(await confirmBox('Delete this cached answer?', 'If devices keep asking it, it can come back here for approval.'))) return;
          try { await rest(`ai_answer_cache?id=eq.${r.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); rows = rows.filter((x) => x.id !== r.id); toast('Deleted.', 'ok'); draw(); }
          catch (e) { toast((e as Error).message, 'err'); }
        } else if (a === 'edit') {
          openDrawer(`${drawerHead('Edit answer')}
            <form class="d-body form" id="cform" novalidate>
              <div><label>Question</label><p>${esc(r.question)}</p></div>
              <div><div class="lbl-row"><label for="cans">Answer</label><span class="counter" id="cct">${r.answer.length}/6000</span></div>
              <textarea id="cans" rows="12" maxlength="6000">${esc(r.answer)}</textarea></div>
              <div class="d-foot"><span class="grow"></span><button type="button" class="btn" data-act="close-drawer">Cancel</button>
                <button type="submit" class="btn primary" id="csave">${icon('check')} Save and approve</button></div>
            </form>`, (d) => {
            const ta = $<HTMLTextAreaElement>('#cans', d);
            ta.oninput = () => { $('#cct', d).textContent = `${ta.value.length}/6000`; };
            $('#cform', d).onsubmit = async (e) => {
              e.preventDefault();
              const v = ta.value.trim();
              if (v.length < 5) { toast('Please write the answer.', 'err'); return; }
              closeDrawer(); patch(approveBody(r, v), 'Saved and approved.');
            };
          });
        }
      });
    });
  };
  draw();
}
