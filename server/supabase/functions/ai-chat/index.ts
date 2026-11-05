// Elric AI online answers (Supabase Edge Function, Deno).
//
// POST JSON (apikey header = the app's publishable/anon key):
//   { device, question, history?: [{role:'user'|'model', text}], image?: {mime, data(base64)},
//     mode?: 'study'|'shopping'|'general', short?: bool, lang?: 'en'|'hi', talk?: bool,
//     name?, study?, memory?, doc?: {name, text}, hard?: bool }
//   doc = text the app took from a PDF/TXT file on the phone (trimmed there; never stored here).
// Response:
//   200 text/event-stream:  data: {"t":"..."}  (text pieces)
//                           data: {"src":[{"t":title,"u":url}]}   (web pages the answer used, when it searched)
//                           data: {"done":true,"m":"g"|"a"|"b"}   (finished; g = Groq, a/b = Gemini primary/fallback)
//                           data: {"error":"failed"|"limit"|"blocked"}   (stream broke; app answers offline)
//   400 {status:'bad_request'} · 401 {status:'unauthorized'} · 413 {status:'too_large'}
//   429 {status:'limit', scope:'device'|'ip'|'provider', retry_after} · 503 {status:'unavailable'}
//
// CORS: https://elricai.sbs and https://www.elricai.sbs (website online mode).
//
// Privacy: no question, answer, photo or memory text is stored or logged. Only a salted
// SHA-256 of the device id and of the IP, with hourly counters (table ai_usage).
// Models: text questions → Groq openai/gpt-oss-20b first, with a calculator tool for maths and web search for
// questions that need facts (global search budget; skipped for maths, chit-chat and files),
// then, if Groq has no first word within a few seconds, errors or is rate limited (or GROQ_API_KEY is
// not set), gemini-3.5-flash-lite hedged with gemini-3.1-flash-lite. Photos always go to Gemini.
// Answer cache: approved answers for common general questions (table ai_answer_cache) are served first
// (x-elric-src: cache, done m "c"); candidates are recorded only after 3+ devices ask (hashes until then).
// Response header x-elric-src: g1 = Groq, g2 = Groq + web search, gc = Groq + calculator, g3 = both, gem = Gemini.

const MODELS = (Deno.env.get("AI_CHAT_MODELS") ?? "gemini-3.5-flash-lite,gemini-3.1-flash-lite")
  .split(",").map((s) => s.trim()).filter(Boolean);
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SALT = Deno.env.get("AI_CHAT_SALT") ?? "";
const TEST_SECRET = Deno.env.get("AUTOFIX_SECRET") ?? "";
const GROQ_KEY = (Deno.env.get("GROQ_API_KEY") ?? "").trim().replace(/^Bearer\s+/i, "");
let groqLast = "";
const GROQ_MODEL = Deno.env.get("AI_CHAT_GROQ_MODEL") ?? "openai/gpt-oss-20b";
/** Fall back to Gemini if Groq has not sent its first word by then. */
const GROQ_FIRST_MS = 4_000;
const GROQ_FIRST_SEARCH_MS = 7_000;
/** After a Groq 429, skip Groq until this time (ms epoch). Per isolate, best effort. */
let groqCooldownUntil = 0;

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
const MAX_DOC = 10_000;                // chars of file text per question
/** Web searches (about 8.5k Groq tokens each, of 8000/min shared) for all users together. */
const SEARCH_HOUR = 50, SEARCH_DAY = 300;
/** Tool rounds per answer (each is one Groq request; 1000 requests/day shared). */
const MAX_TOOL_ROUNDS = 4;
const GROQ_FIRST_TOOL_MS = 12_000;
const CALL_TIMEOUT_MS = 60_000;
/** Start the next model too if the first has not begun answering by then. */
const HEDGE_MS = 4_000;

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
  doc?: { name: string; text: string }; hard: boolean;
};

/** The user's message as sent to the model: the question, with the file's text before it when one is attached. */
function userText(r: Req): string {
  if (!r.doc) return r.question;
  return `Attached file "${r.doc.name}" (text taken from it on the user's phone; may be trimmed):\n<<<\n${r.doc.text}\n>>>\n\n` +
    `Question about the file: ${r.question}`;
}

const clean = (s: unknown, max: number) =>
  typeof s === "string" ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "";

