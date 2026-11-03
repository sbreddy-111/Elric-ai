// Elric AI online answers (Supabase Edge Function, Deno).
//
// POST JSON (apikey header = the app's publishable/anon key):
//   { device, question, history?: [{role:'user'|'model', text}], image?: {mime, data(base64)},
//     mode?: 'study'|'shopping'|'general', short?: bool, lang?: 'en'|'hi', talk?: bool,
//     name?, study?, memory? }
// Response:
//   200 text/event-stream:  data: {"t":"..."}  (text pieces)
//                           data: {"done":true,"m":"a"|"b"}   (finished; a = primary, b = fallback model)
//                           data: {"error":"failed"|"limit"|"blocked"}   (stream broke; app answers offline)
//   400 {status:'bad_request'} · 401 {status:'unauthorized'} · 413 {status:'too_large'}
//   429 {status:'limit', scope:'device'|'ip'|'provider', retry_after} · 503 {status:'unavailable'}
//
// CORS: https://elricai.sbs and https://www.elricai.sbs (website online mode).
//
// Privacy: no question, answer, photo or memory text is stored or logged. Only a salted
// SHA-256 of the device id and of the IP, with hourly counters (table ai_usage).
// Models: gemini-3.5-flash-lite, then gemini-3.1-flash-lite on 429/5xx (free tier).

const MODELS = (Deno.env.get("AI_CHAT_MODELS") ?? "gemini-3.5-flash-lite,gemini-3.1-flash-lite")
  .split(",").map((s) => s.trim()).filter(Boolean);
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SALT = Deno.env.get("AI_CHAT_SALT") ?? "";
const TEST_SECRET = Deno.env.get("AUTOFIX_SECRET") ?? "";

// Limits (abuse guard).
const DEVICE_HOUR = 30, DEVICE_DAY = 100;
const IP_HOUR = 60, IP_DAY = 200;
const MAX_BODY = 1_600_000;          // bytes (photo ≈ 1.1 MB base64 max)
const MAX_IMAGE_B64 = 1_400_000;
const MAX_QUESTION = 4000;
const MAX_TURN = 4000;
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_CHARS = 12000;
const MAX_MEMORY = 450;
const CALL_TIMEOUT_MS = 60_000;

const PUBLIC_KEYS = (() => {
  const keys = new Set<string>();
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (anon) keys.add(anon);
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "";
  try {
    const v = JSON.parse(raw);
    const walk = (x: unknown) => {
      if (typeof x === "string") keys.add(x);
      else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") Object.values(x).forEach(walk);
    };
    walk(v);
  } catch {
    for (const k of raw.split(/[\s,]+/)) if (k) keys.add(k);
  }
  return keys;
})();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SALT + "|" + s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEq(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function rpc(fn: string, body: unknown) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`rpc ${r.status}`);
  return await r.json();
}

// ---------------------------------------------------------------- facts (cached 10 min)

type Fact = { id: number; topic: string | null; fact: string };
let factsCache: { at: number; list: Fact[] } | null = null;

