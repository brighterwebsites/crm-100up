-- 100UP CRM — the Deye 10kW three-phase is never a system Fred would quote.
--
-- Fred, 2026-09-20: there is no scenario in which he would recommend a 10kW
-- three-phase inverter. A three-phase unit splits its rating across the three
-- phases, so a 10kW 3P delivers ~3.33kW per phase — not enough to run what an
-- off-grid three-phase customer expects to run. The Deye three-phase fallback
-- is the 12kW (AI-W5.1-12P3-AU-B); his most recent build used Sigenergy only.
--
-- This is NOT a change to quoted output. V46's three-phase Deye path already
-- hardcodes 12kW in every mode — costFor3phWithConfig('Deye', …, 12,
-- A.deye3phInverterCost) at lines 2259 / 2283 / 2288 / 2295 — and never
-- selects the 10P3. The rebuilt configurator, however, seeds
-- system_config_inverters with a blanket join over every active inverter per
-- brand (20260811160001), so it picked the 10P3 up as a three-phase tier that
-- V46 would never have offered. Removing it makes the new engine match the
-- old one; leaving it in would have introduced the divergence.
--
-- The `stocks` row STAYS. It is a real product, it carries the CES catalogue
-- entry (kva 10, AS4777-2 2020) and its planning_cost of 2300 was confirmed
-- by Fred on 2026-08-11. Removing the tier stops it being QUOTED; it does not
-- remove it from the catalogue, from compliance, or from any historical job.

delete from public.system_config_inverters i
using public.stocks s
where s.id = i.stock_id
  and s.name = 'Deye AI-W5.1-10P3-AU-B';

-- Deye three-phase now has exactly one tier. Re-derive its size class under
-- the same rule 20260811170001 seeds with (a lone tier is its phase's
-- 'small'), so the column keeps agreeing with its own derivation.
--
-- That leaves a real gap: Sigenergy three-phase offers small/medium/large and
-- Deye can now only answer one of them. The Calculator forces a size CLASS so
-- the two brands stay comparable, and quoteEngine's candidate filter returns
-- null when a config has no tier in the forced class — which would blank the
-- Deye column exactly as the size_class design set out to prevent. The engine
-- therefore falls back to a config's remaining tiers for the phase when the
-- forced class matches none of them, which is precisely what V46 does: the
-- 12kW answers every three-phase mode. See quoteEngine.ts.
update public.system_config_inverters i
set size_class = 'small'::public.inverter_size_class
from public.stocks s
where s.id = i.stock_id
  and s.name = 'Deye AI-W5.1-12P3-AU-B';

-- Deye three-phase tiers after this migration: 12P3 only (small).
-- Deye single-phase is untouched: 8P1 = small, 10P1 = large.