function systemPrompt(r: Req, facts: Fact[], search = false, calcTool = false): string {
  const today = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })
    .format(new Date());
  let s = search
    ? `Today is ${today}. Use web search for current facts and answer from what you find; if the results are ` +
      "unclear, say so. Do not paste links, URLs or citation marks; you may name a source in words (like The Hindu). "
    : `Today is ${today}. Your knowledge may be out of date, so for recent news, results or events, ` +
      "say you may not know and suggest checking a trusted source. ";
  s += "You are Elric AI. Do not introduce yourself or mention who made you unless the user asks. Answer reliably in the user's language (English or " +
    "Hindi). If unsure, say so. If asked which model or company you are, say you are Elric AI. " +
    "Write maths in plain text (like 17 × 24 = 408), never LaTeX. Keep answers clear and not too long.";
  if (calcTool) {
    s += " For every arithmetic step (including unit, percent and time-difference sums) call the calculator tool " +
      "and use its exact results; never work numbers out in your head. Show the steps with the computed numbers " +
      "and give the final answer clearly (with units, and clock times as AM/PM).";
  }
  if (!r.talk) {
    s += " If the user asks for a diagram, flowchart, mind map, timeline or process chart, draw it as Mermaid in a " +
      "```mermaid code block (flowchart TD or LR, short node labels in double quotes, no special characters " +
      "outside quotes), with one or two lines of explanation; otherwise do not add diagrams.";
  }
  s += " You cannot create pictures or photos yourself; the app makes them when the user writes a request like " +
    "'Make an image of a temple at sunset'. If asked for a picture in another way, tell them to ask like that, " +
    "or offer a short description or a diagram instead.";
  if (r.doc) s += " The user attached a file; answer from its text, and say so if the answer is not in it.";
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
    "some other AI, reply only that you are Elric AI, founded by Brahma Reddy Suravarapu. " +
    "In that reply never write the names of any other AI company or model (no Google, Gemini, Gemma, DeepMind, " +
    "OpenAI, ChatGPT, GPT, Llama, Meta, Groq, Qwen, Anthropic, Claude, Mistral), not even to deny it. " +
    "Never say you are ChatGPT, GPT, OpenAI, Llama, Meta, Google, Gemini, Groq or any other company's model.";
  return s;
}

// ---------------------------------------------------------------- calculator tool (safe: own parser, no eval)

/** Evaluates an arithmetic expression. Supports + - * / ^ ** % (as percent or mod), parentheses, unary -,
 *  x (as times), constants pi/e and functions sqrt cbrt abs round floor ceil ln log log10
 *  log2 exp sin cos tan asin acos atan (radians) sind cosd tand (degrees) min max pow factorial / n!.
 *  Throws on anything else. */