async function loadFacts(): Promise<Fact[]> {
  if (factsCache && Date.now() - factsCache.at < 600_000) return factsCache.list;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/ai_facts?select=id,topic,fact&active=eq.true&order=id`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (r.ok) {
      const list = ((await r.json()) as Fact[]).filter((f) => f.fact && f.fact.trim());
      factsCache = { at: Date.now(), list };
      return list;
    }
  } catch { /* use cache or none */ }
  return factsCache?.list ?? [];
}

// Same matching as the app (ElricFacts.pick): words shared with the question.
const STOP = new Set(("the and for are was who what when where which how why you your with from that this about " +
  "tell does did can his her its were has have had is of in on a an to me my i do be by it at or as kya hai " +
  "kaun ke ki ka ko se में है का की के को से क्या कौन और").split(" "));
const ALIASES: Record<string, string> = {
  "एलरिक": "elric", "एल्रिक": "elric", "रामानुजन": "ramanujan", "टाइटन": "titan", "घड़ी": "watches",
  "घड़ियाँ": "watches", "ब्रह्मा": "brahma", "संस्थापक": "founded", founder: "founded", founders: "founded",
  watch: "watches",
};
function words(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u)
      .filter((w) => w.length >= 3 || [...w].some((c) => c.charCodeAt(0) > 0x900))
      .filter((w) => w && !STOP.has(w))
      .map((w) => ALIASES[w] ?? w),
  );
}
function pickFacts(facts: Fact[], question: string): string[] {
  const q = words(question);
  if (!q.size) return [];
  const scored = facts.map((f) => {
    const w = words(f.fact + " " + (f.topic ?? ""));
    let score = 0;
    for (const qw of q) {
      for (const x of w) {
        if (x === qw || (qw.length >= 5 && x.startsWith(qw.slice(0, 5)))) { score++; break; }
      }
    }
    return { f, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.f.id - b.f.id);
  const out: string[] = [];
  let chars = 0;
  for (const { f } of scored) {
    if (out.length >= 5) break;
    const t = f.fact.trim();
    if (chars + t.length > 500) continue;
    out.push(t);
    chars += t.length + 1;
  }
  return out;
}

// ---------------------------------------------------------------- prompt (mirrors the app)

const BUILTIN_FACTS =
  ' Facts: Elric AI is an offline-first study and shopping assistant for India, founded by Brahma Reddy Suravarapu (elricai.sbs, "AI you can rely on."). Elric Watches is an official Titan watch store founded and owned by Brahma Reddy Suravarapu (elricwatches.in, Instagram @elricwatches). Brahma Reddy Suravarapu is the founder of the Elric brands: Elric Watches, Elric AI and Elric Next (give no details about Elric Next). Being built: Student OS, Elric Fit (a fitness and diet tracker) and Elric AI Watch; say they are being built and do not describe features.';

type Req = {
  question: string; history: { role: string; text: string }[]; image?: { mime: string; data: string };
  mode: string; short: boolean; lang: string; talk: boolean; name: string; study: string; memory: string;
};

const clean = (s: unknown, max: number) =>
  typeof s === "string" ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "";

function systemPrompt(r: Req, facts: Fact[]): string {
  const today = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })
    .format(new Date());
  let s = `Today is ${today}. Your knowledge may be out of date, so for recent news, results or events, ` +
    "say you may not know and suggest checking a trusted source. ";
  s += "You are Elric AI, built on open models. Answer reliably in the user's language (English or " +
    "Hindi). If unsure, say so. If asked which model or company you are, say you are Elric AI. " +
    "Write maths in plain text (like 17 × 24 = 408), never LaTeX. Keep answers clear and not too long.";
  s += " If asked who made, built or founded you, say Elric AI was founded by Brahma Reddy Suravarapu; " +
    "never say Google, Gemma, Gemini, OpenAI or Qwen made you, and never mention Google, Gemini or Gemma " +
    "as your model, provider or maker (do not name them at all, not even to deny it; just say you are Elric AI). For any small or local business or person you have no facts about, " +
    "say you are not sure rather than guess. Never invent details or features of Elric products beyond the facts given.";
  const rel = pickFacts(facts, r.question);
  if (facts.length === 0) s += BUILTIN_FACTS;
  else if (rel.length) s += " Facts (use exactly when relevant): " + rel.join(" ");
  if (r.mode === "study") s += " Mode: Study. Be a patient tutor for Indian students.";
  else if (r.mode === "shopping") {
    s += " Mode: Shopping. You have NO access to live prices, stock or offers. Never state or " +
      "guess specific prices, and never invent products, shops or links. Help compare " +
      "features and explain what to look for, and say live prices are coming soon.";
  }
  const mem = r.memory;
  if (r.lang === "hi" && !/hindi|हिन्दी|हिंदी/i.test(mem)) s += " The user prefers Hindi.";
  if (r.name) s += ` The user's name is ${r.name}.`;
  if (r.study) s += ` The user studies: ${r.study}. Match explanations to this level.`;
  if (r.talk) {
    s += " This is a spoken conversation: reply in plain spoken sentences, with no markdown, " +
      "lists, tables, symbols or emojis, in the language the user spoke.";
  }
  s += r.short || r.talk
    ? " ANSWER LENGTH: SHORT. Reply in at most 4 short sentences or 5 bullet points (under 80 " +
      "words). Give the key answer first. No greetings, no repeating the question. If the " +
      "user sends several questions, answer each in one or two lines."
    : " ANSWER LENGTH: DETAILED. Explain step by step with an example.";
  if (mem) s += ` What you know about this user (follow it; it overrides the defaults above when they differ): ${mem}`;
  s += " IDENTITY (most important): if asked what model you are, which company made you, or whether you are " +
    "some other AI, reply only that you are Elric AI, built on open models, founded by Brahma Reddy Suravarapu. " +
    "In that reply never write the names of any other AI company or model (no Google, Gemini, Gemma, DeepMind, " +
    "OpenAI, ChatGPT), not even to deny it.";
  return s;
}

