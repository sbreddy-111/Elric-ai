import './style.css';
import { initFit } from './fit';
initFit();
import { t, getLang, setLang, Strings } from './i18n';
import * as E from './engine';
import * as O from './online';
import * as V from './voice';
import * as P from './photo';
import * as F from './feedback';
import * as D from './file';
import { isHard, isImageRequest, isMath } from './smart';
import { drawDiagrams, diag } from './diagram';
import { generateWithCalc, showCalc } from './calcloop';

type Mode = 'study' | 'shopping' | 'general';
const defaultMode = (): Mode => { const m = localStorage.getItem('elric.mode'); return m === 'shopping' || m === 'study' ? m : 'general'; };
let mode: Mode = defaultMode();
let short = localStorage.getItem('elric.length') !== 'long';
/** A chat turn; photo and file text live only in memory, never in saved chats. */
type Turn = E.Turn & { agent?: AgentRes; payUrl?: string; photo?: P.Photo; doc?: D.Doc; image?: string; reported?: boolean; partial?: boolean; sources?: O.Src[]; products?: O.Prod[]; imgPrompt?: string; hard?: boolean };
let turns: Turn[] = [];
/** Elric Agent card inside the chat (from the ai-agent function). closed = answered with Yes/Edit or superseded. */
interface AgentRes { task: string; lang: string; script: string; fields: Record<string, string | null>; missing: string[]; confirm_text: string; closed?: boolean }
interface Chat { id: string; title: string; mode: Mode; turns: Turn[]; at: number }
const CHATS_KEY = 'elric.chats';
const CUR_KEY = 'elric.currentChat';
let chatId = '';
function loadChats(): Chat[] { try { return JSON.parse(localStorage.getItem(CHATS_KEY) || '[]'); } catch { return []; } }
function saveChats(cs: Chat[]) {
  cs.sort((a, b) => b.at - a.at);
  let list = cs.slice(0, 50);
  for (;;) { try { localStorage.setItem(CHATS_KEY, JSON.stringify(list)); return; } catch { if (list.length <= 1) return; list = list.slice(0, -1); } }
}
/** The chat on screen was deleted (or Clear all) while its answer was still being written: never save it again. */
let dropCurrent = false;
function persist() {
  try { persistChat(); } catch { /* storage full or blocked: the chat stays on screen */ }
}
function persistChat() {
  if (dropCurrent) return;
  // Saved chats keep a placeholder instead of the photo (browser storage is small).
  const done = turns.filter((x) => x.text).map(({ photo, doc, image, ...x }) => (image ? { ...x, text: `🖼 ${x.text} (${t('imageNotSaved')})` } : photo ? { ...x, text: `📷 ${t('photoLabel')} · ${x.text}` } : doc ? { ...x, text: `📄 ${doc.name} · ${x.text}` } : x));
  if (!done.length) return;
  if (!chatId) { chatId = Date.now().toString(36); try { localStorage.setItem(CUR_KEY, chatId); } catch { /* storage full */ } }
  const cs = loadChats().filter((c) => c.id !== chatId);
  const first = done.find((x) => x.role === 'user')?.text || '';
  cs.push({ id: chatId, title: first.slice(0, 60), mode, turns: done, at: Date.now() });
  saveChats(cs);
}
/** A chat (or a new one, id '') to open as soon as the answer being written has stopped and been saved. */
let pendingOpen: { id: string } | null = null;
function openChat(c: Chat | undefined) {
  if (busy) { pendingOpen = { id: c?.id || '' }; stopRequested = true; E.stop(); O.stop(); return; } // opened by send() once stopped
  dropCurrent = false;
  chatId = c?.id || ''; turns = c ? c.turns.map((x) => ({ ...x })) : []; if (c) mode = c.mode;
  try { if (chatId) localStorage.setItem(CUR_KEY, chatId); else localStorage.removeItem(CUR_KEY); } catch { /* storage blocked */ }
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
  // Code blocks first (kept exactly); a closed ```mermaid block becomes a diagram placeholder.
  const blocks: string[] = [];
  src = src.replace(/(^|\n)[ \t]*```[ \t]*([\w+-]*)[^\n]*\n([\s\S]*?)(?:\n[ \t]*```[ \t]*(?=\n|$)|$)/g, (all, pre, lang, code) => {
    const closed = /```[ \t]*$/.test(all.trimEnd()) && all.trimEnd().length > all.indexOf('```') + 3 + lang.length;
    const c = esc(code.replace(/\n[ \t]*```[ \t]*$/, ''));
    const isMmd = lang.toLowerCase() === 'mermaid' || (/^(|text|plain|mmd|code)$/i.test(lang) && /^\s*(flowchart|graph|sequenceDiagram|pie|mindmap|timeline|classDiagram|stateDiagram|erDiagram|journey)\b/.test(code));
    blocks.push(isMmd && closed
      ? `<div class="mmd"><pre class="code"><code>${c}</code></pre></div>`
      : `<pre class="code"><code>${c}</code></pre>`);
    return `${pre}\u0003${blocks.length - 1}\u0003\n`;
  });
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
    const bm = raw.match(/^\u0003(\d+)\u0003$/);
    if (bm) { close(); out.push(blocks[+bm[1]]); continue; }
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
const okImage = (u?: string) => !!u && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(u);
const body = (x: Turn) => (x.role === 'model' ? (okImage(x.image) ? `<img class="gen" src="${esc(x.image!)}" alt="${t('imageAlt')}"><a class="gsave" href="${esc(x.image!)}" download="elric-image.jpg">${t('imageSave')}</a>` : '') + md(x.text) : (x.photo ? `<img class="ph" src="${x.photo.thumb}" alt="${t('photoLabel')}">` : '') + (x.doc ? `<span class="dq">📄 ${esc(x.doc.name)}</span>` : '') + esc(x.text));
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
/** Small source links under an answer that used the web, and a tip under a hard question answered offline. */
function extras(x: Turn, i: number): string {
  if (x.role !== 'model' || (busy && i === turns.length - 1)) return '';
  let h = '';
  if (x.agent) h += agentCard(x.agent, i);
  if (x.payUrl && /^https:\/\//.test(x.payUrl)) h += `<a class="agyes aglink" href="${esc(x.payUrl)}" target="_blank" rel="noopener">${t('agOpenPay')}</a>`;
  const src = (x.sources || []).filter((s) => /^https?:\/\//.test(s.u) && host(s.u));
  if (src.length && !x.failed) h += `<div class="srcs"><span>${t('sources')}</span>${src.map((s) => `<a href="${esc(s.u)}" target="_blank" rel="noopener noreferrer nofollow" title="${esc(s.t || host(s.u))}">${esc(host(s.u))}</a>`).join('')}</div>`;
  if (x.products?.length && !x.failed) {
    const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
    h += `<div class="prods"><div class="prods-h">${t('fromStore')}</div><div class="prods-row">${x.products.map((p) => `<a class="prod" href="${esc(p.url)}" target="_blank" rel="noopener">
      <img src="${esc(p.img.includes('?') ? p.img : p.img + '?width=360')}" alt="" loading="lazy"><span class="pt">${esc(p.title)}</span>
      <span class="pp"><b>${inr(p.price)}</b>${p.mrp ? ` <s>${inr(p.mrp)}</s>` : ''}</span><span class="pb">${t('buy')}</span></a>`).join('')}</div></div>`;
  }
  if (x.hard && x.src === 'offline' && O.age18()) h += `<div class="hint">${t(O.isOn() ? 'hardOfflineOn' : 'hardOfflineOff')}</div>`;
  return h;
}
interface Profile { name: string; study: string }
function getProfile(): Profile { try { return { name: '', study: '', ...JSON.parse(localStorage.getItem('elric.profile') || '{}') }; } catch { return { name: '', study: '' }; } }
const secs = (ms: number) => (ms / 1000).toFixed(1);
function stats(x: Turn, i = -1): string {
  if (x.role !== 'model') return '';
  const ra = x.src && !x.failed && x.text && i >= 0 && V.canSpeak() && !(busy && i === turns.length - 1)
    ? ` <button class="ra${reading === i ? ' on' : ''}" data-r="${i}" aria-label="${t('readAloud')}">🔊</button>` : '';
  const fb = x.text && !x.failed && i >= 0 && !(busy && i === turns.length - 1)
    ? ` <button class="fb${x.reported ? ' on' : ''}" data-fb="${i}" aria-label="${t(x.reported ? 'fbReported' : 'fbReport')}"${x.reported ? ' aria-disabled="true"' : ''}>👎</button>` : '';
  const cp = x.text && !x.failed && i >= 0 && !(busy && i === turns.length - 1)
    ? ` <button class="ra" data-cp="${i}" aria-label="${t('copy')}">⧉</button>` : '';
  const tag = ((x.src ? t(x.src === 'online' ? 'tagOnline' : 'tagOffline') : '') + (x.partial ? ` · ${t('partialAnswer')}` : '') + cp + ra + fb).trim();
  if (!x.ms) return tag ? `<div class="stat">${tag}</div>` : '';
  const words = x.text.trim().split(/\s+/).filter(Boolean).length;
  const gen = Math.max(1, x.ms - (x.firstMs || 0));
  const parts = [`⏱ ${t('statTime', { s: secs(x.ms) })}`];
  if (x.firstMs) parts.push(t('statFirst', { s: secs(x.firstMs) }));
  if (words > 3 && words / (gen / 1000) < 150) parts.push(t('statSpeed', { n: (words / (gen / 1000)).toFixed(1) }));
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
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
};
const svg = (p: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

function shell() {
  closeDrawer();
  // Sheets live on <body>, outside #app, so they always show above the drawer and profile
  // (in Home Screen mode #app is position:fixed, which would trap them underneath).
  let sh = document.getElementById('sheet');
  if (!sh) { sh = document.createElement('div'); sh.id = 'sheet'; document.body.appendChild(sh); }
  sh.innerHTML = '';
  $('#app').innerHTML = `
  <header class="top">
    <button class="icon" id="menu" aria-label="${t('cdMenu')}">${svg(ic.menu)}</button>
    <button class="modebtn" id="modebtn" aria-label="${t('cdMode')}">Elric AI · <b>${t(modeKey[mode])}</b>${svg(ic.down)}</button>
    <button class="lang" id="lang">${getLang() === 'en' ? 'हिं' : 'EN'}</button>
    <button class="icon" id="newc" aria-label="${t('cdNewChat')}">${svg(ic.newc)}</button>
  </header>
  <div class="pill ${O.isOn() ? 'online' : ''}"><i></i>${!O.isOn() ? t('privacyOnDevice') : mode === 'shopping' ? t('privacyOnline') : t('pillOnline')}</div>
  <main id="main"></main>
  <div class="att" id="att"></div>
  <form class="composer" id="form">
    <input type="file" id="file" accept="image/*" hidden>
    <button type="button" class="snap" id="snap" aria-label="${t('cdSnap')}">${svg(ic.cam)}</button>
    <textarea id="input" rows="1" placeholder="${t(pending ? 'photoHint' : pendingDoc ? 'docHint' : 'composerHint')}"></textarea>
    <button type="button" class="icon mic${dictation ? ' on' : ''}" id="mic" aria-label="${t(dictation ? 'cdMicStop' : 'cdMic')}">${svg(ic.mic)}</button>
    <button type="submit" class="send" id="send" aria-label="${busy ? t('cdStop') : t('cdSend')}">${svg(busy ? ic.stop : ic.send)}</button>
  </form>`;
  $('#menu').onclick = openDrawer;
  $('#modebtn').onclick = modeSheet;
  $('#lang').onclick = () => { setLang(getLang() === 'en' ? 'hi' : 'en'); shell(); };
  $('#newc').onclick = () => openChat(undefined);
  $('#snap').onclick = pickAttach;
  $<HTMLInputElement>('#file').onchange = onPhotoPicked;
  wireMic($('#mic'));
  renderAtt();
  const input = $<HTMLTextAreaElement>('#input');
  input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; };
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); submit(); } };
  $('#form').onsubmit = (e) => { e.preventDefault(); submit(); };
  renderMain();
  renderProfile();
}

// ---------------------------------------------------------------- Elric Agent in the chat
const AGENT_URL = O.SB_URL + '/functions/v1/ai-agent';
const AG_ICON: Record<string, string> = { electricity_bill: '💡', mobile_recharge: '📱', mandi_price: '🌾', bus_search: '🚌', pm_kisan_status: '🌾' };
const AG_PICKS: Record<string, string[]> = { biller: ['APCPDCL', 'APSPDCL', 'APEPDCL'], operator: ['Jio', 'Airtel', 'Vi', 'BSNL'] };
const PAY_URL: Record<string, string> = {
  APCPDCL: 'https://www.apcpdcl.in/ConsumerDashboard/KnownBillPay',
  APSPDCL: 'https://apspdcl.in/ConsumerDashboard/serviceDetails.jsp',
  APEPDCL: 'https://www.apeasternpower.com/payWithoutLogin',
};
/** Cheap on-phone check before asking the server: only messages that look like a task go to the agent. */
const AGENT_RE = /\b(bill|current bill|karent|bijli|electricity|power|apcpdcl|apspdcl|apepdcl|recharge|top ?up|mandi|market (price|rate|yard)|rate|dhara|bhav|bhaav|bus|kisan|mirchi|chilli|chillies|cotton|patti|paddy|vadlu|dhan|onion|tomato|groundnut|maize|vegetables?|fruits?|prices|sabzi|sabji|kooragay\w*|dharalu|carrot|potato|banana|mango|apple|papaya)\b|కూరగాయ|పండ్ల|सब्ज़ी|सब्जी|फल|బిల్లు|కరెంట్|రీఛార్జ్|ధర|రేటు|బస్|కిసాన్|మిర్చి|పత్తి|బిల|बिल|बिजली|रिचार्ज|भाव|मंडी|बस|किसान|मिर्च|कपास|धान/i;
let agentEdit: AgentRes | null = null;
const openAgentTurn = () => { const x = [...turns].reverse().find((y) => y.role === 'model' && y.agent); return x?.agent && !x.agent.closed && x.agent.missing.length ? x.agent : null; };

function agentCard(a: AgentRes, i: number): string {
  const lab = (k: string) => t(('ag_' + k) as keyof Strings) || k;
  const OPN: Record<string, string> = { JIO: 'Jio', AIRTEL: 'Airtel', VI: 'Vi', BSNL: 'BSNL' };
  const rows = Object.keys(a.fields || {}).map((k) => {
    const v = a.fields[k];
    const shown = v === 'ALL' ? t('agAllCrops') : v ? (k === 'operator' ? OPN[v] || v : k === 'amount' ? '₹' + v : v) : k === 'place' ? 'Andhra Pradesh' : '';
    return `<dt>${esc(lab(k))}</dt><dd class="${shown ? '' : 'miss'}">${shown ? esc(shown) : '—'}</dd>`;
  }).join('');
  let act = '';
  if (!a.closed && !busy) {
    const picks = a.missing.length ? AG_PICKS[a.missing[0]] : null;
    if (picks) act = `<div class="agpicks">${picks.map((p) => `<button class="agpick" data-ag="${i}" data-act="pick" data-v="${esc(p)}">${esc(p)}</button>`).join('')}</div>`;
    else if (!a.missing.length) act = `<div class="agacts"><button class="agyes" data-ag="${i}" data-act="yes">${t('agYes')}</button><button class="agedit" data-ag="${i}" data-act="edit">${t('agEdit')}</button></div>`;
  }
  return `<div class="agcard"><div class="agk">${AG_ICON[a.task] || '⚡'} ${esc(t(('agT_' + a.task) as keyof Strings) || a.task)}</div>${rows ? `<dl>${rows}</dl>` : ''}${act}</div>`;
}

/** Sends the message to the agent when it looks like a task (or answers an open card). false = let the normal chat answer. */
async function tryAgent(text: string, force = false): Promise<boolean> {
  const open = agentEdit || openAgentTurn();
  if (!force && !open && !AGENT_RE.test(text)) return false;
  if (!navigator.onLine) return false;
  busy = true;
  const user: Turn = { role: 'user', text };
  const reply: Turn = { role: 'model', text: '' };
  turns.push(user, reply);
  refreshChat();
  let ok = false;
  try {
    const body: Record<string, unknown> = { text: text.slice(0, 400), ui_lang: getLang() };
    if (open) body.prev = { task: open.task, fields: open.fields, lang: open.lang, script: open.script };
    const r = await fetch(AGENT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: O.CHAT_KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    if (r.ok) {
      const res = (await r.json()) as AgentRes;
      if (res && res.task && res.task !== 'unknown' && typeof res.confirm_text === 'string') {
        if (open) open.closed = true;
        agentEdit = null;
        reply.text = res.confirm_text;
        reply.agent = { task: res.task, lang: res.lang, script: res.script, fields: res.fields || {}, missing: res.missing || [], confirm_text: res.confirm_text };
        ok = true;
      }
    }
  } catch { /* fall back to the normal chat */ }
  if (!ok) turns.splice(turns.indexOf(user), 2);
  busy = false;
  if (ok) persist();
  refreshChat();
  return ok;
}

async function agentYes(a: AgentRes) {
  a.closed = true;
  const f = a.fields;
  if (a.task === 'electricity_bill') {
    const sn = f.service_number || '';
    try { await navigator.clipboard?.writeText(sn); } catch { /* not allowed */ }
    turns.push({ role: 'model', text: t('agPayText', { b: f.biller || '', sn }), payUrl: PAY_URL[f.biller || ''] || PAY_URL.APCPDCL });
  } else if (a.task === 'mandi_price') {
    const reply: Turn = { role: 'model', text: '' };
    turns.push(reply); busy = true; refreshChat();
    reply.text = await mandiText(f.commodity || '', f.place || '');
    if (reply.text === t('agPriceFail')) a.closed = false; // let them tap Yes again
    busy = false;
  } else {
    turns.push({ role: 'model', text: t('agSoon') });
  }
  persist();
  refreshChat();
}

/** Latest Agmarknet prices, written as chat text (so follow-up questions are answered by the normal chat). */
async function mandiText(crop: string, place: string): Promise<string> {
  const all = crop === 'ALL';
  const day = new Date().toISOString().slice(0, 10);
  const ck = `elric.mandi.${crop}.${place}.${day}`;
  try { const c = sessionStorage.getItem(ck) || localStorage.getItem(ck); if (c) return c; } catch { /* storage blocked */ }
  const base = `https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070?api-key=579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b&format=json&limit=10&filters%5Bstate.keyword%5D=Andhra%20Pradesh${all ? '' : `&filters%5Bcommodity%5D=${encodeURIComponent(crop)}`}`;
  type Row = { market: string; district: string; commodity: string; variety: string; modal_price: string; arrival_date: string };
  const once = async (x: string) => { const r = await fetch(base + x, { signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error(String(r.status)); return ((await r.json()).records || []) as Row[]; };
  // The free government key is shared and sometimes busy: try again twice before giving up.
  const get = async (x: string) => { for (let n = 0; ; n++) { try { return await once(x); } catch (e) { if (n >= 2) throw e; await new Promise((r) => setTimeout(r, 1200 * (n + 1))); } } };
  try {
    let rows: Row[] = [];
    if (place) { try { rows = await get(`&filters%5Bmarket%5D=${encodeURIComponent(place)}`); } catch { /* next */ } if (!rows.length) { try { rows = await get(`&filters%5Bdistrict%5D=${encodeURIComponent(place)}`); } catch { /* next */ } } }
    let other = false;
    if (!rows.length) { rows = await get(''); other = !!place; }
    rows = rows.filter((x) => Number(x.modal_price) > 0);
    if (!rows.length) return t('agNoPrice');
    const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const line = (x: Row) => { const q = Number(x.modal_price); return `- ${all ? `**${x.commodity}** · ` : ''}${x.market} (${x.district}): **${inr(q / 100)}/kg** · ${inr(q)}/${t('agQuintal')} · ${x.arrival_date}`; };
    const list = all ? rows.sort((a, b) => a.commodity.localeCompare(b.commodity)) : rows.sort((a, b) => Number(b.modal_price) - Number(a.modal_price)).slice(0, 3);
    const out = `**${all ? t('agAllHead') : t('agPriceHead', { c: crop })}**\n${other ? t('agOtherMarkets', { p: place }) + '\n' : ''}\n` + list.map(line).join('\n') + `\n\n${t('agSource')}`;
    try { sessionStorage.setItem(ck, out); } catch { /* storage full */ }
    return out;
  } catch { return t('agPriceFail'); }
}

/** General-mode Home: greeting, a live Today price card, big task tiles (open Elric Agent on that task),
 *  then the old suggestions as small chips. */
function homeGeneral(m: HTMLElement, cards: [keyof Strings, () => void][]) {
  const name = getProfile().name ? ', ' + esc(getProfile().name.split(' ')[0]) : '';
  const tiles: [string, keyof Strings, keyof Strings][] = [
    ['💡', 'tileBill', 'qBill'], ['📱', 'tileRecharge', 'qRecharge'], ['🌶️', 'tileCrop', 'qCrop'],
    ['🚌', 'tileBus', 'qBus'], ['🌾', 'tileKisan', 'qKisan'], ['💬', 'tileAsk', 'tileAsk'],
  ];
  m.innerHTML = `<section class="hero hero-general home2"><img src="icons/mark.png" alt="" class="mark"><h1>${t('greeting')}${name}</h1><p>${t('homeSub')}</p>
    <div id="today"></div>
    <h2 class="hh">${t('doWork')}</h2>
    <div class="tiles">${tiles.map(([e, k], i) => `<button class="tile" data-ti="${i}"><span class="te">${e}</span><span>${t(k)}</span></button>`).join('')}</div>
    <div class="hchips">${cards.map(([k], i) => `<button class="hchip" data-i="${i}">${t(k)}</button>`).join('')}</div>
    <div id="status"></div></section>`;
  m.querySelectorAll<HTMLButtonElement>('.tile').forEach((b) => (b.onclick = () => {
    const i = +b.dataset.ti!;
    if (i === 5) { const inp = $<HTMLTextAreaElement>('#input'); inp.focus(); return; }
    send(t(tiles[i][2]), null, null, true);
  }));
  m.querySelectorAll<HTMLButtonElement>('.hchip').forEach((b) => (b.onclick = cards[+b.dataset.i!][1]));
  renderStatus();
  todayCard();
}

/** Today card: Guntur dry chilli modal price from Agmarknet (data.gov.in). Hidden when offline or no data. */
async function todayCard() {
  const box = document.getElementById('today'); if (!box) return;
  const KEY = 'elric.today';
  type Row = { market: string; modal_price: string; arrival_date: string };
  let row: Row | null = null;
  try { const c = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (c && Date.now() - c.at < 3 * 3600e3) row = c.row; } catch { /* ignore */ }
  if (!row) {
    try {
      const base = 'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070?api-key=579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b&format=json&limit=10&filters%5Bstate.keyword%5D=Andhra%20Pradesh&filters%5Bcommodity%5D=Dry%20Chillies';
      const get = async (x: string) => { const r = await fetch(base + x, { signal: AbortSignal.timeout(6000) }); return r.ok ? ((await r.json()).records || []) as Row[] : []; };
      let rows = await get('&filters%5Bdistrict%5D=Guntur');
      if (!rows.length) rows = await get('');
      rows.sort((a, b) => Number(b.modal_price) - Number(a.modal_price));
      row = rows[0] || null;
      if (row) sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), row }));
    } catch { row = null; }
  }
  const el = document.getElementById('today'); if (!el || !row || !Number(row.modal_price)) return;
  el.innerHTML = `<button class="today"><span class="te">🌶️</span><span><small>${t('todayChilli')} · ${esc(row.market)}</small><b>₹${Number(row.modal_price).toLocaleString('en-IN')} <i>${t('perQuintal')}</i></b><small>${esc(row.arrival_date)} · Agmarknet</small></span></button>`;
  (el.querySelector('.today') as HTMLButtonElement).onclick = () => send(t('qCrop2'), null, null, true);
}

/** keepScroll: stay where the user is reading unless they were already at the bottom. */
function renderMain(keepScroll = false) {
  const m = $('#main');
  const prevTop = m.scrollTop;
  const atBottom = m.scrollHeight - m.scrollTop - m.clientHeight < 120;
  if (!turns.length) {
    const ask = (k: keyof Strings) => () => send(t(k));
    const fill = (k: keyof Strings) => () => { const i = $<HTMLTextAreaElement>('#input'); i.value = t(k); i.focus(); i.dispatchEvent(new Event('input')); };
    // Each mode has its own suggestions and line under the greeting.
    const byMode: Record<Mode, [keyof Strings, () => void][]> = {
      general: [['sugExplain', fill('promptExplain')], ['sugPhotoAny', () => $('#snap').click()], ['sugWrite', fill('promptWrite')], ['sugPlan', ask('promptPlan')]],
      study: [['sugQuiz', ask('promptQuiz')], ['sugPhoto', () => $('#snap').click()], ['sugLecture', fill('promptLecture')], ['sugChart', ask('promptChart')]],
      shopping: [['sugWatch', ask('promptWatch')], ['sugPhones', fill('promptPhones')], ['sugGift', ask('promptGift')], ['sugDeal', () => $('#snap').click()]],
    };
    const cards = byMode[mode] || byMode.general;
    const sub: Record<Mode, keyof Strings> = { general: 'subtitle', study: 'subStudy', shopping: 'subShop' };
    if (mode === 'general') { homeGeneral(m, cards); return; }
    m.innerHTML = `<section class="hero hero-${mode}"><img src="icons/mark.png" alt="" class="mark"><h1>${t('greeting')}${getProfile().name ? ', ' + esc(getProfile().name.split(' ')[0]) : ''}</h1><p>${t(sub[mode] || 'subtitle')}</p>
      <div class="cards">${cards.map(([k], i) => `<button class="card" data-i="${i}">${t(k)}</button>`).join('')}</div>
      <div id="status"></div></section>`;
    m.querySelectorAll<HTMLButtonElement>('.card').forEach((b) => (b.onclick = cards[+b.dataset.i!][1]));
    renderStatus();
    return;
  }
  m.innerHTML = `<div class="chat">${turns.map((x, i) => `<div class="msg ${x.role}"${i === turns.length - 1 ? ' id="last"' : ''}>${body(x) || waitDots()}</div>${stats(x, i)}${extras(x, i)}${x.role === 'user' && !busy ? `<div class="qact"><button class="edit" data-cp="${i}">⧉ ${t('copy')}</button><button class="edit" data-e="${i}">✎ ${t('editQ')}</button></div>` : ''}`).join('')}
    ${mode === 'shopping' ? `<div class="note">${t('shoppingNote')}</div>` : ''}${showStatusInChat() ? '<div id="status"></div>' : ''}</div>`;
  renderStatus();
  m.scrollTop = keepScroll && !atBottom ? prevTop : m.scrollHeight;
  if (!busy) drawDiagrams(m).then(() => { if ((!keepScroll || atBottom) && m.scrollHeight - m.scrollTop - m.clientHeight < 400) m.scrollTop = m.scrollHeight; });
  m.querySelectorAll<HTMLButtonElement>('[data-e]').forEach((b) => (b.onclick = () => {
    const i = +b.dataset.e!; const q = turns[i].text;
    if (turns[i].photo) { pending = turns[i].photo!; pendingDoc = null; }
    if (turns[i].doc) { pendingDoc = turns[i].doc!; pending = null; }
    turns = turns.slice(0, i); shell();
    const inp = $<HTMLTextAreaElement>('#input'); inp.value = (pending && q === t('photoAsk')) || (pendingDoc && q === t('docAsk')) ? '' : q; inp.focus(); inp.dispatchEvent(new Event('input'));
  }));
  m.querySelectorAll<HTMLButtonElement>('[data-ag]').forEach((b) => (b.onclick = () => {
    const a = turns[+b.dataset.ag!]?.agent; if (!a || a.closed || busy) return;
    const act = b.dataset.act;
    if (act === 'pick') send(b.dataset.v || '');
    else if (act === 'yes') agentYes(a);
    else if (act === 'edit') { a.closed = true; agentEdit = { ...a, missing: [] }; refreshChat(); const inp = $<HTMLTextAreaElement>('#input'); inp.placeholder = t('agEditHint'); inp.focus(); }
  }));
  m.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) => (b.onclick = () => readAloud(+b.dataset.r!)));
  m.querySelectorAll<HTMLButtonElement>('[data-fb]').forEach((b) => (b.onclick = () => reportSheet(+b.dataset.fb!)));
  m.querySelectorAll<HTMLButtonElement>('[data-cp]').forEach((b) => (b.onclick = () => copyText(turns[+b.dataset.cp!]?.text || '')));
  m.querySelectorAll<HTMLElement>('.mmd').forEach((d) => (d.onclick = () => { if (d.classList.contains('ok')) viewDiagram(d); }));
}

/** In a chat, the model card shows when offline answers are on, or when a question still needs the model. */
/** Redraws the chat and the send button only: the typed text, keyboard, open sheet and drawer stay as they are. */
function refreshChat(keepScroll = false) {
  if (!document.getElementById('main')) { shell(); return; }
  renderMain(keepScroll);
  const b = document.getElementById('send');
  if (b) { b.innerHTML = svg(busy ? ic.stop : ic.send); b.setAttribute('aria-label', busy ? t('cdStop') : t('cdSend')); }
  setMicUi();
  renderAtt();
}

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
    case 'iosTooBig': return t('reasonIosTooBig');
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
    if (on && wakeLock?.released) wakeLock = null; // the system lets go of it when the page is hidden
    if (on && !wakeLock && (navigator as any).wakeLock) {
      const l = await (navigator as any).wakeLock.request('screen');
      wakeLock = l;
      l.addEventListener?.('release', () => { if (wakeLock === l) wakeLock = null; });
    }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
/** Progress comes per downloaded/read piece (thousands for a big file): repaint at most ~5 times a second. */
let lastStatusPaint = 0;
function renderStatusSoon() {
  const now = performance.now();
  if (now - lastStatusPaint < 200) return;
  lastStatusPaint = now;
  renderStatus();
}
/** Engine errors are English; show them in the app language. */
function engineMsg(e: any): string {
  const m = String(e?.message || e);
  let x: RegExpMatchArray | null;
  if (/^Model file is damaged/.test(m)) return t('errDamaged');
  if (/^Not enough free space/.test(m)) return t('errNoSpace');
  if (/^Model file not found/.test(m)) return t('errNotFound');
  if ((x = m.match(/^Download paused at (\d+)% \(([\s\S]*)\)\. Tap Resume/))) return t('errPaused', { pct: x[1], err: x[2] });
  if ((x = m.match(/^Incomplete download \((\d+) of (\d+) bytes\)/))) return t('errIncomplete', { done: x[1], total: x[2] });
  if ((x = m.match(/^Download failed \(HTTP (\d+)\)/))) return t('errDownloadHttp', { code: x[1] });
  return m;
}
let resumeOnReturn = false;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (modelState === 'downloading') keepAwake(true); // wake lock drops when hidden
  else if (resumeOnReturn && !E.isStored()) startDownload();
});

async function startDownload() {
  if (modelState === 'downloading') return;
  // Set before the first await, so a double tap (or tap + return to the app) can't start two downloads.
  modelState = 'downloading'; abort = new AbortController(); progress = partial / E.LITE.sizeBytes;
  const signal = abort.signal;
  resumeOnReturn = false;
  renderStatus();
  partial = await E.partialBytes();
  progress = partial / E.LITE.sizeBytes; renderStatus();
  keepAwake(true);
  try {
    await E.downloadModel((p) => { progress = p.done / p.total; partial = p.done; renderStatusSoon(); }, signal);
    modelState = 'stored'; partial = 0;
  } catch (e: any) {
    partial = await E.partialBytes();
    modelState = 'idle';
    if (e?.name !== 'AbortError') {
      if (document.visibilityState !== 'visible') { resumeOnReturn = true; } // paused by iOS: carry on when user comes back
      else { modelState = 'failed'; failIsDownload = true; failMsg = engineMsg(e); }
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
    await E.loadModel((p) => { progress = p.done / p.total; renderStatusSoon(); });
    modelState = 'ready';
    const lastTurn = turns[turns.length - 1];
    if (lastTurn?.role === 'model' && lastTurn.failed && turns[turns.length - 2]?.role === 'user') turns.pop();
    // Ask the waiting question again, with its photo or file.
    if (turns[turns.length - 1]?.role === 'user') { const q = turns.pop()!; setTimeout(() => send(q.text, q.photo ?? null, q.doc ?? null)); }
  } catch (e: any) {
    modelState = 'failed';
    failIsDownload = false;
    failMsg = reasonText({ kind: 'loadFailed', err: engineMsg(e) });
  }
  renderMain();
}

function system(q = ''): string {
  let s = E.SYSTEM_PROMPT;
  if (E.CALC_TAGS && isMath(q)) s += E.CALC_PROMPT;
  if (mode === 'study') s += ' Mode: Study. Be a patient tutor for Indian students.';
  if (mode === 'shopping') s += ' Mode: Shopping. You have NO access to live prices, stock or offers. Never state or guess specific prices. Help compare features and explain what to look for, and say live prices are coming soon.';
  if (getLang() === 'hi') s += ' The user prefers Hindi.';
  if (talk) s += ' This is a spoken conversation: reply in plain spoken sentences, with no markdown, lists, tables, symbols or emojis, in the language the user spoke.';
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
  if (!text && !pending && !pendingDoc) return;
  const photo = pending;
  const doc = pendingDoc;
  if (photo && !photoOk()) return;
  // Abort (not stop): a stopped dictation would put the text it heard back into the cleared box.
  if (dictation) { dictation.abort(); dictation = null; setMicUi(); }
  i.value = ''; i.style.height = 'auto';
  pending = null; pendingDoc = null;
  send(text || t(doc ? 'docAsk' : 'photoAsk'), photo, doc);
}

/** Turns that can be sent to a model as history (no notices, no empty replies). */
function historyOf(list: Turn[]): E.Turn[] {
  return list.filter((x) => !x.failed && x.text.trim()).map(({ photo, doc, image, sources, hard, reported, agent, payUrl, ...x }) => (photo ? { ...x, text: `[${t('photoLabel')}] ${x.text}` } : doc ? { ...x, text: `[📄 ${doc.name}] ${x.text}` } : x));
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
let waitLabel: keyof Strings = 'gettingOnline';
function waitDots(): string {
  return onlineWaiting ? `<span class="dots">•••</span> <span class="wait">${t(waitLabel)}</span>` : '<span class="dots">•••</span>';
}

/** Online answer. Returns true when the reply is final (answered or stopped), false to answer on the device. */
async function answerOnline(reply: Turn, question: string, history: E.Turn[], photo: P.Photo | null = null, doc: D.Doc | null = null, hard = false): Promise<boolean> {
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
    talk: !!talk,
    ...(photo ? { image: { mime: photo.mime, data: photo.data } } : {}),
    ...(doc ? { doc: { name: doc.name, text: D.excerpt(doc, question, ONLINE_DOC_CHARS).text } } : {}),
    ...(hard ? { hard: true } : {}),
    ...(pr.name ? { name: pr.name.trim() } : {}),
    ...(pr.study ? { study: pr.study } : {}),
  }, (piece) => {
    raw += piece;
    onlineWaiting = false;
    if (!reply.firstMs && raw.trim()) reply.firstMs = Math.round(performance.now() - t0);
    reply.text = raw;
    paint(reply);
  }, { ...(hard && !photo ? { firstMs: O.HARD_FIRST_TOKEN_MS } : {}), onSources: (s) => { reply.sources = s; }, onProducts: (p) => { reply.products = p; } });
  onlineWaiting = false;
  flush();
  O.record(end);
  reply.text = raw.trim();
  // Refused by the server: say so. Never answer it on the device instead.
  if (end.kind === 'blocked') {
    reply.text = t('onlineBlocked'); reply.failed = true;
    reply.firstMs = undefined; reply.sources = undefined; reply.products = undefined;
    return true;
  }
  if (end.kind === 'done' && reply.text) { reply.ms = Math.round(performance.now() - t0); reply.src = 'online'; return true; }
  if (end.kind === 'stopped' || stopRequested) {
    if (reply.text) reply.src = 'online'; else { reply.text = t('stopped'); reply.failed = true; }
    reply.firstMs = undefined;
    return true;
  }
  // The connection dropped (or stalled) after part of the answer arrived: keep that part, marked as cut off.
  if (reply.text) { reply.src = 'online'; reply.partial = true; reply.ms = Math.round(performance.now() - t0); return true; }
  // Limit, error or no first word in time: answer on the device, from the start.
  reply.text = ''; reply.firstMs = undefined; reply.sources = undefined; reply.products = undefined;
  return false;
}

const IMAGE_PROMISE = /^\s*(I['’]ll make (that|an|the|this) (image|picture)|मैं (वह|यह) तस्वीर बना|Main (wo|woh|ye|yeh) (image|photo|tasveer) bana|ఆ చిత్రాన్ని తయారు చేస్తాను)/i;

async function answerOffline(reply: E.Turn, history: E.Turn[]) {
  const t0 = performance.now();
  const lastQ = [...history].reverse().find((x) => x.role === 'user')?.text ?? '';
  try {
    // Calculator steps: <calc>…</calc> is worked out by the app (see calcloop.ts); shown as "a = b".
    const raw = await generateWithCalc(
      (prefix, on) => E.generate(system(lastQ), history, on, prefix),
      () => E.stop(),
      (txt) => {
        if (!reply.firstMs && txt.trim()) reply.firstMs = Math.round(performance.now() - t0);
        reply.text = showCalc(txt);
        paint(reply);
      },
      () => stopRequested,
    );
    reply.text = showCalc(raw).trim();
    // Image making is off: never let an offline answer promise a picture.
    if (!O.IMAGES_ON && IMAGE_PROMISE.test(reply.text)) reply.text = t('imageSoon');
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

/** "Make an image of …": one picture from the server (Online answers only). */
async function answerImage(reply: Turn, text: string, ref?: { mime: string; data: string }) {
  if (!O.IMAGES_ON) { reply.text = t('imageSoon'); reply.failed = true; return; }
  if (!O.isOn() || !O.ready()) { reply.text = t(O.isOn() ? 'imageUnavailable' : 'imageNeedsOnline'); reply.failed = true; return; }
  const t0 = performance.now();
  waitLabel = 'makingImage'; onlineWaiting = true; paint(reply);
  const end = await O.makeImage(text, getLang(), ref);
  onlineWaiting = false; waitLabel = 'gettingOnline';
  flush();
  if (end.kind === 'ok') { reply.image = end.url; reply.imgPrompt = text.slice(0, 450); reply.text = t('imageDone'); reply.src = 'online'; reply.ms = Math.round(performance.now() - t0); return; }
  reply.failed = true;
  reply.text = t(end.kind === 'blocked' ? 'imageBlocked' : end.kind === 'limit' ? 'imageLimit' : end.kind === 'stopped' ? 'stopped' : 'imageFailed');
}

let stopRequested = false;
/** Asks a question (optionally with a photo). Resolves with the answer turn, or null if none was started. */
async function send(text: string, photo: P.Photo | null = null, newDoc: D.Doc | null = null, forceAgent = false): Promise<Turn | null> {
  if (busy) return null;
  stopReading();
  if (!photo && !newDoc && !talk && (await tryAgent(text, forceAgent))) return turns[turns.length - 1];
  const history = historyOf(turns);
  // A file attached earlier in this chat stays in use for follow-up questions (in memory only).
  const doc = newDoc || (photo ? null : [...turns].reverse().find((x) => x.doc)?.doc || null);
  const hard = !photo && isHard(text);
  turns.push(photo ? { role: 'user', text, photo } : newDoc ? { role: 'user', text, doc: newDoc } : { role: 'user', text });
  const online = O.ready();
  // Right after a picture, a short change ("in village style", "make it night") makes a new picture with that change.
  const lastModel = [...turns].reverse().find((x) => x.role === 'model');
  const ASK_ABOUT = /^\s*(what|why|who|how|explain|describe|tell me|is |are |does |do |which|kya|kaun|kyun|क्या|कौन|क्यों)/i;
  const imgEdit = !photo && !newDoc && !talk && !!lastModel?.image && !!lastModel.imgPrompt && text.length < 220 && !ASK_ABOUT.test(text)
    && !isImageRequest(text) ? `${lastModel.imgPrompt}. Change: ${text}` : '';
  // A photo plus "edit / change / make it …" edits that photo (Online only).
  const PHOTO_EDIT = /\b(edit|change|turn|convert|transform|add|remove|replace|background|cartoon|anime|sketch|painting|style|make (this|it|him|her|me|us|them))\b|बदलो|बदल दो|हटाओ|जोड़ो/i;
  const photoEdit = !!photo && !talk && (isImageRequest(text) || PHOTO_EDIT.test(text)) && !ASK_ABOUT.test(text);
  const prevRef = imgEdit && lastModel?.image ? (() => { const mm = lastModel.image!.match(/^data:(image\/\w+);base64,(.+)$/); return mm ? { mime: mm[1], data: mm[2] } : undefined; })() : undefined;
  const wantsImage = (!photo && !newDoc && !talk && (isImageRequest(text) || !!imgEdit)) || photoEdit;
  if (!E.isLoaded() && !online && !wantsImage) { renderMain(); return null; } // status card explains what's needed; never fake an answer
  busy = true;
  stopRequested = false;
  const reply: Turn = { role: 'model', text: '', ...(hard ? { hard: true } : {}) };
  turns.push(reply);
  refreshChat();
  try {
    let final = false;
    if (photoEdit && photo) { await answerImage(reply, text, { mime: photo.mime, data: photo.data }); final = true; }
    else if (!photo && !talk && imgEdit) { await answerImage(reply, imgEdit.slice(0, 480), prevRef); final = true; }
    else if (!photo && !doc && !talk && isImageRequest(text)) { await answerImage(reply, text); final = true; }
    if (!final && online) final = await answerOnline(reply, text, history, photo, doc, hard);
    // Photos can't fall back to the device, and hard questions are much better online: try online once more first.
    if (!final && (photo || hard) && online && !stopRequested && O.ready()) final = await answerOnline(reply, text, history, photo, doc, hard);
    if (!final) {
      if (photo) { reply.text = t('photoFailed'); reply.failed = true; } // the device model can't see photos
      else if (E.isLoaded()) {
        paint(reply);
        const q = doc ? `${t('docForModel', { name: doc.name })}\n<<<\n${D.excerpt(doc, text, E.isIOS ? 700 : 1800).text}\n>>>\n\n${text}` : text;
        await answerOffline(reply, [...history, { role: 'user', text: q }]);
      }
      else { reply.text = t('onlineBusy'); reply.failed = true; }
    }
  } catch (e: any) {
    flush(); onlineWaiting = false; waitLabel = 'gettingOnline';
    if (!reply.text.trim()) { reply.text = t('errorAnswer', { err: String(e?.message || e) }); reply.failed = true; }
  } finally {
    busy = false;
    persist();
    const next = pendingOpen;
    pendingOpen = null;
    if (next) openChat(next.id ? loadChats().find((c) => c.id === next.id) : undefined);
    else refreshChat(true);
  }
  return reply;
}

// ---------------------------------------------------------------- photo

let pending: P.Photo | null = null;
let pendingDoc: D.Doc | null = null;
let readingDoc = '';
/** Most file text sent online with one question (the server allows 10,000). */
const ONLINE_DOC_CHARS = 9000;

function renderAtt() {
  const a = $('#att');
  if (!a) return;
  const x = `<button type="button" id="attx" aria-label="${t('removeFile')}">${svg(ic.x)}</button>`;
  a.innerHTML = pending ? `<div class="chip"><img src="${pending.thumb}" alt=""><span>${t('photoLabel')}</span>${x}</div>`
    : pendingDoc ? `<div class="chip doc"><span class="di">📄</span><span class="dn">${esc(pendingDoc.name)}</span><span>${pendingDoc.pages > 1 ? t('docPages', { n: String(pendingDoc.pages) }) : ''}</span>${x}</div>`
    : readingDoc ? `<div class="chip doc"><span class="di">📄</span><span class="dn">${esc(readingDoc)}</span><span>${t('docReading')}</span></div>` : '';
  const input = $<HTMLTextAreaElement>('#input');
  if (input) input.placeholder = t(pending ? 'photoHint' : pendingDoc ? 'docHint' : 'composerHint');
  if (pending || pendingDoc) $('#attx').onclick = () => { pending = null; pendingDoc = null; renderAtt(); };
}

/** Photos are read online; explains (with a way to turn it on) when Online answers can't be used. */
function photoOk(): boolean {
  if (!O.isOn()) {
    sheet(`<h3>${t('photoNeedsOnlineTitle')}</h3><p>${t('photoNeedsOnlineBody')}</p><button class="primary" id="pon">${t('turnOnOnline')}</button>`);
    $('#pon').onclick = () => { $('#sheet').innerHTML = ''; toggleOnline(); };
    return false;
  }
  if (!O.ready()) { sheet(`<h3>${t('photoNeedsOnlineTitle')}</h3><p>${t('photoUnavailable')}</p>`); return false; }
  return true;
}

function openPicker(accept: string) {
  const f = $<HTMLInputElement>('#file');
  f.accept = accept;
  f.value = '';
  f.click();
}

function pickPhoto() {
  if (talk || !photoOk()) return;
  openPicker('image/*');
}

/** Attach (camera button): photo or PDF/text file. Files work offline too; photos need Online answers. */
function pickAttach() {
  if (talk) return;
  if (O.isOn() && O.ready()) { openPicker(`image/*,${D.DOC_ACCEPT}`); return; }
  sheet(`<h3>${t('attachTitle')}</h3><p>${t(O.isOn() ? 'photoUnavailable' : 'attachOfflineBody')}</p>`
    + `<button class="primary" id="pfile">📄 ${t('attachFile')}</button>`
    + (O.isOn() ? '' : `<button class="ghost" id="pon">${t('turnOnOnline')}</button>`));
  $('#pfile').onclick = () => { $('#sheet').innerHTML = ''; openPicker(D.DOC_ACCEPT); };
  const on = document.getElementById('pon');
  if (on) on.onclick = () => { $('#sheet').innerHTML = ''; toggleOnline(); };
}

async function onPhotoPicked() {
  const f = $<HTMLInputElement>('#file');
  const file = f.files?.[0];
  if (!file) return;
  if (D.isDocFile(file)) {
    pending = null; pendingDoc = null; readingDoc = file.name; renderAtt();
    try { pendingDoc = await D.readDoc(file); }
    catch (e: any) {
      const k = e?.message === 'too_large' ? 'docTooLarge' : e?.message === 'no_text' ? 'docNoText' : 'docError';
      sheet(`<h3>${t('attachFile')}</h3><p>${t(k)}</p>`);
    }
    readingDoc = ''; renderAtt();
    return;
  }
  if (!photoOk()) return;
  try { pending = await P.prepare(file); pendingDoc = null; renderAtt(); }
  catch { sheet(`<h3>${t('photoLabel')}</h3><p>${t('photoError')}</p>`); }
}

// ---------------------------------------------------------------- voice input

let dictation: V.Listener | null = null;

function micMessage(err?: string): boolean {
  const k = err === 'not-allowed' || err === 'service-not-allowed' ? 'micDenied' : err === 'network' ? 'micNetwork' : '';
  if (k) sheet(`<h3>${t('cdMic')}</h3><p>${t(k)}</p>`);
  return !!k;
}

function setMicUi() {
  const b = document.getElementById('mic');
  if (!b) return;
  b.classList.toggle('on', !!dictation);
  b.setAttribute('aria-label', t(dictation ? 'cdMicStop' : 'cdMic'));
}

function toggleDictation() {
  if (talk) return;
  if (dictation) { dictation.stop(); return; }
  if (!V.canListen()) { sheet(`<h3>${t('cdMic')}</h3><p>${t('micUnsupported')}</p>`); return; }
  const cur = $<HTMLTextAreaElement>('#input').value.trim();
  const base = cur ? cur + ' ' : '';
  const put = (txt: string) => { const i = $<HTMLTextAreaElement>('#input'); if (!i) return; i.value = base + txt; i.dispatchEvent(new Event('input')); };
  const me = V.listen(V.speechLang(getLang()), {
    interim: (txt) => { if (dictation === me) put(txt); },
    end: (txt, err) => {
      if (dictation !== me) return;
      dictation = null; setMicUi();
      if (txt) put(txt);
      micMessage(err);
    },
  });
  dictation = me;
  setMicUi();
}

/** Mic: tap for voice input; hold for Talk (hands-free). Talk starts on release, inside the tap, so iPhone allows speech. */
function wireMic(b: HTMLElement) {
  let downAt = 0; let longFired = false;
  b.onpointerdown = () => { downAt = Date.now(); longFired = false; };
  b.onpointerup = () => { if (downAt && Date.now() - downAt >= 550 && !dictation && !talk) { longFired = true; startTalk(); } downAt = 0; };
  b.onpointerleave = () => { downAt = 0; };
  b.oncontextmenu = (e) => e.preventDefault();
  b.onclick = () => { if (longFired) { longFired = false; return; } toggleDictation(); };
}

// ---------------------------------------------------------------- read aloud

let reading = -1;
let cancelReading: (() => void) | null = null;
function stopReading() {
  if (cancelReading) { cancelReading(); cancelReading = null; }
  if (reading >= 0) { reading = -1; document.querySelectorAll('.ra.on').forEach((e) => e.classList.remove('on')); }
}
function readAloud(i: number) {
  const was = reading;
  stopReading();
  if (was === i || !turns[i]) return;
  V.unlockSpeech(); // inside the tap, for iPhone
  reading = i;
  document.querySelector(`[data-r="${i}"]`)?.classList.add('on');
  cancelReading = V.speak(V.plain(turns[i].text), () => { if (reading === i) { cancelReading = null; stopReading(); } });
}

// ---------------------------------------------------------------- report a wrong answer

async function copyText(s: string) {
  const text = s.replace(/```mermaid[\s\S]*?```/g, '').trim() || s;
  try { await navigator.clipboard.writeText(text); toast(t('copied')); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove();
    toast(t(ok ? 'copied' : 'copyFailed'), ok ? 'ok' : 'err');
  }
}

/** Full-screen diagram: pinch to zoom, Save as a picture (share sheet on phones, download on PC). */
function viewDiagram(d: HTMLElement) {
  const svg = d.querySelector('svg'); if (!svg) return;
  const ov = document.createElement('div'); ov.className = 'dview';
  ov.innerHTML = `<div class="dbar"><button class="dsave">⤓ ${t('saveImage')}</button><button class="dclose" aria-label="${t('close')}">✕</button></div><div class="dbody">${svg.outerHTML}</div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', key); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  ov.querySelector<HTMLButtonElement>('.dclose')!.onclick = close;
  ov.querySelector<HTMLButtonElement>('.dsave')!.onclick = () => saveDiagram(svg as SVGSVGElement);
}
async function saveDiagram(svg: SVGSVGElement) {
  try {
    const w = +(svg.getAttribute('width') || 600), h = +(svg.getAttribute('height') || 400);
    const clone = svg.cloneNode(true) as SVGSVGElement; clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    const img = new Image(); img.decoding = 'sync';
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('img')); img.src = url; });
    const k = Math.min(3, 4000 / Math.max(w, h)), pad = 24;
    const c = document.createElement('canvas'); c.width = Math.round((w + pad * 2) * k); c.height = Math.round((h + pad * 2) * k);
    const g = c.getContext('2d')!; g.fillStyle = getComputedStyle(document.body).backgroundColor || '#111'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, pad * k, pad * k, w * k, h * k);
    const blob: Blob = await new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('blob'))), 'image/png'));
    const file = new File([blob], 'elric-diagram.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; }
      catch (e: any) { if (e?.name === 'AbortError') return; } // user closed the sheet; anything else (e.g. iPhone lost the tap): download instead
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'elric-diagram.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch { toast(t('saveFailed'), 'err'); }
}

let toastTimer = 0;
/** Stays up until tapped: "New version — tap to refresh". */
function updateBanner() {
  let el = document.getElementById('upd');
  if (!el) {
    el = document.createElement('button'); el.id = 'upd'; el.setAttribute('type', 'button'); el.className = 'toast show upd';
    el.onclick = () => location.reload();
    document.body.appendChild(el);
  }
  el.textContent = t('newVersion');
}
function toast(msg: string, kind: 'ok' | 'err' = 'ok') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.className = `toast ${kind} show`; el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 3200);
}

/** Bottom sheet to report the answer at [i]. Sends only that question and answer (plus the optional note). */
function reportSheet(i: number) {
  const ans = turns[i];
  if (!ans || ans.role !== 'model' || ans.reported) { if (ans?.reported) toast(t('fbAlready')); return; }
  sheet(`<h3>${t('fbTitle')}</h3>
    <textarea id="fbnote" class="fbnote" rows="3" maxlength="4000" placeholder="${t('fbPlaceholder')}" aria-label="${t('fbPlaceholder')}"></textarea>
    <p class="fbinfo">${t('fbInfo')}</p>
    <div class="fbbtns"><button class="ghost" id="fbcancel">${t('cancel')}</button><button class="primary" id="fbsend">${t('fbSend')}</button></div>`, false);
  $('#fbcancel').onclick = closeSheet;
  const sendBtn = $<HTMLButtonElement>('#fbsend');
  sendBtn.onclick = async () => {
    if (sendBtn.disabled) return;
    sendBtn.disabled = true; sendBtn.textContent = t('fbSending');
    const q = turns.slice(0, i).reverse().find((x) => x.role === 'user');
    const backend = ans.src || null;
    const ok = await F.send({
      kind: 'wrong_answer',
      app_version: APP_VERSION,
      platform: `web ${F.shortUA()}`,
      device: F.device(),
      backend,
      model: backend === 'online' ? 'Elric Online' : backend === 'offline' ? t(E.MODEL_NAME_KEY) : null,
      mode,
      question: q?.text || null,
      answer: ans.text,
      note: $<HTMLTextAreaElement>('#fbnote')?.value.trim() || null,
    });
    if (ok) {
      ans.reported = true; persist();
      $('#sheet').innerHTML = '';
      const b = document.querySelector<HTMLButtonElement>(`[data-fb="${i}"]`);
      if (b) { b.classList.add('on'); b.setAttribute('aria-disabled', 'true'); b.setAttribute('aria-label', t('fbReported')); }
      toast(t('fbThanks'));
    } else {
      sendBtn.disabled = false; sendBtn.textContent = t('fbSend');
      toast(t('fbFailed'), 'err');
    }
  };
}

// ---------------------------------------------------------------- talk (hands-free)

type TalkState = 'listening' | 'thinking' | 'speaking' | 'paused';
let talk: { state: TalkState; caption: string; session: number; misses: number; rec: V.Listener | null; hush: (() => void) | null } | null = null;

function startTalk() {
  if (talk) return;
  if (busy) { sheet(`<h3>${t('talk')}</h3><p>${t('talkWait')}</p>`); return; }
  if (!V.canListen()) { sheet(`<h3>${t('talk')}</h3><p>${t('talkNoMic')}</p>`); return; }
  if (!O.ready() && !E.isLoaded()) { sheet(`<h3>${t('talk')}</h3><p>${t('talkNeedsAnswer')}</p>`); return; }
  V.unlockSpeech(); // inside the tap: lets iPhone read answers aloud later
  stopReading();
  if (dictation) { dictation.abort(); dictation = null; setMicUi(); }
  $('#sheet').innerHTML = '';
  talk = { state: 'paused', caption: '', session: 0, misses: 0, rec: null, hush: null };
  talkListen();
}

function renderTalk() {
  let el = document.getElementById('talk');
  if (!talk) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'talk'; el.className = 'talk'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', t('talk'));
    el.innerHTML = `<div class="tk-h">${t('talk')}</div><button class="orb" id="tk-orb">${svg(ic.mic)}</button><p class="tk-s" aria-live="polite"></p><p class="tk-c"></p><p class="tk-hint">${t('talkHint')}</p><button class="tk-end" id="tk-end">${t('talkEnd')}</button>`;
    document.body.appendChild(el);
    el.querySelector<HTMLElement>('#tk-orb')!.onclick = tapTalk;
    el.querySelector<HTMLElement>('#tk-end')!.onclick = stopTalk;
  }
  const lab: Record<TalkState, keyof Strings> = { listening: 'talkListening', thinking: 'talkThinking', speaking: 'talkSpeaking', paused: 'talkPaused' };
  el.querySelector('.orb')!.className = `orb s-${talk.state}`;
  el.querySelector('.orb')!.setAttribute('aria-label', t(lab[talk.state]));
  el.querySelector('.tk-s')!.textContent = t(lab[talk.state]);
  el.querySelector('.tk-c')!.textContent = talk.caption;
}

function talkPause(caption: string) {
  if (!talk) return;
  talk.state = 'paused'; talk.caption = caption; talk.rec = null;
  renderTalk();
}

function talkListen() {
  if (!talk) return;
  const sess = ++talk.session;
  talk.state = 'listening'; talk.caption = ''; renderTalk();
  talk.rec = V.listen(V.speechLang(getLang()), {
    interim: (txt) => { if (talk && talk.session === sess) { talk.caption = txt; renderTalk(); } },
    end: (txt, err) => {
      if (!talk || talk.session !== sess) return;
      talk.rec = null;
      if (txt) { talkAsk(txt, sess); return; }
      if (err === 'not-allowed' || err === 'service-not-allowed') talkPause(t('micDenied'));
      else if (err === 'network') talkPause(t('micNetwork'));
      else if (err !== 'start' && ++talk.misses < 2) talkListen();
      else talkPause('');
    },
  });
}

async function talkAsk(text: string, sess: number) {
  if (!talk) return;
  talk.misses = 0; talk.state = 'thinking'; talk.caption = text; renderTalk();
  const reply = await send(text);
  if (!talk || talk.session !== sess) return;
  if (!reply || reply.failed || !reply.text.trim()) { talkPause(t('talkFailed')); return; }
  if (!V.canSpeak()) { talkPause(t('talkNoVoice')); return; }
  const said = V.plain(reply.text);
  talk.state = 'speaking'; talk.caption = said; renderTalk();
  talk.hush = V.speak(said, () => { if (talk && talk.session === sess) { talk.hush = null; talkListen(); } });
}

/** Tap on the circle: send now while listening, interrupt while speaking, listen again when paused. */
function tapTalk() {
  if (!talk) return;
  if (talk.state === 'listening') talk.rec?.stop();
  else if (talk.state === 'speaking') { talk.hush?.(); talk.hush = null; talkListen(); }
  else if (talk.state === 'paused') { V.unlockSpeech(); talk.misses = 0; talkListen(); }
}

function stopTalk() {
  if (!talk) return;
  talk.session++;
  talk.rec?.abort();
  talk.hush?.();
  if (V.canSpeak()) try { speechSynthesis.cancel(); } catch { /* ignore */ }
  if (busy) { stopRequested = true; E.stop(); O.stop(); }
  talk = null;
  renderTalk();
}

let sheetReturn: HTMLElement | null = null;
function closeSheet() {
  const s = document.getElementById('sheet');
  if (s) s.innerHTML = '';
  const back = sheetReturn; sheetReturn = null;
  if (back?.isConnected) try { back.focus({ preventScroll: true }); } catch { /* ignore */ }
}
function sheet(html: string, withClose = true) {
  const s = $('#sheet');
  if (!s.querySelector('.panel')) sheetReturn = document.activeElement as HTMLElement | null;
  s.innerHTML = `<div class="scrim"></div><div class="panel" role="dialog" aria-modal="true" tabindex="-1">${html}${withClose ? `<button class="ghost" id="close">${t('close')}</button>` : ''}</div>`;
  const panel = s.querySelector<HTMLElement>('.panel')!;
  const h = panel.querySelector('h3, .shd');
  if (h) { h.id = 'sheet-h'; panel.setAttribute('aria-labelledby', 'sheet-h'); }
  s.querySelector<HTMLElement>('.scrim')!.onclick = closeSheet;
  if (withClose) $('#close').onclick = closeSheet;
  // Move focus into the sheet (the panel itself, so a text box doesn't pop the phone keyboard).
  try { panel.focus({ preventScroll: true }); } catch { /* ignore */ }
}

/** Online answers on/off. Turning on asks once that the user is 18 or older. */
function toggleOnline() {
  const done = () => { shell(); if (document.querySelector('.pf.open')) renderProfile(); };
  if (O.isOn()) { O.setOn(false); done(); return; }
  if (O.age18()) { O.setOn(true); done(); return; }
  sheet(`<h3>${t('onlineAnswers')}</h3><p>${t('age18Text')}</p><button class="primary" id="a18">${t('age18Yes')}</button><button class="ghost" id="a18no">${t('notNow')}</button>`, false);
  $('#a18').onclick = () => { O.confirmAge18(); done(); };
  $('#a18no').onclick = closeSheet;
}

function modeSheet() {
  const ms: Mode[] = ['study', 'shopping', 'general'];
  const desc: Record<Mode, keyof Strings> = { study: 'modeStudyDesc', shopping: 'modeShoppingDesc', general: 'modeGeneralDesc' };
  const chk = '<i class="ck">✓</i>';
  sheet(`<div class="shd">${t('modeTitle')}</div><div class="grp">`
    + ms.map((m) => `<button class="it ${m === mode ? 'sel' : ''}" data-m="${m}"><span class="tl"><b>${t(modeKey[m])}</b><small>${t(desc[m])}</small></span>${m === mode ? chk : ''}</button>`).join('')
    + `</div><div class="shd">${t('lenTitle')}</div><div class="seg"><button class="${short ? 'on' : ''}" data-l="short">${t('lenShort')}</button><button class="${!short ? 'on' : ''}" data-l="long">${t('lenLong')}</button></div>`
    + `<p class="foot">${t(short ? 'lenShortDesc' : 'lenLongDesc')}</p>`);
  document.querySelectorAll<HTMLButtonElement>('[data-l]').forEach((b) => (b.onclick = () => { short = b.dataset.l === 'short'; localStorage.setItem('elric.length', short ? 'short' : 'long'); shell(); }));
  document.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => (b.onclick = () => { mode = b.dataset.m as Mode; shell(); }));
}

const APP_VERSION = '0.4.30';
diag.version = APP_VERSION;
const LEGAL_LINKS = () => `<p class="lic legal"><a href="privacy.html" target="_blank" rel="noopener">${t('linkPrivacy')}</a> · <a href="terms.html" target="_blank" rel="noopener">${t('linkTerms')}</a></p>`;
const LICENSES = [
  ['Elric Lite model weights (open model)', 'Apache License 2.0', 'https://www.apache.org/licenses/LICENSE-2.0'],
  ['Elric Basic model weights (Gemma 3 1B, iPhone)', 'Gemma Terms of Use', 'https://ai.google.dev/gemma/terms'],
  ['MediaPipe / LiteRT web runtime', 'Apache License 2.0', 'https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE'],
  ['Elric AI (this app)', 'Apache License 2.0', 'https://github.com/sbreddy-111/Elric-ai/blob/main/LICENSE'],
  ['Vite (build tool)', 'MIT License', 'https://github.com/vitejs/vite/blob/main/LICENSE'],
  ['Mermaid (diagrams)', 'MIT License', 'https://github.com/mermaid-js/mermaid/blob/develop/LICENSE'],
  ['PDF.js (reads PDF files)', 'Apache License 2.0', 'https://github.com/mozilla/pdf.js/blob/master/LICENSE'],
];

// ---------------------------------------------------------------- drawer + profile

/** Line icons for the drawer and profile (24px grid, stroke 1.75). */
const li = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  talk: '<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>',
  cam: '<path d="M4 8.5h3l1.8-2.5h6.4L17 8.5h3V19H4z"/><circle cx="12" cy="13.3" r="3.3"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/>',
  len: '<path d="M4 6h16M4 10h16M4 14h10M4 18h6"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.6 3.6 5.4 3.6 8.5s-1 5.9-3.6 8.5c-2.6-2.6-3.6-5.4-3.6-8.5s1-5.9 3.6-8.5z"/>',
  modes: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 18z"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2.5"/><path d="M9.5 9.5h5v5h-5zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  badge: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.3 4.6-4.8"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  shield: '<path d="M12 3.5l7 2.8v5.4c0 4.3-2.9 7.6-7 8.8-4.1-1.2-7-4.5-7-8.8V6.3z"/>',
  doc: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
  code: '<path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5l-3 14"/>',
  tag: '<path d="M4 4h7.5l8.5 8.5-7.5 7.5L4 11.5z"/><circle cx="8.5" cy="8.5" r="1.4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  more: '<path d="M6 12h.01M12 12h.01M18 12h.01"/>',
};
const lsvg = (p: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => Array.from(w)[0]).join('').toUpperCase();
const avatar = (cls: string) => { const n = initials(getProfile().name); return `<span class="${cls}">${n ? esc(n) : lsvg(li.user)}</span>`; };
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

let drawerQuery = '';
function closeDrawer() {
  const d = document.getElementById('drawer');
  document.body.classList.remove('dw-on');
  if (!d) return;
  d.id = ''; d.classList.remove('open');
  setTimeout(() => d.remove(), 260);
}
function openDrawer() {
  document.getElementById('drawer')?.remove();
  drawerQuery = '';
  const d = document.createElement('div');
  d.id = 'drawer'; d.className = 'dw';
  d.innerHTML = `<div class="dw-scrim"></div><aside class="dw-p" role="dialog" aria-modal="true" aria-label="Elric AI">
    <div class="dw-h"><img src="icons/mark.png" alt=""><b>Elric AI</b><button class="dw-ib" id="d-search" aria-label="${t('searchChats')}">${lsvg(li.search)}</button></div>
    <div class="dw-q" hidden><input id="d-q" type="search" placeholder="${t('searchChats')}" autocomplete="off"></div>
    <div class="dw-sc">
      <nav class="dw-nav">
        <button class="dw-it" id="m-talk">${lsvg(li.talk)}<span>${t('talk')}</span></button>
        <button class="dw-it" id="d-photo">${lsvg(li.cam)}<span>${t('photoQuestion')}</span></button>
      </nav>
      <div class="dw-seg" role="radiogroup" aria-label="${t('modeTitle')}">${(['study', 'shopping', 'general'] as Mode[]).map((m) => `<button role="radio" aria-checked="${m === mode}" class="${m === mode ? 'on' : ''}" data-dm="${m}">${t(modeKey[m])}</button>`).join('')}</div>
      <div class="dw-sh">${t('recents')}</div>
      <div class="dw-rc" id="d-rc"></div>
    </div>
    <div class="dw-f"><button class="dw-new" id="d-newpill">${lsvg(li.edit)}<span>${t('cdNewChat')}</span></button><button class="dw-me" id="d-me" aria-label="${t('profile')}">${avatar('av')}</button></div>
  </aside>`;
  document.body.appendChild(d);
  renderRecents();
  const q = d.querySelector<HTMLInputElement>('#d-q')!;
  d.querySelector<HTMLElement>('.dw-scrim')!.onclick = closeDrawer;
  d.querySelector<HTMLElement>('#d-search')!.onclick = () => {
    const box = d.querySelector<HTMLElement>('.dw-q')!;
    box.hidden = !box.hidden;
    if (box.hidden) { q.value = ''; drawerQuery = ''; renderRecents(); } else q.focus();
  };
  q.oninput = () => { drawerQuery = q.value.trim().toLowerCase(); renderRecents(); };
  const fresh = () => { closeDrawer(); openChat(undefined); };
  d.querySelector<HTMLElement>('#d-newpill')!.onclick = fresh;
  d.querySelector<HTMLElement>('#m-talk')!.onclick = () => { closeDrawer(); startTalk(); };
  d.querySelector<HTMLElement>('#d-photo')!.onclick = () => { closeDrawer(); pickPhoto(); };
  d.querySelector<HTMLElement>('#d-me')!.onclick = () => { closeDrawer(); openProfile(); };
  d.querySelectorAll<HTMLButtonElement>('[data-dm]').forEach((b) => (b.onclick = () => { mode = b.dataset.dm as Mode; closeDrawer(); shell(); }));
  // Swipe left to close.
  const p = d.querySelector<HTMLElement>('.dw-p')!;
  let x0 = 0, y0 = 0, dx = 0, drag = false;
  p.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; drag = false; }, { passive: true });
  p.addEventListener('touchmove', (e) => {
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (!drag && Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my)) drag = true;
    if (drag) { dx = Math.min(0, mx); p.style.transition = 'none'; p.style.transform = `translateX(${dx}px)`; }
  }, { passive: true });
  p.addEventListener('touchend', () => {
    if (!drag) return;
    p.style.transition = ''; p.style.transform = '';
    if (dx < -60) closeDrawer();
  });
  void d.offsetWidth;
  d.classList.add('open');
  document.body.classList.add('dw-on');
  p.setAttribute('tabindex', '-1');
  try { p.focus({ preventScroll: true }); } catch { /* ignore */ }
}
function renderRecents() {
  const box = document.getElementById('d-rc');
  if (!box) return;
  const all = loadChats();
  const cs = drawerQuery ? all.filter((c) => (c.title || '').toLowerCase().includes(drawerQuery)) : all;
  box.innerHTML = cs.length
    ? cs.map((c) => `<div class="rc ${c.id === chatId ? 'sel' : ''}"><button class="ct" data-c="${c.id}">${esc(c.title || '…')}</button><button class="cx" data-d="${c.id}" aria-label="${t('deleteChat')}">${lsvg(li.x)}</button></div>`).join('')
    : `<p class="dw-empty">${t(drawerQuery ? 'noMatches' : 'noChats')}</p>`;
  box.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => (b.onclick = () => { closeDrawer(); openChat(loadChats().find((c) => c.id === b.dataset.c)); }));
  box.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.d!; saveChats(loadChats().filter((c) => c.id !== id));
    if (id === chatId) { if (busy) dropCurrent = true; closeDrawer(); openChat(undefined); } else renderRecents();
  }));
}

/** Small picker sheet: one choice from a short list. */
function choose<T extends string>(title: string, opts: [T, string, string?][], cur: T, pick: (v: T) => void) {
  sheet(`<div class="shd">${title}</div><div class="grp">${opts.map(([v, l, d]) => `<button class="it ${v === cur ? 'sel' : ''}" data-ch="${v}"><span class="tl"><b>${l}</b>${d ? `<small>${d}</small>` : ''}</span>${v === cur ? '<i class="ck">✓</i>' : ''}</button>`).join('')}</div>`);
  document.querySelectorAll<HTMLButtonElement>('[data-ch]').forEach((b) => (b.onclick = () => { pick(b.dataset.ch as T); shell(); }));
}
function editName() {
  const pr = getProfile();
  sheet(`<h3>${t('menuMe')}</h3><p>${t('meIntro')}</p>
    <label class="fl">${t('meName')}<input id="pn" maxlength="40" value="${esc(pr.name)}"></label>
    <button class="primary" id="psave">${t('save')}</button>`);
  $('#psave').onclick = () => {
    localStorage.setItem('elric.profile', JSON.stringify({ ...getProfile(), name: $<HTMLInputElement>('#pn').value.trim() }));
    shell();
  };
}

function closeProfile() {
  const p = document.getElementById('prof');
  if (!p) return;
  p.id = ''; p.classList.remove('open');
  setTimeout(() => p.remove(), 260);
}
function openProfile() {
  document.getElementById('prof')?.remove();
  const p = document.createElement('div');
  p.id = 'prof'; p.className = 'pf'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'true'); p.setAttribute('aria-label', t('profile'));
  document.body.appendChild(p);
  renderProfile();
  void p.offsetWidth;
  p.classList.add('open');
  try { p.querySelector<HTMLElement>('#p-close')?.focus({ preventScroll: true }); } catch { /* ignore */ }
}
function renderProfile() {
  const p = document.getElementById('prof');
  if (!p) return;
  const scroll = p.querySelector('.pf-in')?.scrollTop || 0;
  const name = getProfile().name;
  const row = (id: string, icon: string, label: string, val = '', chev = true) =>
    `<button class="pr" id="${id}">${lsvg(icon)}<span class="pl">${label}</span>${val ? `<span class="pv">${val}</span>` : ''}${chev ? '<i class="chev">›</i>' : ''}</button>`;
  const link = (href: string, icon: string, label: string) => `<a class="pr" href="${href}" target="_blank" rel="noopener">${lsvg(icon)}<span class="pl">${label}</span><i class="chev">›</i></a>`;
  const grp = (title: string, rows: string) => `<div class="pf-sh">${title}</div><div class="pf-g">${rows}</div>`;
  p.innerHTML = `<div class="pf-in">
    <button class="pf-x" id="p-close" aria-label="${t('close')}">${lsvg(li.x)}</button>
    <div class="pf-top"><button class="pf-av" id="p-edit" aria-label="${t('editName')}">${avatar('av big')}<span class="pf-pen">${lsvg(li.edit)}</span></button>
      <div class="pf-name">${name ? esc(name) : `<span class="mu">${t('menuMeHint')}</span>`}</div></div>
    ${grp(t('secPersonalise'),
      row('m-me', li.user, t('menuMe'), esc(name) || t('menuMeHint'))
      + row('p-len', li.len, t('lenTitle'), t(short ? 'lenShort' : 'lenLong'))
      + row('m-lang', li.globe, t('menuLanguage'), getLang() === 'hi' ? 'हिन्दी' : 'English')
      + row('p-mode', li.modes, t('defaultMode'), t(modeKey[defaultMode()])))}
    ${grp(t('secAI'),
      `<button class="pr" id="m-online" role="switch" aria-checked="${O.isOn()}">${lsvg(li.cloud)}<span class="pl">${t('onlineAnswers')}<small>${t('onlineHow')}</small></span><i class="sw ${O.isOn() ? 'on' : ''}"></i></button>`
      + row('m-models', li.chip, t('menuModels'), t(E.MODEL_NAME_KEY as keyof Strings)))}
    ${grp(t('secPrivacy'),
      row('p-age', li.badge, t('age'), t(O.age18() ? 'ageYes' : 'ageNo'), false)
      + row('p-clear', li.trash, t('clearAll'), '', false)
      + row('m-priv', li.shield, t('menuPrivacy'))
      + link('terms.html', li.doc, t('linkTerms')))}
    ${grp(t('secAbout'),
      row('m-about', li.info, t('menuAbout'))
      + row('m-lic', li.code, t('menuLicenses'))
      + row('p-ver', li.tag, t('version'), APP_VERSION, false))}
    <p class="pf-foot">${t(isIOS() ? 'installTip' : 'installTipPc')}<br>${t('versionLine', { v: APP_VERSION })}</p>
  </div>`;
  p.querySelector('.pf-in')!.scrollTop = scroll;
  const on = (id: string, f: () => void) => { const b = p.querySelector<HTMLElement>('#' + id); if (b) b.onclick = f; };
  on('p-close', closeProfile);
  on('p-edit', editName);
  on('m-me', editName);
  on('p-len', () => choose(t('lenTitle'), [['short', t('lenShort'), t('lenShortDesc')], ['long', t('lenLong'), t('lenLongDesc')]], short ? 'short' : 'long', (v) => { short = v === 'short'; localStorage.setItem('elric.length', v); }));
  on('m-lang', () => choose(t('menuLanguage'), [['en', 'English'], ['hi', 'हिन्दी']], getLang(), (v) => setLang(v)));
  on('p-mode', () => {
    const desc: Record<Mode, keyof Strings> = { study: 'modeStudyDesc', shopping: 'modeShoppingDesc', general: 'modeGeneralDesc' };
    choose(t('defaultMode'), (['study', 'shopping', 'general'] as Mode[]).map((m) => [m, t(modeKey[m]), t(desc[m])] as [Mode, string, string]), defaultMode(), (v) => { localStorage.setItem('elric.mode', v); if (!turns.length) mode = v; });
  });
  on('m-online', toggleOnline);
  on('m-models', () => { sheet(`<h3>${t('menuModels')}</h3><div class="status-slot"></div><div class="box"><div class="mh"><b>${t('modelStandard')}</b><span>${t('comingSoon')}</span></div><p class="d">${t('modelStandardDesc')}</p></div>`); renderStatus(); });
  on('p-clear', () => {
    if (!loadChats().length || !confirm(t('clearAllConfirm'))) return;
    localStorage.removeItem(CHATS_KEY);
    if (busy) { dropCurrent = true; openChat(undefined); } // the answer being written is not saved either
    else if (chatId) openChat(undefined); else renderProfile();
  });
  on('m-priv', () => sheet(`<h3>${t('menuPrivacy')}</h3><p>${t('privacyBody')}</p>${LEGAL_LINKS()}`));
  on('m-about', () => sheet(`<h3>${t('menuAbout')}</h3><p>${t('aboutBody')}</p>${LEGAL_LINKS()}`));
  on('m-lic', () => sheet(`<h3>${t('menuLicenses')}</h3><p>${t('licensesIntro')}</p>${LICENSES.map(([n, l, u]) => `<p class="lic"><b>${n}</b><br><a href="${u}" target="_blank" rel="noopener">${l}</a></p>`).join('')}`));
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('.dview')) return; // the diagram viewer closes itself
  if (document.querySelector('#sheet .panel')) closeSheet(); // the top-most layer first
  else if (document.getElementById('drawer')) closeDrawer(); else closeProfile();
});

setLang(getLang());
shell();
E.checkDevice().then((r) => { device = r; renderStatus(); });
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then((r) => r.update()).catch(() => {});
  // A new version took over: offer a refresh, never reload on its own (a draft, photo or answer would be lost).
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) updateBanner(); });
}