function calc(expr: string): number {
  const src = String(expr).slice(0, 300)
    .replace(/[×✕✖]/g, "*").replace(/[÷]/g, "/").replace(/[−–—]/g, "-").replace(/π/g, "pi")
    .replace(/\*\*/g, "^").replace(/₹|\$|rs\.?/gi, "");
  let i = 0;
  const peek = () => { while (src[i] === " " || src[i] === "\t") i++; return src[i] ?? ""; };
  const fail = (m: string): never => { throw new Error(m); };
  const FN: Record<string, (...a: number[]) => number> = {
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, exp: Math.exp,
    ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sind: (x) => Math.sin(x * Math.PI / 180), cosd: (x) => Math.cos(x * Math.PI / 180), tand: (x) => Math.tan(x * Math.PI / 180),
    round: (x, d = 0) => { const k = 10 ** Math.max(0, Math.min(12, Math.trunc(d))); return Math.round(x * k) / k; },
    min: Math.min, max: Math.max, pow: Math.pow, factorial: (x) => fact(x),
  };
  const fact = (n: number) => {
    if (!Number.isInteger(n) || n < 0 || n > 170) fail("factorial");
    let r = 1; for (let k = 2; k <= n; k++) r *= k; return r;
  };
  const primary = (): number => {
    const c = peek();
    if (c === "(") { i++; const v = expr0(); if (peek() !== ")") fail(")"); i++; return v; }
    if (c === "-") { i++; return -unary(); }
    if (c === "+") { i++; return unary(); }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { i += num[0].length; return parseFloat(num[0]); }
    const id = /^[a-z][a-z0-9]*/i.exec(src.slice(i));
    if (id) {
      const name = id[0].toLowerCase(); i += id[0].length;
      if (name === "pi") return Math.PI;
      if (name === "e") return Math.E;
      const f = FN[name];
      if (!f) fail("name");
      if (peek() !== "(") fail("(");
      i++;
      const args: number[] = [];
      if (peek() !== ")") { args.push(expr0()); while (peek() === ",") { i++; args.push(expr0()); } }
      if (peek() !== ")") fail(")");
      i++;
      if (args.length > 10) fail("args");
      return f(...args);
    }
    return fail("token");
  };
  const postfix = (): number => {
    let v = primary();
    for (;;) {
      const c = peek();
      if (c === "!") { i++; v = fact(v); continue; }
      if (c === "%") {
        // "20%" is percent unless followed by an operand (then it's modulo).
        const save = i; i++;
        const nx = peek();
        if (nx && /[\d.(a-z]/i.test(nx)) { i = save; break; }
        v = v / 100; continue;
      }
      break;
    }
    return v;
  };
  const unary = (): number => postfix();
  const power = (): number => {
    const b = unary();
    if (peek() === "^") { i++; const e = power0(); return Math.pow(b, e); }
    return b;
  };
  const power0 = (): number => { const c = peek(); if (c === "-") { i++; return -power(); } return power(); };
  const term = (): number => {
    let v = power0();
    for (;;) {
      const c = peek();
      if (c === "*" || (c === "x" && /^x\s*[\d(.]/.test(src.slice(i)))) { i++; v *= power0(); }
      else if (c === "/") { i++; v /= power0(); }
      else if (c === "%") { i++; v %= power0(); }
      else if (c === "(" ) { v *= power0(); } // implicit: 2(3+4)
      else return v;
    }
  };
  const expr0 = (): number => {
    let v = term();
    for (;;) {
      const c = peek();
      if (c === "+") { i++; v += term(); } else if (c === "-") { i++; v -= term(); } else return v;
    }
  };
  if (!src.trim()) fail("empty");
  const v = expr0();
  if (peek() !== "") fail("trailing");
  if (!Number.isFinite(v)) fail("not finite");
  return v;
}

/** Number as text: exact integers as is, others to 10 significant digits without float noise. */
function fmtNum(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  const s = Number(v.toPrecision(10));
  return String(s);
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
  let doc: Req["doc"];
  if (body.doc && typeof body.doc === "object") {
    const text = clean(body.doc.text, MAX_DOC);
    if (text) doc = { name: clean(body.doc.name, 80).replace(/["<>\n\r]/g, "") || "file", text };
  }
  const mode = ["study", "shopping", "general"].includes(body.mode) ? body.mode : "study";
  return {
    doc, hard: body.hard === true,
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
  parts.push({ text: userText(r) });
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
  // Hedged: start the primary model; if it has not started answering within HEDGE_MS (free tier can
  // queue for 30 s+), also start the next model and use whichever answers first. The loser is aborted.
  type One = { kind: "stream"; res: Response; model: number; ctrl: AbortController } | { kind: "limit" } | { kind: "fail"; status: number; retry: boolean };
  const tryModel = async (i: number, ctrl: AbortController): Promise<One> => {
    if (test === "limit") return { kind: "limit" };
    if (test === "fail-primary" && i === 0) return { kind: "fail", status: 503, retry: true };
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODELS[i]}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
          body,
          signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]),
        },
      );
    } catch {
      return { kind: "fail", status: 504, retry: true };
    }
    if (res.ok && res.body) return { kind: "stream", res, model: i, ctrl };
    const errText = await res.text().catch(() => "");
    console.log(`ai-chat model ${MODELS[i]} status ${res.status}`); // status only, never content
    if (res.status === 429) return { kind: "limit" };
    if (res.status >= 500 || res.status === 404) return { kind: "fail", status: res.status, retry: true };
    if (res.status === 400 && /thinking/i.test(errText)) return { kind: "fail", status: 400, retry: true };
    return { kind: "fail", status: res.status, retry: false };
  };
  return await new Promise<Attempt>((resolve) => {
    let next = 0, running = 0, done = false, sawLimit = false, lastStatus = 0;
    const ctrls: AbortController[] = [];
    let timer: number | undefined;
    const finish = (a: Attempt) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      for (const c of ctrls) if (a.kind !== "stream" || c !== (a as any).ctrl) c.abort();
      resolve(a);
    };
    const start = () => {
      if (done || next >= MODELS.length) return;
      const i = next++;
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      running++;
      if (next < MODELS.length) timer = setTimeout(start, HEDGE_MS) as unknown as number;
      tryModel(i, ctrl).then((r) => {
        running--;
        if (done) { if (r.kind === "stream") ctrl.abort(); return; }
        if (r.kind === "stream") { finish({ kind: "stream", res: r.res, model: r.model, ctrl } as any); return; }
        if (r.kind === "limit") sawLimit = true; else lastStatus = r.status;
        if (r.kind === "fail" && !r.retry) { if (running === 0) finish({ kind: "fail", status: r.status }); return; }
        if (next < MODELS.length) { if (timer) clearTimeout(timer); start(); return; }
        if (running === 0) finish(sawLimit ? { kind: "limit" } : { kind: "fail", status: lastStatus });
      });
    };
    start();
  });
}

