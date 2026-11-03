-- Elric AI Admin: authenticator-app (TOTP) sign-in state. Service role only.
create table if not exists public.ai_admin_totp (
  id smallint primary key default 1 check (id = 1),
  email text not null default 'theinfo222@gmail.com',
  secret text,                       -- active base32 secret
  pending_secret text,               -- set by setup, activated after a correct code
  pending_at timestamptz,
  last_step bigint not null default 0,  -- last accepted 30 s step (blocks code reuse)
  failed_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.ai_admin_totp enable row level security;   -- no policies: anon/authenticated see nothing
revoke all on public.ai_admin_totp from anon, authenticated;
grant all on public.ai_admin_totp to service_role;
insert into public.ai_admin_totp (id) values (1) on conflict do nothing;
