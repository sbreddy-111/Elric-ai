// ---- shared by admin-login and admin-totp-setup (copied into each at deploy) ----
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SR_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OWNER_EMAIL = "theinfo222@gmail.com";
const ORIGINS = ["https://elricai.sbs", "https://www.elricai.sbs"];

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return ORIGINS.includes(o)
    ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
        "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" }
    : {};
}
const json = (body: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32encode(b: Uint8Array) {
  let bits = 0, v = 0, out = "";
  for (const x of b) { v = (v << 8) | x; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(v << (5 - bits)) & 31];
  return out;
}
function b32decode(s: string) {
  const c = s.replace(/[\s=]/g, "").toUpperCase(); const out: number[] = []; let bits = 0, v = 0;
  for (const ch of c) { const i = B32.indexOf(ch); if (i < 0) throw new Error("bad key"); v = (v << 5) | i; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
async function hotp(secret: string, counter: number) {
  const key = await crypto.subtle.importKey("raw", b32decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new Uint8Array(8); let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 255; c = Math.floor(c / 256); }
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}
/** RFC 6238 (SHA-1, 30 s, 6 digits), ±1 step. Returns the matching step or 0. */
async function matchStep(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return 0;
  const t = Math.floor(now / 30000);
  for (const s of [t, t - 1, t + 1]) {
    const exp = await hotp(secret, s);
    let d = 0; for (let i = 0; i < 6; i++) d |= exp.charCodeAt(i) ^ code.charCodeAt(i);
    if (d === 0) return s;
  }
  return 0;
}

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(8000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}`);
  return t ? JSON.parse(t) : null;
}
type TotpRow = { secret: string | null; pending_secret: string | null; pending_at: string | null; last_step: number; failed_count: number; locked_until: string | null };
async function getRow(): Promise<TotpRow | null> {
  const rows = await db("ai_admin_totp?id=eq.1&select=secret,pending_secret,pending_at,last_step,failed_count,locked_until");
  return rows?.[0] ?? null;
}
/** Atomically accept a step only if it is newer than the last accepted one (blocks reuse/races). */
async function claimStep(step: number, extra: Record<string, unknown> = {}) {
  const rows = await db(`ai_admin_totp?id=eq.1&last_step=lt.${step}`, {
    method: "PATCH", body: JSON.stringify({ last_step: step, failed_count: 0, locked_until: null, updated_at: new Date().toISOString(), ...extra }),
  });
  return Array.isArray(rows) && rows.length === 1;
}
/** Counts a wrong code atomically in SQL (ai_admin_totp_fail: 10 in a row → 30 min lock), so parallel
 *  guesses can't share one read of failed_count. */
async function recordFailure() {
  await db("rpc/ai_admin_totp_fail", { method: "POST", body: "{}" });
}
/** Per-IP throttle for sign-in tries (ai_usage keys "al:<hash>", 5/hour, 20/day). false = over the limit. */
async function ipAllowed(req: Request): Promise<boolean> {
  const ip = (req.headers.get("cf-connecting-ip") ?? "").trim() || (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode((Deno.env.get("AI_CHAT_SALT") ?? "") + "|al:" + ip));
  const h = Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const hit = await db("rpc/ai_usage_hit", { method: "POST", body: JSON.stringify({ p_keys: [`al:${h}`], p_hour_caps: [5], p_day_caps: [20] }) });
  return !!hit?.ok;
}
const isLocked = (row: TotpRow) => !!row.locked_until && new Date(row.locked_until).getTime() > Date.now();
// ---- end shared ----

// Elric AI Admin sign-in: owner email + 6-digit authenticator code → one-time magic-link token hash
// (generated with the Admin API, no email sent). The page exchanges it with /auth/v1/verify for a session.
// Public (verify_jwt=false). Generic errors only. Each IP: 5 tries/hour, 20/day. 10 wrong codes in a row (any IP)
// → 30 min lockout, counted atomically in SQL. Codes can't be reused.

const BAD = "That code didn't work. Check your email and the 6-digit code, then try again.";
const LATER = "Please try again a bit later.";

Deno.serve(async (req) => {
  const ch = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });
  if (req.method !== "POST") return json({ error: BAD }, 405, ch);
  let email = "", code = "";
  try { const b = await req.json(); email = String(b?.email ?? "").trim().toLowerCase(); code = String(b?.code ?? "").replace(/\s/g, ""); } catch { /* bad body */ }
  try {
    if (!(await ipAllowed(req))) return json({ error: LATER }, 429, ch);
    if (email !== OWNER_EMAIL || !/^\d{6}$/.test(code)) { await new Promise((r) => setTimeout(r, 400)); return json({ error: BAD }, 401, ch); }
    const row = await getRow();
    if (!row?.secret) return json({ error: BAD }, 401, ch);
    if (isLocked(row)) return json({ error: LATER }, 429, ch);
    const step = await matchStep(row.secret, code);
    if (!step || step <= row.last_step) { await recordFailure(); return json({ error: BAD }, 401, ch); }
    if (!(await claimStep(step))) return json({ error: BAD }, 401, ch);
    const r = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", email: OWNER_EMAIL, redirect_to: "https://elricai.sbs/admin/" }),
    });
    if (!r.ok) return json({ error: LATER }, 503, ch);
    const j = await r.json();
    const token_hash = j?.hashed_token ?? j?.properties?.hashed_token;
    if (!token_hash) return json({ error: LATER }, 503, ch);
    return json({ token_hash }, 200, ch);
  } catch { return json({ error: LATER }, 500, ch); }
});
