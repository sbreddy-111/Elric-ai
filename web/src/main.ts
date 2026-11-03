import './style.css';
import { t, getLang, setLang, Strings } from './i18n';
import * as E from './engine';

type Mode = 'study' | 'shopping' | 'general';
let mode: Mode = 'study';
let turns: E.Turn[] = [];
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
  <div class="pill ${mode === 'shopping' ? 'online' : ''}"><i></i>${mode === 'shopping' ? t('privacyOnline') : t('privacyOnDevice')}</div>
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
  $('#newc').onclick = () => { if (busy) E.stop(); turns = []; shell(); };
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
    m.innerHTML = `<section class="hero"><img src="icons/mark.png" alt="" class="mark"><h1>${t('greeting')}</h1><p>${t('subtitle')}</p>
      <div class="cards">${cards.map(([k], i) => `<button class="card" data-i="${i}">${t(k)}</button>`).join('')}</div>
      <div id="status"></div></section>`;
    m.querySelectorAll<HTMLButtonElement>('.card').forEach((b) => (b.onclick = cards[+b.dataset.i!][1]));
    renderStatus();
    return;
  }
  m.innerHTML = `<div class="chat">${turns.map((x, i) => `<div class="msg ${x.role}"${i === turns.length - 1 ? ' id="last"' : ''}>${esc(x.text) || '<span class="dots">•••</span>'}</div>`).join('')}
    ${mode === 'shopping' ? `<div class="note">${t('shoppingNote')}</div>` : ''}<div id="status"></div></div>`;
  renderStatus();
  m.scrollTop = m.scrollHeight;
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
  if (modelState === 'ready') { el.innerHTML = turns.length ? '' : `<div class="ok">● ${t(E.MODEL_NAME_KEY as keyof Strings)} · ${t('loaded')}</div>`; return; }
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
    if (lastTurn?.role === 'user') { const q = turns.pop()!; setTimeout(() => send(q.text)); }
  } catch (e: any) {
    modelState = 'failed';
    failIsDownload = false;
    failMsg = reasonText({ kind: 'loadFailed', err: String(e?.message || e) });
  }
  renderMain();
}

function system(): string {
  let s = E.SYSTEM_PROMPT;
  if (mode === 'study') s += ' Mode: Study. Explain step by step, like a patient tutor for Indian students.';
  if (mode === 'shopping') s += ' Mode: Shopping. You have NO access to live prices, stock or offers. Never state or guess specific prices. Help compare features and explain what to look for, and say live prices are coming soon.';
  if (getLang() === 'hi') s += ' The user prefers Hindi.';
  return s;
}

function submit() {
  if (busy) { E.stop(); return; }
  const i = $<HTMLTextAreaElement>('#input');
  const text = i.value.trim();
  if (!text) return;
  i.value = ''; i.style.height = 'auto';
  send(text);
}

async function send(text: string) {
  if (busy) return;
  turns.push({ role: 'user', text });
  if (!E.isLoaded()) { renderMain(); return; } // status card explains what's needed; never fake an answer
  busy = true;
  const reply: E.Turn = { role: 'model', text: '' };
  turns.push(reply);
  shell();
  try {
    reply.text = await E.generate(system(), turns.slice(0, -1), (txt) => {
      reply.text = txt;
      const last = document.getElementById('last');
      if (last) last.textContent = txt; else renderMain();
      const m = $('#main'); m.scrollTop = m.scrollHeight;
    });
    if (!reply.text) reply.text = t('stopped');
  } catch (e: any) {
    reply.text = t('errorAnswer', { err: String(e?.message || e) });
  }
  busy = false;
  shell();
}

function sheet(html: string) {
  const s = $('#sheet');
  s.innerHTML = `<div class="scrim"></div><div class="panel">${html}<button class="ghost" id="close">${t('close')}</button></div>`;
  const close = () => (s.innerHTML = '');
  s.querySelector<HTMLElement>('.scrim')!.onclick = close;
  $('#close').onclick = close;
}

function modeSheet() {
  const ms: Mode[] = ['study', 'shopping', 'general'];
  const desc: Record<Mode, keyof Strings> = { study: 'modeStudyDesc', shopping: 'modeShoppingDesc', general: 'modeGeneralDesc' };
  sheet(ms.map((m) => `<button class="row ${m === mode ? 'sel' : ''}" data-m="${m}"><b>${t(modeKey[m])}</b><span>${t(desc[m])}</span></button>`).join(''));
  document.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => (b.onclick = () => { mode = b.dataset.m as Mode; shell(); }));
}

const LICENSES = [
  ['Elric Lite model weights (open model)', 'Apache License 2.0', 'https://www.apache.org/licenses/LICENSE-2.0'],
  ['MediaPipe / LiteRT web runtime', 'Apache License 2.0', 'https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE'],
  ['Elric AI (this app)', 'Apache License 2.0', 'https://github.com/sbreddy-111/Elric-ai/blob/main/LICENSE'],
  ['Vite (build tool)', 'MIT License', 'https://github.com/vitejs/vite/blob/main/LICENSE'],
];

function menuSheet() {
  sheet(`<div class="brand"><img src="icons/mark.png" alt=""><div><b>Elric AI</b><span>AI you can rely on</span></div></div>
    <button class="row" id="m-models"><b>${t('menuModels')}</b><span>${t(E.MODEL_NAME_KEY as keyof Strings)} · ${SIZE}</span></button>
    <button class="row" id="m-lang"><b>${t('menuLanguage')}</b><span>English · हिन्दी</span></button>
    <button class="row" id="m-priv"><b>${t('menuPrivacy')}</b></button>
    <button class="row" id="m-about"><b>${t('menuAbout')}</b></button>
    <button class="row" id="m-lic"><b>${t('menuLicenses')}</b></button>
    <p class="tip">${t('installTip')}</p>`);
  $('#m-models').onclick = () => sheet(`<h3>${t('menuModels')}</h3><div class="status-slot"></div><div class="box"><div class="mh"><b>${t('modelStandard')}</b><span>${t('comingSoon')}</span></div><p class="d">${t('modelStandardDesc')}</p></div>`) ; 
  $('#m-models').addEventListener('click', () => renderStatus());
  $('#m-lang').onclick = () => { setLang(getLang() === 'en' ? 'hi' : 'en'); shell(); };
  $('#m-priv').onclick = () => sheet(`<h3>${t('menuPrivacy')}</h3><p>${t('privacyBody')}</p>`);
  $('#m-about').onclick = () => sheet(`<h3>${t('menuAbout')}</h3><p>${t('aboutBody')}</p>`);
  $('#m-lic').onclick = () => sheet(`<h3>${t('menuLicenses')}</h3><p>${t('licensesIntro')}</p>${LICENSES.map(([n, l, u]) => `<p class="lic"><b>${n}</b><br><a href="${u}" target="_blank" rel="noopener">${l}</a></p>`).join('')}`);
}

setLang(getLang());
shell();
E.checkDevice().then((r) => { device = r; renderStatus(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