// Re-emits Gemini's SSE as small Elric events. Never logs text.
function relay(res: Response, model: number, onDone?: (text: string) => void): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const reader = res.body!.getReader();
  let buf = "";
  let sent = 0;
  let all = "";
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
                sent += p.text.length; all += p.text;
                send(c, { t: p.text });
              }
            }
          }
        }
        if (blocked || (sent === 0 && /SAFETY|PROHIBITED|BLOCK|RECITATION/.test(finish))) send(c, { error: "blocked" });
        else if (sent === 0) send(c, { error: "failed" });
        else {
          send(c, { done: true, m: model === 0 ? "a" : "b", f: finish === "MAX_TOKENS" ? "length" : undefined });
          if (finish !== "MAX_TOKENS") onDone?.(all.trim());
        }
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

// ---------------------------------------------------------------- what a question needs

// Time-sensitive questions (always worth a search), so study words like "current" (electricity) or
// "rate" (of reaction) do not trigger it on their own.
const SEARCH_RE = new RegExp(
  "\\b(today|today's|tonight|tomorrow|yesterday|right now|as of now|latest|currently|recent|recently|news|" +
  "breaking|headlines?|current (affairs|news|events|situation|status|cm|pm|president|chief minister|prime minister)|" +
  "scores?|live score|weather|forecast|cyclone|storm|flood|earthquake|elections?|exam results?|results? (of|for|declared)|" +
  "who won|winner|ipl|world cup|sensex|nifty|share price|stock price|gold price|gold rate|petrol price|" +
  "this week|this month|last week|202[5-9])\\b|\\baaj\\b|\\babhi\\b|taaza|\\btaza\\b|khabar|samachar|mausam|chunav|natija|" +
  "आज|अभी|ताज़ा|ताजा|खबर|ख़बर|समाचार|मौसम|चुनाव|नतीजा|परिणाम|स्कोर", "i");

// Fact look-ups that change or that a small model often gets wrong: office holders, prices, dates of things,
// releases, rankings, specs, schedules, "who is <Name>", and places/organisations by name.
const FACT_RE = new RegExp(
  "\\b(who (is|are) (the )?(current |present |new )?(cm|pm|ceo|chief|captain|coach|president|prime|governor|minister|head|chairman|founder|owner|director)|" +
  "who is [A-Z][a-z]+|price of|cost of|how much (is|does|do)|release date|launch(ed)? (date|in|on)|when (is|was|will|does|did)|" +
  "how many (people|seats|countries|states|districts|members)|population of|ranking|rank of|top \\d+|best .{0,30} (in|under|for) |" +
  "specs?|specifications|schedule|timetable of|fees? (of|for)|cut ?off|syllabus|notification|last date|admit card|" +
  "exam date|vacancy|vacancies|scheme|yojana|launched|announced|new (phone|model|law|rule|policy))\\b|" +
  "कौन है|कीमत|दाम|कब है|कब होगा|योजना|अंतिम तिथि", "i");

// No search for maths, code, writing, translation, greetings or explanations of a concept.
const NO_SEARCH_RE = new RegExp(
  "^\\s*(hi|hello|hey|thanks|thank you|ok|okay|good (morning|night|evening)|namaste|नमस्ते|धन्यवाद)\\b|" +
  "\\b(write (a|an|me)|essay|poem|story|letter|translate|code|python|java|program|function|debug|explain (how|why|the concept)|" +
  "meaning of|define|difference between|solve|calculate|prove|derive)\\b", "i");

const MATH_WORDS = new RegExp(
  "\\b(solve|calculate|compute|find (the|its)|how (many|much|long|far|fast)|what time|percent|percentage|profit|loss|" +
  "discount|markup|interest|ratio|average|speed|km/h|kmph|distance|area|volume|perimeter|equation|probability|" +
  "sum|product|square root|cube|factor|lcm|hcf|gcd|emi|gst|train|catch|overtake|marked price|cost price|selling price|" +
  "original price|simple interest|compound interest)\\b|%|×|÷|\\d\\s*[-+*/^x]\\s*\\d|" +
  "हल|गणना|प्रतिशत|लाभ|हानि|छूट|ब्याज|अनुपात|औसत|गति|दूरी|क्षेत्रफल|मूल्य|कितना|कितने|कितनी", "i");

const REASON_WORDS = new RegExp(
  "\\b(step by step|show steps|prove|derive|balance (the|this)? ?(chemical )?equation|why does|why do|explain why|" +
  "acceleration|velocity|momentum|force|energy|circuit|resistance|reaction|molar|moles|logic|puzzle|riddle)\\b|" +
  "चरणबद्ध|सिद्ध|क्यों", "i");

