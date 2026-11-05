// Elric Agent (prototype) — Supabase Edge Function `ai-agent` (Deno), verify_jwt false.
//
// POST JSON { text, ui_lang?: 'te'|'hi'|'en', prev?: {task, fields} }  (apikey header = publishable key)
//   prev = the task card from the last turn, so a follow-up ("1234 ane number") can fill missing fields.
// 200 { task, lang, fields, missing, confirm_text }
//   task: electricity_bill | bus_search | pm_kisan_status | unknown
// 400 bad_request · 401 unauthorized · 429 limit · 503 unavailable
//
// Privacy: the user's text is never stored or logged. Only status codes are logged. Rate limit uses
// the shared ai_usage_hit RPC with a salted SHA-256 of the IP (key prefix "ag:").
// Model: Groq openai/gpt-oss-20b in JSON mode, Gemini flash-lite as backup.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SALT = Deno.env.get("AI_CHAT_SALT") ?? "";
const GROQ_KEY = (Deno.env.get("GROQ_API_KEY") ?? "").trim().replace(/^Bearer\s+/i, "");
const GROQ_MODEL = Deno.env.get("AI_CHAT_GROQ_MODEL") ?? "openai/gpt-oss-20b";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const IP_HOUR = 40, IP_DAY = 150;
const MAX_TEXT = 500;

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
  } catch { for (const k of raw.split(/[\s,]+/)) if (k) keys.add(k); }
  return keys;
})();

const TASKS = ["electricity_bill", "bus_search", "pm_kisan_status", "unknown"] as const;
const FIELDS: Record<string, string[]> = {
  electricity_bill: ["biller", "service_number"],
  bus_search: ["from", "to", "date"],
  pm_kisan_status: ["aadhaar_or_mobile_last4"],
  unknown: [],
};
const BILLERS = ["APCPDCL", "APSPDCL", "APEPDCL", "TSSPDCL", "TSNPDCL"];

// Used only when the server dropped a value the model gave (so its sentence would be wrong).
// Asking for a missing field always uses these fixed sentences (clear, native, never invented).
const ASK: Record<string, Record<string, string>> = {
  "te-latn": { biller: "Ye current company? (APCPDCL / APSPDCL / APEPDCL)", service_number: "Mee service number cheppandi?", from: "Ekkada nunchi?", to: "Ekkadiki vellali?", date: "Ye roju?", aadhaar_or_mobile_last4: "Aadhaar leda mobile last 4 digits cheppandi?" },
  "hi-latn": { biller: "Kaun si bijli company? (APCPDCL / APSPDCL / APEPDCL)", service_number: "Aapka service number kya hai?", from: "Kahan se?", to: "Kahan jaana hai?", date: "Kis din?", aadhaar_or_mobile_last4: "Aadhaar ya mobile ke last 4 digit batayein?" },
  te: { biller: "ఏ విద్యుత్ సంస్థ? (APCPDCL / APSPDCL / APEPDCL)", service_number: "మీ సర్వీస్ నంబర్ ఎంత?", from: "ఎక్కడి నుంచి?", to: "ఎక్కడికి?", date: "ఏ తేదీ?", aadhaar_or_mobile_last4: "ఆధార్ లేదా మొబైల్ చివరి 4 అంకెలు?" },
  hi: { biller: "कौन सी बिजली कंपनी? (APCPDCL / APSPDCL / APEPDCL)", service_number: "आपका सर्विस नंबर क्या है?", from: "कहाँ से?", to: "कहाँ तक?", date: "किस तारीख को?", aadhaar_or_mobile_last4: "आधार या मोबाइल के आखिरी 4 अंक?" },
  en: { biller: "Which power company? (APCPDCL / APSPDCL / APEPDCL)", service_number: "What is your service number?", from: "From which city?", to: "To which city?", date: "Which date?", aadhaar_or_mobile_last4: "Last 4 digits of Aadhaar or mobile?" },
};

const clean = (s: unknown, max: number) =>
  typeof s === "string" ? s.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SALT + "|" + s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" })
    .formatToParts(new Date()).reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);
}

