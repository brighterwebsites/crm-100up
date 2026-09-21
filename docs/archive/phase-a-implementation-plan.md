# Phase A — Implementation Plan

**Date:** 11 August 2026
**Status:** Ready to execute. No open decisions.

This is a **sequencing** document, not a design one. The design is already
settled elsewhere and is not revisited here:

| Where | What it settles |
|---|---|
| `docs/design/quote-configurator-design.md` | Product-driven configurator; 9-step build order; D1–D6 all resolved |
| `docs/design/2026-08-11_design-brief.md` | Visual system; §7 resolved (light only, no dark calculator mode) |
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

Unchanged from `docs/design/quote-configurator-design.md` §8 — restated only for
sequence. Do not re-plan these until Phase A lands.

| Phase | Content | Gate |
|---|---|---|
| **B** | `system_configs` + inverters/batteries/components; `priceSystem()` engine; `[DEVELOPMENT SANITY CHECK]` parity panel | **Hard gate:** see `docs/archive/phase-b-parity-gate.md`. Blocker cleared — `usable_kwh` added and guarded. Phase B is unblocked |
| **C** | Calculator (1φ) → 3 Phase → GM BOM | Each a discrete deliverable |
| **D** | `quotes` + `quote_lines` (snapshot costs, 18-month expiry, versioning); convert quote → job | Step 7 precedes step 8: the quote record is what creates the customer |
| **E** | Quick Estimate, Simulation | |

---

## Still needed from Fred — none of it blocks Phase A

**All cleared 2026-08-11 in session with Fred:**

1. ~~Deye 10kW single-phase price~~ — 1P is $1,900 (already correct); 3P is
   $2,300, so the 10P3 was $400 light and is corrected.
2. ~~Whether any past job was underpriced by bug #8~~ — none were.
3. ~~Twenty minutes driving the app~~ — done.

**Raised during that session, still open:**

- **Artefacts.** `100UP_suite_V46.html` plus the existing exports are all that
  exist; there is no fresher CRM or assumptions export to collect. The 25 June
  and 20 June copies in the repo are the current state.
- **V46 freeze date** — not yet agreed. Until it is, the parity gate is
  measuring against a moving target.
- **Pipeline dot styling.** Fred prefers his V46 pulsing indicators. Cheap to
  honour, but worth separating the styling from what the dot COMMUNICATES: if
  it encodes time-in-stage, that is decision question 23 (the Alerts/Stale
  rules that exist as filters and are never set by anything) and the threshold
  should be captured.
- **"Important stock" quick view.** Wants at-a-glance levels for key products.
  Placement undecided — candidates are Pipeline, Stock and Order List. Worth
  establishing first whether "important" means *quoted on every job* (which
  the configurator will know by itself in Phase B, needing no flag) or *long
  lead time* (which does need a manual flag).

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