/** Maths with numbers in it: give the model the calculator. */
function needsCalc(q: string) {
  return (q.match(/\d+(\.\d+)?/g) ?? []).length >= 2 && MATH_WORDS.test(q);
}
/** Multi-step reasoning: think a bit longer. */
function isHard(r: Req) {
  return r.hard || needsCalc(r.question) || REASON_WORDS.test(r.question);
}
function needsSearch(r: Req) {
  if (r.doc || r.image) return false;
  const q = r.question;
  if (SEARCH_RE.test(q)) return true;
  if (needsCalc(q) || NO_SEARCH_RE.test(q) || q.length < 12) return false;
  return FACT_RE.test(q);
}

// ---------------------------------------------------------------- Groq (OpenAI-compatible)

const CALC_TOOL = {
  type: "function",
  function: {
    name: "calculator",
    description: "Exact arithmetic. Pass one or more expressions; returns each result. Use + - * / ^ ( ), " +
      "% for percent (20% = 0.2), sqrt(), round(x, digits), pi, sind/cosd/tand (degrees), sin/cos/tan (radians), " +
      "log10, ln, n!. Plain numbers only: no commas, units or words.",
    parameters: {
      type: "object",
      properties: {
        expressions: { type: "array", items: { type: "string" }, description: "e.g. [\"72*1.5\", \"108/(90-72)\"]" },
      },
      required: ["expressions"],
    },
  },
};

function runCalc(args: string): string {
  let list: unknown[] = [];
  try {
    const a = JSON.parse(args || "{}");
    list = Array.isArray(a.expressions) ? a.expressions : typeof a.expression === "string" ? [a.expression] : [];
  } catch { return JSON.stringify({ error: "arguments must be JSON {expressions: [..]}" }); }
  const out = list.slice(0, 12).map((e) => {
    const expr = String(e).slice(0, 300);
    try { return { expression: expr, result: fmtNum(calc(expr)) }; } catch (x) { return { expression: expr, error: String((x as Error).message || "invalid") }; }
  });
  return JSON.stringify(out.length ? out : { error: "no expressions" });
}

/** Groq token budget seen in its last response headers (per isolate; best effort). */
let groqTokRemain = 8000, groqTokResetAt = 0;
function noteGroqLimits(res: Response) {
  const rem = Number(res.headers.get("x-ratelimit-remaining-tokens") ?? "");
  const reset = res.headers.get("x-ratelimit-reset-tokens") ?? "";
  if (!Number.isFinite(rem)) return;
  let ms = 0;
  const m = /(?:(\d+)m)?([\d.]+)s/.exec(reset);
  if (m) ms = (Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000;
  else if (/^[\d.]+ms$/.test(reset)) ms = parseFloat(reset);
  groqTokRemain = rem;
  groqTokResetAt = Date.now() + Math.min(ms || 60_000, 60_000);
}
/** A search needs about 8.5k tokens. Groq refills about 133 tokens/s: wait up to 12 s for room, else skip. */
async function groqSearchRoom(): Promise<boolean> {
  if (Date.now() >= groqTokResetAt || groqTokRemain >= 6000) return true;
  const waitMs = Math.min(groqTokResetAt - Date.now(), ((6000 - groqTokRemain) / 133) * 1000);
  if (waitMs > 12_000) return false;
  await new Promise((r) => setTimeout(r, Math.max(0, waitMs)));
  return true;
}

type Tools = { search: boolean; calc: boolean };
type Source = { t: string; u: string };
type ToolCall = { id: string; name: string; args: string };
type GroqLive = {
  reader: ReadableStreamDefaultReader<Uint8Array>; dec: TextDecoder; buf: string; pending: string[]; finish: string; ended: boolean;
  messages: any[]; body: Record<string, unknown>; signal: AbortSignal; calls: ToolCall[]; rounds: number;
  opened: Source[]; found: Source[]; content: string;
};

async function groqFetch(body: Record<string, unknown>, signal: AbortSignal): Promise<Response | null> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify(body),
    signal,
  });
  noteGroqLimits(res);
  if (!res.ok || !res.body) {
    console.log(`ai-chat groq status ${res.status}`); // status only, never content
    groqLast = String(res.status);
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after") ?? "");
      groqCooldownUntil = Date.now() + (Number.isFinite(ra) && ra > 0 ? Math.min(ra, 3600) : 60) * 1000;
    }
    await res.body?.cancel().catch(() => {});
    return null;
  }
  return res;
}

