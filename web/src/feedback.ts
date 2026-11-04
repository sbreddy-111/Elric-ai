// "Wrong answer" reports (web). Mirrors the Android app (ElricCloud.sendFeedback + baseRow):
// one row POSTed to the ai_feedback table with the public key (anon can only INSERT there).
// Sent only when the user taps Send on the report sheet: that one question and answer, nothing else.
import { SB_URL, CHAT_KEY } from './online';

export type Row = Record<string, string | null | undefined>;

const LONG = new Set(['question', 'answer', 'note']);

/** Short browser + OS, e.g. "Chrome 130 · Android 14". */
export function shortUA(ua = navigator.userAgent): string {
  const os = /iPhone|iPad|iPod/.test(ua) ? `iOS ${(ua.match(/OS (\d+)[_.](\d+)/) || []).slice(1, 3).join('.')}`.trim()
    : /Android/.test(ua) ? `Android ${(ua.match(/Android ([\d.]+)/) || [])[1] || ''}`.trim()
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  let m: RegExpMatchArray | null = null;
  for (const n of ['Edg', 'OPR', 'SamsungBrowser', 'CriOS', 'FxiOS', 'Firefox', 'Chrome']) if ((m = ua.match(new RegExp(`(${n})/(\\d+)`)))) break;
  const names: Record<string, string> = { Edg: 'Edge', OPR: 'Opera', SamsungBrowser: 'Samsung Internet', CriOS: 'Chrome', FxiOS: 'Firefox' };
  const br = m ? `${names[m[1]] || m[1]} ${m[2]}` : /Safari\//.test(ua) ? `Safari ${(ua.match(/Version\/(\d+)/) || [])[1] || ''}`.trim() : '';
  return [br, os].filter(Boolean).join(' · ') || 'browser';
}

export function device(ua = navigator.userAgent): string {
  if (/iPad/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  const a = ua.match(/Android [\d.]+; ([^;)]+)/);
  if (a) return a[1].replace(/ Build\/.*/, '').trim() || 'Android';
  return /Mobile/.test(ua) ? 'Phone' : 'Computer';
}

/** Caps text fields at 4000 characters and the rest at 120, and drops empty values (same as Android). */
export function clean(row: Row): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) if (v != null && v !== '') out[k] = String(v).slice(0, LONG.has(k) ? 4000 : 120);
  return out;
}

/** Stores one feedback row. Returns true when the server accepted it. */
export async function send(row: Row): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`${SB_URL}/rest/v1/ai_feedback`, {
      method: 'POST',
      headers: { apikey: CHAT_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(clean(row)),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