// ---------------------------------------------------------------- request parsing

function parse(body: any): Req | string {
  if (!body || typeof body !== "object") return "body";
  const question = clean(body.question, MAX_QUESTION);
  if (!question) return "question";
  const hist: { role: string; text: string }[] = [];
  if (Array.isArray(body.history)) {
    for (const t of body.history.slice(-MAX_HISTORY_TURNS)) {
      const role = t?.role === "model" ? "model" : t?.role === "user" ? "user" : "";
      const text = clean(t?.text, MAX_TURN);
      if (role && text) hist.push({ role, text });
    }
  }
  // Drop the oldest turns beyond the char budget; start on a user turn.
  let total = hist.reduce((n, t) => n + t.text.length, 0);
  while (hist.length && (total > MAX_HISTORY_CHARS || hist[0].role !== "user")) {
    total -= hist.shift()!.text.length;
  }
  let image: Req["image"];
  if (body.image) {
    const mime = String(body.image.mime ?? "");
    const data = String(body.image.data ?? "");
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) return "image_type";
    if (!data || data.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=\s]+$/.test(data.slice(0, 2000))) return "image";
    image = { mime, data: data.replace(/\s+/g, "") };
  }
  const mode = ["study", "shopping", "general"].includes(body.mode) ? body.mode : "study";
  return {
    question, history: hist, image, mode,
    short: body.short !== false, lang: body.lang === "hi" ? "hi" : "en", talk: body.talk === true,
    name: clean(body.name, 40).replace(/[^\p{L}\p{M}\p{N} .'-]/gu, ""),
    study: clean(body.study, 60),
    memory: clean(body.memory, MAX_MEMORY),
  };
}

// ---------------------------------------------------------------- Gemini

type Attempt =
  | { kind: "stream"; res: Response; model: number }
  | { kind: "limit" } | { kind: "blocked" } | { kind: "fail"; status: number };

async function callGemini(r: Req, system: string, test: string, think = ""): Promise<Attempt> {
  const contents = r.history.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
  const parts: unknown[] = [];
  if (r.image) parts.push({ inline_data: { mime_type: r.image.mime, data: r.image.data } });
  parts.push({ text: r.question });
  contents.push({ role: "user", parts } as any);
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      maxOutputTokens: r.short || r.talk ? 600 : 2048,
      temperature: 0.4,
      ...(think === "none" ? {} : { thinkingConfig: { thinkingLevel: think || "minimal" } }),
    },
  });
  let sawLimit = false;
  let lastStatus = 0;
  for (let i = 0; i < MODELS.length; i++) {
    // Test hooks (only with the server secret): force the primary to fail, or every model to be at its limit.
    if (test === "limit") { sawLimit = true; continue; }
    if (test === "fail-primary" && i === 0) { lastStatus = 503; continue; }
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODELS[i]}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
          body,
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        },
      );
    } catch {
      lastStatus = 504;
      continue;
    }
    if (res.ok && res.body) return { kind: "stream", res, model: i };
    lastStatus = res.status;
    const errText = await res.text().catch(() => "");
    console.log(`ai-chat model ${MODELS[i]} status ${res.status}`); // status only, never content
    if (res.status === 429) { sawLimit = true; continue; }
    if (res.status >= 500 || res.status === 404) continue; // 404: model name not available → next
    if (res.status === 400 && /thinking/i.test(errText)) continue;
    return { kind: "fail", status: res.status };
  }
  return sawLimit ? { kind: "limit" } : { kind: "fail", status: lastStatus };
}

