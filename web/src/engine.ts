// On-device engine for Elric AI (web).
// Runtime: MediaPipe LLM Inference for web (WebGPU). Model shown to users as "Elric Lite".
// Nothing here sends user text anywhere: the only network use is downloading the
// runtime and model files.
import { FilesetResolver, LlmInference } from '@mediapipe/tasks-genai';

const FULL = {
  id: 'elric-lite',
  chat: 'gemma' as 'gemma' | 'chatml',
  // Open model, Apache-2.0. Internal file name is never shown in the UI.
  url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task',
  fileName: 'elric-lite-v1.task',
  sizeBytes: 2003697664,
};

// iPhone web pages get too little memory for the 2 GB model, so iPhone/iPad use a smaller open model (Apache-2.0).
const BASIC = {
  id: 'elric-basic-3',
  chat: 'gemma3' as 'gemma' | 'chatml' | 'gemma3',
  // Official web build (same SHA-256 as litert-community/Gemma3-1B-IT, which is login-gated). Gemma Terms of Use.
  url: 'https://huggingface.co/nuuco/gemma-3-1b-it-int4-web/resolve/main/gemma3-1b-it-int4-web.task',
  fileName: 'elric-basic-v3.task',
  sizeBytes: 700383232,
};


const TODAY = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
export const SYSTEM_PROMPT =
  `Today is ${TODAY}. Your knowledge may be out of date, so for recent news, results or events, say you may not know and suggest checking a trusted source. ` +
  'You are Elric AI, built on open models. Answer reliably in the user\'s language (English or Hindi). If unsure, say so. If asked which model or company you are, say you are Elric AI. Write maths in plain text (like 17 × 24 = 408), never LaTeX. Keep answers clear and not too long. ' +
  'Facts: Elric AI is an offline-first study and shopping assistant for India, founded by Brahma Reddy Suravarapu (elricai.sbs, "AI you can rely on."). Elric Watches is an official Titan watch store founded and owned by Brahma Reddy Suravarapu (elricwatches.in, Instagram @elricwatches). Brahma Reddy Suravarapu is the founder of the Elric brands: Elric Watches, Elric AI and Elric Next (give no details about Elric Next). Being built: Student OS, Elric Fit (a fitness and diet tracker) and Elric AI Watch; say they are being built and do not describe features. If asked who made, built or founded you, say Elric AI was founded by Brahma Reddy Suravarapu; never say Google, Gemma, Gemini or Qwen made you. Use these facts exactly when relevant. For any other small or local business or person, say you are not sure rather than guess.';

export type Reason =
  | { kind: 'noWebGPU' }
  | { kind: 'noAdapter' }
  | { kind: 'smallGpu'; limit: number }
  | { kind: 'storage'; need: number; have: number }
  | { kind: 'crashed' }
  | { kind: 'loadFailed'; err: string };

export interface DeviceReport {
  ok: boolean; // false = hard block (no WebGPU / no adapter)
  soft: Reason[]; // warnings the user can override with "Try anyway"
  hard?: Reason;
  isIOS: boolean;
  maxBufferSize?: number;
  quota?: number;
}

const _isIOS = (() => {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
})();
export const isIOS = _isIOS;
export const LITE = isIOS ? BASIC : FULL;
export const MODEL_NAME_KEY = isIOS ? 'modelBasic' : 'modelLite';
export const MODEL_DESC_KEY = isIOS ? 'modelBasicDesc' : 'modelLiteDesc';

const LOADING_FLAG = 'elric.loadingSince';

// If this device holds a different model than the one it should use now (e.g. the 2 GB one on iPhone), free that space.
(async () => {
  const prev = localStorage.getItem('elric.modelId');
  if (prev === LITE.id) return;
  try {
    localStorage.removeItem('elric.stored');
    localStorage.removeItem('elric.hybridAt');
    await caches.delete('elric-model-pieces');
    await caches.delete('elric-models');
    const root = await navigator.storage.getDirectory();
    for (const n of ['elric-lite-v1.task', 'elric-lite-v1.task.part', 'elric-basic-v1.litertlm', 'elric-basic-v1.litertlm.part', 'elric-basic-v2.litertlm', 'elric-basic-v2.litertlm.part', 'elric-basic-v3.task', 'elric-basic-v3.task.part']) {
      try { await root.removeEntry(n); } catch { /* none */ }
    }
  } catch { /* best effort */ }
  localStorage.setItem('elric.modelId', LITE.id);
})();
const HYBRID_AT = 'elric.hybridAt'; // bytes kept in the OPFS .part file; the rest lives in the piece store
const STORED_FLAG = 'elric.stored'; // "opfs" | "cache" once a complete file is saved

