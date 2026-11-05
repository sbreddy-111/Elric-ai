// Online answers for Elric AI (web). Optional, off by default, 18+ only.
// Mirrors the Android app (ElricOnline.kt): POST JSON to the Elric server, streamed back as
// server-sent events: data: {"t":"..."} pieces, then {"done":true} or {"error":"failed|limit|blocked"}.
// No chat text is logged or stored here; the server stores none either (see privacy.html).

export const SB_URL = 'https://hqsqpiwmozgsxiizhaml.supabase.co';
const CHAT_URL = `${SB_URL}/functions/v1/ai-chat`;
const IMAGE_URL = `${SB_URL}/functions/v1/ai-image`;
/** Public by design (the same publishable key the Android app ships). */
export const CHAT_KEY = 'sb_publishable_Yv1D_ZUk38W3-ZvYdoAD8A_-fx5gPCT';

/** Time to the first word before answering on the device instead, and longest pause after it. */
export const FIRST_TOKEN_MS = 15000;
/** Photos take longer to read: wait longer for the first word. */
export const PHOTO_FIRST_TOKEN_MS = 30000;
const STALL_MS = 6000;
/** After this many failures in a row, online is skipped for BACKOFF_MS. */
const MAX_FAILS = 2;
const BACKOFF_MS = 3 * 60 * 1000;
export const HISTORY_TURNS = 12;

const ON_KEY = 'elric.online';
const AGE_KEY = 'elric.age18';
const DEVICE_KEY = 'elric.deviceId';

export type End =
  | { kind: 'done' }
  | { kind: 'stopped' }
  | { kind: 'limit'; retryAfter: number; scope: string }
  | { kind: 'failed'; reason: string };

export interface Body {
  question: string;
  history: { role: 'user' | 'model'; text: string }[];
  mode: string;
  short: boolean;
  lang: 'en' | 'hi';
  name?: string;
  study?: string;
  /** Spoken conversation (Talk): plain, short sentences. */
  talk?: boolean;
  /** A photo with the question (JPEG, base64). */
  image?: { mime: string; data: string };
  /** Text taken from a PDF/TXT file on the device (trimmed); the server does not keep it. */
  doc?: { name: string; text: string };
  /** Multi-step maths/science or recent facts: the server thinks longer and uses its tools. */
  hard?: boolean;
}

/** A web page the online answer used. */
export interface Src { t: string; u: string }

// ---------- settings

export function age18(): boolean {
  return localStorage.getItem(AGE_KEY) === '1';
}

/** Online answers are on only when the user turned them on and confirmed they are 18 or older. */
export function isOn(): boolean {
  return age18() && localStorage.getItem(ON_KEY) === '1';
}

export function setOn(on: boolean): void {
  if (on && !age18()) return;
  localStorage.setItem(ON_KEY, on ? '1' : '0');
  fails = 0;
  blockedUntil = 0;
  if (!on) stop();
}

export function confirmAge18(): void {
  localStorage.setItem(AGE_KEY, '1');
  setOn(true);
}

/** A random id for this browser, used only for the server's rate limit (stored there hashed). */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (id && id.length >= 16) return id;
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) id = c.randomUUID();
  else {
    const b = new Uint8Array(16);
    if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    id = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  localStorage.setItem(DEVICE_KEY, id!);
  return id!;
}

// ---------- availability (failures, limits)

let fails = 0;
let blockedUntil = 0;

/** True when an online answer can be tried now. */
export function ready(): boolean {
  return isOn() && navigator.onLine !== false && Date.now() >= blockedUntil;
}

/** Records how an answer ended, so repeated failures or a limit pause online for a while. */
export function record(end: End): void {
  if (end.kind === 'done') { fails = 0; return; }
  if (end.kind === 'limit') { blockedUntil = Date.now() + Math.min(3600, Math.max(60, end.retryAfter)) * 1000; return; }
  if (end.kind === 'failed') {
    if (++fails >= MAX_FAILS) { blockedUntil = Date.now() + BACKOFF_MS; fails = 0; }
  }
}

// ---------- one streamed answer

let current: { ctrl: AbortController; cancelled: boolean } | null = null;

/** Stops the online answer being streamed, if any. */
export function stop(): void {
  if (!current) return;
  current.cancelled = true;
  current.ctrl.abort();
}

export function busy(): boolean {
  return !!current;
}

/** Sends the question and streams the answer to onText (called with each new piece). */
/** Hard questions (tools, web search) can take longer to start. */
export const HARD_FIRST_TOKEN_MS = 25000;

