-- 100UP CRM — inverter tiers get a SIZE CLASS, not just a product identity.
--
-- Fixing a design error in the rebuilt Calculator. It offered "force <this
-- exact product>", which breaks the whole point of the screen: the two brands
-- are shown side by side for comparison, and pinning a Sigenergy product
-- leaves the Deye column with nothing to answer with.
--
-- V46 got this right and I did not read it carefully enough. Its modes were
-- tier-RELATIVE: "Force 12/10kW" is ONE mode meaning "each brand's bigger
-- option", resolving to the 12kW for Sigenergy and the 10kW for Deye. The
-- product differs per brand; the intent does not.
--
-- So the choice is a size class and each config resolves it to its own
-- product. Vanessa's framing: small / medium / large, with each brand's
-- equivalent in each slot.

create type public.inverter_size_class as enum ('small', 'medium', 'large');

alter table public.system_config_inverters
  add column size_class public.inverter_size_class;

-- Seed by kW rank within each config AND phase — a three-phase 15kW is the
-- "small" of its phase, not a medium overall.
with ranked as (
  select i.id,
         row_number() over (partition by i.config_id, s.phase order by s.kw)      as asc_rank,
         count(*)     over (partition by i.config_id, s.phase)                    as tiers
  from public.system_config_inverters i
  join public.stocks s on s.id = i.stock_id
)
update public.system_config_inverters i
set size_class = case
      when r.tiers = 1                 then 'small'
      when r.asc_rank = 1              then 'small'
      when r.asc_rank = r.tiers        then 'large'
      else 'medium'
    end::public.inverter_size_class
from ranked r
where r.id = i.id;

-- Current result, for the record:
--   Sigenergy single : EC 8.0 SP  = small, EC 12.0 SP = large
--   Deye single      : 8P1        = small, 10P1       = large
--   Sigenergy three  : EC 15 = small, EC 20 = medium, EC 30 = large
--   Deye three       : 10P3  = small, 12P3  = large
--
-- OPEN WITH FRED: the derivation is by capacity, which is a reasonable default
-- but not necessarily how he thinks about it. Worth confirming that
-- Sigenergy 20kW really is the three-phase "medium", and whether single phase
-- wants a middle option at all. Editable per tier once confirmed.

comment on column public.system_config_inverters.size_class is
  'Which slot this product fills for its config. The Calculator forces a CLASS, not a product, so both brands stay comparable — V46 "Force 12/10kW" meant 12kW on Sigenergy and 10kW on Deye, one intent, two products.';
