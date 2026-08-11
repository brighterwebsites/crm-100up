# Phase A — Implementation Plan

**Date:** 11 August 2026
**Status:** Ready to execute. No open decisions.

This is a **sequencing** document, not a design one. The design is already
settled elsewhere and is not revisited here:

| Where | What it settles |
|---|---|
| `docs/quote-configurator-design.md` | Product-driven configurator; 9-step build order; D1–D6 all resolved |
| `docs/2026-08-11_design-brief.md` | Visual system; §7 resolved (light only, no dark calculator mode) |
| `docs/bugs.md` | #6–#9, all reproduced |

**Why this document exists.** Those two plans interleave, and they collide at
exactly one point — the Products page. Build it before the component work and
it gets restyled a week later; do all the component work first and the thing
that removes Fred's daily pain slips. This resolves the order and nothing else.

**The main risk to this phase is not technical.** A great deal of design has
been done in a short time and it is all sound. The failure mode from here is
continuing to plan rather than shipping. Phase A is deliberately sequenced so
something visible lands early and often.

---

## Prerequisite — clear before A3

- [ ] **Install the Supabase CLI.** Not on the dev machine. Migrations must go
      through `supabase db push`, not an agent connection — see `CLAUDE.md`
      convention 1 for why (it caused the history drift repaired in `6e609a4`).
      Blocks A3 onward. Everything before A3 can proceed without it.

---

## Phase A — foundation

Ordered by dependency. Each item ships on its own and leaves the app working.

| # | Item | Done when | Notes |
|---|---|---|---|
| **A1** | **Icon swap** — Lucide in, emoji out | No emoji remain in nav, buttons or pills; icons share one stroke weight and size | Brief §3.4. Highest visible change for the effort; touches every screen at once. Independent of everything else — safe to do first |
| **A2** | **Set-password screen** | A recovery link lands on a form that sets a new password via `supabase.auth.updateUser` | Real hole: "self-service password reset" is listed as Live but only half exists. Fred hits this the first time he forgets his password. ~30 lines |
| **A3** | **Migration: extend `stocks`** | `product_type`, `phase`, `brand`, `planning_cost`, `planning_cost_updated_at`, `active` exist; types regenerated | Design §3, step 0. Schema only — no UI, no calculator dependency. `quotable` deliberately dropped (D-decision: `product_type` + `phase` + `active` already scope every picker) |
| **A4** | **Backfill + GM products** | 17 existing rows classified and priced; 19 GM components created | Step 1. Data is dummy/test, so low stakes — it is re-imported at cutover. **Trap: usable kWh ≠ model number** (BAT 10.0 sizes on 9 kWh; AI-W5.1-B on 5.1). GM costs copy straight from `GM_DEFAULT_COSTS` (V46 line 3920). Also add the missing `Deye AI-W5.1-10P1-AU-B` (bug #9) |
| **A5** | **Products page** — new fields + `.detail-panel` consolidation | Product type/phase/brand/planning cost/active editable; `last_cost` and qty-on-hand shown inline with "use last cost"; `JobDetailPanel` and `StockDetailPanel` share one shell | Step 0 UI **and** brief §4 in one visit — this is the collision point, and doing them together is the whole reason for this document. Qty-on-hand beside cost is deliberate (see D3) |
| **A6** | **Settings screens** — pricing, rebates + tiers, sizing rules, fixed site costs, panel settings | All five editable in-app; nothing requires opening V46 to change a price | Step 2. **The payoff item.** Closes gap §4.5 and kills the standing risk that V46 and the database disagree on cost |

### What Phase A deliberately does not include

- No calculator, no configurator UI, no quote records. Those are Phase B+.
- No `receive-against-PO`, no notifications, no import-script rework.
- No dark mode. Tokens are structured for it; it is not built.

---

## After Phase A

Unchanged from `docs/quote-configurator-design.md` §8 — restated only for
sequence. Do not re-plan these until Phase A lands.

| Phase | Content | Gate |
|---|---|---|
| **B** | `system_configs` + inverters/batteries/components; `priceSystem()` engine; `[DEVELOPMENT SANITY CHECK]` parity panel | **Hard gate:** see `docs/phase-b-parity-gate.md`. Blocker cleared — `usable_kwh` added and guarded. Phase B is unblocked |
| **C** | Calculator (1φ) → 3 Phase → GM BOM | Each a discrete deliverable |
| **D** | `quotes` + `quote_lines` (snapshot costs, 18-month expiry, versioning); convert quote → job | Step 7 precedes step 8: the quote record is what creates the customer |
| **E** | Quick Estimate, Simulation | |

---

## Still needed from Fred — none of it blocks Phase A

1. **Deye 10kW single-phase price.** `deyeSingleInverterCost` = $1,900 is
   documented as the *10P3* price and is applied to both. Confirm whether the
   1P 10kW is the same, or single-phase quotes have been pricing off the
   three-phase unit. Also correct the `ASSUMPTION_META` note that wrongly says
   10kW is three-phase only (bug #9).
2. **Whether any past job was quoted through optimise + ground with a force
   setting selected.** Bug #8 means those priced the wrong configuration, and
   the fix moves prices. 18 jobs — directly checkable.
3. **Twenty minutes driving the app.** Nobody has used it as an admin. Per
   `docs/notes.md` §4 this produces more real requirements than the 37
   decision questions will, and it is now possible.

## Open, decide at build time — not blocking

- `--signal` orange does double duty as Stage 3 and the attention colour.
  Deliberate, but the most likely thing to feel wrong in use. Easy to dial back.
- Six hardcoded colours remain in `.tsx` (a repeated `#eef0f3` "closed" grey
  worth a token, plus load-profile chart colours). Fold in per screen as
  touched — brief §6.3, not a sweep.
- **Supabase Auth email still uses the throttled built-in SMTP.** App
  transactional mail is API-based (reference implementation exists in the
  Brighter Websites app), but Supabase Auth only accepts SMTP for reset /
  invite / confirm mail. Most providers expose both on one account. Needed
  before go-live, not before Phase A.