export async function ask(body: Body, onText: (piece: string) => void, opts: { firstMs?: number; onSources?: (s: Src[]) => void } = {}): Promise<End> {
  const firstMs = opts.firstMs ?? (body.image ? PHOTO_FIRST_TOKEN_MS : FIRST_TOKEN_MS);
  const me = { ctrl: new AbortController(), cancelled: false };
  current = me;
  const start = Date.now();
  let lastData = start;
  let gotFirst = false;
  let why = '';
  const dog = setInterval(() => {
    const now = Date.now();
    if (!gotFirst && now - start > firstMs) { why = `no first word in ${firstMs} ms`; me.ctrl.abort(); }
    else if (gotFirst && now - lastData > STALL_MS) { why = 'stalled'; me.ctrl.abort(); }
  }, 200);
  try {
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { apikey: CHAT_KEY, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ device: deviceId(), talk: false, ...body }),
      signal: me.ctrl.signal,
      cache: 'no-store',
    });
    if (res.status === 429) {
      let retry = 600; let scope = 'provider';
      try { const o = await res.json(); if (typeof o.retry_after === 'number') retry = o.retry_after; if (o.scope) scope = String(o.scope); } catch { /* defaults */ }
      return { kind: 'limit', retryAfter: retry, scope };
    }
    if (!res.ok || !res.body) return { kind: 'failed', reason: `http ${res.status}` };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      lastData = Date.now();
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        let o: any;
        try { o = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (typeof o.t === 'string') {
          if (o.t) { if (o.t.trim()) gotFirst = true; onText(o.t); }
        } else if (Array.isArray(o.src)) {
          const list = (o.src as any[]).filter((x) => x && typeof x.u === 'string' && /^https?:\/\//.test(x.u))
            .slice(0, 3).map((x) => ({ u: String(x.u).slice(0, 500), t: String(x.t || '').slice(0, 120) }));
          if (list.length) opts.onSources?.(list);
        } else if (o.done) {
          try { reader.cancel(); } catch { /* closed */ }
          return { kind: 'done' };
        } else if (o.error) {
          return o.error === 'limit' ? { kind: 'limit', retryAfter: 600, scope: 'provider' } : { kind: 'failed', reason: String(o.error) };
        }
      }
    }
    if (me.cancelled) return { kind: 'stopped' };
    return { kind: 'failed', reason: why || 'connection closed' };
  } catch (e: any) {
    if (me.cancelled) return { kind: 'stopped' };
    return { kind: 'failed', reason: why || String(e?.name || e) };
  } finally {
    clearInterval(dog);
    if (current === me) current = null;
  }
}

// ---------- one image ("make an image of …"), Online answers only

export type ImageEnd =
  | { kind: 'ok'; url: string }
  | { kind: 'blocked' }
  | { kind: 'limit'; retryAfter: number }
  | { kind: 'stopped' }
  | { kind: 'failed'; reason: string };

/** Asks the server to make one picture. Nothing is stored there; the image comes back as a data URL. */
export async function makeImage(prompt: string, lang: 'en' | 'hi'): Promise<ImageEnd> {
  const me = { ctrl: new AbortController(), cancelled: false };
  current = me;
  const dog = setTimeout(() => me.ctrl.abort(), 60000);
  try {
    const res = await fetch(IMAGE_URL, {
      method: 'POST',
      headers: { apikey: CHAT_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: deviceId(), prompt: prompt.slice(0, 500), lang }),
      signal: me.ctrl.signal,
      cache: 'no-store',
    });
    let o: any = {};
    try { o = await res.json(); } catch { /* not json */ }
    if (res.status === 422) return { kind: 'blocked' };
    if (res.status === 429) return { kind: 'limit', retryAfter: typeof o.retry_after === 'number' ? o.retry_after : 3600 };
    if (!res.ok || typeof o.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(o.data.slice(0, 200))) return { kind: 'failed', reason: `http ${res.status}` };
    const mime = /^image\/(jpeg|png|webp)$/.test(o.mime) ? o.mime : 'image/jpeg';
    return { kind: 'ok', url: `data:${mime};base64,${o.data}` };
  } catch (e: any) {
    if (me.cancelled) return { kind: 'stopped' };
    return { kind: 'failed', reason: String(e?.name || e) };
  } finally {
    clearTimeout(dog);
    if (current === me) current = null;
  }
}