export async function checkDevice(): Promise<DeviceReport> {
  const report: DeviceReport = { ok: true, soft: [], isIOS };
  if (!('gpu' in navigator) || !navigator.gpu) {
    return { ...report, ok: false, hard: { kind: 'noWebGPU' } };
  }
  let adapter: GPUAdapter | null = null;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch {
    adapter = null;
  }
  if (!adapter) return { ...report, ok: false, hard: { kind: 'noAdapter' } };
  report.maxBufferSize = adapter.limits.maxBufferSize;
  if (adapter.limits.maxBufferSize < 128 * 1024 * 1024) {
    report.soft.push({ kind: 'smallGpu', limit: adapter.limits.maxBufferSize });
  }
  if (!isStored()) {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.quota) {
        report.quota = est.quota;
        const free = est.quota - (est.usage ?? 0);
        const need = LITE.sizeBytes - (await partialBytes());
        if (free < need * 1.05) {
          report.soft.push({ kind: 'storage', need, have: free });
        }
      }
    } catch {
      /* estimate not available: not a reason to block */
    }
  }
  if (localStorage.getItem(LOADING_FLAG)) report.soft.push({ kind: 'crashed' });
  return report;
}

export function clearCrashFlag(): void {
  localStorage.removeItem(LOADING_FLAG);
}

export function isStored(): boolean {
  return !!localStorage.getItem(STORED_FLAG);
}

// ---------- Storage (OPFS first, Cache API fallback) ----------

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

async function readStored(): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
  const where = localStorage.getItem(STORED_FLAG);
  if (where === 'opfs') {
    const root = await opfsRoot();
    if (root) {
      try {
        const file = await (await root.getFileHandle(LITE.fileName)).getFile();
        if (file.size === LITE.sizeBytes) return { stream: file.stream(), size: file.size };
      } catch {
        /* fall through */
      }
    }
  } else if (where === 'pieces' || where === 'hybrid') {
    const cache = await caches.open(PIECES);
    const n = Math.ceil(LITE.sizeBytes / CHUNK);
    const at = where === 'hybrid' ? Number(localStorage.getItem(HYBRID_AT) || 0) : 0;
    let i = at / CHUNK;
    let cur: ReadableStreamDefaultReader<Uint8Array> | null = null;
    if (at > 0) {
      const root = await opfsRoot();
      const file = await (await root!.getFileHandle(PART_NAME())).getFile();
      if (file.size < at) { localStorage.removeItem(STORED_FLAG); return null; }
      cur = file.slice(0, at).stream().getReader();
    }
    const stream = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        for (;;) {
          if (!cur) {
            if (i >= n) { ctrl.close(); return; }
            const r = await cache.match(pieceKey(i++));
            if (!r?.body) { ctrl.error(new Error('Model file is damaged. Please remove and download again.')); return; }
            cur = r.body.getReader();
          }
          const { done, value } = await cur.read();
          if (done) { cur = null; continue; }
          ctrl.enqueue(value); return;
        }
      },
    });
    return { stream, size: LITE.sizeBytes };
  } else if (where === 'cache') {
    const cache = await caches.open('elric-models');
    const res = await cache.match(LITE.fileName);
    if (res?.body) return { stream: res.body, size: LITE.sizeBytes };
  }
  localStorage.removeItem(STORED_FLAG);
  return null;
}

export async function removeStored(): Promise<void> {
  localStorage.removeItem(STORED_FLAG);
  localStorage.removeItem(HYBRID_AT);
  const root = await opfsRoot();
  try {
    await root?.removeEntry(LITE.fileName);
  } catch {
    /* not there */
  }
  try {
    await root?.removeEntry(LITE.fileName + '.part');
  } catch {
    /* not there */
  }
  try {
    await caches.delete('elric-models');
    await caches.delete(PIECES);
  } catch {
    /* ignore */
  }
}

export interface Progress {
  done: number;
  total: number;
}

const PART_NAME = () => LITE.fileName + '.part';
const CHUNK = 16 * 1024 * 1024; // 16 MB pieces, each saved to disk as it lands
const PIECES = 'elric-model-pieces';
const pieceKey = (i: number) => `/elric-piece/${LITE.fileName}/${i}`;

/** Bytes saved so far in the Cache API piece store (browsers without OPFS writable files, e.g. older Safari). */
async function piecesBytes(start = 0): Promise<number> {
  try {
    if (!(await caches.has(PIECES))) return start * CHUNK;
    const cache = await caches.open(PIECES);
    const n = Math.ceil(LITE.sizeBytes / CHUNK);
    let i = start;
    while (i < n && (await cache.match(pieceKey(i)))) i++;
    return Math.min(i * CHUNK, LITE.sizeBytes);
  } catch {
    return 0;
  }
}

