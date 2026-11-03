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
- Sign-in: Supabase Auth magic link, owner email only (`theinfo222@gmail.com`, existing user; `create_user:false`).
  `https://elricai.sbs/admin/` is in the Auth redirect allow list.
- `supabase/migrations/20261103_ai_admin.sql`: `authenticated` table grants + RLS policies `ai_*_owner_all`
  (`lower(auth.jwt()->>'email') = 'theinfo222@gmail.com'`), and `ai_admin_checker_status()` (last cron run, owner only).
  Other signed-in users (gym app) match no policy → see/change nothing. Anon grants/policies unchanged.
- "Run checker now": `ai-autofix` also accepts `Authorization: Bearer <owner JWT>` (verified via `/auth/v1/user`),
  CORS for https://elricai.sbs only. The secret never reaches the browser.
