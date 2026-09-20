-- 100UP CRM — close the installer read leak. docs/bugs.md #14.
--
-- Writes have been role-enforced since day one. READS never were: 24 tables
-- carried a `<table>_select_all` policy of `using (true)` for every
-- authenticated user, role-blind. Confirmed live on 2026-09-15 by logging in
-- as test user Installer One and calling the REST API directly — all 38
-- `stocks` rows with `last_cost` / `planning_cost` / `last_landed_cost`, every
-- supplier, `purchase_orders.po_amount`, `purchase_order_items.cost`, and
-- **`pricing_settings.margin`**. Whatever the UI showed them, the API did not
-- care.
--
-- `app/src/lib/data.tsx` made it live rather than theoretical: useData()
-- selects every one of those tables on load, for every signed-in user.
--
-- This is the blocker before a real installer gets an account, and Fred's
-- 2026-09-20 email ("installer only can see job description nothing else")
-- settles what the answer should be.
--
-- Already correct, left alone: jobs, job_stock_items, job_events, customers,
-- installation_requests (row-scoped to the assigned installer), profiles
-- (own row), stock_takes, stock_take_lines, email_sends, ai_call_log
-- (already admin-only), integrations (RLS on, no policies at all).
--
-- pipeline_steps stays readable by everyone: step labels, keys, ordinals and
-- the installer_can_set / follow_up flags. It carries no money and the
-- installer's Job progress panel needs it to render at all.

-- ── 1. The sweep ───────────────────────────────────────────────────────
-- Everything an installer has no business reading. Same policy name, so the
-- intent stays greppable; `using (true)` becomes `using (is_admin())`.
do $$
declare t text;
begin
  foreach t in array array[
    -- catalogue and cost
    'stocks', 'manufacturers',
    -- suppliers and procurement.
    -- NOT 'receipts' (renamed to purchase_orders in 20260719030001) and NOT
    -- 'stock_ces_specs' (merged into stocks in 20260719020001) — both appear
    -- in the original grep of *_select_all policies and neither still exists.
    'suppliers', 'purchase_orders', 'purchase_order_items',
    'supplier_documents', 'goods_receipts', 'goods_receipt_items',
    'goods_receipt_documents',
    -- quoting inputs: margin lives here
    'assumptions', 'pricing_settings', 'rebate_settings',
    'battery_rebate_tiers', 'sizing_rules', 'fixed_site_costs',
    'panel_settings', 'ground_mount_settings',
    'system_configs', 'system_config_inverters', 'system_config_batteries',
    'system_config_components', 'simulation_presets'
  ]
  loop
    -- Guard rather than assume: this list was built by grepping migration
    -- history, which still names tables that have since been dropped or
    -- renamed. A missing one should be visible, not fatal.
    if to_regclass('public.' || quote_ident(t)) is null then
      raise warning 'skipping %: table does not exist', t;
      continue;
    end if;
    execute format('drop policy if exists "%s_select_all" on public.%I', t, t);
    execute format(
      'create policy "%s_select_all" on public.%I for select to authenticated using ((select private.is_admin()))',
      t, t);
  end loop;
end $$;

-- ── 2. Installers still need their parts list ──────────────────────────
-- 1ac53f9 deliberately shows an installer the stock allocated to their job,
-- and knowing which panels and inverter are going on the roof is the job.
-- Locking `stocks` down takes the NAMES away with the costs, so give the
-- names back without them.
--
-- The view keeps `stocks`' exact column shape so the app's Stock type still
-- fits and nothing downstream has to special-case it — but every cost column
-- is redacted to a literal, and `qty` (on-hand across the business) to 0. A
-- reader gets 0, never a real figure, and never `undefined`.
--
-- Rows are limited to stock allocated to a job this installer is assigned to.
-- An admin gets everything, so one code path serves both.
--
-- SECURITY INVOKER is deliberately NOT set: the view must read `stocks` with
-- its owner's rights, because the whole point is that the caller can no
-- longer select that table. The WHERE clause below is therefore the access
-- control, and it has to be right.
create or replace view public.stocks_visible as
select
  s.id,
  s.name,
  s.model,
  s.category,
  s.product_type,
  s.phase,
  s.active,
  s.verified,
  s.manufacturer_id,
  s.kw,
  s.kva,
  s.kwh,
  s.usable_kwh,
  s.watts,
  -- Redacted. Never the real figures.
  0::numeric    as qty,
  0::numeric    as last_cost,
  0::numeric    as last_landed_cost,
  0::numeric    as planning_cost,
  null::timestamptz as planning_cost_updated_at,
  null::bigint  as preferred_supplier_id
from public.stocks s
where (select private.is_admin())
   or exists (
     select 1
     from public.job_stock_items jsi
     join public.jobs j on j.id = jsi.job_id
     where jsi.stock_id = s.id
       and j.assigned_installer_id = (select auth.uid())
   );

revoke all on public.stocks_visible from anon, authenticated;
grant select on public.stocks_visible to authenticated;

comment on view public.stocks_visible is
  'Installer-safe view of stocks: real identity and spec columns, cost and on-hand redacted to 0, rows limited to stock allocated to the caller''s assigned jobs (admins see all). The app reads `stocks` when admin and this when not. docs/bugs.md #14.';
