-- 100UP CRM — classify existing stock as products; add the two missing sets.
--
-- A4 of docs/archive/phase-a-implementation-plan.md. Data only, no schema.
--
-- Values come from 100UP_assumptions_2026-06-20.json (the figures the V46
-- calculator actually quotes with today) and GM_DEFAULT_COSTS in
-- 100UP_suite_V46.html line 3920. They are starting values, editable in the
-- Products UI — the point of this migration is that every quotable thing is
-- a row with a type, a phase and a price, not that these numbers are final.

-- ── Existing 17: classify and price ───────────────────────────────────
-- planning_cost is set from the assumption values rather than last_cost.
-- The two differ on purpose: last_cost records what was paid (and is 0 for
-- anything never received through the system), planning_cost is what quotes
-- are costed at. SigenStor BAT 8.0 is the case that proves it — last_cost 0,
-- still actively sold, quoted at 2200.

update public.stocks set product_type = 'inverter', phase = 'single', planning_cost = 2500 where name = 'SigenStor EC 8.0 SP';
update public.stocks set product_type = 'inverter', phase = 'single', planning_cost = 2700 where name = 'SigenStor EC 12.0 SP';
update public.stocks set product_type = 'inverter', phase = 'three',  planning_cost = 3350 where name = 'SigenStor EC 15.0 TP';
update public.stocks set product_type = 'inverter', phase = 'three',  planning_cost = 4000 where name = 'SigenStor EC 20.0 TP';
update public.stocks set product_type = 'inverter', phase = 'three',  planning_cost = 5100 where name = 'SigenStor EC 30.0 TP';

update public.stocks set product_type = 'inverter', phase = 'single', planning_cost = 1550 where name = 'Deye AI-W5.1-8P1-AU-B';
update public.stocks set product_type = 'inverter', phase = 'three',  planning_cost = 1900 where name = 'Deye AI-W5.1-10P3-AU-B';
update public.stocks set product_type = 'inverter', phase = 'three',  planning_cost = 3160 where name = 'Deye AI-W5.1-12P3-AU-B';

-- Batteries are phase-agnostic — they sit behind the inverter.
-- kwh here is NOMINAL (the model name). The USABLE figure the engine sizes on
-- is lower and differs: BAT 10.0 sizes on 9 kWh, AI-W5.1-B on 5.1. Do not
-- "correct" kwh to match the model name — see docs/design/quote-configurator-design.md
-- D3a on why spec fields are not cost fields.
update public.stocks set product_type = 'battery', phase = 'na', planning_cost = 2600 where name = 'SigenStor BAT 10.0';
update public.stocks set product_type = 'battery', phase = 'na', planning_cost = 2200 where name = 'SigenStor BAT 8.0';
update public.stocks set product_type = 'battery', phase = 'na', planning_cost = 1250 where name = 'Deye AI-W5.1-B';

-- Gateways are phase-specific: one per <=3 inverters, different unit per phase.
update public.stocks set product_type = 'gateway', phase = 'single', planning_cost = 1700 where name = 'Sigen Gateway HomePro SP-F AU';
update public.stocks set product_type = 'gateway', phase = 'three',  planning_cost = 1850 where name = 'Sigen Gateway C60 AU (60kW, Three Phase)';

-- Mounting kit applies to every Sigenergy system regardless of phase.
update public.stocks set product_type = 'mounting', phase = 'na', planning_cost = 250 where name = 'SigenStor mounting kit';

-- Deye stack base. In the assumptions these are ONE number (deye_bms_cost
-- 550) covering two physical products; split here so each carries its own
-- cost and stock level. 250 + 300 = the 550 the calculator uses today.
update public.stocks set product_type = 'bms', phase = 'na', planning_cost = 250 where name = 'Deye AI-W5.1-PDU3';
update public.stocks set product_type = 'bms', phase = 'na', planning_cost = 300 where name = 'Deye AI-W5.1-Base';

update public.stocks set product_type = 'panel', phase = 'na', planning_cost = 143 where name = 'Solar panel 475W';