/** Bytes already saved from an earlier, unfinished download (0 if none). */
export async function partialBytes(): Promise<number> {
  if (isStored()) return 0;
  const hyb = Number(localStorage.getItem(HYBRID_AT) || 0);
  if (hyb > 0) return piecesBytes(hyb / CHUNK);
  if (isIOS) {
    const root = await opfsRoot();
    try {
      const old = root ? (await (await root.getFileHandle(PART_NAME())).getFile()).size : 0;
      if (old >= CHUNK) return old - (old % CHUNK);
    } catch { /* none */ }
  }
  const root = await opfsRoot();
  let opfs = 0;
  try {
    if (root) opfs = (await (await root.getFileHandle(PART_NAME())).getFile()).size;
  } catch {
    opfs = 0;
  }
  return opfs || (await piecesBytes());
}

let directUrl: string | null = null; // final CDN address (avoids a preflighted redirect on Safari)

/** Follows the Hugging Face redirect with a plain request (no custom headers) to learn the CDN address. */
async function resolveDirect(signal: AbortSignal): Promise<string> {
  const c = new AbortController();
  const onAbort = () => c.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(LITE.url, { signal: c.signal, cache: 'no-store' });
    const url = res.url;
    c.abort(); // we only need the address, not the 2 GB body
    if (!res.ok || !url) throw new Error(`Download failed (HTTP ${res.status})`);
    return url;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Fetches one byte range, with a stall timeout so a frozen request is retried instead of hanging. */
async function fetchRangeOnce(url: string, from: number, to: number, signal: AbortSignal): Promise<Uint8Array> {
  const piece = new AbortController();
  const onAbort = () => piece.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => piece.abort(), 90_000);
  try {
    const res = await fetch(url, { signal: piece.signal, cache: 'no-store', headers: { Range: `bytes=${from}-${to}` } });
    if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength !== to - from + 1) throw new Error('Short read');
    return buf;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** One byte range: tries the main address, then the CDN address (refreshed if it expired). */
async function fetchRange(from: number, to: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!directUrl) {
    try {
      return await fetchRangeOnce(LITE.url, from, to, signal);
    } catch (e) {
      if (signal.aborted) throw e;
      directUrl = await resolveDirect(signal);
    }
  }
  try {
    return await fetchRangeOnce(directUrl, from, to, signal);
  } catch (e) {
    if (signal.aborted) throw e;
    directUrl = await resolveDirect(signal); // signed address may have expired
    return await fetchRangeOnce(directUrl, from, to, signal);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Downloads the model in pieces and saves each piece on the device as it arrives,
 * so a download interrupted by switching apps (iOS pauses background tabs) resumes
 * where it stopped instead of starting over.
 */
export async function downloadModel(onProgress: (p: Progress) => void, signal: AbortSignal): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* best effort */
  }
  const total = LITE.sizeBytes;
  const root = await opfsRoot();
  // Safari copies the whole file on every OPFS write (2x space, fails near the end), so iPhone uses the piece store.
  const canResume = !isIOS && !!root && typeof (FileSystemFileHandle.prototype as any).createWritable === 'function';
  const hyb = Number(localStorage.getItem(HYBRID_AT) || 0);
  if (hyb > 0) return downloadPieces(onProgress, signal, hyb / CHUNK);
  if (!canResume) {
    // Keep bytes an earlier version saved in the .part file instead of downloading them again.
    try {
      const old = root ? (await (await root.getFileHandle(PART_NAME())).getFile()).size : 0;
      const keep = old - (old % CHUNK);
      if (keep > 0) {
        localStorage.setItem(HYBRID_AT, String(keep));
        return downloadPieces(onProgress, signal, keep / CHUNK);
      }
    } catch { /* no .part */ }
    return downloadPieces(onProgress, signal);
  }

  let part: FileSystemFileHandle;
  let done: number;
  try {
    part = await root!.getFileHandle(PART_NAME(), { create: true });
    done = (await part.getFile()).size;
  } catch {
    return downloadPieces(onProgress, signal); // this browser's file storage refused: use the piece store
  }
  if (done > total) {
    await root!.removeEntry(PART_NAME());
    return downloadModel(onProgress, signal);
  }
  onProgress({ done, total });
  let failures = 0;
  let wroteAny = false;
  let lastErr = '';
  while (done < total) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const endByte = Math.min(done + CHUNK, total) - 1;
    try {
      const buf = await fetchRange(done, endByte, signal);
      try {
        const w: FileSystemWritableFileStream = await (part as any).createWritable({ keepExistingData: true });
        await w.seek(done);
        await w.write(buf as any);
        await w.close(); // commits this piece to disk
      } catch (we: any) {
        if (we?.name === 'QuotaExceededError') throw we;
        if (!wroteAny && done === 0) {
          // This browser can't write files this way: use the piece store instead.
          try { await root!.removeEntry(PART_NAME()); } catch { /* none */ }
          return downloadPieces(onProgress, signal);
        }
        // Safari copies the whole file on every write, so a big file eventually runs out of room.
        // Keep what's saved and put the rest in the piece store.
        const kept = (await part.getFile()).size;
        if (kept % CHUNK === 0) {
          localStorage.setItem(HYBRID_AT, String(kept));
          return downloadPieces(onProgress, signal, kept / CHUNK);
        }
        throw we;
      }
      wroteAny = true;
      done += buf.byteLength;
      failures = 0;
      onProgress({ done, total });
    } catch (e: any) {
      if (signal.aborted) throw e;
      if (e?.name === 'QuotaExceededError') throw new Error('Not enough free space on this device for Elric Lite.');
      lastErr = String(e?.message || e);
      // Network blip or the tab was paused: retry this piece a few times before giving up.
      if (++failures > 5) throw new Error(`Download paused at ${Math.floor((done / total) * 100)}% (${lastErr}). Tap Resume to continue.`);
      await sleep(1500 * failures);
      done = (await part.getFile()).size; // trust what is actually on disk
    }
  }
  // Rename .part to the final file (copy for engines without move()).
  if (typeof (part as any).move === 'function') {
    try { await root!.removeEntry(LITE.fileName); } catch { /* none */ }
    await (part as any).move(LITE.fileName);
  } else {
    // No move(): read the .part file in place instead of copying 2 GB.
    localStorage.setItem(HYBRID_AT, String(total - (total % CHUNK)));
    return downloadPieces(onProgress, signal, Math.floor(total / CHUNK));
  }
  const size = (await (await root!.getFileHandle(LITE.fileName)).getFile()).size;
  if (size !== total) throw new Error(`Incomplete download (${size} of ${total} bytes)`);
  localStorage.setItem(STORED_FLAG, 'opfs');
  onProgress({ done: total, total });
}