/** Runs the tool calls of the round that just ended and starts the next round. false = cannot continue. */
async function groqNextRound(live: GroqLive): Promise<boolean> {
  if (!live.calls.length || live.rounds >= MAX_TOOL_ROUNDS) return false;
  live.rounds++;
  const calls = live.calls.splice(0);
  live.messages.push({
    role: "assistant", content: live.content || null,
    tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })),
  });
  for (const c of calls) {
    live.messages.push({
      role: "tool", tool_call_id: c.id,
      content: c.name === "calculator" ? runCalc(c.args) : JSON.stringify({ error: "unknown tool" }),
    });
  }
  live.content = "";
  const body = { ...live.body, messages: live.messages };
  // Last round: no more tools, so the model must answer.
  if (live.rounds >= MAX_TOOL_ROUNDS) delete (body as any).tools;
  const res = await groqFetch(body, live.signal);
  if (!res) return false;
  live.reader = res.body!.getReader(); live.buf = ""; live.finish = ""; live.ended = false;
  return true;
}

/** Starts a streamed Groq answer and waits for its first word. null = use Gemini instead. Never logs text. */
async function startGroq(r: Req, system: string, tools: Tools): Promise<GroqLive | null> {
  if (!GROQ_KEY || r.image || Date.now() < groqCooldownUntil) return null;
  const messages: any[] = [
    { role: "system", content: system },
    ...r.history.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.text })),
    { role: "user", content: userText(r) },
  ];
  const body: Record<string, unknown> = {
    model: GROQ_MODEL, stream: true, temperature: tools.calc ? 0.2 : 0.4,
    reasoning_effort: isHard(r) ? "medium" : "low", include_reasoning: false,
    max_completion_tokens: r.short || r.talk ? (isHard(r) ? 1600 : 900) : 2600,
  };
  const t: unknown[] = [];
  if (tools.search) t.push({ type: "browser_search" });
  if (tools.calc) t.push(CALC_TOOL);
  if (t.length) body.tools = t;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), tools.calc ? GROQ_FIRST_TOOL_MS : tools.search ? GROQ_FIRST_SEARCH_MS : GROQ_FIRST_MS);
  const signal = AbortSignal.any([ctrl.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]);
  try {
    const res = await groqFetch({ ...body, messages }, signal);
    if (!res) { clearTimeout(timer); return null; }
    const live: GroqLive = {
      reader: res.body!.getReader(), dec: new TextDecoder(), buf: "", pending: [], finish: "", ended: false,
      messages, body, signal, calls: [], rounds: 0, opened: [], found: [], content: "",
    };
    for (;;) {
      while (!live.pending.length && !live.ended) await groqRead(live);
      if (live.pending.length) break;
      if (live.finish === "tool_calls" && await groqNextRound(live)) continue;
      break;
    }
    clearTimeout(timer);
    if (!live.pending.length) { console.log("ai-chat groq empty"); return null; }
    return live;
  } catch {
    clearTimeout(timer);
    console.log("ai-chat groq timeout/error");
    groqLast = "err";
    return null;
  }
}

