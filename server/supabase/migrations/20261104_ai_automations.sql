-- Elric AI Admin automations (2026-11-04).
-- Touches ONLY ai_* objects in the shared project (elric-fit tables are untouched).
-- Security model unchanged: anon gets nothing new; the owner (JWT email
-- theinfo222@gmail.com) reads everything and may only flip automation switches;
-- the ai-autofix Edge Function (service role) writes events, settings results and rollups.

-- 1) Review statuses: add 'duplicate' (+ link to the first report), re-check counter.
alter table public.ai_feedback drop constraint if exists ai_feedback_review_status_check;
alter table public.ai_feedback add constraint ai_feedback_review_status_check
  check (review_status in ('new','auto_added','needs_review','rejected','duplicate'));
alter table public.ai_feedback
  add column if not exists duplicate_of uuid,
  add column if not exists recheck_count integer not null default 0;
create index if not exists ai_feedback_duplicate_of_idx on public.ai_feedback (duplicate_of) where duplicate_of is not null;

-- 2) Time-sensitive facts switch themselves off after expires_at (null = never).
alter table public.ai_facts add column if not exists expires_at timestamptz;
create index if not exists ai_facts_expires_idx on public.ai_facts (expires_at) where expires_at is not null and active;

-- 3) Automation switches + last result (owner can flip `enabled` only).
create table if not exists public.ai_settings (
  key          text primary key,
  enabled      boolean not null default true,
  last_run_at  timestamptz,
  last_result  text,
  updated_at   timestamptz not null default now()
);
insert into public.ai_settings (key) values
  ('checker'), ('auto_add'), ('duplicates'), ('spam'), ('recheck'), ('expiry'), ('daily_summary')
on conflict (key) do nothing;

-- 4) Automation activity feed (service role writes, owner reads).
create table if not exists public.ai_admin_events (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  automation  text not null,
  action      text not null,
  message     text not null check (char_length(message) <= 500),
  ref         text,
  details     jsonb
);
create index if not exists ai_admin_events_created_idx on public.ai_admin_events (created_at desc);

-- 5) Daily online-question totals (ai_usage only keeps 2 days).
create table if not exists public.ai_usage_daily (
  day        date primary key,
  questions  integer not null default 0,
  devices    integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.ai_settings     enable row level security;
alter table public.ai_admin_events enable row level security;
alter table public.ai_usage_daily  enable row level security;
revoke all on public.ai_settings, public.ai_admin_events, public.ai_usage_daily from anon, authenticated;
grant select on public.ai_settings, public.ai_admin_events, public.ai_usage_daily to authenticated;
grant update (enabled, updated_at) on public.ai_settings to authenticated;

drop policy if exists ai_settings_owner_read on public.ai_settings;
create policy ai_settings_owner_read on public.ai_settings for select to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'theinfo222@gmail.com');
drop policy if exists ai_settings_owner_toggle on public.ai_settings;
create policy ai_settings_owner_toggle on public.ai_settings for update to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'theinfo222@gmail.com')
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'theinfo222@gmail.com');
drop policy if exists ai_admin_events_owner_read on public.ai_admin_events;
create policy ai_admin_events_owner_read on public.ai_admin_events for select to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'theinfo222@gmail.com');
drop policy if exists ai_usage_daily_owner_read on public.ai_usage_daily;
create policy ai_usage_daily_owner_read on public.ai_usage_daily for select to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'theinfo222@gmail.com');

-- 6) Roll ai_usage (device keys) into ai_usage_daily, IST days. Service role only.
create or replace function public.ai_usage_rollup()
returns void language sql security definer set search_path = '' as $$
  insert into public.ai_usage_daily (day, questions, devices, updated_at)
  select (u.hour at time zone 'Asia/Kolkata')::date, sum(u.count)::int, count(distinct u.key)::int, now()
    from public.ai_usage u
   where u.key like 'd:%' and u.hour >= now() - interval '36 hours'
   group by 1
  on conflict (day) do update
    set questions = greatest(public.ai_usage_daily.questions, excluded.questions),
        devices   = greatest(public.ai_usage_daily.devices, excluded.devices),
        updated_at = now();
$$;
revoke all on function public.ai_usage_rollup() from public, anon, authenticated;
grant execute on function public.ai_usage_rollup() to service_role;

-- 7) Owner-only stats for the Overview: online questions today + last 7 IST days.
create or replace function public.ai_admin_usage()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date; res jsonb;
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'theinfo222@gmail.com' then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  with live as (
    select (hour at time zone 'Asia/Kolkata')::date d, sum(count)::int q, count(distinct key)::int dv
      from public.ai_usage where key like 'd:%' group by 1
  ), days as (
    select g::date d from generate_series(today - 6, today, interval '1 day') g
  )
  select jsonb_build_object(
    'today', coalesce((select greatest(l.q, coalesce(x.questions, 0)) from live l left join public.ai_usage_daily x on x.day = l.d where l.d = today), 0),
    'today_devices', coalesce((select l.dv from live l where l.d = today), 0),
    'days', (select jsonb_agg(jsonb_build_object('day', days.d,
               'questions', greatest(coalesce(l.q, 0), coalesce(x.questions, 0))) order by days.d)
               from days left join live l on l.d = days.d left join public.ai_usage_daily x on x.day = days.d)
  ) into res;
  return res;
end $$;
revoke all on function public.ai_admin_usage() from public, anon;
grant execute on function public.ai_admin_usage() to authenticated;