/** Resumable fallback: each 16 MB piece is its own Cache API entry. */
async function downloadPieces(onProgress: (p: Progress) => void, signal: AbortSignal, start = 0): Promise<void> {
  const total = LITE.sizeBytes;
  const n = Math.ceil(total / CHUNK);
  const cache = await caches.open(PIECES);
  let failures = 0;
  for (let i = start; i < n; ) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (await cache.match(pieceKey(i))) { i++; onProgress({ done: Math.min(i * CHUNK, total), total }); continue; }
    const from = i * CHUNK;
    const to = Math.min(from + CHUNK, total) - 1;
    try {
      const buf = await fetchRange(from, to, signal);
      await cache.put(pieceKey(i), new Response(buf as any, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.byteLength) } }));
      failures = 0;
      i++;
      onProgress({ done: to + 1, total });
    } catch (e: any) {
      if (signal.aborted) throw e;
      if (e?.name === 'QuotaExceededError') throw new Error('Not enough free space on this device for Elric Lite.');
      if (++failures > 5) throw new Error(`Download paused at ${Math.floor((from / total) * 100)}% (${String(e?.message || e)}). Tap Resume to continue.`);
      await sleep(1500 * failures);
    }
  }
  localStorage.setItem(STORED_FLAG, start > 0 ? 'hybrid' : 'pieces');
  onProgress({ done: total, total });
}

/** Fallback for browsers without OPFS writable files: one-shot download into Cache API. */
async function downloadWhole(onProgress: (p: Progress) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(LITE.url, { signal, cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('Content-Length')) || LITE.sizeBytes;
  let done = 0;
  let last = 0;
  const body = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      done += chunk.byteLength;
      const now = performance.now();
      if (now - last > 200) { last = now; onProgress({ done, total }); }
      ctrl.enqueue(chunk);
    },
  }));
  const cache = await caches.open('elric-models');
  await cache.put(LITE.fileName, new Response(body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(total) } }));
  if (done !== LITE.sizeBytes) {
    await caches.delete('elric-models');
    throw new Error(`Incomplete download (${done} of ${LITE.sizeBytes} bytes)`);
  }
  localStorage.setItem(STORED_FLAG, 'cache');
  onProgress({ done: total, total });
}

// ---------- Inference ----------

