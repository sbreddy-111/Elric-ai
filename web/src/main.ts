import './style.css';
import { t, getLang, setLang, Strings } from './i18n';
import * as E from './engine';
import * as O from './online';

type Mode = 'study' | 'shopping' | 'general';
let mode: Mode = 'study';
let short = localStorage.getItem('elric.length') !== 'long';
let turns: E.Turn[] = [];
interface Chat { id: string; title: string; mode: Mode; turns: E.Turn[]; at: number }
const CHATS_KEY = 'elric.chats';
const CUR_KEY = 'elric.currentChat';
let chatId = '';
function loadChats(): Chat[] { try { return JSON.parse(localStorage.getItem(CHATS_KEY) || '[]'); } catch { return []; } }
function saveChats(cs: Chat[]) {
  cs.sort((a, b) => b.at - a.at);
  let list = cs.slice(0, 50);
  for (;;) { try { localStorage.setItem(CHATS_KEY, JSON.stringify(list)); return; } catch { if (list.length <= 1) return; list = list.slice(0, -1); } }
}
function persist() {
  const done = turns.filter((x) => x.text);
  if (!done.length) return;
  if (!chatId) { chatId = Date.now().toString(36); localStorage.setItem(CUR_KEY, chatId); }
  const cs = loadChats().filter((c) => c.id !== chatId);
  const first = done.find((x) => x.role === 'user')?.text || '';
  cs.push({ id: chatId, title: first.slice(0, 60), mode, turns: done, at: Date.now() });
  saveChats(cs);
}
function openChat(c: Chat | undefined) {
  if (busy) { stopRequested = true; E.stop(); O.stop(); return; } // let the current answer finish stopping and save first
  chatId = c?.id || ''; turns = c ? c.turns.map((x) => ({ ...x })) : []; if (c) mode = c.mode;
  if (chatId) localStorage.setItem(CUR_KEY, chatId); else localStorage.removeItem(CUR_KEY);
  shell();
}
localStorage.removeItem(CUR_KEY); // every launch starts a new chat; old ones are in Recent chats
function tex(m: string): string {
  let x = m;
  for (let i = 0; i < 4; i++) x = x.replace(/\\(?:text|mathrm|mathbf)\{([^{}]*)\}/g, '$1').replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
  return x.replace(/\\times/g, '×').replace(/\\div/g, '÷').replace(/\\cdot/g, '·').replace(/\\(?:long)?rightarrow/g, '→').replace(/\\quad/g, ' ')
    .replace(/\\%/g, '%').replace(/_\{?(\d+)\}?/g, (_, d) => d.split('').map((c: string) => '₀₁₂₃₄₅₆₇₈₉'[+c]).join('')).replace(/\^\{?(\d+)\}?/g, (_, d) => d.split('').map((c: string) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]).join('')).replace(/[{}]/g, '').replace(/\\/g, '');
}
/** Light, safe Markdown for model answers (escape first, then format). */
function md(src: string): string {
  let s = src.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => `\u0001${tex(m).trim()}\u0002`).replace(/\$([^$\n]+?)\$/g, (_, m) => tex(m));
  s = esc(s).replace(/(^\s*\|.*\|\s*)\n\s*\n(?=\s*\|)/gm, '$1\n').replace(/(^\s*\|.*\|\s*)\n\s*\n(?=\s*\|)/gm, '$1\n');
  const out: string[] = []; let list = ''; let head = true;
  const close = () => { if (list) { out.push(list === 'table' ? '</table></div>' : `</${list}>`); list = ''; } };
  const fmt = (l: string) => l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  for (const raw of s.split('\n')) {
    if (/^\s*\|.*\|\s*$/.test(raw)) {
      const cells = raw.trim().slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (list !== 'table') { close(); out.push('<div class="tw"><table>'); list = 'table'; head = true; }
      const tag = head ? 'th' : 'td'; head = false;
      out.push(`<tr>${cells.map((c) => `<${tag}>${fmt(c)}</${tag}>`).join('')}</tr>`);
      continue;
    }
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<i>$2</i>').replace(/\u0001(.*?)\u0002/g, '<span class="eq">$1</span>');
    let m;
    if (/^\s*(\*{3,}|-{3,})\s*$/.test(raw)) { close(); out.push('<hr>'); }
    else if ((m = line.match(/^#{1,4}\s+(.*)/))) { close(); out.push(`<h4>${m[1]}</h4>`); }
    else if ((m = line.match(/^\s*[*-]\s+(.*)/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${m[1]}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${m[1]}</li>`); }
    else if (!line.trim()) { close(); out.push(''); }
    else { close(); out.push(`<p>${line}</p>`); }
  }
  close();
  return out.join('');
}
const body = (x: E.Turn) => (x.role === 'model' ? md(x.text) : esc(x.text));
interface Profile { name: string; study: string }
function getProfile(): Profile { try { return { name: '', study: '', ...JSON.parse(localStorage.getItem('elric.profile') || '{}') }; } catch { return { name: '', study: '' }; } }
const secs = (ms: number) => (ms / 1000).toFixed(1);
function stats(x: E.Turn): string {
  if (x.role !== 'model') return '';
  const tag = x.src ? t(x.src === 'online' ? 'tagOnline' : 'tagOffline') : '';
  if (!x.ms) return tag ? `<div class="stat">${tag}</div>` : '';
  const words = x.text.trim().split(/\s+/).filter(Boolean).length;
  const gen = Math.max(1, x.ms - (x.firstMs || 0));
  const parts = [`⏱ ${t('statTime', { s: secs(x.ms) })}`];
  if (x.firstMs) parts.push(t('statFirst', { s: secs(x.firstMs) }));
  if (words > 3) parts.push(t('statSpeed', { n: (words / (gen / 1000)).toFixed(1) }));
  if (tag) parts.push(tag);
  return `<div class="stat">${parts.join(' · ')}</div>`;
}
let busy = false;
let device: E.DeviceReport | null = null;
let partial = 0;
E.partialBytes().then((b) => { partial = b; renderStatus(); });
let modelState: 'idle' | 'downloading' | 'stored' | 'loading' | 'ready' | 'failed' = E.isStored() ? 'stored' : 'idle';
let progress = 0;
let failMsg = '';
let failIsDownload = false;
let abort: AbortController | null = null;

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const gb = (b: number) => (b / 1e9).toFixed(1) + ' GB';
const SIZE = gb(E.LITE.sizeBytes);
const modeKey: Record<Mode, keyof Strings> = { study: 'modeStudy', shopping: 'modeShopping', general: 'modeGeneral' };

const ic = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  newc: '<path d="M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6M16 19h6M19 16v6"/>',
  cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
};
const svg = (p: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

function shell() {
  $('#app').innerHTML = `
  <header class="top">
    <button class="icon" id="menu" aria-label="${t('cdMenu')}">${svg(ic.menu)}</button>
    <button class="modebtn" id="modebtn" aria-label="${t('cdMode')}">Elric AI · <b>${t(modeKey[mode])}</b>${svg(ic.down)}</button>
    <button class="lang" id="lang">${getLang() === 'en' ? 'हिं' : 'EN'}</button>
    <button class="icon" id="newc" aria-label="${t('cdNewChat')}">${svg(ic.newc)}</button>
  </header>
  <div class="pill ${mode === 'shopping' || O.isOn() ? 'online' : ''}"><i></i>${mode === 'shopping' ? t('privacyOnline') : O.isOn() ? t('pillOnline') : t('privacyOnDevice')}</div>
  <main id="main"></main>
  <form class="composer" id="form">
    <button type="button" class="snap" id="snap" aria-label="${t('cdSnap')}">${svg(ic.cam)}</button>
    <textarea id="input" rows="1" placeholder="${t('composerHint')}"></textarea>
    <button type="button" class="icon" id="mic" aria-label="${t('cdMic')}">${svg(ic.mic)}</button>
    <button type="submit" class="send" id="send" aria-label="${busy ? t('cdStop') : t('cdSend')}">${svg(busy ? ic.stop : ic.send)}</button>
  </form>
  <div id="sheet"></div>`;
  $('#menu').onclick = menuSheet;
  $('#modebtn').onclick = modeSheet;
  $('#lang').onclick = () => { setLang(getLang() === 'en' ? 'hi' : 'en'); shell(); };
  $('#newc').onclick = () => openChat(undefined);
  $('#snap').onclick = () => sheet(`<h3>${t('photoSoonTitle')}</h3><p>${t('photoSoonBody')}</p>`);
  $('#mic').onclick = () => sheet(`<h3>${t('micSoonTitle')}</h3><p>${t('micSoonBody')}</p>`);
  const input = $<HTMLTextAreaElement>('#input');
  input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; };
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); submit(); } };
  $('#form').onsubmit = (e) => { e.preventDefault(); submit(); };
  renderMain();
}

function renderMain() {
  const m = $('#main');
  if (!turns.length) {
    const cards: [keyof Strings, () => void][] = [
      ['sugQuiz', () => send(t('promptQuiz'))],
      ['sugPhoto', () => $('#snap').click()],
      ['sugLecture', () => { const i = $<HTMLTextAreaElement>('#input'); i.value = t('promptLecture'); i.focus(); }],
      ['sugWatch', () => { mode = 'shopping'; shell(); send(t('promptWatch')); }],
    ];
    m.innerHTML = `<section class="hero"><img src="icons/mark.png" alt="" class="mark"><h1>${t('greeting')}${getProfile().name ? ', ' + esc(getProfile().name.split(' ')[0]) : ''}</h1><p>${t('subtitle')}</p>
      <div class="cards">${cards.map(([k], i) => `<button class="card" data-i="${i}">${t(k)}</button>`).join('')}</div>
      <div id="status"></div></section>`;
    m.querySelectorAll<HTMLButtonElement>('.card').forEach((b) => (b.onclick = cards[+b.dataset.i!][1]));
    renderStatus();
    return;
  }
  m.innerHTML = `<div class="chat">${turns.map((x, i) => `<div class="msg ${x.role}"${i === turns.length - 1 ? ' id="last"' : ''}>${body(x) || waitDots()}</div>${stats(x)}${x.role === 'user' && !busy ? `<button class="edit" data-e="${i}">✎ ${t('editQ')}</button>` : ''}`).join('')}
    ${mode === 'shopping' ? `<div class="note">${t('shoppingNote')}</div>` : ''}${showStatusInChat() ? '<div id="status"></div>' : ''}</div>`;
  renderStatus();
  m.scrollTop = m.scrollHeight;
  m.querySelectorAll<HTMLButtonElement>('[data-e]').forEach((b) => (b.onclick = () => {
    const i = +b.dataset.e!; const q = turns[i].text;
    turns = turns.slice(0, i); shell();
    const inp = $<HTMLTextAreaElement>('#input'); inp.value = q; inp.focus(); inp.dispatchEvent(new Event('input'));
  }));
}

/** In a chat, the model card shows when offline answers are on, or when a question still needs the model. */
function showStatusInChat(): boolean {
  const last = turns[turns.length - 1];
  return !O.isOn() || !last || last.role === 'user' || !!last.failed;
}

function reasonText(r: E.Reason): string {
  switch (r.kind) {
    case 'noWebGPU': return t('reasonNoWebGPU');
    case 'noAdapter': return t('reasonNoAdapter');
    case 'smallGpu': return t('reasonSmallGpu', { limit: gb(r.limit) });
    case 'storage': return t('reasonStorage', { need: gb(r.need), have: gb(r.have) });
    case 'crashed': return t('reasonCrashed');
    case 'loadFailed': return t('reasonLoadFailed', { err: r.err });
  }
}

/** Model / device card shown on home and in chat when the model isn't ready. */
function renderStatus() {
  const els = Array.from(document.querySelectorAll<HTMLElement>('#status, .status-slot'));
  if (!els.length) return;
  const el = { set innerHTML(h: string) { els.forEach((e) => (e.innerHTML = h)); } };
  if (modelState === 'ready') { el.innerHTML = turns.length ? '' : `<div class="ok">● ${t(E.MODEL_NAME_KEY as keyof Strings)} · ${t(O.isOn() ? 'loadedBackup' : 'loaded')}</div>`; return; }
  if (!device) { el.innerHTML = `<div class="box muted">${t('checking')}</div>`; return; }
  if (!device.ok) { el.innerHTML = `<div class="box warn"><h3>${t('cantRunTitle')}</h3><p>${reasonText(device.hard!)}</p></div>`; return; }
  let body = '';
  const soft = device.soft.map((r) => `<p class="w">${reasonText(r)}</p>`).join('');
  if (modelState === 'idle') {
    const resume = partial > 0 ? `<div class="bar"><i style="width:${((partial / E.LITE.sizeBytes) * 100).toFixed(1)}%"></i></div><p class="tip">${t('downloadedOf', { done: gb(partial), total: SIZE })}</p>` : '';
    body = `${soft}${device.isIOS ? `<p class="w">${t('iosWarning')}</p>` : ''}${resume}<button class="primary" id="dl">${partial > 0 ? t('resume') : t('downloadSize', { size: SIZE })}</button><p class="tip">${t('wifiTip')}</p>`;
  } else if (modelState === 'downloading') {
    body = `<div class="bar"><i style="width:${(progress * 100).toFixed(1)}%"></i></div><p class="tip">${t('downloading', { pct: Math.floor(progress * 100) + '%' })} · ${t('downloadedOf', { done: gb(progress * E.LITE.sizeBytes), total: SIZE })}</p><p class="tip">${t('keepOpen')}</p><button class="ghost" id="cx">${t('cancel')}</button>`;
  } else if (modelState === 'stored') {
    body = `${soft}<p class="tip">✓ ${t('ready')}</p><button class="primary" id="ld">${device.soft.length ? t('tryAnyway') : t('loadModel')}</button><button class="ghost" id="rm">${t('remove')}</button>`;
  } else if (modelState === 'loading') {
    body = `<div class="bar"><i style="width:${(progress * 100).toFixed(1)}%"></i></div><p class="tip">${t('loading')}</p>`;
  } else if (modelState === 'failed') {
    body = `<h3>${t(failIsDownload ? 'pausedTitle' : 'cantRunTitle')}</h3><p class="w">${esc(failMsg)}</p><button class="primary" id="rt">${partial > 0 ? t('resume') : t('retry')}</button>`;
  }
  el.innerHTML = `<div class="box"><div class="mh"><b>${t(E.MODEL_NAME_KEY as keyof Strings)}</b><span>${SIZE}</span></div><p class="d">${t(E.MODEL_DESC_KEY as keyof Strings)}</p>${body}</div>`;
  const on = (id: string, f: () => void) => { document.querySelectorAll<HTMLElement>(`[id="${id}"]`).forEach((b) => (b.onclick = f)); };
  on('dl', startDownload);
  on('cx', () => abort?.abort());
  on('ld', startLoad);
  on('rt', () => { if (!E.isStored() && partial > 0) { startDownload(); return; } modelState = E.isStored() ? 'stored' : 'idle'; renderStatus(); });
  on('rm', async () => { if (confirm(t('removeConfirm'))) { await E.removeStored(); modelState = 'idle'; renderStatus(); } });
}

let wakeLock: any = null;
async function keepAwake(on: boolean) {
  try {
    if (on && !wakeLock && (navigator as any).wakeLock) wakeLock = await (navigator as any).wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
let resumeOnReturn = false;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (modelState === 'downloading') keepAwake(true); // wake lock drops when hidden
  else if (resumeOnReturn && !E.isStored()) startDownload();
});

async function startDownload() {
  if (modelState === 'downloading') return;
  partial = await E.partialBytes();
  modelState = 'downloading'; progress = partial / E.LITE.sizeBytes; abort = new AbortController(); renderStatus();
  resumeOnReturn = false;
  keepAwake(true);
  try {
    await E.downloadModel((p) => { progress = p.done / p.total; partial = p.done; renderStatus(); }, abort.signal);
    modelState = 'stored'; partial = 0;
  } catch (e: any) {
    partial = await E.partialBytes();
    modelState = 'idle';
    if (e?.name !== 'AbortError') {
      if (document.visibilityState !== 'visible') { resumeOnReturn = true; } // paused by iOS: carry on when user comes back
      else { modelState = 'failed'; failIsDownload = true; failMsg = String(e?.message || e); }
    }
  }
  keepAwake(false);
  renderStatus();
}

async function startLoad() {
  E.clearCrashFlag();
  if (device) device.soft = device.soft.filter((r) => r.kind !== 'crashed');
  modelState = 'loading'; progress = 0; renderStatus();
  try {
    await E.loadModel((p) => { progress = p.done / p.total; renderStatus(); });
    modelState = 'ready';
    const lastTurn = turns[turns.length - 1];
    if (lastTurn?.role === 'model' && lastTurn.failed && turns[turns.length - 2]?.role === 'user') turns.pop();
    if (turns[turns.length - 1]?.role === 'user') { const q = turns.pop()!; setTimeout(() => send(q.text)); }
  } catch (e: any) {
    modelState = 'failed';
    failIsDownload = false;
    failMsg = reasonText({ kind: 'loadFailed', err: String(e?.message || e) });
  }
  renderMain();
}

function system(): string {
  let s = E.SYSTEM_PROMPT;
  if (mode === 'study') s += ' Mode: Study. Be a patient tutor for Indian students.';
  if (mode === 'shopping') s += ' Mode: Shopping. You have NO access to live prices, stock or offers. Never state or guess specific prices. Help compare features and explain what to look for, and say live prices are coming soon.';
  if (getLang() === 'hi') s += ' The user prefers Hindi.';
  const pr = getProfile();
  if (pr.name) s += ` The user's name is ${pr.name}.`;
  if (pr.study) s += ` The user studies: ${pr.study}. Match explanations to this level.`;
  s += short
    ? ' ANSWER LENGTH: SHORT. Reply in at most 4 short sentences or 5 bullet points (under 80 words). Give the key answer first. No greetings, no repeating the question. If the user sends several questions, answer each in one or two lines.'
    : ' ANSWER LENGTH: DETAILED. Explain step by step with an example.';
  return s;
}

function submit() {
  if (busy) { stopRequested = true; E.stop(); O.stop(); return; }
  const i = $<HTMLTextAreaElement>('#input');
  const text = i.value.trim();
  if (!text) return;
  i.value = ''; i.style.height = 'auto';
  send(text);
}

/** Turns that can be sent to a model as history (no notices, no empty replies). */
function historyOf(list: E.Turn[]): E.Turn[] {
  return list.filter((x) => !x.failed && x.text.trim());
}

let frame = 0;
/** Repaints the answer being written, following it only if the user is at the bottom. */
function paint(reply: E.Turn) {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const m = $('#main');
    const stick = m.scrollHeight - m.scrollTop - m.clientHeight < 120;
    const last = document.getElementById('last');
    if (last) last.innerHTML = md(reply.text) || waitDots(); else renderMain();
    if (stick) m.scrollTop = m.scrollHeight;
  });
}
function flush() { if (frame) { cancelAnimationFrame(frame); frame = 0; } }

let onlineWaiting = false;
function waitDots(): string {
  return onlineWaiting ? `<span class="dots">•••</span> <span class="wait">${t('gettingOnline')}</span>` : '<span class="dots">•••</span>';
}

/** Online answer. Returns true when the reply is final (answered or stopped), false to answer on the device. */
async function answerOnline(reply: E.Turn, question: string, history: E.Turn[]): Promise<boolean> {
  const pr = getProfile();
  const t0 = performance.now();
  let raw = '';
  onlineWaiting = true; paint(reply);
  const end = await O.ask({
    question: question.slice(0, 4000),
    history: history.slice(-O.HISTORY_TURNS).map((x) => ({ role: x.role, text: x.text.slice(0, 4000) })),
    mode,
    short,
    lang: getLang(),
    ...(pr.name ? { name: pr.name.trim() } : {}),
    ...(pr.study ? { study: pr.study } : {}),
  }, (piece) => {
    raw += piece;
    onlineWaiting = false;
    if (!reply.firstMs && raw.trim()) reply.firstMs = Math.round(performance.now() - t0);
    reply.text = raw;
    paint(reply);
  });
  onlineWaiting = false;
  flush();
  O.record(end);
  reply.text = raw.trim();
  if (end.kind === 'done' && reply.text) { reply.ms = Math.round(performance.now() - t0); reply.src = 'online'; return true; }
  if (end.kind === 'stopped' || stopRequested) {
    if (reply.text) reply.src = 'online'; else { reply.text = t('stopped'); reply.failed = true; }
    reply.firstMs = undefined;
    return true;
  }
  // Limit, error, no first word in time or the connection dropped: answer on the device, from the start.
  reply.text = ''; reply.firstMs = undefined;
  return false;
}

async function answerOffline(reply: E.Turn, history: E.Turn[]) {
  const t0 = performance.now();
  try {
    reply.text = await E.generate(system(), history, (txt) => {
      if (!reply.firstMs && txt.trim()) reply.firstMs = Math.round(performance.now() - t0);
      reply.text = txt;
      paint(reply);
    });
    flush();
    reply.ms = Math.round(performance.now() - t0);
    reply.src = 'offline';
    if (!reply.text) { reply.text = t('stopped'); reply.ms = undefined; reply.src = undefined; reply.failed = true; }
  } catch (e: any) {
    flush();
    reply.text = t('errorAnswer', { err: String(e?.message || e) });
    reply.failed = true;
  }
}

let stopRequested = false;
async function send(text: string) {
  if (busy) return;
  const history = historyOf(turns);
  turns.push({ role: 'user', text });
  const online = O.ready();
  if (!E.isLoaded() && !online) { renderMain(); return; } // status card explains what's needed; never fake an answer
  busy = true;
  stopRequested = false;
  const reply: E.Turn = { role: 'model', text: '' };
  turns.push(reply);
  shell();
  let final = false;
  if (online) final = await answerOnline(reply, text, history);
  if (!final) {
    if (E.isLoaded()) { paint(reply); await answerOffline(reply, [...history, { role: 'user', text }]); }
    else { reply.text = t('onlineBusy'); reply.failed = true; }
  }
  busy = false;
  persist();
  shell();
}

function sheet(html: string, withClose = true) {
  const s = $('#sheet');
  s.innerHTML = `<div class="scrim"></div><div class="panel">${html}${withClose ? `<button class="ghost" id="close">${t('close')}</button>` : ''}</div>`;
  const close = () => (s.innerHTML = '');
  s.querySelector<HTMLElement>('.scrim')!.onclick = close;
  if (withClose) $('#close').onclick = close;
}

/** Online answers on/off. Turning on asks once that the user is 18 or older. */
function toggleOnline() {
  if (O.isOn()) { O.setOn(false); shell(); return; }
  if (O.age18()) { O.setOn(true); shell(); return; }
  sheet(`<h3>${t('onlineAnswers')}</h3><p>${t('age18Text')}</p><button class="primary" id="a18">${t('age18Yes')}</button><button class="ghost" id="a18no">${t('notNow')}</button>`, false);
  $('#a18').onclick = () => { O.confirmAge18(); shell(); };
  $('#a18no').onclick = () => { $('#sheet').innerHTML = ''; };
}

function modeSheet() {
  const ms: Mode[] = ['study', 'shopping', 'general'];
  const desc: Record<Mode, keyof Strings> = { study: 'modeStudyDesc', shopping: 'modeShoppingDesc', general: 'modeGeneralDesc' };
  sheet(ms.map((m) => `<button class="row ${m === mode ? 'sel' : ''}" data-m="${m}"><b>${t(modeKey[m])}</b><span>${t(desc[m])}</span></button>`).join('')
    + `<div class="sec">${t('lenTitle')}</div>`
    + `<button class="row ${short ? 'sel' : ''}" data-l="short"><b>${t('lenShort')}</b><span>${t('lenShortDesc')}</span></button>`
    + `<button class="row ${!short ? 'sel' : ''}" data-l="long"><b>${t('lenLong')}</b><span>${t('lenLongDesc')}</span></button>`);
  document.querySelectorAll<HTMLButtonElement>('[data-l]').forEach((b) => (b.onclick = () => { short = b.dataset.l === 'short'; localStorage.setItem('elric.length', short ? 'short' : 'long'); shell(); }));
  document.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => (b.onclick = () => { mode = b.dataset.m as Mode; shell(); }));
}

const APP_VERSION = '0.3.9';
const LEGAL_LINKS = () => `<p class="lic legal"><a href="privacy.html" target="_blank" rel="noopener">${t('linkPrivacy')}</a> · <a href="terms.html" target="_blank" rel="noopener">${t('linkTerms')}</a></p>`;
const LICENSES = [
  ['Elric Lite model weights (open model)', 'Apache License 2.0', 'https://www.apache.org/licenses/LICENSE-2.0'],
  ['Elric Basic model weights (Gemma 3 1B, iPhone)', 'Gemma Terms of Use', 'https://ai.google.dev/gemma/terms'],
  ['MediaPipe / LiteRT web runtime', 'Apache License 2.0', 'https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE'],
  ['Elric AI (this app)', 'Apache License 2.0', 'https://github.com/sbreddy-111/Elric-ai/blob/main/LICENSE'],
  ['Vite (build tool)', 'MIT License', 'https://github.com/vitejs/vite/blob/main/LICENSE'],
];

function menuSheet() {
  sheet(`<div class="brand"><img src="icons/mark.png" alt=""><div><b>Elric AI</b><span>AI you can rely on</span></div></div>
    <div class="sec">${t('menuChats')}</div>
    ${(() => { const cs = loadChats(); return cs.length ? cs.slice(0, 20).map((c) => `<div class="chatrow ${c.id === chatId ? 'sel' : ''}"><button class="ct" data-c="${c.id}">${esc(c.title || '…')}</button><button class="cx" data-d="${c.id}" aria-label="${t('deleteChat')}">×</button></div>`).join('') : `<p class="tip pad">${t('noChats')}</p>`; })()}
    <div class="sec"></div>
    <button class="row" id="m-me"><b>${t('menuMe')}</b><span>${esc(getProfile().name) || t('menuMeHint')}</span></button>
    <button class="row" id="m-models"><b>${t('menuModels')}</b><span>${t(E.MODEL_NAME_KEY as keyof Strings)} · ${SIZE}</span></button>
    <button class="row trow" id="m-online" role="switch" aria-checked="${O.isOn()}"><span class="tl"><b>${t('onlineAnswers')}</b><span>${t('onlineHow')}</span></span><i class="sw ${O.isOn() ? 'on' : ''}"></i></button>
    <button class="row" id="m-lang"><b>${t('menuLanguage')}</b><span>English · हिन्दी</span></button>
    <button class="row" id="m-priv"><b>${t('menuPrivacy')}</b></button>
    <button class="row" id="m-about"><b>${t('menuAbout')}</b></button>
    <button class="row" id="m-lic"><b>${t('menuLicenses')}</b></button>
    <p class="tip">${t(/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)) ? 'installTip' : 'installTipPc')}</p><p class="tip pad">Version ${APP_VERSION}</p>`);
  $('#m-models').onclick = () => sheet(`<h3>${t('menuModels')}</h3><div class="status-slot"></div><div class="box"><div class="mh"><b>${t('modelStandard')}</b><span>${t('comingSoon')}</span></div><p class="d">${t('modelStandardDesc')}</p></div>`) ; 
  $('#m-models').addEventListener('click', () => renderStatus());
  document.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => (b.onclick = () => openChat(loadChats().find((c) => c.id === b.dataset.c))));
  document.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.d!; saveChats(loadChats().filter((c) => c.id !== id));
    if (id === chatId) openChat(undefined); else menuSheet();
  }));
  $('#m-me').onclick = () => {
    const pr = getProfile();
    sheet(`<h3>${t('menuMe')}</h3><p>${t('meIntro')}</p>
      <label class="fl">${t('meName')}<input id="pn" maxlength="40" value="${esc(pr.name)}"></label>
      <button class="primary" id="psave">${t('save')}</button>`);
    $('#psave').onclick = () => {
      localStorage.setItem('elric.profile', JSON.stringify({ name: $<HTMLInputElement>('#pn').value.trim(), study: '' }));
      shell();
    };
  };
  $('#m-online').onclick = toggleOnline;
  $('#m-lang').onclick = () => { setLang(getLang() === 'en' ? 'hi' : 'en'); shell(); };
  $('#m-priv').onclick = () => sheet(`<h3>${t('menuPrivacy')}</h3><p>${t('privacyBody')}</p>${LEGAL_LINKS()}`);
  $('#m-about').onclick = () => sheet(`<h3>${t('menuAbout')}</h3><p>${t('aboutBody')}</p>${LEGAL_LINKS()}`);
  $('#m-lic').onclick = () => sheet(`<h3>${t('menuLicenses')}</h3><p>${t('licensesIntro')}</p>${LICENSES.map(([n, l, u]) => `<p class="lic"><b>${n}</b><br><a href="${u}" target="_blank" rel="noopener">${l}</a></p>`).join('')}`);
}

setLang(getLang());
shell();
E.checkDevice().then((r) => { device = r; renderStatus(); });
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then((r) => r.update()).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !busy && modelState !== 'downloading' && modelState !== 'loading') location.reload(); });
}