function addSource(list: Source[], u: string, t: string) {
  if (!/^https?:\/\//.test(u) || /exa\.ai\/search|google\.[a-z.]+\/search|bing\.com\/search/.test(u)) return;
  if (list.some((s) => s.u === u) || list.length >= 8) return;
  list.push({ u: u.slice(0, 500), t: (t || "").replace(/\s+/g, " ").trim().slice(0, 120) });
}

/** Reads one network chunk; keeps delta.content (never reasoning), tool calls and the pages search used. */
async function groqRead(live: GroqLive) {
  const { value, done } = await live.reader.read();
  if (done) { live.ended = true; return; }
  live.buf += live.dec.decode(value, { stream: true });
  let idx;
  while ((idx = live.buf.indexOf("\n")) >= 0) {
    const line = live.buf.slice(0, idx).trim();
    live.buf = live.buf.slice(idx + 1);
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let ev: any;
    try { ev = JSON.parse(payload); } catch { continue; }
    if (ev?.error) { live.ended = true; live.finish = "error"; return; }
    const ch = ev?.choices?.[0];
    if (ch?.finish_reason) live.finish = ch.finish_reason;
    const d = ch?.delta ?? {};
    const t = d.content;
    if (typeof t === "string" && t) { live.pending.push(t); live.content += t; }
    for (const tc of d.tool_calls ?? []) {
      const i = typeof tc.index === "number" ? tc.index : live.calls.length;
      const c = live.calls[i] ?? (live.calls[i] = { id: "", name: "", args: "" });
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.name = tc.function.name;
      if (tc.function?.arguments) c.args += tc.function.arguments;
    }
    for (const et of d.executed_tools ?? []) {
      for (const x of et?.search_results?.results ?? []) addSource(live.found, String(x?.url ?? ""), String(x?.title ?? ""));
      if (et?.name === "browser.open" && typeof et.output === "string") {
        const u = /URL:\s*(\S+)/.exec(et.output)?.[1] ?? "";
        const title = /^L2:\s*(.+)$/m.exec(et.output)?.[1] ?? "";
        addSource(live.opened, u, title);
      }
    }
  }
}

// Removes search citation marks like 【3†L4-L9】 even when split across pieces.
function citeFilter() {
  let hold = "";
  return (piece: string, end = false): string => {
    let t = (hold + piece).replace(/【[^】]{0,80}】/g, "");
    hold = "";
    const open = t.lastIndexOf("【");
    if (!end && open >= 0 && t.length - open < 80) { hold = t.slice(open); t = t.slice(0, open); }
    if (end) t = t.replace(/【[^】]*$/, "");
    return t;
  };
}

/** Up to 3 pages: the ones the model opened first, then top search results. */
function pickSources(live: GroqLive): Source[] {
  const out: Source[] = [];
  for (const s of [...live.opened, ...live.found]) {
    if (out.length >= 3) break;
    const host = (() => { try { return new URL(s.u).hostname; } catch { return ""; } })();
    if (!host || out.some((o) => { try { return new URL(o.u).hostname === host; } catch { return false; } })) continue;
    const title = live.found.find((f) => f.u === s.u)?.t || s.t;
    out.push({ u: s.u, t: title || host.replace(/^www\./, "") });
  }
  return out;
}

function relayGroq(live: GroqLive, onDone?: (text: string, searched: boolean) => void): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const send = (c: ReadableStreamDefaultController<Uint8Array>, o: unknown) =>
    c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
  const filter = citeFilter();
  let sent = 0;
  let all = "";
  return new ReadableStream({
    async start(c) {
      try {
        while (true) {
          for (const p of live.pending.splice(0)) {
            const t = filter(p);
            if (t) { sent += t.length; all += t; send(c, { t }); }
          }
          if (live.ended) {
            if (live.finish === "tool_calls" && await groqNextRound(live)) { if (sent) { sent++; send(c, { t: "\n\n" }); } continue; }
            break;
          }
          await groqRead(live);
        }
        const tail = filter("", true);
        if (tail) { sent += tail.length; all += tail; send(c, { t: tail }); }
        if (sent === 0 || live.finish === "error") send(c, { error: "failed" });
        else {
          const src = pickSources(live);
          if (src.length) send(c, { src });
          send(c, { done: true, m: "g", f: live.finish === "length" ? "length" : undefined });
          if (live.finish !== "length") onDone?.(all.trim(), live.found.length + live.opened.length > 0);
        }
      } catch {
        try { send(c, { error: "failed" }); } catch { /* closed */ }
      } finally {
        try { c.close(); } catch { /* closed */ }
      }
    },
    cancel() {
      live.reader.cancel().catch(() => {});
    },
  });
}

// ---------------------------------------------------------------- answer cache (owner-approved)

// Never cached: personal questions, private numbers/ids, links, names of people, news.
const PERSONAL_RE = /\b(i|i'm|im|i've|me|my|mine|myself|we|our|ours|us|mera|meri|mere|mujhe|mujhko|hum|hamara|hamari|humara)\b|मेरा|मेरी|मेरे|मुझे|मुझको|मैं|हम|हमारा|हमारी/i;
const PRIVATE_RE = /\d[\d\s-]{4,}\d|@|https?:|www\.|aadhaa?r|\bpan\b|password|\botp\b|\bupi\b|account|bank|phone number|mobile number|address|आधार|पासवर्ड|खाता/i;
/** Two Capitalised words after the first word (like a person's name). */
const NAME_RE = /[A-Z][a-z]+\s+[A-Z][a-z]+/;

function normQ(q: string) {
  return q.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Whether this question may be answered from / recorded into the cache. */
function cacheable(r: Req): boolean {
  const q = r.question;
  if (r.image || r.doc || r.talk || r.history.length || r.memory || r.study) return false;
  if (q.length < 6 || q.length > 300) return false;
  if (PERSONAL_RE.test(q) || PRIVATE_RE.test(q) || SEARCH_RE.test(q)) return false;
  if (NAME_RE.test(q.replace(/^\s*\S+/, ""))) return false;
  return normQ(q).length >= 4;
}
const cacheKey = (r: Req) => ({ p_norm: normQ(r.question), p_lang: r.lang, p_mode: r.mode, p_short: r.short });

async function cacheGet(r: Req): Promise<string | null> {
  try {
    const a = await rpc("ai_cache_get", cacheKey(r));
    return typeof a === "string" && a ? a : null;
  } catch { return null; }
}

/** Counts this device for the question; the answer is kept only when 3+ devices asked (owner approves it later). */
function cacheNote(r: Req, device: string, answer: string, kind: "general" | "search") {
  if (r.name && answer.toLowerCase().includes(r.name.toLowerCase())) return;
  if (PRIVATE_RE.test(answer.slice(0, 200)) && /\d{6,}/.test(answer)) return;
  const k = cacheKey(r);
  const p = (async () => {
    await rpc("ai_cache_note", {
      p_qhash: await sha(`q:${k.p_norm}|${k.p_lang}|${k.p_mode}|${k.p_short}`), p_dhash: await sha("d:" + device),
      ...k, p_question: r.question.slice(0, 300), p_answer: answer.slice(0, 6000), p_kind: kind,
    });
  })().catch(() => {});
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* not on Supabase */ }
}

