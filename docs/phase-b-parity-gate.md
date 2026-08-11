# Phase B Parity Gate — Expected Divergence List

**Date:** 11 August 2026
**Status:** Ready. One blocker to clear before the gate can run (§1).

Phase B step 4 says the rebuilt engine must reproduce V46 "to the cent". That
cannot be a plain equality check, because **V46 is wrong in places we already
know about** and the rebuild must not copy the defects. The gate needs to
distinguish *"differs because we fixed something"* from *"differs because we
broke something"* — and without this list it can only do the former by
accident, which means it cannot fail meaningfully.

**Rule: every difference must appear below.** Any unexplained difference, of
any size, fails the gate. "Close enough" is not a result.

---

## 1. BLOCKER — battery kWh is not what the engine sizes on

**This must be resolved before the gate runs. It is not a divergence, it is a
latent 14% error.**

| Battery | `stocks.kwh` (nominal) | V46 sizes on (usable) | Gap |
|---|---|---|---|
| SigenStor BAT 10.0 | **10.24** | **9** | 13.8% |
| SigenStor BAT 8.0 | 8.06 | — (not in V46) | — |
| Deye AI-W5.1-B | **5.12** | **5.1** | 0.4% |

V46's `sigBatteryKwh = 9` and `deyeBatteryKwh = 5.1` are **usable** capacity.
The `kwh` column on products is **nominal** — it was populated for CES, where
the form asks for "Nominal storage capacity kWh".

Both figures are correct for their own purpose, and they are not
interchangeable. If `priceSystem()` reads `stocks.kwh` it will size every
Sigenergy battery bank 14% high, which flows into battery STCs, the rebate
total, the final price and the July simulation. It would look plausible and be
wrong everywhere.

**Required before Phase B:** add `usable_kwh` to `stocks`, populated 9 / 5.1 /
(BAT 8.0 to be confirmed with Fred). The engine sizes on `usable_kwh`; CES
keeps reading `kwh`. Both stay visible and separately editable on the Products
page, labelled so nobody "corrects" one to match the other — the same trap
recorded in design doc D3a.

This is exactly why the gate exists: nothing in the app would have surfaced it.

---

## 2. Expected divergences — differences that PASS

### 2.1 Bug #6 — cost breakdown double-count · display only

| | |
|---|---|
| **Totals** | **Must match exactly.** `costBeforeMargin`, margin, GST, rebates and final price are all correct in V46 |
| **Line items** | Will differ. V46 prints the inverter row inclusive of gateway, mounting kit and PDU/Base, then prints the kit and PDU/Base *again* as separate rows |
| **New behaviour** | Line items sum exactly to base cost |
| **Verify** | Sum the displayed rows. V46 overshoots base cost by $250/inverter (Sig) or $550/inverter (Deye); the new engine sums to zero difference |

### 2.2 Bug #8 — optimise + ground discarded the inverter mode · PRICE CHANGES

The only divergence that moves money. Narrowly scoped:

**Diverges only when ALL of:** panel mode = optimise **and** mount = roof+ground
**and** inverter mode ≠ auto.

Everything else — fixed panels (any mount), optimise + roof-only, and any
optimise+ground run left on auto — **must match exactly**.

Two effects compound, and both are expected:

1. The forced mode now applies, so inverter count rises to the floor.
2. Battery parity then applies, which V46 skipped in this path
   (`optIsDual` excluded ground), so unit count can round up.

**Worked reference** (7 kWh/day, optimise 12–80, 15 ground panels, Sigenergy,
Dual selected):

| | V46 | Rebuilt | Why |
|---|---|---|---|
| Inverters | 1 | 2 | Dual floor now honoured |
| Battery units | 3 | 4 | 3 cannot split evenly across 2 |
| Base cost delta | — | **+$2,600** | One extra BAT 10.0 |

Any divergence in this scenario must be explainable as *inverter count rose to
the floor* plus *units rounded up to a multiple of that floor*. A different
shape of difference is a failure.

### 2.3 Bug #9 — Deye 10P1 · BOM changes, price does not

