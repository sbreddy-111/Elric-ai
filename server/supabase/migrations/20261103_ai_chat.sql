-- Elric AI online answers (Edge Function ai-chat): per-device / per-IP rate limits.
-- Touches ONLY public.ai_usage and public.ai_usage_hit (shared elric-fit project).
-- No chat text is ever stored: only a salted SHA-256 of the device id / IP and counters.

create table if not exists public.ai_usage (
  key    text        not null,          -- 'd:<sha256>' (device) or 'ip:<sha256>'
  hour   timestamptz not null,          -- date_trunc('hour', now())
  count  integer     not null default 0,
  primary key (key, hour)
);

alter table public.ai_usage enable row level security;   -- no policies: service role only
revoke all on public.ai_usage from anon, authenticated;

-- Atomically counts one question for each key and says whether it is allowed.
-- Returns {ok, scope, hour_count, day_count, retry_after} for the first key over a cap.
create or replace function public.ai_usage_hit(
  p_keys text[], p_hour_caps int[], p_day_caps int[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  h timestamptz := date_trunc('hour', now());
  i int;
  hc int;
  dc int;
begin
  -- Check every key first (nothing is counted when one is over its cap).
  for i in 1 .. coalesce(array_length(p_keys, 1), 0) loop
    select coalesce(sum(count) filter (where hour = h), 0),
           coalesce(sum(count), 0)
      into hc, dc
      from ai_usage
     where key = p_keys[i] and hour > h - interval '24 hours';
    if hc >= p_hour_caps[i] then
      return jsonb_build_object('ok', false, 'scope', split_part(p_keys[i], ':', 1), 'window', 'hour',
        'retry_after', greatest(60, extract(epoch from (h + interval '1 hour' - now()))::int));
    end if;
    if dc >= p_day_caps[i] then
      return jsonb_build_object('ok', false, 'scope', split_part(p_keys[i], ':', 1), 'window', 'day',
        'retry_after', 3600);
    end if;
  end loop;
  for i in 1 .. coalesce(array_length(p_keys, 1), 0) loop
    insert into ai_usage (key, hour, count) values (p_keys[i], h, 1)
      on conflict (key, hour) do update set count = ai_usage.count + 1;
  end loop;
  -- Housekeeping: keep only the last two days.
  if random() < 0.05 then
    delete from ai_usage where hour < now() - interval '2 days';
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.ai_usage_hit(text[], int[], int[]) from public, anon, authenticated;
grant execute on function public.ai_usage_hit(text[], int[], int[]) to service_role;
