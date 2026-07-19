-- 100UP CRM — Phase 1 migration 2/3: helper functions, RLS policies, grants
--
-- Pattern: role checks go through SECURITY DEFINER helpers in the private
-- schema, never inline subqueries on profiles from inside a profiles
-- policy (that recurses infinitely — Postgres 42P17). Helpers are wrapped
-- as (select ...) in policy predicates so they evaluate once per
-- statement, not once per row.

-- ── Helper functions ───────────────────────────────────────────────────
create or replace function private.user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select role from public.profiles where id = (select auth.uid())) = 'admin',
    false
  );
$$;

-- Postgres grants EXECUTE to PUBLIC by default on new functions; policies
-- run with invoker rights, so authenticated needs EXECUTE — nobody else.
revoke all on function private.user_role() from public, anon;
revoke all on function private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.user_role() to authenticated;
grant execute on function private.is_admin() to authenticated;

-- ── Profile auto-creation on signup ────────────────────────────────────
-- Role always defaults to installer; promotion to admin is a separate,
-- deliberate act (first admin is bootstrapped via SQL — no in-app path).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Role changes are admin-only (or direct SQL / service role, where
-- auth.uid() is null — needed for the first-admin bootstrap). A trigger
-- because RLS cannot restrict individual columns.
create or replace function private.guard_profile_role()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    if (select auth.uid()) is null or (select private.is_admin()) then
      return new;
    end if;
    raise exception 'Only an admin can change a user''s role';
  end if;
  return new;
end;
$$;

create trigger guard_profile_role
  before update on public.profiles
  for each row execute function private.guard_profile_role();

-- ── Enable RLS everywhere ──────────────────────────────────────────────
alter table public.pipeline_steps  enable row level security;
alter table public.profiles        enable row level security;
alter table public.suppliers       enable row level security;
alter table public.stocks          enable row level security;
alter table public.stock_ces_specs enable row level security;
alter table public.jobs            enable row level security;
alter table public.job_stock_items enable row level security;
alter table public.receipts        enable row level security;
alter table public.job_events      enable row level security;

-- ── Table grants ───────────────────────────────────────────────────────
-- The CRM has no anonymous surface at all: anon gets nothing.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.jobs,
  public.job_stock_items, public.stocks, public.suppliers,
  public.receipts, public.stock_ces_specs to authenticated;
grant update on public.profiles to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ── profiles policies ──────────────────────────────────────────────────
-- Everyone sees their own row; admins see all (needed for the
-- installer-assignment dropdown).
create policy "profiles_select_own_or_admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

create policy "profiles_update_own_or_admin" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()))
  with check (id = (select auth.uid()) or (select private.is_admin()));
-- (Column-level rules — role changes — enforced by guard_profile_role.)

-- No INSERT/DELETE policies: rows are created by the auth trigger and
-- removed only via auth.users cascade.

-- ── pipeline_steps policies ────────────────────────────────────────────
create policy "pipeline_steps_select_all" on public.pipeline_steps
  for select to authenticated
  using (true);
-- No write policies: managed by migration only.

-- ── jobs policies ──────────────────────────────────────────────────────
create policy "jobs_select_admin_or_assigned" on public.jobs
  for select to authenticated
  using (
    (select private.is_admin())
    or assigned_installer_id = (select auth.uid())
  );

create policy "jobs_insert_admin" on public.jobs
  for insert to authenticated
  with check ((select private.is_admin()));

create policy "jobs_update_admin_or_assigned" on public.jobs
  for update to authenticated
  using (
    (select private.is_admin())
    or assigned_installer_id = (select auth.uid())
  )
  with check (
    (select private.is_admin())
    or assigned_installer_id = (select auth.uid())
  );
-- (Which columns an installer may touch is enforced by the
-- guard_jobs_update trigger in migration 3/3 — RLS is row-level only.)

create policy "jobs_delete_admin" on public.jobs
  for delete to authenticated
  using ((select private.is_admin()));

-- ── job_stock_items policies ───────────────────────────────────────────
create policy "job_stock_items_select_admin_or_assigned" on public.job_stock_items
  for select to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.jobs j
      where j.id = job_stock_items.job_id
        and j.assigned_installer_id = (select auth.uid())
    )
  );

-- Direct writes are admin-only and can never create or touch 'consumed'
-- rows — the pending->assigned->consumed transitions live exclusively in
-- the SECURITY DEFINER RPCs, which bypass these policies by design.
create policy "job_stock_items_insert_admin" on public.job_stock_items
  for insert to authenticated
  with check ((select private.is_admin()) and status <> 'consumed');

create policy "job_stock_items_update_admin" on public.job_stock_items
  for update to authenticated
  using ((select private.is_admin()) and status <> 'consumed')
  with check ((select private.is_admin()) and status <> 'consumed');

create policy "job_stock_items_delete_admin" on public.job_stock_items
  for delete to authenticated
  using ((select private.is_admin()) and status <> 'consumed');

-- ── stocks / suppliers / receipts / stock_ces_specs ────────────────────
-- Reference data both roles can read; writes are admin-only. Stock qty
-- mutations tied to consumption/receiving happen only inside RPCs.
create policy "stocks_select_all" on public.stocks
  for select to authenticated using (true);
create policy "stocks_insert_admin" on public.stocks
  for insert to authenticated with check ((select private.is_admin()));
create policy "stocks_update_admin" on public.stocks
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy "stocks_delete_admin" on public.stocks
  for delete to authenticated using ((select private.is_admin()));

create policy "suppliers_select_all" on public.suppliers
  for select to authenticated using (true);
create policy "suppliers_insert_admin" on public.suppliers
  for insert to authenticated with check ((select private.is_admin()));
create policy "suppliers_update_admin" on public.suppliers
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy "suppliers_delete_admin" on public.suppliers
  for delete to authenticated using ((select private.is_admin()));

create policy "receipts_select_all" on public.receipts
  for select to authenticated using (true);
create policy "receipts_insert_admin" on public.receipts
  for insert to authenticated with check ((select private.is_admin()));
create policy "receipts_update_admin" on public.receipts
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy "receipts_delete_admin" on public.receipts
  for delete to authenticated using ((select private.is_admin()));

create policy "stock_ces_specs_select_all" on public.stock_ces_specs
  for select to authenticated using (true);
create policy "stock_ces_specs_insert_admin" on public.stock_ces_specs
  for insert to authenticated with check ((select private.is_admin()));
create policy "stock_ces_specs_update_admin" on public.stock_ces_specs
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy "stock_ces_specs_delete_admin" on public.stock_ces_specs
  for delete to authenticated using ((select private.is_admin()));

-- ── job_events policies ────────────────────────────────────────────────
-- Read-only mirror of job visibility; rows are written only by the RPCs.
create policy "job_events_select_admin_or_assigned" on public.job_events
  for select to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.jobs j
      where j.id = job_events.job_id
        and j.assigned_installer_id = (select auth.uid())
    )
  );
