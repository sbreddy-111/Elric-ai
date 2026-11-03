# Elric AI server (Supabase, free tier)

Lives in the shared Supabase project `elric-fit` (ref `hqsqpiwmozgsxiizhaml`). Only `public.ai_*` tables are ours.

- `supabase/migrations/20261103_ai_autofix.sql` – review columns, locked anon grants, pg_cron + pg_net, hourly job.
- `supabase/functions/ai-autofix` – hourly worker: up to 10 `new` feedback rows with a question → Gemini
  (`gemini-3.5-flash-lite`, free) reads candidate pages (Wikipedia API, DuckDuckGo, Gemini-suggested reference URLs)
  via the free URL-context tool. Auto-adds a fact (`ai_facts.source='auto'`) only if the answer is clearly wrong,
  it is a general public fact (not personal/opinion/Elric/founder/local/time-sensitive), ≥2 independent sites that
  Gemini actually retrieved state it, and no existing fact conflicts or is similar. Otherwise `needs_review`
  (or `rejected` when the app answer was right). Rows without a question → `needs_review`.
- Protected: POST + header `x-autofix-secret` (Edge secret `AUTOFIX_SECRET`, Vault `ai_autofix_secret`).
- Optional: Edge secret `AUTOFIX_GOOGLE_GROUNDING=1` switches to Google Search grounding (not free on this key).

Deploy: `POST https://api.supabase.com/v1/projects/<ref>/functions/deploy?slug=ai-autofix` (multipart, `verify_jwt:false`).

## Owner review
SQL editor: `select created_at, question, answer, note, ai_verdict, ai_sources from ai_feedback where review_status='needs_review' order by created_at desc;`
Approve: insert the suggested fact into `ai_facts` (source 'manual') and set the row to `auto_added`/`rejected`;
undo an auto fact: `update ai_facts set active=false where id=…;`

## Elric AI Admin (https://elricai.sbs/admin/)
- Web page `web/admin/index.html` + `web/src/admin/*` (separate Vite entry; the service worker ignores `/admin/`).
- Sign-in: owner email + 6-digit authenticator code (TOTP). Backup: "Forgot / not set up yet? Email me a link"
  (Supabase magic link, `create_user:false`; `https://elricai.sbs/admin/` is in the Auth redirect allow list).
  Session kept in localStorage with auto refresh (multi-tab safe). No shared Auth settings changed.
- `functions/admin-login` (verify_jwt off): owner email + code → RFC 6238 (SHA-1, 30 s, ±1 step), reused codes
  rejected (atomic `last_step`), 5 wrong → 15 min lock; then Admin API `generate_link` (magiclink, no email) and
  returns only `token_hash`; the page calls `/auth/v1/verify {type:'magiclink', token_hash}`. Generic errors.
- `functions/admin-totp-setup` (owner JWT checked via /auth/v1/user): status | start (pending key, 30 min) | confirm.
  The current key keeps working until a new one is confirmed. Shared TOTP code: `functions/_totp-common.ts.txt`
  (inlined into each index.ts). Reset everything: `update ai_admin_totp set secret=null, pending_secret=null where id=1;`
- `migrations/20261103_ai_admin_totp.sql`: `ai_admin_totp` (single row; RLS on, no policies, anon/authenticated revoked).
- `supabase/migrations/20261103_ai_admin.sql`: `authenticated` table grants + RLS policies `ai_*_owner_all`
  (`lower(auth.jwt()->>'email') = 'theinfo222@gmail.com'`), and `ai_admin_checker_status()` (last cron run, owner only).
  Other signed-in users (gym app) match no policy → see/change nothing. Anon grants/policies unchanged.
- "Run checker now": `ai-autofix` also accepts `Authorization: Bearer <owner JWT>` (verified via `/auth/v1/user`),
  CORS for https://elricai.sbs only. The secret never reaches the browser.

## Online answers (`functions/ai-chat`, Android 0.3.6+, web 0.3.6+)
- Optional, 18+ only, off by default in both apps (Android 0.3.9+: stored flag `age18`; web: localStorage `elric.age18`/`elric.online`).
- CORS: https://elricai.sbs and https://www.elricai.sbs only (OPTIONS preflight + headers on every response).
- Public (verify_jwt off; checks `apikey` = project publishable/anon key). POST JSON
  `{device, question, history[≤12], image?{mime,data b64}, mode, short, lang, talk, name?, study?, memory?}` →
  SSE `data: {"t":…}` … `{"done":true,"m":"a|b"}` or `{"error":"failed|blocked|limit"}`.
  Pre-stream errors: 429 `{status:'limit', scope:'device|ip|provider', retry_after}`, 400, 401, 413, 503.
- Prompt built server-side (mirrors the app's systemPrompt + relevant `ai_facts`, cached 10 min, + IDENTITY rule).
- Models: `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` on 429/5xx/404 (`AI_CHAT_MODELS` overrides), thinking minimal.
- Abuse guard: `ai_usage` (migration `20261103_ai_chat.sql`) — salted SHA-256 of device id / IP (Edge secret
  `AI_CHAT_SALT`), 30/h + 100/day per device, 60/h + 200/day per IP; rows pruned after 2 days. Body ≤1.6 MB.
  No chat text stored or logged.
- Test hooks (only with header `x-autofix-secret`): `x-elric-test: fail-primary | limit | small-cap`, `x-elric-think`.
