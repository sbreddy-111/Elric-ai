// Voice for the Elric AI web app: browser speech recognition (voice input, Talk) and
// speech synthesis (Talk, read aloud). Both are provided by the browser / operating system.

export const speechLang = (l: 'en' | 'hi') => (l === 'hi' ? 'hi-IN' : 'en-IN');

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
  let fin = ''; let inter = ''; let err = ''; let done = false;
  r.onresult = (e: any) => {
    fin = ''; inter = '';
    for (let i = 0; i < e.results.length; i++) { const x = e.results[i]; if (x.isFinal) fin += x[0].transcript; else inter += x[0].transcript; }
    on.interim((fin + inter).trim());
  };
  r.onerror = (e: any) => { err = e?.error || 'error'; };
  r.onend = () => { if (done) return; done = true; on.end((fin + inter).trim(), err || undefined); };
  try { r.start(); } catch { done = true; setTimeout(() => on.end('', 'start')); }
  return {
    stop: () => { try { r.stop(); } catch { /* ended */ } },
    abort: () => { done = true; try { r.abort(); } catch { /* ended */ } },
  };
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