function systemPrompt(uiLang: string, prev: unknown) {
  const t = today();
  return `You turn one spoken request from an Indian user into a task card. Output ONLY a JSON object.
Today is ${t.weekday}, ${t.year}-${t.month}-${t.day} (Asia/Kolkata).
The user may speak Telugu, Hindi, English, or mixed (Tenglish/Hinglish), in native script or Latin letters.

Tasks:
- "electricity_bill": check/pay a power (current/karent/bijli/vidyut) bill. Fields: biller, service_number.
  biller must be one of APCPDCL (central AP: Guntur, Palnadu/Narasaraopet, Krishna, NTR/Vijayawada, Prakasam, Bapatla, Eluru),
  APSPDCL (south AP: Nellore, Tirupati, Chittoor, Kadapa, Kurnool, Anantapur), APEPDCL (north AP: Visakhapatnam, Vizianagaram,
  Srikakulam, East/West Godavari, Kakinada), TSSPDCL, TSNPDCL. Set biller ONLY if the user names it or names a town/district that clearly maps to one; else null.
  service_number: the consumer/service/USC number exactly as the user said it (digits only, join spoken digits); else null.
- "bus_search": find a bus. Fields: from (origin), to (destination) (city names in English, e.g. "Hyderabad"), date (YYYY-MM-DD; resolve today/tomorrow/repu/kal/parsu/weekday names from today's date; else null).
- "pm_kisan_status": PM-Kisan instalment/payment status. Field: aadhaar_or_mobile_last4 (last 4 digits of Aadhaar or registered mobile, only if the user said them; if they said a full number, keep only the last 4 digits).
  Direction words: destination = "to X", "X ki/X ku/X ke/X kosam", "X jaane/X jaana/X jaanevali", "X vellali", "X కి/కు", "X को/X जाने";
  origin = "from X", "X se/X से", "X nunchi/X నుంచి/నుండి". If only the destination is said, from is null (and vice versa).
- "unknown": anything else (fields = {}).

Rules:
- NEVER invent a value. If the user did not say it, the field is null.
- "lang": the language the user spoke: "te", "hi", or "en" (Tenglish counts as "te", Hinglish as "hi"). If unclear use "${uiLang}".
- "missing": names of required fields that are still null.
- "confirm_text": ONE short sentence in the user's language and script style (Telugu script for Telugu, Devanagari for Hindi, unless they typed in Latin letters — then reply in the same romanised style).
  If nothing is missing, restate the key values and ask to proceed. Examples:
  en "APCPDCL bill, service no. 1234. Check it?"  te "APCPDCL బిల్లు, సర్వీస్ నంబర్ 1234. చెక్ చేయాలా?"
  hi "APCPDCL बिल, सर्विस नंबर 1234. चेक करें?"  Tenglish "Guntur nunchi Hyderabad bus, repu (7 Nov). Chudamaa?"
  Hinglish "Hyderabad se Vijayawada bus, kal (7 Nov). Dekhein?"  In confirm_text write dates like "7 Nov"; in fields.date ALWAYS use YYYY-MM-DD.
  If something is missing, ask only for the first missing field, e.g. "Which service number?".
  For unknown, say briefly you can now help with power bills, bus search and PM-Kisan status.
- Numbers stay as digits.
${prev ? `This is a follow-up. The previous task card was: ${JSON.stringify(prev)}. Keep its task and its values unless the user changes them; fill missing fields from the new message.` : ""}
JSON shape: {"task": "...", "lang": "te|hi|en", "fields": {...}, "missing": [...], "confirm_text": "..."}`;
}

async function callGroq(system: string, text: string): Promise<string | null> {
  if (!GROQ_KEY) return null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL, temperature: 0.1, reasoning_effort: "low", include_reasoning: false,
        max_completion_tokens: 1200, response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: text }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) { console.log(`ai-agent groq ${r.status}`); await r.body?.cancel(); return null; }
    const j = await r.json();
    return j?.choices?.[0]?.message?.content ?? null;
  } catch { console.log("ai-agent groq error"); return null; }
}

async function callGemini(system: string, text: string): Promise<string | null> {
  if (!GEMINI_KEY) return null;
  for (const m of GEMINI_MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 800, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) { console.log(`ai-agent gem ${r.status}`); await r.body?.cancel(); continue; }
      const j = await r.json();
      const t = (j?.candidates?.[0]?.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("");
      if (t) return t;
    } catch { console.log("ai-agent gem error"); }
  }
  return null;
}

