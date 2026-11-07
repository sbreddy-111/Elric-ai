// Elric AI image making (Supabase Edge Function, Deno). NOT DEPLOYED until the smart-features merge.
//
// POST JSON (apikey header = the app's publishable/anon key):  { device, prompt, lang?: 'en'|'hi', image?: base64, mime? } (image = photo to edit)
// 200 {status:'ok', mime:'image/jpeg', data:<base64>}          (nothing is stored)
// 400 bad_request · 401 unauthorized · 422 {status:'blocked'} (prompt not allowed)
// 429 {status:'limit', scope:'device'|'ip'|'daily', retry_after} · 503 {status:'unavailable'}
//
// Model: Cloudflare Workers AI @cf/black-forest-labs/flux-1-schnell (free daily allowance), called only
// from here. Edge secrets: CF_ACCOUNT_ID, CF_AI_TOKEN (an API token with Account → Workers AI → Read
// permission). Optional GROQ_API_KEY: Hindi/Telugu prompts are turned into English first.
// Limits: 5/h + 10/day per device, 6/h + 12/day per IP, 30/h + 70/day for everyone (table ai_usage, hashed keys
// imgd:/imgip:/g:image, same atomic function ai_usage_hit as ai-chat). The IP is cf-connecting-ip (set by
// Cloudflare, not the client), so one person cannot use up everyone's daily pictures by rotating device ids.
// A request that is blocked or fails upstream is refunded (ai_usage_refund). No prompt or image is stored or logged.
// CORS: https://elricai.sbs and https://www.elricai.sbs.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SALT = Deno.env.get("AI_CHAT_SALT") ?? "";
const CF_ACCOUNT = (Deno.env.get("CF_ACCOUNT_ID") ?? "").trim();
const CF_TOKEN = (Deno.env.get("CF_AI_TOKEN") ?? "").trim().replace(/^Bearer\s+/i, "");
// Our own Worker (elric-image), which speaks this JSON format. Without it there is no image backend:
// the public Cloudflare REST API would need a different (multipart) request for FLUX.2.
const CF_BASE = (Deno.env.get("CF_API_BASE") ?? "").trim();
const GROQ_KEY = (Deno.env.get("GROQ_API_KEY") ?? "").trim().replace(/^Bearer\s+/i, "");
const GROQ_URL = Deno.env.get("GROQ_API_URL") ?? "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "@cf/black-forest-labs/flux-2-klein-4b"; // better quality; can edit a given photo
const FALLBACK = "@cf/black-forest-labs/flux-1-schnell";
const MAX_REF = 1_600_000; // base64 of a reference photo

const DEVICE_HOUR = 5, DEVICE_DAY = 10, IP_HOUR = 6, IP_DAY = 12, ALL_HOUR = 30, ALL_DAY = 70; // free daily allowance fits about 80 klein-4b pictures
const RPC_TIMEOUT_MS = 5_000;
const MAX_PROMPT = 500;
const TIMEOUT_MS = 50_000;

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
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`rpc ${r.status}`);
  return await r.json();
}

const clean = (s: unknown, max: number) =>
  typeof s === "string" ? s.normalize("NFC").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Client IP from Cloudflare (cf-connecting-ip cannot be sent by the client); first XFF hop only as a fallback. */
