-- 100UP CRM — a banner Vanessa can put in front of Fred without a deploy.
--
-- Fred started testing on 2026-09-20 while development continues underneath
-- him. Two different problems come out of that, and they want different
-- answers:
--
--   1. His browser is running whatever bundle it loaded when he opened the
--      tab. After a deploy it is stale, and if the API moved under it things
--      break in ways that look like bugs rather than like "reload me". That
--      is solved automatically by the build-id check in the app — no table,
--      no toggle, nothing to remember.
--
--   2. "I am actively changing things right now, expect wobble." That is a
--      judgement only Vanessa can make, so it needs a switch. This table is
--      that switch.
--
-- Deliberately a TABLE and not a build-time constant: the whole point is to
-- turn it on and off without deploying, and to have it appear in Fred's open
-- tab straight away rather than on his next refresh (hence the realtime
-- publication at the end).
--
-- `until` is the important column. A maintenance banner that has to be turned
-- off by hand is a banner that stays up for three weeks and stops being read.
-- This one expires on its own; leaving it on is not a failure mode.

create table public.app_notice (
  id         smallint primary key default 1 check (id = 1),
  active     boolean not null default false,
  message    text not null default '',
  -- Null means "until switched off", but the UI always sets one.
  until      timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.app_notice (id, active, message) values (1, false, '');

-- Convention 5, and the reason it exists: this project carries an ALTER
-- DEFAULT PRIVILEGES rule granting ALL to anon/authenticated on every new
-- table in public, so the table already holds INSERT/UPDATE/DELETE/TRUNCATE
-- for both roles before a single grant below runs. Revoke first, then grant
-- exactly what the policies allow. docs/bugs.md #13.
revoke all on public.app_notice from anon, authenticated;
grant select on public.app_notice to authenticated;
grant update on public.app_notice to authenticated;

alter table public.app_notice enable row level security;

-- Everyone signed in reads it — it is a banner, and an installer being told
-- the system is mid-change is just as useful as Fred being told.
create policy "app_notice_select_all" on public.app_notice
  for select to authenticated
  using (true);

create policy "app_notice_update_admin" on public.app_notice
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- No insert or delete policy: there is exactly one row and it is seeded here.

-- So the banner reaches an open tab immediately. data.tsx already subscribes
-- to every change in `public`, so nothing needs wiring on the client.
alter publication supabase_realtime add table public.app_notice;
