-- 100UP CRM — move the integrations store out of the private schema.
--
-- private.integrations has never worked. PostgREST only serves the schemas in
-- pgrst.db_schemas ('public' and 'graphql_public' by default), so
-- .schema('private') is not a valid REST target even from a service-role
-- client — integrations-save and integrations-status both fail before they
-- reach the table. The zero rows in private.integrations ARE that bug: no
-- CyberPersons key has ever been saved, so nothing in the CRM can send mail.
--
-- Identical fault and identical fix to BW-CRM (20260722105255), which hit it
-- on 2026-07-22, one day after this repo forked the same code.
--
-- Lockdown follows the pattern already used for credentials here: RLS enabled
-- with NO policies at all, plus an explicit revoke. RLS with zero policies
-- denies every role outright; only the service role bypasses it, and the Edge
-- Functions verify the caller is an admin before using it. The secret column
-- therefore never crosses PostgREST.
--
-- All three providers are allowed from the start rather than widened one at a
-- time — Gmail and Anthropic land in the same batch of work.

create table public.integrations (
  provider      text primary key
                check (provider in ('email', 'anthropic', 'gmail')),
  config        jsonb not null default '{}',
  secret        text,
  secret_last4  text not null default '',
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null
);

-- Carry across anything that did land. Expected to move nothing, but a silent
-- drop of a live credential would be much worse than a no-op insert.
insert into public.integrations (provider, config, secret, secret_last4, updated_at, updated_by)
select provider, config, secret, secret_last4, updated_at, updated_by
from private.integrations
on conflict (provider) do nothing;

drop table private.integrations;

alter table public.integrations enable row level security;
revoke all on public.integrations from public, anon, authenticated;

comment on table public.integrations is
  'Admin-managed third-party credentials: CyberPersons email, Anthropic, Gmail. Service-role only — RLS is on with no policies, so PostgREST can reach nothing here. Edge Functions read it after verifying the caller is an admin. Replaces private.integrations, which was unreachable via PostgREST.';
