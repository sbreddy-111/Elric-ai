// Elric AI Admin – tiny Supabase client (authenticator-code sign-in + email link backup, PostgREST), no dependencies.
export const SB_URL = 'https://hqsqpiwmozgsxiizhaml.supabase.co';
export const SB_KEY = 'sb_publishable_Yv1D_ZUk38W3-ZvYdoAD8A_-fx5gPCT'; // public key (same as the apps)
export const OWNER = 'theinfo222@gmail.com';
const STORE = 'elric-admin-session';
export const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, '');

export type Session = { access_token: string; refresh_token: string; expires_at: number; email: string };

export type Feedback = {
  id: string; created_at: string; kind: string; app_version: string | null; platform: string | null;
  device: string | null; backend: string | null; model: string | null; mode: string | null;
  question: string | null; answer: string | null; note: string | null; review_status: string;
  ai_verdict: string | null; ai_sources: unknown; reviewed_at: string | null;
};
export type Fact = {
  id: number; updated_at: string; topic: string | null; fact: string; lang: string | null;
  active: boolean; source: string; sources: unknown;
};

let session: Session | null = load();
let refreshing: Promise<void> | null = null;

function load(): Session | null {
  try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; }
}
function save(s: Session | null) {
  session = s;
  if (s) localStorage.setItem(STORE, JSON.stringify(s)); else localStorage.removeItem(STORE);
}
export const getSession = () => session;
export const isOwner = (email?: string) => (email || '').trim().toLowerCase() === OWNER;

async function authFetch(path: string, init: RequestInit = {}, token?: string) {
  const r = await fetch(SB_URL + '/auth/v1/' + path, {
    ...init,
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(init.headers || {}) },
  });
  const t = await r.text();
  let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { /* text */ }
  if (!r.ok) throw new ApiError(j?.msg || j?.error_description || j?.message || `Sign-in error (${r.status})`, r.status);
  return j;
}

export class ApiError extends Error { constructor(m: string, public status = 0) { super(m); } }

/** Main sign-in: owner email + 6-digit authenticator code → one-time token → session (kept on this device). */
export async function signInWithCode(email: string, code: string) {
  const r = await fetch(SB_URL + '/functions/v1/admin-login', {
    method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.replace(/\s/g, '') }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.token_hash) throw new ApiError(j?.error || 'Please try again a bit later.', r.status);
  const v = await authFetch('verify', { method: 'POST', body: JSON.stringify({ type: 'magiclink', token_hash: j.token_hash }) });
  return fromTokens(v.access_token, v.refresh_token, v.expires_in);
}

/** Authenticator setup (owner session): status | start | confirm. */
export async function totpSetup(action: 'status' | 'start' | 'confirm', code?: string): Promise<any> {
  const s = await ensureFresh();
  if (!s) throw new ApiError('Signed out', 401);
  const r = await fetch(SB_URL + '/functions/v1/admin-totp-setup', {
    method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, code }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(j?.error || 'Something went wrong. Please try again a bit later.', r.status);
  return j;
}

/** Backup: one-time sign-in link by email ("Forgot password?"). */
export async function sendMagicLink(email: string) {
  await authFetch('otp?redirect_to=' + encodeURIComponent(REDIRECT), {
    method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), create_user: false }),
  });
}

async function fromTokens(access_token: string, refresh_token: string, expires_in: number): Promise<Session> {
  const u = await authFetch('user', {}, access_token);
  const s = { access_token, refresh_token, expires_at: Math.floor(Date.now() / 1000) + (expires_in || 3600), email: String(u?.email || '') };
  save(s);
  return s;
}

/** Handles the #access_token=… redirect from the magic link. Returns an error message if the link failed. */
export async function consumeRedirect(): Promise<string | null> {
  if (!/(access_token|error)=/.test(location.hash)) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  if (p.get('error') || p.get('error_description')) {
    // A second open of an already-used link (e.g. Gmail → Safari, then "Open in Chrome") must not kick out a valid session.
    if (session) return null;
    const d = (p.get('error_description') || p.get('error') || '').replace(/\+/g, ' ');
    return /expired|invalid|otp/i.test(d + (p.get('error_code') || ''))
      ? 'That link was already used. Each link works once, in the first browser that opens it, so you may already be signed in there (for example Safari). To sign in here, send a new link and open it in this browser.'
      : d;
  }
  const at = p.get('access_token'), rt = p.get('refresh_token');
  if (!at || !rt) return null;
  try { await fromTokens(at, rt, Number(p.get('expires_in') || 3600)); return null; }
  catch (e) { return (e as Error).message; }
}

export async function ensureFresh(): Promise<Session | null> {
  const stored = load();
  if (stored && (!session || stored.expires_at > session.expires_at)) session = stored; // another tab refreshed
  if (!session) return null;
  if (session.expires_at - 90 > Date.now() / 1000) return session;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const j = await authFetch('token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session!.refresh_token }) });
        await fromTokens(j.access_token, j.refresh_token, j.expires_in);
      } catch (e) {
        const st = (e as ApiError).status, other = load();
        if (other && other.refresh_token !== session?.refresh_token) { session = other; return; } // refreshed in another tab
        if (st && st < 500 && st !== 429) save(null);
        throw e;
      } finally { refreshing = null; }
    })();
  }
  await refreshing;
  return session;
}

export async function signOut() {
  const s = session; save(null);
  if (s) { try { await authFetch('logout?scope=local', { method: 'POST' }, s.access_token); } catch { /* ignore */ } }
}

/** PostgREST call as the signed-in owner. */
export async function rest<T = any>(path: string, init: RequestInit & { count?: boolean } = {}): Promise<{ data: T; count: number | null }> {
  const s = await ensureFresh();
  if (!s) throw new ApiError('Signed out', 401);
  const headers: Record<string, string> = {
    apikey: SB_KEY, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> || {}),
  };
  if (init.count) headers.Prefer = [headers.Prefer, 'count=exact'].filter(Boolean).join(',');
  const r = await fetch(SB_URL + '/rest/v1/' + path, { ...init, headers });
  const t = await r.text();
  let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { /* text */ }
  if (!r.ok) {
    if (r.status === 401) save(null);
    throw new ApiError(j?.message || `Request failed (${r.status})`, r.status);
  }
  const cr = r.headers.get('content-range');
  const count = cr && cr.includes('/') && cr.split('/')[1] !== '*' ? Number(cr.split('/')[1]) : null;
  return { data: j as T, count };
}

export async function countOf(table: string, filter: string) {
  const { count } = await rest(`${table}?select=id&${filter}`, { method: 'HEAD', count: true, headers: { Range: '0-0' } });
  return count ?? 0;
}

/** Runs the ai-autofix checker now with the owner's session (the server secret never reaches the browser). */
export async function runChecker(): Promise<Record<string, unknown>> {
  const s = await ensureFresh();
  if (!s) throw new ApiError('Signed out', 401);
  const r = await fetch(SB_URL + '/functions/v1/ai-autofix', {
    method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: '{}',
  });
  if (r.status === 403) throw new ApiError('Not allowed to run the checker.', 403);
  if (!r.ok) throw new ApiError(`Checker failed (${r.status})`, r.status);
  return r.json();
}