/** Streams a cached answer in a few pieces, like a model would. */
function relayCached(answer: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      const parts = answer.match(/[\s\S]{1,400}(\s|$)|[\s\S]+$/g) ?? [answer];
      for (const t of parts) if (t) c.enqueue(enc.encode(`data: ${JSON.stringify({ t })}\n\n`));
      c.enqueue(enc.encode(`data: ${JSON.stringify({ done: true, m: "c" })}\n\n`));
      c.close();
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
  const facts = await factsP;
  marks.facts = Date.now() - t0;
  const sse = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store",
    "X-Accel-Buffering": "no",
    "Access-Control-Expose-Headers": "x-elric-src",
  };

  // 0) Owner-approved answer for a common general question: no model call.
  const canCache = cacheable(parsed) && test !== "no-cache";
  if (canCache) {
    const hit = await cacheGet(parsed);
    marks.cache = Date.now() - t0;
    if (hit) {
      return new Response(relayCached(hit), {
        headers: { ...sse, "x-elric-src": "cache", "Server-Timing": `limit;dur=${marks.limit}, cache;dur=${marks.cache}` },
      });
    }
  }

  // 1) Groq for text questions (skipped when no key, photo, cooldown, or test header no-groq).
  if (!parsed.image && test !== "no-groq" && test !== "limit" && test !== "fail-primary") {
    const wantSearch = needsSearch(parsed) && test !== "no-search";
    let search = wantSearch && await groqSearchRoom();
    if (search) {
      // Shared budget for all users (searches use most of Groq's per-minute tokens).
      try {
        const hit = await rpc("ai_usage_hit", { p_keys: ["g:search"], p_hour_caps: [SEARCH_HOUR], p_day_caps: [SEARCH_DAY] });
        if (!hit?.ok) search = false;
      } catch { search = false; }
    }
    const calcTool = needsCalc(parsed.question) && !parsed.talk;
    let system = systemPrompt(parsed, facts, search, calcTool);
    if (wantSearch && !search) {
      system += " IMPORTANT: you cannot check current information for this question right now. Begin by saying " +
        "your information may be out of date and the user should check a trusted source; do not state recent " +
        "office holders, results or prices as certain.";
    }
    const live = await startGroq(parsed, system, { search, calc: calcTool });
    marks.groq = Date.now() - t0;
    if (live) {
      const onDone = canCache ? (text: string, searched: boolean) => cacheNote(parsed, device, text, searched ? "search" : "general") : undefined;
      return new Response(relayGroq(live, onDone), {
        headers: {
          ...sse,
          "x-elric-src": search ? (calcTool ? "g3" : "g2") : calcTool ? "gc" : "g1",
          ...(wantSearch && !search ? { "x-elric-ns": "1" } : {}),
          "Server-Timing": `limit;dur=${marks.limit}, facts;dur=${marks.facts}, model;dur=${marks.groq}`,
        },
      });
    }
  }

  // 2) Gemini (as before).
  if (!GEMINI_KEY) return json(503, { status: "unavailable" });
  const system = systemPrompt(parsed, facts);
  const a = await callGemini(parsed, system, test, testAuth ? (req.headers.get("x-elric-think") ?? "") : "");
  marks.model = Date.now() - t0;
  if (a.kind === "limit") return json(429, { status: "limit", scope: "provider", retry_after: 600 });
  if (a.kind === "fail") return json(503, { status: "unavailable", code: a.status });
  if (a.kind === "blocked") return json(422, { status: "blocked" });
  return new Response(relay(a.res, a.model, canCache ? (text) => cacheNote(parsed, device, text, "general") : undefined), {
    headers: {
      ...sse,
      "x-elric-src": "gem", "x-elric-gs": groqLast,
      "Server-Timing": `limit;dur=${marks.limit}, facts;dur=${marks.facts}${marks.groq !== undefined ? `, groq;dur=${marks.groq}` : ""}, model;dur=${marks.model}`,
    },
  });
}
