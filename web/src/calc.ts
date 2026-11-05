// Safe calculator (own parser, never eval): used for the on-device model's <calc> steps.
// Same rules as the server's calculator tool (server/supabase/functions/ai-chat/index.ts).

/** Evaluates an arithmetic expression. Supports + - * / ^ ** % (as percent or mod), parentheses, unary -,
 *  x (as times), constants pi/e and functions sqrt cbrt abs round floor ceil ln log log10
 *  log2 exp sin cos tan asin acos atan (radians) sind cosd tand (degrees) min max pow factorial / n!.
 *  Throws on anything else. */
export function calc(expr: string): number {
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
export function fmtNum(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  const s = Number(v.toPrecision(10));
  return String(s);
}
