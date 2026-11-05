// Calculator steps for the on-device model. The model writes <calc>expression</calc> and then
// <result>value</result> (see model/data/CALC_FORMAT.md). The app stops the model right after </calc>,
// works the expression out exactly, writes the <result> itself and lets the model continue, so the
// numbers in offline answers are computed, not guessed.

import { calc, fmtNum } from './calc';

const OPEN = '<calc>', CLOSE = '</calc>';
export const MAX_CALC_STEPS = 8;

/** The first complete <calc>…</calc> that starts at or after `from` (earlier ones already have results). */
export function pendingCalc(text: string, from = 0): { end: number; expr: string } | null {
  const a = text.indexOf(OPEN, from);
  if (a < 0) return null;
  const b = text.indexOf(CLOSE, a);
  if (b < 0) return null;
  return { end: b + CLOSE.length, expr: text.slice(a + OPEN.length, b).trim() };
}

/** "<result>…</result>" for an expression (or an error note the model can recover from). */
export function resultFor(expr: string): string {
  try { return `<result>${fmtNum(calc(expr))}</result>`; } catch { return '<result>error</result>'; }
}

/**
 * Runs the model with calculator steps. gen(prefix, onText) generates the model's answer continuing after
 * prefix and reports the new text so far; stop() makes it stop early.
 */
export async function generateWithCalc(
  gen: (prefix: string, onText: (newText: string) => void) => Promise<string>,
  stop: () => void,
  onText: (full: string) => void,
  isStopped: () => boolean = () => false,
): Promise<string> {
  let done = '';
  for (let step = 0; step <= MAX_CALC_STEPS; step++) {
    let cut: { end: number; expr: string } | null = null;
    let stopping = false;
    let out = '';
    try {
      out = await gen(done, (t) => {
        if (stopping) return;
        const full = done + t;
        const p = step < MAX_CALC_STEPS ? pendingCalc(full, done.length) : null;
        if (p) { cut = p; stopping = true; stop(); onText(full.slice(0, p.end)); return; }
        onText(full);
      });
    } catch (e) {
      if (!stopping) throw e;
    }
    const full = done + out;
    if (!cut && step < MAX_CALC_STEPS) { const p = pendingCalc(full, done.length); if (p) cut = p; }
    if (!cut || isStopped()) return full;
    const c = cut as { end: number; expr: string };
    const head = full.slice(0, c.end);
    const res = resultFor(c.expr);
    done = head + res;
    onText(done);
  }
  return done;
}

const pretty = (e: string) => e.trim().replace(/\s*\*\s*/g, ' × ').replace(/\s*\/\s*/g, ' ÷ ');

/** For display and reading aloud: "<calc>a</calc><result>b</result>" → "a = b"; hides an unfinished tag. */
export function showCalc(text: string): string {
  if (!text.includes('<calc>') && !text.includes('<result>')) return text;
  return text
    .replace(/<calc>([\s\S]*?)<\/calc>\s*<result>([\s\S]*?)<\/result>/g, (_, e, r) => `${pretty(e)} = ${r.trim()}`)
    .replace(/<calc>([\s\S]*?)<\/calc>/g, (_, e) => `${pretty(e)} = …`)
    .replace(/<\/?result>/g, '')
    .replace(/<calc>([^<]*)$/, '$1')
    .replace(/<\/?c?a?l?c?$|<\/?r?e?s?u?l?t?$/, '');
}