| | |
|---|---|
| **Price** | **Must match.** The product is priced $1,900, the same figure V46 used |
| **BOM** | Differs. V46 emitted `Deye AI-W5.1-10P1-AU-B` as an unmatched name and allocated nothing; the rebuild emits a real `stock_id` |
| **Watch** | If Fred later confirms the 1P 10kW costs something other than $1,900, this becomes a genuine price divergence and this row must be rewritten |

### 2.4 Deye stack base split · totals identical

V46 uses one number, `deyeBmsCost = 550`, for two physical products. The
catalogue splits it: PDU3 $250 + Base $300.

**Total must be identical at $550 per inverter.** The BOM gains a line. If the
total moves, the split is wrong.

### 2.5 Presentation-only changes

None of these may alter a total:

- Line items carry `stock_id`, not generated names — `normalizePart()` is out
  of the quote path entirely
- Fixed site costs are summed from rows, not four hardcoded fields. With the
  four seeded rows active the sum is unchanged at $5,000
- Battery rebate tiers are read from rows. With the seeded 0–14 / 14–28 /
  28–50 bands at 6.8 / 4.08 / 1.0, `batteryStcCount()` output is unchanged
- Gateway quantity is `per_n_inverters` divisor 3 rather than a hardcoded
  `ceil(invCount / 3)` — same arithmetic

---

## 3. Must NOT diverge

Differences here are failures, however small.

- Panel supply, install and frame costs; the ground-mount 50% install discount
- Fixed site costs total
- Margin, GST and their order of application (margin, then GST, then rebates)
- Solar STC count and value; battery STC banding
- Inverter selection under `auto` — fewest inverters, then lowest price, then
  largest kW on a tie
- Sigenergy 3-phase tier sweep across 15/20/30 kW, including skipping
  unconfigured (zero-cost) sizes
- Gateway count, mounting kit count, `maxBattPerInverter` behaviour
- Ground mount labour and machinery; frame at the ballpark rate while
  `gm_kits` does not yet exist
- `min_inverters` parity — units rounded against the **floor**, never against
  the naturally-derived count (design doc D2)

---

## 4. Gate procedure

**Scenarios** — run each on both engines, both brands:

| # | Setup |
|---|---|
| 1 | Fixed 36 panels, roof, auto battery, auto inverter |
| 2 | Fixed 36 panels, roof, auto battery, **dual** |
| 3 | Fixed 36 panels, roof, auto battery, **force large** |
| 4 | Fixed panels, **roof + ground**, auto — control for §2.2 |
| 5 | Fixed panels, roof + ground, **dual** — must match; fixed+ground was never broken |
| 6 | **Optimise**, roof only, dual — must match |
| 7 | **Optimise + ground**, dual — §2.2 divergence expected |
| 8 | **Optimise + ground**, force large — §2.2 divergence expected |
| 9 | Three-phase, auto and dual |
| 10 | A high battery count that forces `invForBatt` above `invForSolar` |

**Compare, in this order:** inverter count and kW → battery unit count and
kWh → each cost line → base cost → margin → GST → each rebate → final price.
Stop at the first mismatch; a later figure differing is usually a consequence,
not a second bug.

**Tolerance: $0.00 on every total.** These are deterministic arithmetic over
the same inputs, so floating-point drift is not an acceptable explanation for
a cent. If a cent appears, the operation order changed and that is worth
knowing.

**Instrument:** the `[DEVELOPMENT SANITY CHECK]` panel (design doc D2a) — new
engine against V46, per line item, with deltas. Build it as part of step 4
rather than comparing by hand; it is also what lets Fred confirm his numbers
survived, which is the harder half of the gate.

---

## 5. Sign-off

The gate passes when, across all ten scenarios:

- Every difference maps to §2, with the right shape and magnitude
- Nothing in §3 differs at all
- §1 is resolved — the engine sizes on usable capacity, not nominal

Ten scenarios × two brands is roughly twenty comparisons. That is an hour or
two, and it is the cheapest possible insurance against silently repricing a
solar business's entire quote book.
