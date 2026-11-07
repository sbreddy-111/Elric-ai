// Voice for the Elric AI web app: browser speech recognition (voice input, Talk) and
// speech synthesis (Talk, read aloud). Both are provided by the browser / operating system.

export const speechLang = (l: 'en' | 'te' | 'hi') => (l === 'hi' ? 'hi-IN' : l === 'te' ? 'te-IN' : 'en-IN');

function recCtor(): any {
  const w: any = globalThis as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}
export const canListen = () => !!recCtor();
export const canSpeak = () => typeof (globalThis as any).speechSynthesis !== 'undefined' && typeof (globalThis as any).SpeechSynthesisUtterance !== 'undefined';

export interface Listener { stop(): void; abort(): void }
/**
 * Listens once (stops after a pause or on stop()). interim gets the text so far;
 * end gets the final text ('' if nothing heard) and the error code, if any.
 */
export function listen(lang: string, on: { interim(text: string): void; end(text: string, err?: string): void }): Listener | null {
  const C = recCtor();
  if (!C) return null;
  const r = new C();
  r.lang = lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  let text = ''; let err = ''; let done = false; let quiet: any = 0; let cap: any = 0; let dog: any = 0;
  const finish = () => {
    if (done) return; done = true;
    clearTimeout(quiet); clearTimeout(cap); clearTimeout(dog);
    on.end(text.trim(), err || undefined);
  };
  // iPhone Safari sometimes keeps listening after you stop talking, or never sends 'end':
  // stop after a short silence, cap the length, and finish ourselves if 'end' never comes.
  const stopSoon = () => { try { r.stop(); } catch { /* ended */ } clearTimeout(dog); dog = setTimeout(finish, 1500); };
  const arm = (ms: number) => { clearTimeout(quiet); quiet = setTimeout(stopSoon, ms); };
  r.onresult = (e: any) => {
    text = joinResults(e.results);
    on.interim(text);
    arm(2200);
  };
  r.onerror = (e: any) => { const c = e?.error || 'error'; if (c !== 'aborted' || !text) err = c; };
  r.onend = finish;
  try { r.start(); arm(8000); cap = setTimeout(stopSoon, 60000); } catch { done = true; setTimeout(() => on.end('', 'start')); }
  return {
    stop: stopSoon,
    abort: () => { done = true; clearTimeout(quiet); clearTimeout(cap); clearTimeout(dog); try { r.abort(); } catch { /* ended */ } },
  };
}

/** Joins recognition results. iPhone Safari repeats earlier words in later results ("hello", "hello how",
 *  "hello how are you"), which made the text come out doubled; keep only the newest version of each phrase. */
export function joinResults(results: ArrayLike<any>): string {
  const parts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const s = String(results[i]?.[0]?.transcript || '').trim();
    if (!s) continue;
    const last = parts[parts.length - 1];
    const a = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '');
    if (last !== undefined && a(s).startsWith(a(last))) parts[parts.length - 1] = s;
    else if (last !== undefined && a(last).startsWith(a(s))) continue;
    else parts.push(s);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** iOS Safari only plays speech started from a tap: call this inside the tap that opens Talk. */
export function unlockSpeech(): void {
  if (!canSpeak()) return;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch { /* ignore */ }
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  let vs: SpeechSynthesisVoice[] = [];
  try { vs = speechSynthesis.getVoices() || []; } catch { return null; }
  const n = (v: SpeechSynthesisVoice) => (v.lang || '').replace('_', '-').toLowerCase();
  const want = lang.toLowerCase();
  return vs.find((v) => n(v) === want && v.localService) || vs.find((v) => n(v) === want)
    || vs.find((v) => n(v).startsWith(want.slice(0, 2) + '-in')) || vs.find((v) => n(v).startsWith(want.slice(0, 2))) || null;
}

/** Markdown / math answer -> plain text that reads well aloud. */
export function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$?([^$]*)\$\$?/g, '$1')
    .replace(/\\(?:text|mathrm|mathbf)\{([^{}]*)\}/g, '$1').replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1 by $2')
    .replace(/\\times/g, ' × ').replace(/\\div/g, ' ÷ ').replace(/\\[a-z]+/gi, ' ').replace(/[{}\\]/g, '')
    .replace(/^\s*\|?\s*:?-{2,}.*$/gm, '')
    .replace(/\|/g, ', ')
    .replace(/^\s*#{1,6}\s+/gm, '').replace(/^\s*[*-]\s+/gm, '').replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')
    .replace(/\*\*|__|`|~~/g, '').replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|[.,!?]|$)/g, '$1$2')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, '')
    .replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

/** Splits text into pieces the speech engines read reliably (long utterances get cut on some browsers). */
function chunks(text: string): string[] {
  const out: string[] = [];
  for (const s of text.split(/(?<=[.!?।])\s+|\n+/)) {
    let x = s.trim();
    while (x.length > 220) {
      let cut = x.lastIndexOf(', ', 220); if (cut < 80) cut = x.lastIndexOf(' ', 220); if (cut < 40) cut = 220;
      out.push(x.slice(0, cut + 1).trim()); x = x.slice(cut + 1).trim();
    }
    if (x) out.push(x);
  }
  return out;
}

/** Reads text aloud (Hindi voice for Devanagari, Indian English otherwise). Returns a cancel function. */
export function speak(text: string, onEnd: () => void): () => void {
  if (!canSpeak()) { setTimeout(onEnd); return () => {}; }
  const lang = /[\u0900-\u097F]/.test(text) ? 'hi-IN' : 'en-IN';
  const voice = pickVoice(lang);
  const parts = chunks(text);
  let cancelled = false; let i = 0; let dog: any = 0;
  const next = () => {
    clearTimeout(dog);
    if (cancelled) return;
    if (i >= parts.length) { cancelled = true; onEnd(); return; }
    const p = parts[i++];
    const u = new SpeechSynthesisUtterance(p);
    u.lang = voice?.lang || lang; if (voice) u.voice = voice; u.rate = 1;
    let fired = false;
    const go = () => { if (fired) return; fired = true; next(); };
    u.onend = go; u.onerror = go;
    // Some browsers occasionally never fire onend: move on after a generous estimate.
    dog = setTimeout(go, 4000 + p.length * 140);
    try { speechSynthesis.speak(u); } catch { go(); }
  };
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
  setTimeout(next, 60);
  return () => { if (cancelled) return; cancelled = true; clearTimeout(dog); try { speechSynthesis.cancel(); } catch { /* ignore */ } };
}