function clientIp(req: Request): string {
  const cf = (req.headers.get("cf-connecting-ip") ?? "").trim();
  if (cf) return cf;
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

// Not allowed: sexual content, minors in any unsafe context, gore, self-harm, hate, real people's likeness
// in fake situations, weapons instructions, documents/IDs/currency (fraud).
// Word stems match every form (guns, bombing, terrorists, killed, corpses, weapons, mutilated, ...).
const BLOCK = new RegExp(
  "\\b(nud(?:e|es|ity)|naked\\w*|nsfw|porn\\w*|sex\\w*|erotic\\w*|lingerie|bikinis?|topless|boobs?|breasts?|genital\\w*|nipples?|" +
  "strip(?:per|pers|ping|tease)\\w*|undress\\w*|" +
  "gor(?:e|y)|blood(?:y|ied|shed)|behead\\w*|decapitat\\w*|corpses?|dead bod(?:y|ies)|mutilat\\w*|dismember\\w*|suicid\\w*|" +
  "self[- ]?harm\\w*|kill\\w*|murder\\w*|tortur\\w*|massacre\\w*|shoot(?:ing|ings|er|ers)|stab(?:bing|bed|s)?|" +
  "terror\\w*|bomb(?:s|ed|er|ers|ing|ings)?|explosiv\\w*|grenades?|guns?|gunm[ae]n|rifles?|pistols?|revolvers?|firearms?|weapon\\w*|ak-?47|" +
  "nazi\\w*|swastikas?|kkk|racis\\w*|" +
  "aadhaa?r|pan cards?|passports?|driving licen[cs]es?|voter ids?|id cards?|currency notes?|banknotes?|cheques?|signatures?|" +
  "deepfakes?|fake photos? of|celebrit\\w*|politician\\w*|modi|rahul gandhi|trump|biden)\\b|" +
  "नग्न|अश्लील|सेक्स|खून|हत्या|आत्महत्या|बम|बंदूक|हथियार|आतंक|लाश|आधार|" +
  "నగ్న|అశ్లీల|సెక్స్|రక్తం|హత్య|ఆత్మహత్య|బాంబు|తుపాకీ|ఆయుధ|ఉగ్రవా|శవం|ఆధార్", "i");

function blocked(p: string) { return BLOCK.test(p); }

/** Turns a Hindi/Telugu/Hinglish prompt into a short English image prompt. null = the rewrite failed. */
async function toEnglish(p: string): Promise<string | null> {
  if (!GROQ_KEY) return null;
  try {
    const r = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b", temperature: 0, reasoning_effort: "low", include_reasoning: false, max_completion_tokens: 300,
        messages: [
          { role: "system", content: "Turn the user's image request into one clear English image description of at most 60 words for an image model. Keep every detail the user asked for. If it has a 'Change:' part, apply that change to the earlier request (for example village style means a rural Indian village scene). If a company, shop, brand or person's business name is mentioned, the picture must show that name written exactly and clearly on a sign, logo wall or board (for example: a large sign reading \"ELRIC\"). Anything named Elric (Elric AI, Elric Watches, Elric office) is an Indian startup brand with black and gold colours. If it starts with EDIT, the user has given a picture to change: write only a short instruction for the edit (for example: Change the background to a beach at sunset, keep the person the same). Reply with the description only." },
          { role: "user", content: p },
        ],
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const t = clean(j?.choices?.[0]?.message?.content, MAX_PROMPT);
    return t || null;
  } catch { return null; }
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
    if (raw.length > MAX_REF + 8000) return json(413, { status: "too_large" });
    body = JSON.parse(raw);
  } catch { return json(400, { status: "bad_request" }); }
  const device = clean(body?.device, 128);
  if (device.length < 16) return json(400, { status: "bad_request", field: "device" });
  const prompt = clean(body?.prompt, MAX_PROMPT);
  if (prompt.length < 3) return json(400, { status: "bad_request", field: "prompt" });
  if (blocked(prompt)) return json(422, { status: "blocked" });
  if (!CF_ACCOUNT || !CF_TOKEN || !CF_BASE) return json(503, { status: "unavailable" });
  const ref = typeof body?.image === "string" && body.image.length > 100 && body.image.length <= MAX_REF && /^[A-Za-z0-9+/=]+$/.test(body.image.slice(0, 400))
    ? { data: body.image as string, mime: /^image\/(jpeg|png|webp)$/.test(body?.mime) ? body.mime as string : "image/jpeg" } : null;

  const ip = clientIp(req);
  const keys = [`imgd:${await sha("d:" + device)}`, `imgip:${await sha("ip:" + ip)}`, "g:image"];
  try {
    const hit = await rpc("ai_usage_hit", {
      p_keys: keys, p_hour_caps: [DEVICE_HOUR, IP_HOUR, ALL_HOUR], p_day_caps: [DEVICE_DAY, IP_DAY, ALL_DAY],
    });
    if (!hit?.ok) {
      const scope = hit?.scope === "imgd" ? "device" : hit?.scope === "imgip" ? "ip" : "daily";
      return json(429, { status: "limit", scope, window: hit?.window, retry_after: hit?.retry_after ?? 3600 });
    }
  } catch { return json(503, { status: "unavailable" }); }
  // Blocked or failed requests do not use up the user's (or everyone's) pictures.
  const refund = async (res: Response) => { try { await rpc("ai_usage_refund", { p_keys: keys }); } catch { /* best effort */ } return res; };

  const rewritten = await toEnglish(ref ? `EDIT the given picture. ${prompt}` : prompt);
  // Without the rewrite, a prompt in another script cannot be checked against the (English) blocklist.
  if (rewritten === null && /[^\u0000-\u024f\u2000-\u206f\u20b9]/.test(prompt)) return refund(json(503, { status: "unavailable" }));
  let english = rewritten ?? (ref ? `EDIT the given picture. ${prompt}` : prompt);
  // Elric AI is for India: scenes with people or places default to an Indian setting unless another place is named.
  const PEOPLE = /\b(child|children|kid|kids|boy|girl|man|men|woman|women|people|person|family|student|teacher|farmer|school|village|street|market|city|town|house|home|classroom|festival|wedding|shop)s?\b/i;
  const ELSEWHERE = /\b(america|american|usa|europe|european|england|london|paris|japan|japanese|china|chinese|africa|african|korea|russia|germany|france|italy|spain|canada|australia|mexico|arab|dubai|western|space|moon|mars|fantasy|cartoon of)\b/i;
  if (!ref && PEOPLE.test(english) && !ELSEWHERE.test(english) && !/\bindia/i.test(english)) english += ", set in India with Indian people and surroundings, natural and realistic";
  if (blocked(english) || blocked(prompt)) return refund(json(422, { status: "blocked" }));
  try {
    const run = (model: string) => fetch(`${CF_BASE}/accounts/${CF_ACCOUNT}/ai/run/${model}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${CF_TOKEN}` },
      body: JSON.stringify({ prompt: english, steps: 4, ...(ref ? { image: ref.data, mime: ref.mime } : {}) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let r = await run(MODEL);
    if (!r.ok && !ref && r.status !== 400) { console.log(`ai-image main status ${r.status}, trying fallback`); r = await run(FALLBACK); }
    if (!r.ok) {
      console.log(`ai-image provider status ${r.status}`); // status only, never the prompt
      if (r.status === 429) return refund(json(429, { status: "limit", scope: "daily", retry_after: 3600 }));
      if (r.status === 400) return refund(json(422, { status: "blocked" })); // provider safety filter or bad prompt
      return refund(json(503, { status: "unavailable" }));
    }
    const j = await r.json();
    const data = j?.result?.image;
    if (typeof data !== "string" || data.length < 100) return refund(json(503, { status: "unavailable" }));
    return json(200, { status: "ok", mime: "image/jpeg", data });
  } catch {
    console.log("ai-image provider timeout/error");
    return refund(json(503, { status: "unavailable" }));
  }
}
