// Elric AI auto-correction worker (Supabase Edge Function, Deno).
// Runs hourly from pg_cron. Reviews up to 10 'new' ai_feedback rows that have a
// question and either auto-adds a short correct fact to ai_facts (source 'auto')
// or leaves the row for the owner (needs_review / rejected).
//
// Evidence (free tier only):
//   default  : the function finds candidate pages itself (Wikipedia search API +
//              GDELT news search + DuckDuckGo HTML results, both free, no key) and Gemini reads them
//              with the free URL-context tool. Only pages Gemini actually
//              retrieved AND cites as supporting count as sources.
//   optional : set Edge secret AUTOFIX_GOOGLE_GROUNDING=1 to use Google Search
//              grounding instead (not free for keys created after the 2.5
//              models closed; 3.x grounding is paid-only).
//
// Protection: deployed with verify_jwt=false but REQUIRES POST with either
//   - header x-autofix-secret == AUTOFIX_SECRET (Edge secret; cron reads it from Vault), or
//   - Authorization: Bearer <user JWT> of the owner (theinfo222@gmail.com), checked
//     against Supabase Auth — used by the "Run checker now" button in Elric AI Admin.

const MODEL = Deno.env.get("AUTOFIX_MODEL") ?? "gemini-3.5-flash-lite";
const GOOGLE_GROUNDING = Deno.env.get("AUTOFIX_GOOGLE_GROUNDING") === "1";
const BATCH = 10;
const STAGGER_MS = 6500; // ≤ ~9 requests/minute
const LAST_START_MS = 75_000; // stop starting calls after this; finish within the 150 s limit
const CALL_TIMEOUT_MS = 60_000;
const BRAND_RE = /(elric|brahma|suravarapu|student\s*os)/i;
const SKIP_DOMAINS = /(^|\.)(duckduckgo|youtube|quora|reddit|facebook|instagram|x|twitter|tiktok|pinterest|linkedin)\.com$|wikipedia\.org$/;

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SECRET = Deno.env.get("AUTOFIX_SECRET") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OWNER_EMAIL = "theinfo222@gmail.com";
const ADMIN_ORIGINS = ["https://elricai.sbs", "http://localhost:5173"];
const UA = "ElricAI-autofix/1.0 (https://elricai.sbs)";

type Row = { id: string; question: string | null; answer: string | null; note: string | null };
type Fact = { id: number; fact: string };
type Source = { title?: string; uri: string };

