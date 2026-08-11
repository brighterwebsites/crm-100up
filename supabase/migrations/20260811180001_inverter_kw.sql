-- 100UP CRM — populate inverter kW, and make its absence impossible.
--
-- SERIOUS BUG, caught before it reached a quote. Every inverter product had
-- kw = null: the A4 backfill set product_type, phase and planning_cost but
-- never the capacity, because the legacy stock rows only carried kw for
-- batteries.
--
-- priceSystem() sizes on it:
--     maxSolarPerInv = invKw * (oversize / 100)
--     invForSolar    = ceil(solarKw / maxSolarPerInv)
-- With kw null that is 0, the guard falls through to the minimum, and EVERY
-- system gets one inverter no matter how large the array. A 30kW array on a
-- single 8kW inverter, priced and quoted without complaint.
--
-- The parity harness did not catch it because it used hand-built fixtures
-- with kw filled in. The lesson is in the CHECK constraint at the bottom:
-- a fixture can lie, a constraint cannot.

update public.stocks set kw = 8  where name = 'SigenStor EC 8.0 SP';
update public.stocks set kw = 12 where name = 'SigenStor EC 12.0 SP';
update public.stocks set kw = 15 where name = 'SigenStor EC 15.0 TP';
update public.stocks set kw = 20 where name = 'SigenStor EC 20.0 TP';
update public.stocks set kw = 30 where name = 'SigenStor EC 30.0 TP';
update public.stocks set kw = 8  where name = 'Deye AI-W5.1-8P1-AU-B';
update public.stocks set kw = 10 where name = 'Deye AI-W5.1-10P1-AU-B';
update public.stocks set kw = 10 where name = 'Deye AI-W5.1-10P3-AU-B';
update public.stocks set kw = 12 where name = 'Deye AI-W5.1-12P3-AU-B';

-- Re-derive the size classes now that the ordering key actually has values.
-- The previous pass ordered by an all-null column, so its output was
-- insertion order that happened to look right — luck, not correctness.
with ranked as (
  select i.id,
         row_number() over (partition by i.config_id, s.phase order by s.kw) as asc_rank,
         count(*)     over (partition by i.config_id, s.phase)               as tiers
  from public.system_config_inverters i
  join public.stocks s on s.id = i.stock_id
)
update public.system_config_inverters i
set size_class = case
      when r.tiers = 1          then 'small'
      when r.asc_rank = 1       then 'small'
      when r.asc_rank = r.tiers then 'large'
      else 'medium'
    end::public.inverter_size_class
from ranked r
where r.id = i.id;

-- Same guarantee the batteries got in 20260811140001: an inverter without a
-- capacity cannot be quoted, so it cannot be saved. Sizing silently degrading
-- to "one inverter" is far worse than a save being refused.
alter table public.stocks
  add constraint stocks_inverter_needs_kw
  check (product_type <> 'inverter' or kw is not null);

comment on column public.stocks.kw is
  'Nominal capacity. REQUIRED for inverters — the engine sizes the inverter count on it, and a null silently collapses every system to the minimum count. Also carries battery nominal power where known.';
