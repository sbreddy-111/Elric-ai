// On-device engine for Elric AI (web).
// Runtime: MediaPipe LLM Inference for web (WebGPU). Model shown to users as "Elric Lite".
// Nothing here sends user text anywhere: the only network use is downloading the
// runtime and model files.
import { FilesetResolver, LlmInference } from '@mediapipe/tasks-genai';

export const LITE = {
  id: 'elric-lite',
  // Open model, Apache-2.0. Internal file name is never shown in the UI.
  url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task',
  fileName: 'elric-lite-v1.task',
  sizeBytes: 2003697664,
};

export const SYSTEM_PROMPT =
  'You are Elric AI, built on open models. Answer reliably in the user\'s language (English or Hindi). If unsure, say so. If asked which model or company you are, say you are Elric AI, built on open models.';

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

export const isIOS = (() => {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
})();

const LOADING_FLAG = 'elric.loadingSince';
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
        if (free < LITE.sizeBytes * 1.05) {
          report.soft.push({ kind: 'storage', need: LITE.sizeBytes, have: free });
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

/** Bytes already saved from an earlier, unfinished download (0 if none). */
export async function partialBytes(): Promise<number> {
  const root = await opfsRoot();
  if (!root) return 0;
  try {
    return (await (await root.getFileHandle(PART_NAME())).getFile()).size;
  } catch {
    return 0;
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
  const canResume = !!root && typeof (FileSystemFileHandle.prototype as any).createWritable === 'function';
  if (!canResume) return downloadWhole(onProgress, signal);

  const part = await root!.getFileHandle(PART_NAME(), { create: true });
  let done = (await part.getFile()).size;
  if (done > total) {
    await root!.removeEntry(PART_NAME());
    return downloadModel(onProgress, signal);
  }
  onProgress({ done, total });
  let failures = 0;
  while (done < total) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const endByte = Math.min(done + CHUNK, total) - 1;
    try {
      const piece = new AbortController();
      const onAbort = () => piece.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => piece.abort(), 90_000); // stalled (e.g. tab was frozen): retry this piece
      let buf: Uint8Array;
      try {
        const res = await fetch(LITE.url, { signal: piece.signal, cache: 'no-store', headers: { Range: `bytes=${done}-${endByte}` } });
        if (res.status !== 206) throw new Error(`Download failed (HTTP ${res.status})`);
        buf = new Uint8Array(await res.arrayBuffer());
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
      if (buf.byteLength !== endByte - done + 1) throw new Error('Short read');
      const w: FileSystemWritableFileStream = await (part as any).createWritable({ keepExistingData: true });
      await w.seek(done);
      await w.write(buf as any);
      await w.close(); // commits this piece to disk
      done += buf.byteLength;
      failures = 0;
      onProgress({ done, total });
    } catch (e: any) {
      if (signal.aborted) throw e;
      // Network blip or the tab was paused: retry this piece a few times before giving up.
      if (++failures > 5) throw new Error(`Download paused at ${Math.floor((done / total) * 100)}%. Tap Resume to continue.`);
      await sleep(1500 * failures);
      done = (await part.getFile()).size; // trust what is actually on disk
    }
  }
  // Rename .part to the final file (copy for engines without move()).
  if (typeof (part as any).move === 'function') {
    try { await root!.removeEntry(LITE.fileName); } catch { /* none */ }
    await (part as any).move(LITE.fileName);
  } else {
    const fin = await root!.getFileHandle(LITE.fileName, { create: true });
    const w: FileSystemWritableFileStream = await (fin as any).createWritable();
    await (await part.getFile()).stream().pipeTo(w);
    await root!.removeEntry(PART_NAME());
  }
  const size = (await (await root!.getFileHandle(LITE.fileName)).getFile()).size;
  if (size !== total) throw new Error(`Incomplete download (${size} of ${total} bytes)`);
  localStorage.setItem(STORED_FLAG, 'opfs');
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
const MAX_TOKENS = isIOS ? 1024 : 2048;

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
}

function render(system: string, turns: Turn[]): string {
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
    .replace(/<\|channel>[\s\S]*$/, '');
}

export async function generate(system: string, turns: Turn[], onText: (text: string) => void): Promise<string> {
  if (!llm) throw new Error('not loaded');
  const prompt = buildPrompt(system, turns);
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
