// Elric AI image making (Supabase Edge Function, Deno). NOT DEPLOYED until the smart-features merge.
//
// POST JSON (apikey header = the app's publishable/anon key):  { device, prompt, lang?: 'en'|'hi' }
// 200 {status:'ok', mime:'image/jpeg', data:<base64>}          (nothing is stored)
// 400 bad_request · 401 unauthorized · 422 {status:'blocked'} (prompt not allowed)
// 429 {status:'limit', scope:'device'|'ip'|'daily', retry_after} · 503 {status:'unavailable'}
//
// Model: Cloudflare Workers AI @cf/black-forest-labs/flux-1-schnell (free daily allowance), called only
// from here. Edge secrets: CF_ACCOUNT_ID, CF_AI_TOKEN (an API token with Account → Workers AI → Read
// permission). Optional GROQ_API_KEY: Hindi/Telugu prompts are turned into English first.
// Limits: 5/h + 10/day per device, 10/h + 20/day per IP, 100/day for everyone (table ai_usage, hashed keys,
// same function ai_usage_hit as ai-chat). No prompt or image is stored or logged.
// CORS: https://elricai.sbs and https://www.elricai.sbs.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SALT = Deno.env.get("AI_CHAT_SALT") ?? "";
const CF_ACCOUNT = (Deno.env.get("CF_ACCOUNT_ID") ?? "").trim();
const CF_TOKEN = (Deno.env.get("CF_AI_TOKEN") ?? "").trim().replace(/^Bearer\s+/i, "");
const CF_BASE = Deno.env.get("CF_API_BASE") ?? "https://api.cloudflare.com/client/v4";
const GROQ_KEY = (Deno.env.get("GROQ_API_KEY") ?? "").trim().replace(/^Bearer\s+/i, "");
const GROQ_URL = Deno.env.get("GROQ_API_URL") ?? "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "@cf/black-forest-labs/flux-1-schnell";

const DEVICE_HOUR = 5, DEVICE_DAY = 10, IP_HOUR = 10, IP_DAY = 20, ALL_HOUR = 40, ALL_DAY = 100;
const MAX_PROMPT = 500;
const TIMEOUT_MS = 45_000;

const PUBLIC_KEYS = (() => {
  const keys = new Set<string>();
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (anon) keys.add(anon);
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "";
  try {
    const walk = (x: unknown) => {
      if (typeof x === "string") keys.add(x);
      else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") Object.values(x).forEach(walk);
    };
    walk(JSON.parse(raw));
  } catch {
    for (const k of raw.split(/[\s,]+/)) if (k) keys.add(k);
  }
  return keys;
})();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SALT + "|" + s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
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

const clean = (s: unknown, max: number) =>
  typeof s === "string" ? s.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

// Not allowed: sexual content, minors in any unsafe context, gore, self-harm, hate, real people's likeness
// in fake situations, weapons instructions, documents/IDs/currency (fraud).
const BLOCK = new RegExp(
  "\\b(nude|nudity|naked|nsfw|porn|sex|sexy|sexual|erotic|lingerie|bikini|topless|boobs?|breasts?|genitals?|" +
  "gore|gory|bloody|beheaded|corpse|dead body|mutilat|suicide|self[- ]?harm|kill(ing)?|murder|torture|" +
  "terroris|bomb|gun|rifle|pistol|weapon|nazi|swastika|kkk|racist|" +
  "aadhaa?r|pan card|passport|driving licen[cs]e|voter id|id card|currency note|banknote|cheque|signature|" +
  "deepfake|fake photo of|celebrity|politician|modi|rahul gandhi|trump|biden)\\b|" +
  "नग्न|अश्लील|सेक्स|खून|हत्या|आत्महत्या|बम|बंदूक|आधार", "i");

function blocked(p: string) { return BLOCK.test(p); }

/** Turns a Hindi/Telugu/Hinglish prompt into a short English image prompt (best effort). */
async function toEnglish(p: string): Promise<string> {
  if (!/[\u0900-\u0DFF]/.test(p) || !GROQ_KEY) return p;
  try {
    const r = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b", temperature: 0, reasoning_effort: "low", include_reasoning: false, max_completion_tokens: 200,
        messages: [
          { role: "system", content: "Translate the user's image request into one short English image description. Reply with the description only." },
          { role: "user", content: p },
        ],
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return p;
    const j = await r.json();
    const t = clean(j?.choices?.[0]?.message?.content, MAX_PROMPT);
    return t || p;
  } catch { return p; }
}

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
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
});

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { status: "method" });
  const apikey = req.headers.get("apikey") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!PUBLIC_KEYS.has(apikey)) return json(401, { status: "unauthorized" });
  let body: any;
  try {
    const raw = await req.text();
    if (raw.length > 8000) return json(413, { status: "too_large" });
    body = JSON.parse(raw);
  } catch { return json(400, { status: "bad_request" }); }
  const device = clean(body?.device, 128);
  if (device.length < 16) return json(400, { status: "bad_request", field: "device" });
  const prompt = clean(body?.prompt, MAX_PROMPT);
  if (prompt.length < 3) return json(400, { status: "bad_request", field: "prompt" });
  if (blocked(prompt)) return json(422, { status: "blocked" });
  if (!CF_ACCOUNT || !CF_TOKEN) return json(503, { status: "unavailable" });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  try {
    const hit = await rpc("ai_usage_hit", {
      p_keys: [`i:d:${await sha("d:" + device)}`, `i:ip:${await sha("ip:" + ip)}`, "g:image"],
      p_hour_caps: [DEVICE_HOUR, IP_HOUR, ALL_HOUR], p_day_caps: [DEVICE_DAY, IP_DAY, ALL_DAY],
    });
    if (!hit?.ok) {
      const scope = hit?.scope === "i" ? "device" : "daily"; // keys split on ':' → 'i' for device/ip, 'g' for all
      return json(429, { status: "limit", scope, window: hit?.window, retry_after: hit?.retry_after ?? 3600 });
    }
  } catch { return json(503, { status: "unavailable" }); }

  const english = await toEnglish(prompt);
  if (blocked(english)) return json(422, { status: "blocked" });
  try {
    const r = await fetch(`${CF_BASE}/accounts/${CF_ACCOUNT}/ai/run/${MODEL}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${CF_TOKEN}` },
      body: JSON.stringify({ prompt: english, steps: 4 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      console.log(`ai-image provider status ${r.status}`); // status only, never the prompt
      if (r.status === 429) return json(429, { status: "limit", scope: "daily", retry_after: 3600 });
      if (r.status === 400) return json(422, { status: "blocked" }); // provider safety filter or bad prompt
      return json(503, { status: "unavailable" });
    }
    const j = await r.json();
    const data = j?.result?.image;
    if (typeof data !== "string" || data.length < 100) return json(503, { status: "unavailable" });
    return json(200, { status: "ok", mime: "image/jpeg", data });
  } catch {
    console.log("ai-image provider timeout/error");
    return json(503, { status: "unavailable" });
  }
}