function safeEq(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
// existing fact already says everything the new one says (same or superset of words)
const covers = (existing: string, f: string) => {
  const have = new Set(norm(existing).split(" "));
  const need = norm(f).split(" ").filter((w) => w.length > 2 && !["the", "and", "was", "were", "has", "for"].includes(w));
  return need.length >= 3 && need.every((w) => have.has(w));
};
const overlap = (existing: string, f: string) => {
  const have = new Set(norm(existing).split(" "));
  const need = norm(f).split(" ").filter((w) => w.length > 2);
  return need.length ? need.filter((w) => have.has(w)).length / need.length : 0;
};
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
// registrable-ish domain: last two labels (three for co.in / gov.in style)
const site = (u: string) => {
  const h = host(u).split(".");
  return h.slice(h.length > 2 && h[h.length - 2].length <= 3 ? -3 : -2).join(".");
};

const STOP = new Set("a an the of in on at to for and or is are was were be been what which who whom whose when where why how do does did can could should would will current currently latest today now news effect effects impact about tell me please give explain is it this that there their its from with by as".split(" "));
/** Short keyword query from a question (for news search). */
function keywords(q: string): string {
  const w = q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((x) => x.length >= 3 && !STOP.has(x));
  return [...new Set(w)].slice(0, 5).join(" ");
}

async function candidateUrls(q: string, hindi: boolean): Promise<string[]> {
  const query = q.slice(0, 200);
  const urls: string[] = [];
  const lang = hindi ? "hi" : "en";
  try {
    const r = await fetch(
      `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srlimit=2&format=json&srsearch=${encodeURIComponent(query)}`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) },
    );
    const j = await r.json();
    for (const s of j?.query?.search ?? []) urls.push(`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`);
  } catch { /* ignore */ }
  // Recent news (free GDELT DOC API, no key): catches events newer than Wikipedia.
  const kw = keywords(query);
  if (kw) {
    for (const qq of [kw, kw.split(" ").sort((a, b) => b.length - a.length).slice(0, 2).join(" ")]) {
      try {
        const r = await fetch(
          `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(qq)}&mode=artlist&format=json&maxrecords=15&sort=hybridrel&timespan=3months`,
          { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) },
        );
        const txt = await r.text();
        let arts: { url?: string; language?: string }[] = [];
        try { arts = JSON.parse(txt)?.articles ?? []; } catch { arts = []; }
        const seen = new Set(urls.map(site));
        let added = 0;
        for (const a of arts) {
          const u = String(a.url ?? "");
          const s = site(u);
          if (!u.startsWith("http") || !s || SKIP_DOMAINS.test(host(u)) || seen.has(s)) continue;
          if (a.language && !/english|hindi/i.test(a.language)) continue;
          seen.add(s); urls.push(u); added++;
          if (added >= 4) break;
        }
        if (added) break;
        await new Promise((res) => setTimeout(res, 5500)); // GDELT asks for ≥5 s between requests
      } catch { /* ignore */ }
    }
  }
  try {
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ElricAI-autofix/1.0)" }, signal: AbortSignal.timeout(8000),
    });
    const html = await r.text();
    const seen = new Set<string>();
    for (const m of html.matchAll(/uddg=([^&"']+)/g)) {
      const u = decodeURIComponent(m[1]);
      const s = site(u);
      if (!u.startsWith("http") || !s || SKIP_DOMAINS.test(host(u)) || seen.has(s)) continue;
      seen.add(s); urls.push(u);
      if (seen.size >= 4) break;
    }
  } catch { /* ignore */ }
  // Search engines often block cloud IPs. If we still lack non-Wikipedia pages, ask
  // Gemini (no tools) to suggest reference URLs; they only count later if Gemini's
  // URL-context tool actually retrieves them AND they state the fact.
  if (urls.filter((u) => !u.includes("wikipedia.org")).length < 2) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `List up to 4 exact URLs of reputable reference pages that are NOT Wikipedia (e.g. britannica.com, government, university, museum, major news or encyclopedia sites, each on a different site) that directly answer this question: "${query}". Only URLs you are confident exist. Reply with one URL per line, nothing else.` }] }],
          generationConfig: { temperature: 0 },
        }),
      });
      if (r.ok) {
        const j = await r.json();
        const t: string = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("\n");
        const seen = new Set(urls.map(site));
        for (const u of t.match(/https?:\/\/[^\s)>\]"']+/g) ?? []) {
          const s = site(u);
          if (!s || SKIP_DOMAINS.test(host(u)) || seen.has(s)) continue;
          seen.add(s); urls.push(u);
          if (urls.length >= 6) break;
        }
      }
    } catch { /* ignore */ }
  }
  return urls;
}

function prompt(row: Row, facts: Fact[], urls: string[]) {
  const list = facts.map((f) => `#${f.id}: ${f.fact}`).join("\n");
  const evidence = GOOGLE_GROUNDING
    ? "Use Google Search to verify."
    : `Read these pages and base your decision ONLY on what they say:\n${urls.join("\n")}`;
  return `You are a strict fact-checker for an offline study app. ${evidence}
A user flagged this app answer as possibly wrong.

QUESTION: ${row.question}
APP ANSWER: ${row.answer ?? "(not provided)"}
USER NOTE (an unverified hint, NOT evidence): ${row.note ?? "(none)"}

EXISTING FACTS the app already knows:
${list || "(none)"}

Never accept anything on the user note alone. Return:
- answer_status: "correct" | "wrong" | "partly_wrong" | "unsure"
- category: "general_public_fact" (stable, widely documented public knowledge) | "personal" | "opinion" | "elric_or_founder" (anything about Elric brands or their founder) | "local_business" | "time_sensitive" (prices, news, scores, current office holders) | "other"
- correct_fact: if wrong/partly_wrong, ONE short standalone sentence stating the correct fact, else ""
- supporting_urls: the exact URLs from the pages you read that explicitly state correct_fact (empty if none)
- lang: "en" or "hi" (language of the question)
- topic: 1-3 lowercase words
- duplicate_of: id of an existing fact that already contains the correct information (even if worded differently or with more detail), else null
- conflicts_with: id of an existing fact that contradicts correct_fact, else null
- reason: max 25 words

Reply with ONLY a JSON object with exactly these keys.`;
}

