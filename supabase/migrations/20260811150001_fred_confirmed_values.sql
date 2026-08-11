-- 100UP CRM — values confirmed by Fred, 11 August 2026.
-- Replaces two figures that were derived or inherited rather than known.

-- 1. SigenStor BAT 8.0 usable capacity.
-- Was 7.08, derived from the BAT 10.0 nominal/usable ratio because the
-- battery never appeared in V46. Fred confirms 7.8.
update public.stocks set usable_kwh = 7.8 where name = 'SigenStor BAT 8.0';

-- 2. Deye AI-W5.1-10P3-AU-B — the THREE-phase 10kW.
-- V46 held one figure, deyeSingleInverterCost = 1900, and applied it to both
-- 10kW variants; ASSUMPTION_META documented it as the 10P3 price. Fred
-- confirms the two differ: 1P is 1900 (already correct), 3P is 2300. The 10P3
-- was therefore carried in 400 light.
--
-- NO PARITY IMPACT: V46's three-phase Deye path prices the 12P3 via
-- deye3phInverterCost (3160) and never selects the 10P3, so the old engine
-- never quoted this product. Correcting it cannot move any gate scenario.
update public.stocks set planning_cost = 2300 where name = 'Deye AI-W5.1-10P3-AU-B';
