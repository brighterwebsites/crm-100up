-- 100UP CRM — separate usable battery capacity from nominal.
--
-- Clears the blocker in docs/phase-b-parity-gate.md §1.
--
-- THE PROBLEM: `stocks.kwh` holds NOMINAL capacity, because it was populated
-- for CES — that form asks for "Nominal storage capacity kWh". The V46 pricing
-- engine sizes on USABLE capacity, which is a different and smaller number:
--
--     SigenStor BAT 10.0   nominal 10.24    usable 9      (13.8% apart)
--     Deye AI-W5.1-B       nominal  5.12    usable 5.1
--
-- Both figures are correct for their own purpose and they are NOT
-- interchangeable. Had priceSystem() read `kwh`, every Sigenergy bank would
-- have been sized ~14% high, flowing into battery STCs, the rebate, the final
-- price and the July simulation — plausible everywhere and wrong everywhere.
-- Nothing in the app would have surfaced it.

alter table public.stocks
  add column usable_kwh numeric check (usable_kwh is null or usable_kwh > 0);

-- Values the V46 engine actually quotes with today (assumptions
-- sig_battery_kwh / deye_battery_kwh), so Phase B's parity gate compares like
-- for like.
update public.stocks set usable_kwh = 9   where name = 'SigenStor BAT 10.0';
update public.stocks set usable_kwh = 5.1 where name = 'Deye AI-W5.1-B';

-- BAT 8.0 has no V46 figure — it was never in the calculator. Derived from the
-- BAT 10.0 ratio (9 / 10.24 = 0.879) applied to its 8.06 nominal.
-- UNCONFIRMED: needs Fred or a datasheet. Deliberately not left null (that
-- would break sizing) and deliberately not set equal to nominal (that would
-- reproduce the exact error this migration exists to prevent).
update public.stocks set usable_kwh = 7.08 where name = 'SigenStor BAT 8.0';

-- A battery without a usable capacity is not quotable, so make it
-- structurally impossible rather than relying on whoever adds the next
-- product to remember. This is the guard that stops the bug recurring.
alter table public.stocks
  add constraint stocks_battery_needs_usable_kwh
  check (product_type <> 'battery' or usable_kwh is not null);

comment on column public.stocks.usable_kwh is
  'Usable capacity — what the pricing and simulation engines size on. Distinct from kwh, which is NOMINAL and is what a CES submission reports. Do not reconcile them; they are different figures for different purposes.';
comment on column public.stocks.kwh is
  'NOMINAL capacity, as reported on a CES submission. The engines size on usable_kwh instead.';