async function check(row: Row, facts: Fact[]) {
  const hindi = /[\u0900-\u097F]/.test(row.question ?? "");
  const urls = GOOGLE_GROUNDING ? [] : await candidateUrls(row.question ?? "", hindi);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt(row, facts, urls) }] }],
      tools: [GOOGLE_GROUNDING ? { google_search: {} } : { url_context: {} }],
      generationConfig: { temperature: 0 },
    }),
  });
  if (!r.ok) {
    const msg = ((await r.json().catch(() => ({})))?.error?.message ?? "").slice(0, 160);
    const e = new Error(`gemini ${r.status} ${msg}`) as Error & { status?: number };
    e.status = r.status;
    throw e;
  }
  const j = await r.json();
  const cand = j.candidates?.[0];
  const text: string = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  let v: Record<string, unknown> | null = null;
  try { v = m ? JSON.parse(m[0]) : null; } catch { v = null; }

  // Sources that really count: retrieved by Gemini (or grounding chunks) AND cited as supporting.
  let sources: Source[] = [];
  if (GOOGLE_GROUNDING) {
    for (const c of cand?.groundingMetadata?.groundingChunks ?? []) {
      if (c.web?.uri) sources.push({ title: String(c.web.title ?? ""), uri: String(c.web.uri) });
    }
  } else {
    const ok = new Set<string>(
      (cand?.urlContextMetadata?.urlMetadata ?? [])
        .filter((u: { urlRetrievalStatus?: string }) => u.urlRetrievalStatus === "URL_RETRIEVAL_STATUS_SUCCESS")
        .map((u: { retrievedUrl: string }) => u.retrievedUrl),
    );
    const cited = Array.isArray(v?.supporting_urls) ? (v!.supporting_urls as string[]) : [];
    sources = cited.filter((u) => ok.has(u) || [...ok].some((k) => decodeURI(k) === decodeURI(u))).map((uri) => ({ uri }));
  }
  const independent = GOOGLE_GROUNDING
    ? new Set(sources.map((s) => (s.title ?? "").toLowerCase().replace(/^www\./, "")).filter((d) => d.includes(".")))
    : new Set(sources.map((s) => site(s.uri)).filter(Boolean));
  return { v, sources, independent: independent.size, candidates: urls };
}

async function mark(id: string, status: string, verdict: string, sources: unknown) {
  await db(`ai_feedback?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ review_status: status, ai_verdict: verdict.slice(0, 1000), ai_sources: sources, reviewed_at: new Date().toISOString() }),
  });
}

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return ADMIN_ORIGINS.includes(o)
    ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "authorization, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" }
    : {};
}

// Owner JWT: verified by Supabase Auth itself (signature + expiry), then exact email match.
async function isOwner(req: Request): Promise<boolean> {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!m || !ANON_KEY || m[1] === ANON_KEY || m[1] === SB_KEY) return false;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${m[1]}` }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return false;
    const u = await r.json();
    return String(u?.email ?? "").toLowerCase() === OWNER_EMAIL;
  } catch { return false; }
}

Deno.serve(async (req) => {
  const ch = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });
  if (req.method !== "POST") return new Response("forbidden", { status: 403, headers: ch });
  if (!safeEq(req.headers.get("x-autofix-secret") ?? "", SECRET) && !(await isOwner(req))) {
    return new Response("forbidden", { status: 403, headers: ch });
  }
  const res = await run();
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(ch)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
});

