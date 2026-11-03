-- Elric AI auto-correction: review columns + locked-down anon access.
-- Touches ONLY public.ai_feedback and public.ai_facts (shared elric-fit project).

alter table public.ai_feedback
  add column if not exists review_status text not null default 'new'
    check (review_status in ('new','auto_added','needs_review','rejected')),
  add column if not exists ai_verdict text,
  add column if not exists ai_sources jsonb,
  add column if not exists reviewed_at timestamptz;

create index if not exists ai_feedback_review_status_idx
  on public.ai_feedback (review_status, created_at);

alter table public.ai_facts
  add column if not exists source text not null default 'manual'
    check (source in ('manual','auto')),
  add column if not exists sources jsonb;

-- Keep anon exactly as before: INSERT only the original feedback columns
-- (so it can never set review_status / ai_* / reviewed_at), SELECT only the
-- original fact columns (RLS still limits to active rows).
revoke insert on public.ai_feedback from anon;
grant insert (id, created_at, kind, app_version, platform, device, backend,
              model, mode, question, answer, note) on public.ai_feedback to anon;
revoke select on public.ai_facts from anon;
grant select (id, updated_at, topic, fact, lang, active) on public.ai_facts to anon;

-- Scheduler (free): pg_cron + pg_net. The shared secret lives in Supabase Vault
-- as 'ai_autofix_secret' and as Edge Function secret AUTOFIX_SECRET.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Hourly at :17 (applied 2026-11-03 as cron job 'ai-autofix-hourly'):
select cron.schedule('ai-autofix-hourly', '17 * * * *', $job$
  select net.http_post(
    url := 'https://hqsqpiwmozgsxiizhaml.supabase.co/functions/v1/ai-autofix',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-autofix-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ai_autofix_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
$job$);
