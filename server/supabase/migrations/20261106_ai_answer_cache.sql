-- Elric AI answer cache (ai-chat). Touches ONLY public.ai_answer_cache, public.ai_answer_cache_seen and
-- the functions ai_cache_get / ai_cache_note (shared elric-fit project).
-- Common general questions are answered from here without a model call, but only after the owner
-- approves the answer (admin Cache tab). Candidates are recorded only when 3+ different devices asked
-- the same normalised question; until then only salted hashes are kept (no question text, no device id).

create table if not exists public.ai_answer_cache (
  id            bigserial primary key,
  question_norm text        not null,                 -- lowercased, punctuation stripped
  lang          text        not null default 'en',    -- app language ('en' | 'hi')
  mode          text        not null default 'general',
  short         boolean     not null default true,    -- answer length setting
  question      text        not null,                 -- as asked (general question; personal ones are never recorded)
  answer        text        not null,
  kind          text        not null default 'general' check (kind in ('general', 'search')),
  ttl_days      int         not null default 30,      -- search answers 1 day, others 30 days
  devices       int         not null default 3,       -- different devices that asked (when recorded)
  hits          int         not null default 0,       -- times served from the cache
  approved      boolean     not null default false,
  status        text        not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at    timestamptz not null default now(),
  approved_at   timestamptz,
  expires_at    timestamptz,
  unique (question_norm, lang, mode, short)
);

create table if not exists public.ai_answer_cache_seen (
  qhash   text        not null,   -- salted SHA-256 of the normalised question + lang/mode/length
  dhash   text        not null,   -- salted SHA-256 of the device id
  seen_at timestamptz not null default now(),
  primary key (qhash, dhash)
);

alter table public.ai_answer_cache      enable row level security;
alter table public.ai_answer_cache_seen enable row level security;   -- no policies: service role only
revoke all on public.ai_answer_cache, public.ai_answer_cache_seen from anon, authenticated;

-- Owner (admin page) can review, approve, edit and delete cache rows; other signed-in users match no policy.
grant select, update, delete on public.ai_answer_cache to authenticated;
drop policy if exists ai_answer_cache_owner_all on public.ai_answer_cache;
create policy ai_answer_cache_owner_all on public.ai_answer_cache
  for all to authenticated
  using (lower(auth.jwt()->>'email') = 'theinfo222@gmail.com')
  with check (lower(auth.jwt()->>'email') = 'theinfo222@gmail.com');

-- Serve: an approved, unexpired answer (counts a hit), or null.
create or replace function public.ai_cache_get(p_norm text, p_lang text, p_mode text, p_short boolean)
returns text language plpgsql security definer set search_path = public as $$
declare a text;
begin
  update ai_answer_cache set hits = hits + 1
   where question_norm = p_norm and lang = p_lang and mode = p_mode and short = p_short
     and approved and status = 'approved' and expires_at > now()
  returning answer into a;
  return a;
end $$;

-- Record that a device asked this question; when 3+ different devices did (last 30 days) and there is no
-- live row yet, keep the question + answer as a pending candidate for the owner. Returns the device count.
create or replace function public.ai_cache_note(
  p_qhash text, p_dhash text, p_norm text, p_lang text, p_mode text, p_short boolean,
  p_question text, p_answer text, p_kind text
) returns int language plpgsql security definer set search_path = public as $$
declare n int; r ai_answer_cache%rowtype;
begin
  insert into ai_answer_cache_seen (qhash, dhash) values (p_qhash, p_dhash)
    on conflict (qhash, dhash) do update set seen_at = now();
  select count(*) into n from ai_answer_cache_seen where qhash = p_qhash and seen_at > now() - interval '30 days';
  if n >= 3 and coalesce(length(p_answer), 0) between 20 and 6000 and coalesce(length(p_question), 0) between 4 and 300 then
    select * into r from ai_answer_cache
     where question_norm = p_norm and lang = p_lang and mode = p_mode and short = p_short;
    if not found then
      insert into ai_answer_cache (question_norm, lang, mode, short, question, answer, kind, ttl_days, devices)
      values (p_norm, p_lang, p_mode, p_short, p_question, p_answer,
              case when p_kind = 'search' then 'search' else 'general' end,
              case when p_kind = 'search' then 1 else 30 end, n);
    elsif r.status = 'pending' then
      update ai_answer_cache set devices = greatest(devices, n) where id = r.id;
    elsif r.status = 'approved' and r.expires_at <= now() then
      -- Expired: a fresh answer goes back to the owner for approval.
      update ai_answer_cache set answer = p_answer, question = p_question, devices = n, approved = false,
        status = 'pending', approved_at = null, expires_at = null, created_at = now(),
        kind = case when p_kind = 'search' then 'search' else 'general' end,
        ttl_days = case when p_kind = 'search' then 1 else 30 end
       where id = r.id;
    end if;
  end if;
  -- Housekeeping.
  delete from ai_answer_cache_seen where seen_at < now() - interval '30 days';
  delete from ai_answer_cache where status = 'pending' and created_at < now() - interval '14 days';
  return n;
end $$;

revoke all on function public.ai_cache_get(text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.ai_cache_note(text, text, text, text, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.ai_cache_get(text, text, text, boolean) to service_role;
grant execute on function public.ai_cache_note(text, text, text, text, text, boolean, text, text, text) to service_role;