async function run(): Promise<Response> {
  const started = Date.now();
  const out: Record<string, unknown> = { no_question: 0, checked: 0, auto_added: 0, duplicate: 0, needs_review: 0, rejected: 0, deferred: 0, errors: 0 };
  const inc = (k: string) => (out[k] = (out[k] as number) + 1);

  // 1) Rows without a question (crash/stuck reports, Q&A not shared) -> owner review, no AI call.
  const noQ = await db("ai_feedback?review_status=eq.new&or=(question.is.null,question.eq.)&select=id", {
    method: "PATCH",
    body: JSON.stringify({ review_status: "needs_review", ai_verdict: "No question shared - nothing to fact-check.", reviewed_at: new Date().toISOString() }),
  });
  out.no_question = noQ?.length ?? 0;

  // 2) Up to BATCH rows with a question, oldest first.
  const rows: Row[] = await db(
    `ai_feedback?review_status=eq.new&question=not.is.null&select=id,question,answer,note&order=created_at.asc&limit=${BATCH}`,
    { method: "GET" },
  );
  if (!rows.length || !GEMINI_KEY) return Response.json(out);
  const facts: Fact[] = await db("ai_facts?active=eq.true&select=id,fact&order=id&limit=300", { method: "GET" });
  let stop = false; // set on quota / outage / config errors: leave the rest 'new' for next hour

  async function handle(row: Row, i: number) {
    await new Promise((r) => setTimeout(r, i * STAGGER_MS));
    if (stop || Date.now() - started > LAST_START_MS) { inc("deferred"); return; }
    try {
      const { v, sources, independent, candidates } = await check(row, facts);
      inc("checked");
      const src = { model: MODEL, mode: GOOGLE_GROUNDING ? "google_search" : "url_context", sources, candidates };
      if (!v) { await mark(row.id, "needs_review", "AI reply could not be read.", src); inc("needs_review"); return; }
      const fact = String(v.correct_fact ?? "").trim();
      const summary = `${v.answer_status}/${v.category}: ${v.reason ?? ""}${fact ? ` | Suggested fact: ${fact}` : ""}`;
      const brand = BRAND_RE.test(`${row.question} ${row.answer ?? ""} ${fact}`);

      if (v.answer_status === "correct" && !brand) {
        await mark(row.id, "rejected", `App answer judged correct. ${summary}`, src); inc("rejected"); return;
      }
      // Already covered by an existing (owner-curated or earlier auto) fact: close it, add nothing.
      const dup = (v.answer_status === "wrong" || v.answer_status === "partly_wrong") && v.category === "general_public_fact" && !brand &&
        ((v.duplicate_of != null && facts.find((f) => f.id === Number(v.duplicate_of) && f.id > 0)) || (fact && facts.find((f) => f.id > 0 && covers(f.fact, fact))));
      if (dup) {
        await mark(row.id, "auto_added", `Already covered by fact #${dup.id} - nothing new added. ${summary}`, src);
        inc("duplicate"); return;
      }
      // Very similar to an existing fact but not clearly the same: let the owner decide (avoids near-duplicates/conflicts).
      const similar = facts.find((f) => f.id > 0 && fact && overlap(f.fact, fact) >= 0.6);
      if (similar && v.category === "general_public_fact" && !brand) {
        await mark(row.id, "needs_review", `Needs review (similar to fact #${similar.id}). ${summary}`, src); inc("needs_review"); return;
      }
      const eligible = (v.answer_status === "wrong" || v.answer_status === "partly_wrong") &&
        v.category === "general_public_fact" && !brand && fact.length > 10 && fact.length <= 300 &&
        independent >= 2 && v.conflicts_with == null;
      if (!eligible) {
        const why = brand ? "Elric/founder topic" : v.category !== "general_public_fact" ? `${v.category}` :
          independent < 2 ? `only ${independent} independent source(s)` :
          v.conflicts_with != null ? `conflicts with fact #${v.conflicts_with}` : "not clearly wrong-and-correctable";
        await mark(row.id, "needs_review", `Needs review (${why}). ${summary}`, src); inc("needs_review"); return;
      }
      const placeholder = { id: -1, fact }; facts.push(placeholder); // reserve before await (dedupe within batch)
      const [ins] = await db("ai_facts", {
        method: "POST",
        body: JSON.stringify({
          topic: String(v.topic ?? "general").slice(0, 60), fact, lang: v.lang === "hi" ? "hi" : "en",
          active: true, source: "auto", sources: { ...src, from_feedback: row.id },
        }),
      });
      placeholder.id = ins.id;
      await mark(row.id, "auto_added", `Added fact #${ins.id}. ${summary}`, src); inc("auto_added");
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status && (status === 429 || status >= 500 || [400, 401, 403, 404].includes(status))) {
        stop = true; inc("deferred"); out.last_error = (e as Error).message; return;
      }
      if ((e as Error).name === "TimeoutError") { inc("deferred"); return; }
      inc("errors");
      await mark(row.id, "needs_review", `Auto-check failed: ${(e as Error).message}`.slice(0, 300), null).catch(() => {});
    }
  }
  await Promise.all(rows.map(handle));
  return Response.json(out);
}