// Re-emits Gemini's SSE as small Elric events. Never logs text.
function relay(res: Response, model: number): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const reader = res.body!.getReader();
  let buf = "";
  let sent = 0;
  let finish = "";
  let blocked = false;
  const send = (c: ReadableStreamDefaultController<Uint8Array>, o: unknown) =>
    c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
  return new ReadableStream({
    async start(c) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let ev: any;
            try { ev = JSON.parse(payload); } catch { continue; }
            if (ev?.promptFeedback?.blockReason) blocked = true;
            const cand = ev?.candidates?.[0];
            if (cand?.finishReason) finish = cand.finishReason;
            for (const p of cand?.content?.parts ?? []) {
              if (typeof p?.text === "string" && p.text && !p.thought) {
                sent += p.text.length;
                send(c, { t: p.text });
              }
            }
          }
        }
        if (blocked || (sent === 0 && /SAFETY|PROHIBITED|BLOCK|RECITATION/.test(finish))) send(c, { error: "blocked" });
        else if (sent === 0) send(c, { error: "failed" });
        else send(c, { done: true, m: model === 0 ? "a" : "b", f: finish === "MAX_TOKENS" ? "length" : undefined });
      } catch {
        try { send(c, { error: "failed" }); } catch { /* closed */ }
      } finally {
        try { c.close(); } catch { /* closed */ }
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}

// ---------------------------------------------------------------- handler

// CORS: only the Elric AI website may call this from a browser (the app doesn't need CORS).
const CORS_ORIGINS = new Set(["https://elricai.sbs", "https://www.elricai.sbs"]);
function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !CORS_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Vary": "Origin" } });
  const res = await handle(req);
  if (!Object.keys(cors).length) return res;
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
});

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { status: "method" });
  const apikey = req.headers.get("apikey") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!PUBLIC_KEYS.has(apikey)) return json(401, { status: "unauthorized" });
  // Read the body with a cap (the whole body is read so the connection always gets an answer).
  let raw = "";
  try {
    const reader = req.body?.getReader();
    const dec = new TextDecoder();
    let size = 0;
    let over = false;
    while (reader) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY) over = true;
      else raw += dec.decode(value, { stream: true });
      if (size > 4 * MAX_BODY) { await reader.cancel().catch(() => {}); break; }
    }
    raw += dec.decode();
    if (over) return json(413, { status: "too_large" });
  } catch {
    return json(400, { status: "bad_request" });
  }
  let body: any;
  try { body = JSON.parse(raw); } catch { return json(400, { status: "bad_request" }); }
  const device = clean(body?.device, 128);
  if (device.length < 16) return json(400, { status: "bad_request", field: "device" });
  const parsed = parse(body);
  if (typeof parsed === "string") return json(400, { status: "bad_request", field: parsed });

  const testAuth = safeEq(req.headers.get("x-autofix-secret") ?? "", TEST_SECRET);
  const test = testAuth ? (req.headers.get("x-elric-test") ?? "") : "";

  const t0 = Date.now();
  const factsP = loadFacts();
  const marks: Record<string, number> = {};
  // Rate limits (device + IP), counted before calling the model.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  try {
    const keys = [`d:${await sha("d:" + device)}`, `ip:${await sha("ip:" + ip)}`];
    const caps = test === "small-cap" ? [[1, 1], [1000, 1000]] : [[DEVICE_HOUR, DEVICE_DAY], [IP_HOUR, IP_DAY]];
    const hit = await rpc("ai_usage_hit", {
      p_keys: keys, p_hour_caps: caps.map((c) => c[0]), p_day_caps: caps.map((c) => c[1]),
    });
    if (!hit?.ok) {
      return json(429, { status: "limit", scope: hit?.scope === "d" ? "device" : "ip", window: hit?.window, retry_after: hit?.retry_after ?? 3600 });
    }
  } catch {
    return json(503, { status: "unavailable" });
  }

  marks.limit = Date.now() - t0;
  if (!GEMINI_KEY) return json(503, { status: "unavailable" });
  const system = systemPrompt(parsed, await factsP);
  marks.facts = Date.now() - t0;
  const a = await callGemini(parsed, system, test, testAuth ? (req.headers.get("x-elric-think") ?? "") : "");
  marks.model = Date.now() - t0;
  if (a.kind === "limit") return json(429, { status: "limit", scope: "provider", retry_after: 600 });
  if (a.kind === "fail") return json(503, { status: "unavailable", code: a.status });
  if (a.kind === "blocked") return json(422, { status: "blocked" });
  return new Response(relay(a.res, a.model), {
    headers: {
      "Server-Timing": `limit;dur=${marks.limit}, facts;dur=${marks.facts}, model;dur=${marks.model}`,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
