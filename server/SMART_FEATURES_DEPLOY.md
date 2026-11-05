# Smart features: merge-day deploy steps (branch `feature/smart-features`)

This is released together with Elric Lite Round 6, in one merge. Nothing on this branch is deployed yet,
with one exception: on 2026-11-06 at 00:47 IST the answer-cache migration was applied live, before the
owner paused the work. Its tables are empty and nothing uses them.

## What's in the branch
| Feature | Where |
|---|---|
| Hard-question routing: online first, longer wait, one retry, offline fallback with a tip | `web/src/smart.ts`, `main.ts` (`send`) |
| Calculator: online = Groq tool `calculator` (safe parser, no eval); offline = `<calc>expr</calc>` → app writes `<result>v</result>` | `ai-chat/index.ts` (`calc`, `CALC_TOOL`), `web/src/calc.ts`, `web/src/calcloop.ts` |
| Web search for fact questions (global budget 50/h, 300/day, waits ≤12 s for Groq token room), source links | `ai-chat` (`needsSearch`, `groqSearchRoom`, SSE `{"src":[…]}`), `main.ts` (`extras`) |
| Image making ("make an image of …") | new function `ai-image` (Cloudflare Workers AI FLUX.1 schnell), `online.ts` (`makeImage`), `main.ts` (`answerImage`) |
| Mermaid diagrams (lazy-loaded; code shown if they fail) and code blocks | `web/src/diagram.ts`, `main.ts` (`md`) |
| PDF/TXT in the attach (camera) button: text read in the browser (pdf.js, lazy-loaded); ≤9,000 chars online, 700/1,800 chars offline | `web/src/file.ts`, `main.ts`, `ai-chat` (`doc`) |
| Read aloud 🔊 (already in 0.4.6; now also reads calculator steps cleanly) | `voice.ts` |
| Answer cache (owner-approved) + admin Cache tab | `ai-chat` (`cacheable`, `cacheGet`, `cacheNote`), migration `20261106_ai_answer_cache.sql`, `web/src/admin/main.ts` (`viewCache`) |
| Privacy page + Hindi/English strings | `web/public/privacy.html`, `web/src/i18n.ts` |

## Steps
1. **Model:** if the Round 6 `.task` file writes `<calc>`, set `CALC_TAGS = true` in `web/src/engine.ts`. Check
   `model/data/CALC_FORMAT.md` against `CALC_PROMPT` and `calcloop.ts`, which expect `<calc>expr</calc>` then `<result>value</result>`.
2. **Cloudflare token (owner):** dash.cloudflare.com → My Profile → API Tokens → Create token → template
   "Workers AI" (or custom: Account → Workers AI → Read; the template also adds Edit) for account
   `966d6220d24ff6b9d1d3332f4d5776e8`. The token on file now gets 401 on Workers AI.
3. **Edge secrets** (Supabase API `POST /v1/projects/hqsqpiwmozgsxiizhaml/secrets`, body `[{"name":…,"value":…}]`):
   `CF_ACCOUNT_ID`, `CF_AI_TOKEN`. `GROQ_API_KEY` and `AI_CHAT_SALT` already exist (ai-image uses them too).
4. **DB:** run `server/supabase/migrations/20261106_ai_answer_cache.sql` (safe to re-run: `if not exists` /
   `create or replace` / `drop policy if exists`). Check that anon gets 401 on `ai_answer_cache`, `ai_answer_cache_seen` and `rpc/ai_cache_get`.
5. **Functions:**
   - `ai-chat`: `/workspace/work/deploychat.sh`, which keeps `verify_jwt:false`.
   - `ai-image`: same API with `slug=ai-image`, `{"name":"ai-image","entrypoint_path":"index.ts","verify_jwt":false}`.
6. **Smoke tests** (publishable key in `web/src/online.ts`):
   - train question → `x-elric-src: gc`, 2:10 PM;
   - "price after 20% markup is 480, original?" → 400;
   - "current CM of Andhra Pradesh" → `g2` plus a `src` event;
   - "Make an image of a temple" to `ai-image` → `status: ok`;
   - a photo still goes to Gemini (`gem`).
7. **Web:** pull and rebase `main` and `gh-pages`, merge the branch, check `APP_VERSION` (0.4.7 on the branch) and the
   `sw.js` cache version (v17), then `npm run build`. Deploy gh-pages by the usual rules: keep `.git`, `CNAME`, `/agent/` and
   `delete-data.html`. The build makes `index.html`, `assets/`, `admin/`, `privacy.html`, `terms.html`, `sw.js`, icons and the manifest.
   GitHub Pages must serve `assets/pdf.worker.min-*.mjs` as JavaScript; check that one PDF opens.
8. **Admin:** elricai.sbs/admin → Cache tab. Candidates appear after 3 devices ask the same general question.

## Limits and notes
- Groq free tier: 1,000 requests/day and 8,000 tokens/min shared. One web search with a page open uses about 8.5k tokens,
  so about one search per minute. If none fits, the answer says it may be out of date, or Gemini answers after a Groq 429.
- Calculator rounds: at most 4 Groq requests per answer.
- Images: 5/h and 10/day per device, 10/h and 20/day per IP, 40/h and 100/day overall (FLUX schnell free allowance ≈ 170/day).
  The prompt block list is in `ai-image/index.ts`. Hindi/Telugu prompts are translated by Groq first.
- Answer cache: only first-turn questions with no photo, file, memory or class. Not cached: personal (I/my/मेरा…),
  numbers of 5+ digits, links, @, names (two capitalised words) or news words. Device counting uses hashes only.
- Rollback: redeploy `ai-chat` from `main`, delete function `ai-image`, redeploy gh-pages from `main`.

## Tests (sandbox)
- UI: `/workspace/work/uitest` → `node run.mjs` … `run8.mjs` (jsdom; mermaid/pdf.js mocked via `libmock.mjs`).
  `run7` covers routing, sources, diagrams, files and read aloud; `run8` covers offline calculator, images and the admin Cache tab.
- Server locally: `/workspace/work/smart/runlocal.sh` (ai-chat against mock Supabase `mocksb.ts`, real Groq);
  `mockimg.ts` is a mock Supabase + Cloudflare for `ai-image`.