let llm: LlmInference | null = null;
const MAX_TOKENS = isIOS ? 1024 : 4096;

export function isLoaded(): boolean {
  return !!llm;
}

export async function loadModel(onProgress?: (p: Progress) => void): Promise<void> {
  if (llm) return;
  const stored = await readStored();
  if (!stored) throw new Error('Model file not found on this device. Please download it again.');
  let done = 0;
  const counted = stored.stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        done += chunk.byteLength;
        onProgress?.({ done, total: stored.size });
        ctrl.enqueue(chunk);
      },
    }),
  );
  // If the page dies while this flag is set, next launch shows an honest "ran out of memory" state.
  localStorage.setItem(LOADING_FLAG, String(Date.now()));
  try {
    const fileset = await FilesetResolver.forGenAiTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.30/wasm');
    llm = await LlmInference.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: counted.getReader() },
      maxTokens: MAX_TOKENS,
      topK: 40,
      temperature: 0.6,
      randomSeed: 1,
    });
  } finally {
    localStorage.removeItem(LOADING_FLAG);
  }
}

export interface Turn {
  role: 'user' | 'model';
  text: string;
  /** Total answer time in ms (model turns only). */
  ms?: number;
  /** Time to first word in ms. */
  firstMs?: number;
  /** Answer length in tokens, for speed. */
  tokens?: number;
  /** Where the answer was made (model turns; missing in older chats). */
  src?: 'online' | 'offline';
  /** A notice instead of an answer (left out of the history sent to a model). */
  failed?: boolean;
}

export function countTokens(text: string): number {
  try { return llm?.sizeInTokens(text) ?? 0; } catch { return 0; }
}

function render(system: string, turns: Turn[]): string {
  if ((LITE as any).chat === 'gemma3') {
    let g = '';
    turns.forEach((t, i) => {
      const txt = i === 0 && t.role === 'user' ? `${system}\n\n${t.text}` : t.text;
      g += `<start_of_turn>${t.role === 'model' ? 'model' : 'user'}\n${txt}<end_of_turn>\n`;
    });
    return g + '<start_of_turn>model\n';
  }
  if (LITE.chat === 'chatml') {
    let c = `<|im_start|>system\n${system}<|im_end|>\n`;
    for (const t of turns) c += `<|im_start|>${t.role === 'model' ? 'assistant' : 'user'}\n${t.text}<|im_end|>\n`;
    return c + '<|im_start|>assistant\n<think>\n\n</think>\n\n';
  }
  let s = `<|turn>system\n${system}<turn|>\n`;
  for (const t of turns) s += `<|turn>${t.role}\n${t.text}<turn|>\n`;
  return s + '<|turn>model\n';
}

/** Builds the prompt, dropping the oldest turns if the conversation is too long. */
function buildPrompt(system: string, turns: Turn[]): string {
  const reserve = Math.min(512, Math.floor(MAX_TOKENS / 2));
  let start = 0;
  let prompt = render(system, turns);
  while (start < turns.length - 1) {
    const size = llm?.sizeInTokens(prompt) ?? 0;
    if (size + reserve <= MAX_TOKENS) break;
    start++;
    prompt = render(system, turns.slice(start));
  }
  return prompt;
}

function clean(text: string): string {
  return text
    .replace(/<\|channel>[\s\S]*?<channel\|>/g, '')
    .replace(/<\|?turn\|?>/g, '')
    .replace(/<\|channel>[\s\S]*$/, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<\|im_(start|end)\|>/g, '')
    .replace(/<(start|end)_of_turn>(model|user)?/g, '');
}

/**
 * Whether the loaded model was trained to write <calc>expr</calc> for arithmetic (Elric Lite Round 6+;
 * see model/data/CALC_FORMAT.md). The app parses <calc> in every offline answer either way.
 */
export const CALC_TAGS = false;
export const CALC_PROMPT = ' For every arithmetic step write <calc>expression</calc> (numbers and + - * / ^ ( ) % only) and wait: the app adds <result>value</result>. Use that value; never guess numbers.';

/** prefix = the start of the answer already written (continues after a calculator step). */
export async function generate(system: string, turns: Turn[], onText: (text: string) => void, prefix = ''): Promise<string> {
  if (!llm) throw new Error('not loaded');
  const prompt = buildPrompt(system, turns) + prefix;
  let acc = '';
  await llm.generateResponse(prompt, (partial: string) => {
    acc += partial;
    onText(clean(acc));
  });
  return clean(acc).trim();
}

export function stop(): void {
  try {
    llm?.cancelProcessing();
  } catch {
    /* ignore */
  }
}
