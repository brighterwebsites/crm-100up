# Bugs & Issues Log

Tracks bugs found in the legacy `100UP_suite_V46.html` calculator suite and
the CRM app, whether they've been carried into the new build, and their
resolution status.

| # | Tool / Screen | Issue | Resolution | Status |
|---|---|---|---|---|
| 1 | Simulation Trace (V46) | Typing `0` into Daily load, Number of panels, or Battery kWh silently reverts to the hardcoded default (20 / 30 / 27) instead of using 0. Caused by `Number(value) \|\| default` — `0` is falsy in JS so the fallback always wins. Symptom: table stays at "Load (kWh) 20" even after zeroing the field, and results reflect the default scenario, not zero. Standby W is unaffected (its fallback is also 0). | Patched in `100UP_suite_V46.html` (`runSimTrace()`) to use a proper finite-number check instead of `\|\|`. Will be built correctly from scratch in the CRM port (no `\|\|`-on-numeric-input pattern). | Fixed (V46) / To-build-correctly (CRM port) |
| 2 | Simulation Trace → "Quick-fill from assumptions" (V46) | The button labels/kWh values are a hybrid: battery kWh figures are pulled live from `A.sigBatteryKwh` / `A.deyeBatteryKwh`, but the panel counts (30/36) and which unit-count combos are offered (Sig 3/4, Deye 5/6) are hardcoded literals in the JS — not derived from assumptions at all. Editing assumptions only changes the kWh numbers shown, not which configs exist. | Not fixed — documented behaviour. To be redesigned properly when Simulation is ported (quick-fill configs should probably become data-driven, e.g. stored alongside assumptions or computed from available battery/inverter combos). | Open — design decision needed at port time |
| 3 | Assumptions table → "Stock avail." column (V46) | The Stock avail. column looks up on-hand stock **quantity** for a given assumption row (matched by stock name, or by panel wattage for `panelCost`), but the assumption's **cost** value (e.g. `panelCost`, `sigInverterCost`, `deyeBatteryCost`) is a separately hand-maintained number with no link back to the actual purchase/supply cost recorded against that stock item (via receipts). Qty and cost can silently drift out of sync — you see live stock availability next to a cost figure that isn't tied to it. | Not fixed. Flagged by user as a known gap; end goal is to properly link assumption cost fields to stock items (and their real supply cost) at some point — deferred, no ETA. | Open — deferred |

## Notes
- V46 file: `100UP_suite_V46.html` (legacy standalone HTML calculator suite, `localStorage`-persisted assumptions under key `100upSolarCalc_v24`).
- CRM port: `app/src/pages/*` (new Supabase-backed app). Assumptions are being migrated to a Supabase table (see `supabase/migrations/`) so Simulation, Daily Load Profile, and other Quote Designer tools can read live data instead of `localStorage`.