-- ── The missing single-phase 10kW Deye (docs/bugs.md #9) ──────────────
-- The 1-phase Calculator's "force large" generates the name
-- 'Deye AI-W5.1-10P1-AU-B', which had no stock row, so normalizePart() keyed
-- deye-inv-10p1 against nothing and the inverter line silently dropped out of
-- allocation. It is a real Australian product (verified against AU retailers);
-- the catalogue was incomplete, the calculator was right.
-- Priced at 1900, matching the 10P3 — confirmed, and adjustable in the UI.
insert into public.stocks (name, qty, product_type, phase, planning_cost, category, model, verified, manufacturer_id)
select 'Deye AI-W5.1-10P1-AU-B', 0, 'inverter', 'single', 1900, 'inverter',
       'AI-W5.1-10P1-AU-B (AS4777-2 2020)', false, m.id
from public.manufacturers m
where m.legal_name = 'NingBo Deye Inverter Technology Co Ltd';

-- ── Ground-mount components (19) ──────────────────────────────────────
-- Straight copy of GM_DEFAULT_COSTS (V46 line 3920), which holds real L&H
-- quoted unit prices. These were a localStorage blob keyed by part code and
-- invisible to stock control; as products they become orderable and countable
-- like everything else. `model` carries the manufacturer part code.
--
-- Quantities are NOT stored — they are geometry, derived per array from panel
-- width and row count (V46 lines 4008-4026), and stay in code keyed by part.
--
-- Two deliberate quirks preserved from the source: 100-0121 (M12x110) is
-- quoted under the M12x90 SKU at the same price, and the end clamp is a
-- 30mm/35mm pair selected by panel thickness — both remain distinct products.
insert into public.stocks (name, qty, product_type, phase, planning_cost, category, model, active)
values
  ('M12x25mm Nickel Zinc',                    0, 'gm_component', 'na',  0.59, 'other', '100-0119',    true),
  ('M12x90mm Nickel Zinc',                    0, 'gm_component', 'na',  1.53, 'other', '100-0120',    true),
  ('M12x110mm Nickel Zinc',                   0, 'gm_component', 'na',  1.53, 'other', '100-0121',    true),
  ('M12 Nut Nickel Zinc',                     0, 'gm_component', 'na',  0.28, 'other', '101-0036',    true),
  ('Rubber Cap for ground screw',             0, 'gm_component', 'na',  0.37, 'other', '102-0022',    true),
  ('M12 Washer, Nickel Zinc',                 0, 'gm_component', 'na',  0.48, 'other', '104-0028',    true),
  ('Ground screw, 1.6m, Std Thread',          0, 'gm_component', 'na', 45.85, 'other', '110-0002-16', true),
  ('HDG Screws for ground screw',             0, 'gm_component', 'na',  0.00, 'other', '100-0131',    true),
  ('Front Post 849mm',                        0, 'gm_component', 'na', 12.14, 'other', '153-0003',    true),
  ('Back Post 2119mm',                        0, 'gm_component', 'na', 21.75, 'other', '154-0005',    true),
  ('C Purlin Rail 100x50x1.5mm, 5800mm',      0, 'gm_component', 'na', 48.28, 'other', '155-0020',    true),
  ('Joiner Plate',                            0, 'gm_component', 'na',  3.17, 'other', '158-0014',    true),
  ('Brace Arm, 1398mm',                       0, 'gm_component', 'na', 11.14, 'other', '159-0003',    true),
  ('U Truss 1.5mm, 4020mm, 20-25-30 deg',     0, 'gm_component', 'na', 59.66, 'other', '161-0005',    true),
  ('Mid Clamp with earthing',                 0, 'gm_component', 'na',  2.03, 'other', '301-0027',    true),
  ('End Clamp with Earthing, 35mm',           0, 'gm_component', 'na',  2.01, 'other', '302-0059',    true),
  ('End Clamp with Earthing, 30mm',           0, 'gm_component', 'na',  2.01, 'other', '302-0058',    true),
  ('Brace Arm Sleeve',                        0, 'gm_component', 'na',  6.35, 'other', '312-0002',    true),
  ('Spacer',                                  0, 'gm_component', 'na',  0.28, 'other', '375-0001',    true),
  ('Rail Clamp',                              0, 'gm_component', 'na',  2.12, 'other', '376-0001',    true);

-- Stamp every price set above, so the Products page can flag staleness
-- against last_cost from a known starting point.
update public.stocks set planning_cost_updated_at = now() where planning_cost > 0;
