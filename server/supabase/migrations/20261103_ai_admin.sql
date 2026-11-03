-- Elric AI Admin (https://elricai.sbs/admin/): owner-only full access to ai_* tables.
-- Additive only. Anon grants/policies are unchanged. Other authenticated users
-- (e.g. elric-fit gym users) get table grants but NO matching policy, so RLS
-- returns/changes zero rows for them.

grant select, insert, update, delete on public.ai_feedback to authenticated;
grant select, insert, update, delete on public.ai_facts to authenticated;
grant usage, select on sequence public.ai_facts_id_seq to authenticated;

drop policy if exists ai_feedback_owner_all on public.ai_feedback;
create policy ai_feedback_owner_all on public.ai_feedback
  for all to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'theinfo222@gmail.com')
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'theinfo222@gmail.com');

drop policy if exists ai_facts_owner_all on public.ai_facts;
create policy ai_facts_owner_all on public.ai_facts
  for all to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'theinfo222@gmail.com')
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'theinfo222@gmail.com');

-- Last scheduled auto-checker run (cron tables are not readable by API roles).
create or replace function public.ai_admin_checker_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'theinfo222@gmail.com' then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select d.start_time, d.end_time, d.status into r
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   where j.jobname = 'ai-autofix-hourly' order by d.start_time desc limit 1;
  return jsonb_build_object('start_time', r.start_time, 'end_time', r.end_time, 'status', r.status);
end $$;
revoke all on function public.ai_admin_checker_status() from public, anon;
grant execute on function public.ai_admin_checker_status() to authenticated;
