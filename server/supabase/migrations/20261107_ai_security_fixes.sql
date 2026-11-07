-- Elric AI server security fixes (2026-11-07). Touches ONLY ai_ tables / ai_ functions
-- (public.ai_usage, public.ai_feedback, public.ai_admin_totp, public.ai_settings) in the shared project.

-- 1) Rate limits: count first, then check, in one statement per key. The UPSERT takes the row lock on
--    (key, hour), so parallel requests for the same key are serialised and can never all see count < cap.
--    If any key is over its cap, everything this call counted is rolled back (inner block), so a refused
--    request costs nothing. Keys are processed in the order given (callers always use the same order).
create or replace function public.ai_usage_hit(
  p_keys text[], p_hour_caps int[], p_day_caps int[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  h timestamptz := date_trunc('hour', now());
  i int;
  hc int;
  dc int;
  bad_key text;
  bad_win text;
begin
  begin
    for i in 1 .. coalesce(array_length(p_keys, 1), 0) loop
      insert into ai_usage (key, hour, count) values (p_keys[i], h, 1)
        on conflict (key, hour) do update set count = ai_usage.count + 1
        returning count into hc;
      select coalesce(sum(count), 0) into dc
        from ai_usage where key = p_keys[i] and hour > h - interval '24 hours';
      if hc > p_hour_caps[i] then bad_key := p_keys[i]; bad_win := 'hour'; raise exception using errcode = 'P0429'; end if;
      if dc > p_day_caps[i] then bad_key := p_keys[i]; bad_win := 'day'; raise exception using errcode = 'P0429'; end if;
    end loop;
  exception when sqlstate 'P0429' then
    -- the inner block's counts are rolled back; variables keep their values
    return jsonb_build_object('ok', false, 'scope', split_part(bad_key, ':', 1), 'window', bad_win,
      'retry_after', case when bad_win = 'hour'
        then greatest(60, extract(epoch from (h + interval '1 hour' - now()))::int) else 3600 end);
  end;
  if random() < 0.05 then
    delete from ai_usage where hour < now() - interval '2 days';
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ai_usage_hit(text[], int[], int[]) from public, anon, authenticated;
grant execute on function public.ai_usage_hit(text[], int[], int[]) to service_role;

-- 2) Give back one use (e.g. an image request that was blocked or failed upstream).
create or replace function public.ai_usage_refund(p_keys text[])
returns void language sql security definer set search_path = public as $$
  update ai_usage set count = greatest(count - 1, 0)
   where key = any(p_keys) and hour = date_trunc('hour', now());
$$;
revoke all on function public.ai_usage_refund(text[]) from public, anon, authenticated;
grant execute on function public.ai_usage_refund(text[]) to service_role;

-- 3) Admin TOTP: count a wrong code atomically (no read-then-write race). 10 wrong codes in a row
--    (from any IP) lock sign-in for 30 minutes; admin-login also throttles each IP to 5 tries/hour,
--    so one IP alone can never lock the owner out. Returns true when this failure set the lock.
create or replace function public.ai_admin_totp_fail()
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update ai_admin_totp set failed_count = failed_count + 1, updated_at = now()
   where id = 1 returning failed_count into n;
  if n >= 10 then
    update ai_admin_totp set failed_count = 0, locked_until = now() + interval '30 minutes', updated_at = now()
     where id = 1;
    return true;
  end if;
  return false;
end $$;
revoke all on function public.ai_admin_totp_fail() from public, anon, authenticated;
grant execute on function public.ai_admin_totp_fail() to service_role;

-- 4) Feedback: anon can no longer choose id or created_at (column defaults gen_random_uuid() / now()
--    always apply), and text fields have length limits (the apps already cap at 4000 / 120).
revoke insert on public.ai_feedback from anon;
grant insert (kind, app_version, platform, device, backend, model, mode, question, answer, note)
  on public.ai_feedback to anon;
alter table public.ai_feedback drop constraint if exists ai_feedback_len_chk;
alter table public.ai_feedback add constraint ai_feedback_len_chk check (
  coalesce(char_length(question), 0) <= 4000 and coalesce(char_length(answer), 0) <= 4000 and
  coalesce(char_length(note), 0) <= 4000 and
  coalesce(char_length(kind), 0) <= 40 and coalesce(char_length(app_version), 0) <= 200 and
  coalesce(char_length(platform), 0) <= 200 and coalesce(char_length(device), 0) <= 200 and
  coalesce(char_length(backend), 0) <= 200 and coalesce(char_length(model), 0) <= 200 and
  coalesce(char_length(mode), 0) <= 200);

-- 5) Auto-correction: proven facts wait for the owner's approval (Review tab) instead of going live.
update public.ai_settings set enabled = false where key = 'auto_add';
