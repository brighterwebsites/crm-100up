-- Private integrations store: admin-managed credentials for outbound
-- integrations. Starts with CyberPanel Email Delivery (CyberPersons —
-- platform.cyberpersons.com, not hosting SMTP). Service-role only; never
-- exposed via PostgREST to authenticated/anon (Edge Functions read it
-- after verifying the caller is admin via their JWT).

create table private.integrations (
  provider      text primary key check (provider in ('email')),
  config        jsonb not null default '{}',
  secret        text,
  secret_last4  text not null default '',
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null
);

revoke all on private.integrations from public, anon, authenticated;