// Accepts YYYY-MM-DD, or "7 Nov" / "Nov 7" (next such date from today, IST). Else null.
function isoDate(v: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const M = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const m = v.toLowerCase().match(/(\d{1,2})\s*([a-z]{3})|([a-z]{3})[a-z]*\s*(\d{1,2})/);
  if (!m) return null;
  const day = Number(m[1] ?? m[4]); const mon = M.indexOf((m[2] ?? m[3]) as string);
  if (mon < 0 || day < 1 || day > 31) return null;
  const t = today(); let y = Number(t.year);
  if (mon + 1 < Number(t.month) || (mon + 1 === Number(t.month) && day < Number(t.day))) y++;
  return `${y}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Validate the model's JSON. Values that are not plausible or not grounded in the text are dropped (no invented values).
function normalize(raw: string, text: string, prevFields: Record<string, string>, uiLang: string) {
  let o: any;
  try { o = JSON.parse(raw.replace(/^```(json)?|```$/g, "").trim()); } catch { return null; }
  const task = TASKS.includes(o?.task) ? o.task : "unknown";
  const lang = ["te", "hi", "en"].includes(o?.lang) ? o.lang : uiLang;
  const f: Record<string, string | null> = {};
  let dropped = false;
  const src = o?.fields && typeof o.fields === "object" ? o.fields : {};
  const digitsInText = (text + " " + Object.values(prevFields).join(" ")).replace(/\D/g, "");
  for (const k of FIELDS[task]) {
    let v = src[k];
    v = v === null || v === undefined ? null : clean(String(v), 40);
    if (!v || /^(null|none|unknown|n\/a)$/i.test(v)) v = null;
    if (v && k === "biller") { v = v.toUpperCase().replace(/\s/g, ""); if (!BILLERS.includes(v)) v = null; }
    if (v && k === "service_number") { v = v.replace(/\D/g, ""); if (v.length < 3 || !digitsInText.includes(v)) v = null; }
    if (v && k === "aadhaar_or_mobile_last4") { v = v.replace(/\D/g, "").slice(-4); if (v.length !== 4 || !digitsInText.includes(v)) v = null; }
    if (v && k === "date") v = isoDate(v);
    if (!v && src[k] && !/^(null|none|unknown|n\/a)$/i.test(String(src[k]))) dropped = true;
    if (!v && prevFields[k]) v = prevFields[k]; // keep what the user gave in an earlier turn
    f[k] = v;
  }
  const missing = FIELDS[task].filter((k) => !f[k]);
  let confirm = clean(o?.confirm_text, 200);
  if (missing.length) {
    const native = lang === "te" ? /[\u0C00-\u0C7F]/.test(text) : lang === "hi" ? /[\u0900-\u097F]/.test(text) : true;
    confirm = ASK[native ? lang : lang + "-latn"][missing[0]];
  }
  void dropped;
  return { task, lang, fields: f, missing, confirm_text: confirm };
}

const CORS_ORIGINS = new Set(["https://elricai.sbs", "https://www.elricai.sbs"]);
function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  const ok = CORS_ORIGINS.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!ok) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
const json = (status: number, body: unknown, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors } });

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, Vary: "Origin" } });
  if (req.method !== "POST") return json(405, { status: "method" }, cors);
  const apikey = req.headers.get("apikey") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!PUBLIC_KEYS.has(apikey)) return json(401, { status: "unauthorized" }, cors);
  let body: any;
  try {
    const raw = await req.text();
    if (raw.length > 8000) return json(413, { status: "too_large" }, cors);
    body = JSON.parse(raw);
  } catch { return json(400, { status: "bad_request" }, cors); }
  const text = clean(body?.text, MAX_TEXT);
  if (!text) return json(400, { status: "bad_request", field: "text" }, cors);
  const uiLang = ["te", "hi", "en"].includes(body?.ui_lang) ? body.ui_lang : "en";
  let prev: { task: string; fields: Record<string, string> } | null = null;
  if (body?.prev && TASKS.includes(body.prev.task) && body.prev.task !== "unknown") {
    const pf: Record<string, string> = {};
    for (const k of FIELDS[body.prev.task]) { const v = clean(body.prev.fields?.[k], 40); if (v) pf[k] = v; }
    prev = { task: body.prev.task, fields: pf };
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/ai_usage_hit`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_keys: [`ag:${await sha("ag:" + ip)}`], p_hour_caps: [IP_HOUR], p_day_caps: [IP_DAY] }),
    });
    if (!r.ok) throw new Error();
    const hit = await r.json();
    if (!hit?.ok) return json(429, { status: "limit", retry_after: hit?.retry_after ?? 3600 }, cors);
  } catch { return json(503, { status: "unavailable" }, cors); }

  const system = systemPrompt(uiLang, prev);
  let out = null;
  const g = await callGroq(system, text);
  if (g) out = normalize(g, text, prev?.fields ?? {}, uiLang);
  if (!out) {
    const b = await callGemini(system, text);
    if (b) out = normalize(b, text, prev?.fields ?? {}, uiLang);
  }
  if (!out) return json(503, { status: "unavailable" }, cors);
  return json(200, out, cors);
});
