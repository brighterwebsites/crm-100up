-- 100UP CRM — Quote Designer assumptions table.
--
-- Singleton config row (id fixed at 1) mirroring the legacy V46 calculator
-- suite's `A` / `DEFAULT_A` object (100UP_suite_V46.html), migrated from
-- localStorage to Supabase so Simulation / Daily Load Profile / future
-- Quote Designer tools read live, shared, synced data instead of a
-- per-browser localStorage blob.
--
-- Cost fields are intentionally NOT linked to public.stocks yet — see
-- docs/bugs.md #3. That link (assumption cost <-> real stock supply cost)
-- is deferred; this table only carries the flat assumption values for now.

create table public.assumptions (
  id                       smallint primary key default 1 check (id = 1),

  -- Panels
  panel_w                  numeric not null default 0,
  panel_cost               numeric not null default 0,
  panel_install_per_w      numeric not null default 0,
  panel_frame              numeric not null default 0,
  panel_mfr                text    not null default '',
  panel_model              text    not null default '',
  solar_stc_per_kw         numeric not null default 0,
  solar_stc_price          numeric not null default 0,
  solar_oversize_percent   numeric not null default 0,
  solar_oversize_3ph_percent numeric not null default 160,

  -- Batteries
  sig_battery_kwh          numeric not null default 0,
  sig_battery_cost         numeric not null default 0,
  deye_battery_kwh         numeric not null default 0,
  deye_battery_cost        numeric not null default 0,
  battery_tier1            numeric not null default 0,
  battery_tier2            numeric not null default 0,
  battery_tier3            numeric not null default 0,
  battery_stc_price        numeric not null default 0,
  max_batt_per_inverter    integer not null default 6,

  -- Inverters / gateways
  deye_inverter_cost       numeric not null default 0,
  deye_bms_cost            numeric not null default 0,
  deye_single_inverter_cost numeric not null default 0,
  deye_3ph_inverter_cost   numeric not null default 0,
  sig_inverter_cost        numeric not null default 0,
  sig_single_inverter_cost numeric not null default 0,
  sig_gateway_cost         numeric not null default 0,
  sig_ground_kit_cost      numeric not null default 0,
  sig_3ph_15kw_cost        numeric not null default 0,
  sig_3ph_20kw_cost        numeric not null default 0,
  sig_3ph_30kw_cost        numeric not null default 0,
  sig_3ph_gateway_cost     numeric not null default 0,
  min_inverters            integer not null default 1,

  -- Standby / parasitic draw (brand-specific, Simulation engine)
  sig_standby_w            numeric not null default 0,
  deye_standby_w           numeric not null default 0,

  -- Labour / fixed costs
  small_parts              numeric not null default 0,
  installer_sign_off       numeric not null default 0,
  ces                      numeric not null default 0,
  labour_fixed             numeric not null default 0,

  -- Ground mount
  gm_frame_per_panel       numeric not null default 0,
  gm_labour_per_panel      numeric not null default 0,
  gm_machinery_fixed       numeric not null default 0,

  -- Pricing
  margin                   numeric not null default 0,
  gst                      numeric not null default 0,

  -- Daily load profile: 24 relative hourly weights (Simulation + Daily Load
  -- Profile tool both read/write this). Auto-normalised by consumers —
  -- values don't need to total 100.
  load_profile             jsonb   not null default '[2,1.5,1.5,1.5,2,3,5,7,6.5,5,3.5,3,3.5,3,3,3,4,6,8,8,6.5,5,3.5,2.5]'::jsonb,

  version                  integer not null default 1,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create or replace function private.bump_assumptions_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger b_bump_assumptions_version
  before update on public.assumptions
  for each row execute function private.bump_assumptions_version();

-- Seed the single row from 100UP_assumptions_2026-06-20.json.
insert into public.assumptions (
  id, panel_w, panel_cost, panel_install_per_w, panel_frame, panel_mfr, panel_model,
  solar_stc_per_kw, solar_stc_price, solar_oversize_percent, solar_oversize_3ph_percent,
  sig_battery_kwh, sig_battery_cost, deye_battery_kwh, deye_battery_cost,
  battery_tier1, battery_tier2, battery_tier3, battery_stc_price, max_batt_per_inverter,
  deye_inverter_cost, deye_bms_cost, deye_single_inverter_cost, deye_3ph_inverter_cost,
  sig_inverter_cost, sig_single_inverter_cost, sig_gateway_cost, sig_ground_kit_cost,
  sig_3ph_15kw_cost, sig_3ph_20kw_cost, sig_3ph_30kw_cost, sig_3ph_gateway_cost, min_inverters,
  sig_standby_w, deye_standby_w,
  small_parts, installer_sign_off, ces, labour_fixed,
  gm_frame_per_panel, gm_labour_per_panel, gm_machinery_fixed,
  margin, gst
) values (
  1, 475, 143, 0.35, 50, 'Jinko', 'JKM475',
  6.8, 38, 200, 160,
  9, 2600, 5.1, 1250,
  6.8, 4.08, 1, 38, 6,
  1550, 550, 1900, 3160,
  2500, 2700, 1700, 250,
  3350, 4000, 5100, 1850, 1,
  150, 150,
  1000, 1500, 500, 2000,
  150, 150, 1000,
  0.3, 0.1
);

-- RLS: all authenticated staff can read (needed for quoting tools);
-- only admins can change business assumptions.
revoke all on public.assumptions from anon;
grant select on public.assumptions to authenticated;
grant update on public.assumptions to authenticated;

alter table public.assumptions enable row level security;

create policy "assumptions_select_all" on public.assumptions
  for select to authenticated
  using (true);

create policy "assumptions_update_admin" on public.assumptions
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- No insert/delete policies — the singleton row is seeded by this migration
-- and never removed or duplicated.

alter publication supabase_realtime add table public.assumptions;
