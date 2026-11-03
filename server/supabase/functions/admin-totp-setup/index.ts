// ---- shared by admin-login and admin-totp-setup (copied into each at deploy) ----
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SR_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OWNER_EMAIL = "theinfo222@gmail.com";
const ORIGINS = ["https://elricai.sbs", "http://localhost:5173"];

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
async function recordFailure(row: TotpRow) {
  const n = (row.failed_count ?? 0) + 1;
  const lock = n >= 5;
  await db("ai_admin_totp?id=eq.1", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
    failed_count: lock ? 0 : n, ...(lock ? { locked_until: new Date(Date.now() + 15 * 60_000).toISOString() } : {}), updated_at: new Date().toISOString(),
  }) });
}
const isLocked = (row: TotpRow) => !!row.locked_until && new Date(row.locked_until).getTime() > Date.now();
// ---- end shared ----

// Elric AI Admin: set up / reset the authenticator app. Owner JWT required (checked with Supabase Auth).
// {action:"status"} → {active, pending}
// {action:"start"}  → new pending secret {secret, uri}; the current one keeps working until confirmed
// {action:"confirm", code} → activates the pending secret if the code matches

async function ownerOk(req: Request) {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!m || m[1] === ANON_KEY || m[1] === SR_KEY) return false;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY || SR_KEY, Authorization: `Bearer ${m[1]}` } });
    if (!r.ok) return false;
    return String((await r.json())?.email ?? "").toLowerCase() === OWNER_EMAIL;
  } catch { return false; }
}

Deno.serve(async (req) => {
  const ch = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });
  if (req.method !== "POST" || !(await ownerOk(req))) return json({ error: "Not authorised" }, 403, ch);
  try {
    const b = await req.json().catch(() => ({}));
    const row = await getRow();
    if (!row) return json({ error: "Not ready" }, 500, ch);
    if (b?.action === "status") return json({ active: !!row.secret, pending: !!row.pending_secret }, 200, ch);
    if (b?.action === "start") {
      const secret = b32encode(crypto.getRandomValues(new Uint8Array(20)));
      await db("ai_admin_totp?id=eq.1", { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ pending_secret: secret, pending_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      const uri = `otpauth://totp/${encodeURIComponent("Elric AI Admin:" + OWNER_EMAIL)}?secret=${secret}&issuer=${encodeURIComponent("Elric AI Admin")}&algorithm=SHA1&digits=6&period=30`;
      return json({ secret, uri }, 200, ch);
    }
    if (b?.action === "confirm") {
      const code = String(b?.code ?? "").replace(/\s/g, "");
      const fresh = row.pending_at && Date.now() - new Date(row.pending_at).getTime() < 30 * 60_000;
      if (!row.pending_secret || !fresh) return json({ error: "Setup expired. Please start again." }, 400, ch);
      if (isLocked(row)) return json({ error: "Please try again a bit later." }, 429, ch);
      const step = await matchStep(row.pending_secret, code);
      if (!step) { await recordFailure(row); return json({ error: "That code didn't match. Check the app and try again." }, 400, ch); }
      // new secret: reset the reuse marker to this step
      await db("ai_admin_totp?id=eq.1", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
        secret: row.pending_secret, pending_secret: null, pending_at: null, last_step: step, failed_count: 0, locked_until: null, updated_at: new Date().toISOString(),
      }) });
      return json({ active: true }, 200, ch);
    }
    return json({ error: "Unknown action" }, 400, ch);
  } catch { return json({ error: "Something went wrong. Please try again a bit later." }, 500, ch); }
});
