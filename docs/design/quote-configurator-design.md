# Quote Configurator — Design & Mapping

**Status: proposed, nothing built.** This replaces the "port the Assumptions table"
line item in `docs/archive/2026-07-29_status-gap-and-decisions.md` §7 Phase A/B with a
concrete target shape.

**One-line summary.** Stop treating Assumptions as a flat table of 45 numbers.
Turn it into a **configurator** where anything that is a physical thing you buy
is selected from the product catalogue, and only genuinely global business
values (margin, GST, rebate rates, sizing rules) remain as typed numbers.

This is **Theme A, Level 3** from the decisions doc — the fully configurable
catalogue. It is the expensive option, and that trade-off is called out in
§9 below. Read that before committing.

---

## 1. The problem, stated precisely

Today a Sigenergy 8kW inverter exists in **four** disconnected places:

| Place | Representation |
|---|---|
| `assumptions.sig_inverter_cost` | the number `1550` |
| `ASSUMPTION_META` (V46 line 3192) | the label `'Sig 8kW · EC 8.0 SP'` |
| `partInverter()` naming template (V46) | the string `` `SigenStor EC ${kw}.0 ${SP|TP}` `` |
| `stocks` row id 5 | `name = 'SigenStor EC 8.0 SP'`, `qty`, `last_cost`, CEC specs |

`ASSUMPTION_STOCK_LINKS` (V46 line 3235) is a hand-maintained map stitching
one to four together **for display only** — it shows on-hand qty next to a cost
figure that has no relationship to it (`docs/bugs.md` #3).

Consequences, all currently live:

- Adding a new inverter tier = new DB column + new assumption meta row + new
  naming-template branch + new regex in `normalizePart()` + new entry in
  `ASSUMPTION_STOCK_LINKS`. Five places, all code.
- Component quantities are hardcoded arithmetic, not data:
  `gatewayCount = ceil(invCount/3)`, `groundKitCost = invCount × 250`,
  `deyeBmsCost = invCount × 550`. A third brand cannot be expressed at all.
- The brand split is a literal `isSig = brand === 'Sigenergy'` ternary repeated
  **five times** across `costForWithConfig`, `costFor3phWithConfig`,
  `costFor3phWithConfigGround`, `costForGroundWithConfig`, and `_sig3phBest`.
- Quoted cost and paid cost can drift silently and nothing surfaces it.

---

## 2. Principle

> **If it is a thing you buy, it is a product row. The configurator selects
> products and applies quantity rules. It never stores a price.**

Corollary: the calculator's output BOM stops being *generated names matched by
regex* and becomes *product IDs already known at calculation time*. This deletes
`normalizePart()`'s role in the quote path entirely (it stays for the
paste-an-invoice receive flow, where free text is genuinely the input).

### 2.1 Why this is about correctness, not just configurability

The flexibility argument ("adding a product becomes data entry") is the weaker
half. The stronger half is that **the link becomes structurally guaranteed
instead of conventionally hoped-for**.

Today the chain from a quoted item to its stock level and price is:

```
assumption column → naming template → free-text string
  → normalizePart() regex → stocks.name → qty / last_cost
```

Every arrow is a place it can silently fail, and one of them is a regex against
a hand-typed name. Rename a stock item, get a supplier model number with a
different suffix, add a tier the regex doesn't anticipate — the match returns
`{key: 'raw:…', name: null}`, the quote still prices (from the assumption
number), and nothing surfaces that stock is now invisible for that line. It
fails *quietly and plausibly*, which is the worst failure mode for a pricing
tool.

Under this design the chain is:

```
system_config_components.stock_id → stocks
```

One FK. Postgres will not let you configure a system pointing at a product that
doesn't exist, and `on delete restrict` will not let you delete a product a
config still references. The quote's BOM carries `stock_id` into
`job_stock_items` directly — **there is no string anywhere in the path**, so
"will pricing and stock-on-hand show up where he wants" stops being a question
about naming discipline and becomes a database constraint.

Three surfaces make the coverage visible rather than assumed:

1. **Config health check** on the configurator page — flags a system config
   with no battery, an inverter tier whose product is inactive, or a component
   row pointing at a product with `planning_cost = 0`.
2. **Staleness badge** on the Products list — quotable products where
   `last_cost <> planning_cost`, or the planning cost hasn't been refreshed in
   N days.
3. **Unquotable-product report** — products marked `quotable` that no system
   config references, and configs referencing products marked `active = false`.

None of these exist today, and none of them are buildable while the link is a
regex — you cannot report on a match that might silently not happen.

---

## 3. Product catalogue — extending `stocks`

`stocks` already carries `category`, `manufacturer`, `model`, `kva`, `kw`,
`kwh`, `watts`, `verified`, `last_cost`, `preferred_supplier_id` (migration
`20260719020001_merge_stock_specs.sql`). It is 80% of a product catalogue
already. Add:

```sql
-- product_type is deliberately NOT ces_category. ces_category answers
-- "does this appear on a CES form and how"; product_type answers "what role
-- does this play in a system configuration". A mounting kit is
-- ces_category='other' but product_type='mounting'.
create type public.product_type as enum (
  'panel', 'inverter', 'battery', 'gateway', 'mounting',
  'bms', 'gm_component', 'consumable', 'other'
);

create type public.electrical_phase as enum ('single', 'three', 'na');

alter table public.stocks
  add column product_type   public.product_type    not null default 'other',
  add column phase          public.electrical_phase not null default 'na',
  add column brand          text    not null default '',   -- filter/grouping key
  -- Planning price used by the configurator. Deliberately separate from
  -- last_cost (what was actually paid) so a mid-quarter supplier price rise
  -- does not silently move live quotes. See §9 decision D3.
  add column planning_cost  numeric not null default 0 check (planning_cost >= 0),
  add column planning_cost_updated_at timestamptz,
  add column quotable       boolean not null default false, -- selectable in configurator
  add column active         boolean not null default true;  -- false = EOL, hide from pickers
```

`brand` is a plain text column, not a `manufacturers` table — that
normalisation stays **PARKED** per `docs/archive/schema-restructure-proposal.md` §7.
Nothing here forecloses it.

**"Refresh from last cost"** is a per-product action (and a bulk action on the
Products page): copies `last_cost` → `planning_cost`, stamps
`planning_cost_updated_at`. A staleness badge on the Products list flags any
quotable product where `last_cost <> planning_cost` or the stamp is older than
N days. This is Theme A **Level 1** behaviour sitting on top of a Level 3
catalogue — you get the flexibility without the "supplier price change silently
reprices quotes" hazard.

---

## 4. Configurator schema — the five sections

Mapping the mind map to tables. Each section is independently editable.

### 4.1 System Setup

Two named system options compared side by side (today: hardcoded Sigenergy vs
Deye). Generalised:

```sql
create table public.system_configs (
  id           bigint generated by default as identity primary key,
  -- brand_filter narrows the product pickers AND seeds the default label, so
  -- the group is named for its brand ("Sigenergy", "Sigenergy budget") without
  -- brand ever entering the calculation. Label stays editable.
  brand_filter text    not null default '',
  label        text    not null,
  standby_w    numeric not null default 0,    -- parasitic draw, feeds Simulation
  sort_order   smallint not null default 0,
  active       boolean not null default true
);
```

**A config is not phase-specific** — see §4.2. One Sigenergy config serves both
single- and three-phase quoting; the phase is chosen on the quote, and only the
rows that actually differ by phase are scoped.

-- Inverter tiers available to this config. The engine picks between them the
-- way _sig3phBest() does today: fewest inverters, then lowest price, then
-- largest kW. min_inverters replaces the costForDual8() "force 2" variant.
create table public.system_config_inverters (
  id             bigint generated by default as identity primary key,
  config_id      bigint  not null references public.system_configs(id) on delete cascade,
  stock_id       bigint  not null references public.stocks(id) on delete restrict,
  min_inverters  smallint not null default 1,
  -- Null = inherit the global sizing rule. Set to override per tier.
  oversize_percent numeric,
  max_batteries    smallint,
  sort_order       smallint not null default 0
);

create table public.system_config_batteries (
  id         bigint generated by default as identity primary key,
  config_id  bigint not null references public.system_configs(id) on delete cascade,
  stock_id   bigint not null references public.stocks(id) on delete restrict,
  is_default boolean not null default true
);
```

`kw` and `kwh` come from the product row — `sig_battery_kwh`,
`deye_battery_kwh`, and the `invKw` literals `8 / 10 / 12 / 15 / 20 / 30`
scattered through the V46 engine all disappear.

### 4.2 Additional Components — the part that kills the hardcoding

```sql
create type public.qty_rule as enum (
  'per_system', 'per_inverter', 'per_n_inverters',
  'per_battery', 'per_n_batteries', 'per_panel', 'per_kw_solar'
);

create table public.system_config_components (
  id         bigint generated by default as identity primary key,
  config_id  bigint  not null references public.system_configs(id) on delete cascade,
  stock_id   bigint  not null references public.stocks(id) on delete restrict,
  rule       public.qty_rule not null default 'per_system',
  qty        numeric  not null default 1,   -- multiplier
  divisor    smallint not null default 1,   -- the "n" in per_n_*; ceil() applied
  sort_order smallint not null default 0
);
```

Every current hardcoded component becomes one row:

| Today (code) | Becomes (data) |
|---|---|
| `gatewayCount = ceil(invCount/3)` × `sigGatewayCost` | Sigen Gateway HomePro SP-F, `per_n_inverters`, qty 1, divisor 3 |
| `groundKitCost = invCount × sigGroundKitCost` | SigenStor mounting kit, `per_inverter`, qty 1 |
| `deyeBmsCost = invCount × deyeBmsCost` | Deye AI-W5.1-PDU3, `per_inverter`, qty 1 **+** Deye AI-W5.1-Base, `per_inverter`, qty 1 |
| 3φ gateway (`sig3phGatewayCost`) | same as row 1 but on the three-phase config |

Note the Deye case: `deye_bms_cost = 550` is today **one number covering two
physical products** (`ASSUMPTION_STOCK_LINKS.deyeBmsCost` maps to a two-element
array). Splitting it into two component rows makes the BOM honest and lets each
part carry its own cost and stock level.

### 4.2b Phase — a scope, not a per-row assignment

Comparing the single-phase engine (`costForWithConfig`, V46 2063) against the
three-phase one (`costFor3phWithConfig`, 2145) line by line, **only three things
differ**:

| | Single phase | Three phase |
|---|---|---|
| Inverter products | EC 8.0 / 12.0 SP, AI-W5.1-8P1 / 10P3 | EC 15/20/30 TP, AI-W5.1-12P3 |
| Sig gateway product | HomePro SP-F (22kW) | C60 (60kW) |
| Solar oversize rule | 200% | 160% |

Panels, batteries, mounting kit, Deye PDU/Base, fixed costs, rebates, margin,
GST and max-batteries-per-inverter are **identical**. So duplicating a whole
config per phase would clone a dozen rows to change two.

Instead, phase is a **scope** on the rows that vary:

```sql
alter table public.system_config_components
  add column phase_scope public.electrical_phase not null default 'na';
  -- 'na' = applies to both phases (mounting kit, PDU, Base — the common case)
  -- 'single' / 'three' = only when quoting that phase (the two gateways)
```

Inverter tiers need no extra column — they inherit phase from the product
(`stocks.phase`), and the engine only considers tiers matching the quote's
phase. The oversize rule already has both values in `sizing_rules`.

So the Sigenergy config holds: mounting kit (`na`), gateway HomePro
(`single`), gateway C60 (`three`), and six inverter tiers whose own `phase`
sorts them. Quote single-phase and the TP tiers and the C60 simply aren't
candidates.

**This revises my earlier "phase doesn't belong on the row".** That was too
absolute — the instinct to put it there was right, it just isn't a free choice
per row. It answers *"which phase(s) does this component apply to"*, defaults
to both, and only needs setting on the rare row where the product differs. The
thing to avoid is a dropdown that lets you assign a three-phase product to a
single-phase system; scoping doesn't do that, because the product's own `phase`
still governs electrical validity.

**"Select from Brands":** brand is a picker *filter* and the default label
prefix for the config group — never a calculation input. `brand_filter` on
`system_configs` does both.

### 4.3 Sizing Rules

Stays as typed numbers. These are engineering/regulatory limits, not products.

```sql
create table public.sizing_rules (
  id                         smallint primary key default 1 check (id = 1),
  solar_oversize_percent     numeric  not null default 200,  -- single phase
  solar_oversize_3ph_percent numeric  not null default 160,
  max_batteries_per_inverter smallint not null default 6,
  min_inverters              smallint not null default 1
);
```

Per-tier overrides live on `system_config_inverters` (§4.1) so a specific
inverter with a different oversize allowance doesn't need a global change.

### 4.4 Fixed Site Costs — repeater

```sql
create table public.fixed_site_costs (
  id         bigint generated by default as identity primary key,
  label      text    not null,
  amount     numeric not null default 0,
  active     boolean not null default true,
  sort_order smallint not null default 0
);
```

Seeded with the existing four: Small parts $1000, Installer sign off $1500,
CES $500, Fixed labour $2000.

Deliberately **no `stock_id`** — see D4. Linking "small parts" to a real
consumables product is speculative until Fred says he wants consumables
stock-tracked, and adding a nullable FK later is a one-line migration.

### 4.5 Rebates

```sql
create table public.rebate_settings (
  id                smallint primary key default 1 check (id = 1),
  solar_stc_per_kw  numeric not null default 6.8,
  solar_stc_price   numeric not null default 38,
  battery_stc_price numeric not null default 38
);

-- Replaces battery_tier1/2/3 + the hardcoded 14/28/50 kWh band boundaries
-- baked into batteryStcCount() (V46 line 2044).
create table public.battery_rebate_tiers (
  id           bigint generated by default as identity primary key,
  from_kwh     numeric not null,
  to_kwh       numeric,              -- null = no upper bound
  stc_per_kwh  numeric not null,
  sort_order   smallint not null
);
-- Seed: (0, 14, 6.8), (14, 28, 4.08), (28, 50, 1.0)
```

Band boundaries becoming data matters — federal rebate tiers change by
legislation, and today changing 14→15 kWh is a code edit.

### 4.6 Pricing

```sql
create table public.pricing_settings (
  id     smallint primary key default 1 check (id = 1),
  margin numeric not null default 0.30,
  gst    numeric not null default 0.10
);
```

### 4.7 Solar Panels (shared across both systems)

Per the mind map, panels sit outside System 1 / System 2:

```sql
create table public.panel_settings (
  id                   smallint primary key default 1 check (id = 1),
  stock_id             bigint references public.stocks(id) on delete restrict,
  install_cost_per_w   numeric not null default 0.35,
  roof_frame_per_panel numeric not null default 50
);
```

`panel_w`, `panel_cost`, `panel_mfr`, `panel_model` all come from the product
row — which also resolves decision Q10 in the decisions doc (the quote carries
the specific panel product through to CES, instead of generic "Solar panel
475W").

---

## 5. Ground mount

**Recommendation: two layers, and stop duplicating.**

Today there are already two GM concepts and they overlap badly:

- **Ground Mount Extras** (assumptions): `gm_frame_per_panel`,
  `gm_labour_per_panel`, `gm_machinery_fixed` — a $/panel estimate.
- **Ground Mount BOM Calculator**: 19 real parts with geometry-derived
  quantities and hand-entered costs stored in a `gmCosts` localStorage blob,
  producing `costPerPanel`.

They are already wired together — `gmFramePerPanelEff` (V46 line 3030) uses the
BOM's `costPerPanel` when the "use BOM" checkbox is ticked, else the flat
assumption. So the link exists; it's just informal and the costs live outside
the catalogue.

**Proposed:**

1. **The 19 BOM parts become products** — `product_type = 'gm_component'`,
   carrying `model` (the `100-0119` part code), supplier SKU, L&H order code,
   unit weight, `planning_cost`. This kills the `gmCosts` localStorage blob and
   makes GM parts orderable and stock-trackable like everything else.

   **The costs already exist and already calculate.** `GM_DEFAULT_COSTS` (V46
   line 3920) holds all 19 real unit prices from an L&H quote — ground screw
   $45.85, C-purlin rail $48.28, U-truss $59.66, down to $0.28 for a spacer —
   hardcoded as defaults, overridable per part in localStorage under
   `GM_COST_KEY`, saved values winning. `calcGmBom()` multiplies them by the
   geometry-derived quantities live. So migration here is a **straight copy
   into 19 product rows**, not a data-gathering exercise. Note two rows share a
   price by design (`100-0121` M12×110 is quoted under the M12×90 SKU) and the
   end clamp is a 30mm/35mm pair selected by panel thickness — both need to
   survive as distinct products.

2. **A GM kit definition** maps products to their per-array quantity:

   ```sql
   create table public.gm_kits (
     id     bigint generated by default as identity primary key,
     label  text not null,          -- "Standard 2-row ground array"
     active boolean not null default true
   );

   create table public.gm_kit_items (
     id           bigint generated by default as identity primary key,
     kit_id       bigint not null references public.gm_kits(id) on delete cascade,
     stock_id     bigint not null references public.stocks(id) on delete restrict,
     -- Quantities are geometry, not data entry: ground screws, joiners, rails
     -- etc. are functions of panelsPerRow and array length (V46 lines
     -- 4008-4026). Keep the formulas in code, keyed here.
     formula_key  text not null,
     multiplier   numeric not null default 1,
     sort_order   smallint not null
   );
   ```

   **Why `formula_key` and not an expression string:** the quantities are
   derived engineering (`groundScrews = (ceil((arrayLength - 600 - 4320)/2700)
   + 3) × 2`). Storing that as evaluable text buys nothing but an injection
   surface and a debugging problem. What actually changes over time is *cost*
   and *supplier* — those become data. Geometry stays code.

3. **"Ground Mount Extras" shrinks to two fields**: `gm_labour_per_panel` and
   `gm_machinery_fixed` (both genuinely labour/plant, not products). Frame cost
   comes from the GM kit — delete `gm_frame_per_panel` and the "use BOM?"
   checkbox rather than keeping two independent sources of truth for one
   number.

   **But keep a ballpark** (see D5): the kit caches
   `ballpark_cost_per_panel`, recalculated whenever a real array is costed
   against it, so early-stage quotes made before the paddock is measured still
   have a figure — clearly labelled as an estimate. One source of truth, with a
   cached value, rather than two numbers that can disagree.

4. GM stays a **mount context on the quote**, not a system option. The
   configurator asks "how many panels roof / how many ground" — exactly the
   existing `costForGroundWithConfig(brand, roofPanels, gmPanels, units, ...)`
   signature. It is not a third system column.

---

## 6. Calculation engine

The five near-identical cost functions in V46 (`costForWithConfig`,
`costForGroundWithConfig`, `costFor3phWithConfig`,
`costFor3phWithConfigGround`, plus the `costFor*` wrappers) collapse into one:

```
priceSystem(config, { roofPanels, gmPanels, batteryUnits, gmKit }) →
  1. panels     → panel_settings.stock_id → planning_cost, watts
                  supply + install($/W × W, GM panels at 50%) + roof frame
  2. inverter   → for each system_config_inverters tier:
                    invForSolar = max(min_inverters, ceil(solarKw / (kw × oversize/100)))
                    invForBatt  = ceil(units / max_batteries)
                    invCount    = max(invForSolar, invForBatt)
                  pick: fewest inverters → lowest price → largest kW
  3. batteries  → units × battery.planning_cost;  kWh = units × battery.kwh
  4. components → for each system_config_components row, apply qty_rule
  5. fixed      → sum(fixed_site_costs where active)
  6. GM extras  → gm_kit cost + labour/panel + machinery
  7. base       → 1+2+3+4+5+6
  8. margin, GST, rebates (solar STC + battery tiers) → final price
  9. BOM        → line items with real stock_id, qty, unit cost
```

No brand branches. No naming templates. No `normalizePart()` in this path.
Step 9 means "Link quote to job" stops being a fuzzy name match and becomes a
direct `job_stock_items` insert.

**Every line item must reconcile to the base cost.** The V46 breakdown does not
(see bug #6, logged in `docs/bugs.md`) — build the display by summing the same
line-item array the engine produced, never by re-deriving labels alongside a
separately-computed total.

---

## 7. Mapping — all 45 assumption values

| Assumption key | Destination |
|---|---|
| `panelW` | product `watts` |
| `panelCost` | product `planning_cost` |
| `panelMfr`, `panelModel` | product `manufacturer`, `model` |
| `panelInstallPerW` | `panel_settings.install_cost_per_w` |
| `panelFrame` | `panel_settings.roof_frame_per_panel` |
| `sigBatteryKwh`, `deyeBatteryKwh` | product `kwh` |
| `sigBatteryCost`, `deyeBatteryCost` | product `planning_cost` |
| `sigInverterCost` | product `planning_cost` (SigenStor EC 8.0 SP) |
| `sigSingleInverterCost` | product `planning_cost` (EC 12.0 SP) |
| `sig3ph15kwCost` / `20kwCost` / `30kwCost` | product `planning_cost` (EC 15/20/30 TP) |
| `deyeInverterCost` | product `planning_cost` (AI-W5.1-8P1-AU-B) |
| `deyeSingleInverterCost` | product `planning_cost` (AI-W5.1-10P3-AU-B) |
| `deye3phInverterCost` | product `planning_cost` (AI-W5.1-12P3-AU-B) |
| `sigGatewayCost`, `sig3phGatewayCost` | product `planning_cost` + component row (`per_n_inverters`, 3) |
| `sigGroundKitCost` | product `planning_cost` + component row (`per_inverter`) |
| `deyeBmsCost` | **splits into two** products (PDU3, Base) + two component rows |
| `minInverters` | `sizing_rules` + per-tier override |
| `maxBattPerInverter` | `sizing_rules` + per-tier override |
| `solarOversizePercent`, `solarOversize3phPercent` | `sizing_rules` |
| `smallParts`, `installerSignOff`, `ces`, `labourFixed` | `fixed_site_costs` rows |
| `solarStcPerKw`, `solarStcPrice`, `batteryStcPrice` | `rebate_settings` |
| `batteryTier1/2/3` | `battery_rebate_tiers` rows (+ band boundaries, now data) |
| `margin`, `gst` | `pricing_settings` |
| `gmFramePerPanel` | **deleted** — derived from GM kit |
| `gmLabourPerPanel`, `gmMachineryFixed` | GM settings (stay as numbers) |
| `sigStandbyW`, `deyeStandbyW` | `system_configs.standby_w` |
| `loadProfile` | unchanged — stays on a settings singleton (Simulation input) |

Net: of 45 values, **21 become product data**, 3 are deleted or merged, and
21 remain typed settings across five small tables.

Also disappearing: the naming templates `partInverter()` / `partBattery()` /
`partSigGateway()`, the `ASSUMPTION_STOCK_LINKS` map, and the quote-path use of
`normalizePart()`.

---

## 8. Build order

Each step is independently shippable and leaves the app working.

| # | Step | Notes |
|---|---|---|
| 0 | Extend `stocks` (§3); Products page gains type/phase/brand/planning cost/quotable/active + "refresh from last cost" | No calculator dependency — ships alone, immediately useful |
| 1 | Backfill: classify the 17 existing stock rows, set `planning_cost` from the current assumption values | One-off data task, cross-check against `ASSUMPTION_STOCK_LINKS`. **Trap:** usable kWh ≠ the model number — `SigenStor BAT 10.0` has `sig_battery_kwh = 9`, and Deye `AI-W5.1-B` is 5.1. `stocks.kwh` must carry the *usable* figure the engine sizes on; don't "correct" it to match the name |
| 2 | Settings tables: pricing, rebates + tiers, sizing rules, fixed site costs, panel settings — with editors | This alone closes gap §4.5 "assumptions unreachable through the interface" |
| 3 | `system_configs` + inverters/batteries/components + the configurator UI | The mind map's System Setup panel |
| 4 | Engine `priceSystem()` against the new model; validate output equals V46 to the cent on ~6 known jobs. Build the `[DEVELOPMENT SANITY CHECK]` parity panel here (see D2a) — new engine vs V46, per line item, with deltas | **Hard gate.** Do not proceed on a mismatch. The panel is the instrument for this step, not a UI feature — flagged, admin-only, removed at handover |
| 5 | Calculator (1φ) page → then 3-Phase (same engine, `phase='three'` configs) | |
| 6 | GM components as products + `gm_kits` + GM BOM page | Frame cost switches to kit-derived; `gm_frame_per_panel` dropped here |
| 7 | `quotes` + `quote_lines` (snapshot costs, versioning, status); save/send a quote; prospect = customer with no jobs | **Moved up by D6** — was "emit BOM lines onto a job". Design alongside step 3, since both define the configurator's output shape |
| 8 | Convert quote → job; BOM lines carry real `stock_id` into `job_stock_items` | Retires the fuzzy-match path |
| 9 | Quick Estimate, Simulation | Simulation reads `system_configs.standby_w` |

Two things not to compromise on:

- **Step 4's regression gate.** A silent pricing change is the worst possible
  outcome of this work. Note that V46 is the reference for *pricing*, not for
  behaviour — bugs #6, #8 and #9 are known-wrong and must not be replicated.
  Reproduce the numbers, not the defects.
- **Step 7 before step 8.** D6 established that the quote record is what
  creates the customer, so conversion depends on it existing. Building the
  job-link first means rebuilding it.

---

## 9. Decisions needed before step 3

These change the schema, so they need answering before the configurator tables
are written, not after.

- **D1 — Level 3 vs Level 1 — RESOLVED: Level 3.** Originally framed as "how
  often does the product range change?", which pointed at Level 1 (keep the
  flat table, add a `stock_id` FK per cost column) since the brands are stable.
  That framing was wrong. The deciding question is **"does Fred sell anything
  the fixed column set cannot express?"** — and he does: batteries and panel
  models turn over roughly yearly, and there are other systems sold outside the
  Sigenergy/Deye pair. Level 1 gives a guaranteed link *only for products that
  have a column*; anything else has no row to attach to and stays invisible to
  pricing and stock. Since the requirement is that every quoted item reliably
  carries its own price and stock level (§2.1), Level 1 cannot deliver it and
  the brands-are-stable argument doesn't apply.
### D2 — How the inverter-choice override generalises to N tiers

**Not** "auto vs manual" — Fred already has both. The Calculator has a
three-way radio (V46 line 2865, `mainInvConfig`):

| Mode | Function | Behaviour |
|---|---|---|
| `auto` | `costForAuto` | Try 8kW-dual and 12kW-single; fewest inverters, then lowest price |
| `large` | `costForLarge` | Force the single large inverter (12kW Sig / 10kW Deye) |
| `dual8` | `costForDual8` | Force 8kW with `minInv = 2`, regardless of solar kW |

Three-phase Sigenergy separately auto-selects across 15/20/30kW in
`_sig3phBest` with no manual override at all.

So the real question is how three hardcoded modes become N data-driven tiers.
Proposed:

- **Per-quote inverter mode** = `auto` (engine ranks all tiers for this config
  and phase) **or** pin to one specific `system_config_inverters` row.
- **`dual8` decomposes into two things**: pin the 8kW tier, *and* force a
  minimum inverter count. `min_inverters` currently sits on the tier
  (config-level) — forcing 2 for one quote needs it as a **per-quote override
  input**, not a config edit. Add that field to the quote form.

**RESOLVED (Vanessa, with Fred's operational context):** `dual8` means **"force
at least 2 inverters"**, not "pin the 8kW tier". Confirmed by the code —
`costForDual8` only passes `minInv = 2` into
`max(minInv, ceil(solarKw / maxSolarPerInv))`, so it is purely a **floor**.
That is also why it stops having any visible effect once the system is large
enough to need two inverters regardless.

The driver is redundancy/failover. Note this is **not symmetrical between
brands** — Sigenergy units fail over natively, whereas a redundant Deye setup
needs deliberate wiring. So "force 2" carries an install implication on Deye
that it doesn't on Sig, and should surface as a note on the quote rather than
being silently equivalent.

**Design consequence:** a per-quote **`min_inverters` override** (integer,
default = the tier's own value). Not a tier pin, and not a config edit. Tier
selection stays `auto` unless explicitly pinned. This is a strict superset of
today's three modes.

**Three-phase already has this, and already names it correctly.** (Correcting
an earlier error in this doc — the claim that 3φ had no override was wrong; it
was based on `_sig3phBest`'s signature without checking its wrappers.) The 3φ
tab has its own radio at line 1327:

```html
<input type="radio" name="three3phInvConfig" value="dual"> Dual (min 2 inv)
```

fully plumbed via `costForSig3phBestDual` / `costForDeye3phDual`, their ground
variants, and `findMinUnits3ph(isDual)`. **The 3φ label — "Dual (min 2 inv)" —
is the honest one**; single-phase's "Dual 8kW" is what made the same mechanism
look like a tier pin. Use the 3φ wording in the rebuild.

3φ also needs no "force large" equivalent: `_sig3phBest` already sweeps
15/20/30kW automatically and Deye 3φ has a single model (12kW), so there is no
tier to pin. Not a gap.

**Battery parity — generalise against the floor, not the final count.**
`enforceDualEven()` (line 2056) forces battery units even when dual is active,
so they split across the two inverters. Hardcoded to the 2-inverter case.

The obvious generalisation — "units divisible by the final inverter count" — is
**circular** and must not be built: `invCount = max(invForSolar,
ceil(units / maxBatt), minInv)`, so the count depends on the units, and
rounding the units up can push the count up again.

The non-circular rule, which is also what V46 actually does: **parity applies
to the forced floor (`min_inverters`), not to the naturally-derived count.**
V46 forces even because dual sets the floor to 2; it does *not* force
divisibility by 3 when three inverters happen to result from solar sizing. So:

```
units = roundUpToMultipleOf(units, min_inverters)   // before costing
invCount = max(invForSolar, ceil(units / maxBatt), min_inverters)
```

No iteration, no circularity, and it's a faithful port. If Fred later wants
even splitting across a naturally-derived count too, that is a **different
rule** with a real trade-off (it would silently add batteries), and should be
decided separately rather than assumed into the generalisation.

**Deye "force large" on single phase — RESOLVED: add the missing product.**

**This entry previously said the opposite** ("remove the option — the 10kW Deye
is three-phase only"). That was wrong, and how it went wrong is worth keeping,
because it is an argument for the whole design.

`AI-W5.1-10P1-AU-B` is a real Australian product, stocked by multiple AU
retailers. The mistaken claim came from the `ASSUMPTION_META` note on
`deyeSingleInverterCost` — *"10kW exists only as three-phase"* — which is true
of Deye's **EU** range (`AI-WS.1-*-EU-B`: single phase 3.6/5/6/7.6/8; three
phase 5/6/8/10/12) and was generalised to the **AU** range, where a 1P 10kW
does exist. The calculator was right; the catalogue and the note were wrong.

**Fix: add the product to `stocks`.** `normalizePart()` keys a row named
`Deye AI-W5.1-10P1-AU-B` to `deye-inv-10p1`, which matches the generated string
exactly, so the silent allocation failure resolves with a data change alone.
The `ASSUMPTION_META` note should be corrected too, or the next person
re-derives the same wrong conclusion from the same datasheet.

**Open question for Fred:** `deyeSingleInverterCost` = $1,900 is documented as
the *10P3* price and is currently applied to both. Confirm whether the 1P 10kW
is the same price, or the single-phase calculator has been pricing off the
three-phase unit.

**What this episode actually demonstrates.** Establishing whether one product
could legitimately be quoted required reading a naming template, a regex, an
assumptions-metadata comment, and a manufacturer datasheet — and the answer
that came back was still wrong. That is the architecture defect, not a product
question. Under this design the same task is: create a product row, attach it
as an inverter tier on the Deye config, done. No template, no regex, no note to
misread. **Adding products Fred wants to sell should never require code
archaeology** — that requirement is the whole justification for §2.1.

### D2a — `auto` runners-up: a development sanity-check table

**Not a UI change to the finished tool.** Fred's early versions had a
many-options comparison table and he deliberately cut it, so the shipped
Calculator shows the winner only. That stands.

**But during the rebuild, build the comparison as a diagnostic panel** —
labelled **`[DEVELOPMENT SANITY CHECK]`**, collapsed by default, admin-only,
behind a flag that can be removed cleanly at the end. Two reasons it earns its
place, neither of which is "redesigning his tool":

1. **It is the tooling step 4's regression gate needs anyway.** The gate
   requires comparing new-engine output against V46 to the cent. Doing that as
   a panel inside the app — new engine vs V46, per line item, with the delta —
   is more useful than a one-off script and costs about the same. It pays for
   itself twice.
2. **Given bugs #6, #8 and #9, "the winner looks right" is not evidence.** All
   three produce a plausible-looking single answer. Seeing the runners-up and
   the per-line arithmetic is how a wrong tier selection or a double-counted
   component becomes visible instead of just being a number Fred has no way to
   check.

Frame it to Fred as a build-time instrument, not a feature: it shows the
working so both sides can confirm the rebuilt engine reproduces his numbers,
and it comes out before handover unless he asks to keep it.

**Two live defects found while resolving this** — logged as `docs/bugs.md`
#8 (ground optimise silently discards the inverter mode) and #9 (force-large
Deye 1φ generates a non-existent `10P1` part that then fails stock matching).
Both must be understood before the engine rewrite, since step 4's regression
gate compares against V46's output — **do not replicate these two.**

### D3 — `planning_cost` vs `last_cost` — RESOLVED

**Fred confirmed: last price paid must be visible in the calculator.**

Build as in §3 — both fields, with `last_cost` shown alongside `planning_cost`
on every configurator line, not hidden behind a Products-page visit. Where they
differ, show the delta inline with a one-click "use last cost" so Fred can
accept the new price at the moment he notices it.

**Show quantity on hand on the same line**, and this is not decoration. When a
supplier price moves but the old stock is still on the shelf, "what do I quote"
has no automatic answer — quoting the new price on stock bought cheaper, or the
old price on stock that will need replacing dearer, are both defensible and
the right call depends on the job. Qty on hand is the input to that judgement,
which is why the V46 Assumptions table carried a "Stock avail." column next to
each cost in the first place.

Worth correcting the record: `docs/bugs.md` #3 framed that column as a flaw —
"live stock availability next to a cost figure that isn't tied to it". The flaw
was the **missing link**, not the juxtaposition. Putting availability beside
cost was deliberate and useful, and the rebuild should keep it, now with the
two actually connected.

This satisfies decisions-doc **Q5**: the quote prices off `planning_cost` (so
a mid-quarter supplier rise doesn't silently move quotes), while `last_cost` is
always on screen so the planning price can never drift unnoticed. Visible, not
automatic.

**Q7** (should sent quotes be repriced or frozen?) is a different question and
is handled in D6.

#### D3a — Spec fields are not cost fields

The D6 snapshot freezes a *sent* quote against later catalogue edits. It does
**not** protect future quotes from a catalogue that has become wrong — and the
two failure modes are different in kind:

| | Cost fields (`planning_cost`, `last_cost`) | Spec fields (`kwh`, `kw`, `watts`, `phase`) |
|---|---|---|
| Change how often? | Constantly — expected | Essentially never for a given product |
| Effect of a change | Price moves | **System design moves** — unit counts, inverter counts, rebate bands |
| A change means | Supplier repriced | Either a data-entry error, or it's a *different product* |

`SigenStor BAT 10.0` sizes on **9 kWh usable**, and `Deye AI-W5.1-B` on
**5.1 kWh** — in both cases the model name and the sizing figure disagree, and
they are supposed to. Someone tidying the catalogue "corrects" the 9 to a 10
and every subsequent Sigenergy quote is under-specified by one battery in nine.
Nothing about that edit looks wrong at the time.

**Principle: specs identify a product; costs describe it.** If a spec genuinely
changes, it is a different product and should be a new row — not an edit. That
also keeps historical quotes meaningful: a quote referencing `stock_id 13`
should always mean the same physical thing.

Implementation:

- Spec edits on a `quotable` product require confirmation and are recorded in
  a change log (who, when, old → new). Cost edits do not.
- The confirmation offers **"create a new product instead"** as the primary
  action, since that is usually what was actually meant.
- Superseding a product sets `active = false` rather than deleting it — the FK
  from `quote_lines` and `system_config_components` is `on delete restrict`
  anyway, so history can't be orphaned.

This is cheap, and it is the only thing standing between a plausible-looking
one-character edit and every future quote being wrong.

### D4 — Drop `stock_id` from `fixed_site_costs`

**Changed recommendation — drop it.** §4.4 sketches a nullable `stock_id` so
"small parts" ($1000 flat) could later become a real consumables bundle with
stock tracking.

On reflection that is speculative. It requires Fred to want to stock-track
cable, conduit and fixings, which is a materially different inventory
discipline from tracking inverters — counting consumables is exactly the kind
of admin that doesn't get done, and a bundle whose stock levels are wrong is
worse than no bundle. Nothing in the decisions doc asks for it.

Adding a nullable FK later is a one-line migration. An unused column that
invites "should this be filled in?" costs more than that. **Ship
`fixed_site_costs` as label + amount only.**

**RESOLVED — Fred does not want to track consumables at that level of detail.**
"Small parts, $1000, flat" is the honest model. No `stock_id`, and this also
answers the consumables half of decisions-doc Q14.

### D5 — GM frame: one source, but keep a ballpark

§5.3 as written deletes `gm_frame_per_panel` outright so frame cost is always
kit-derived. **That is too blunt** — it assumes the array is always sized
before a price is needed, and it isn't. Quick Estimate exists precisely to
produce a ballpark from a bedroom count, and Stage 1 "System proposals" happens
well before anyone measures a paddock.

Better: still **one source of truth (the kit)**, but the kit caches a
representative cost per panel:

```sql
alter table public.gm_kits
  add column ballpark_cost_per_panel numeric not null default 0,
  add column ballpark_updated_at     timestamptz;
```

Recalculated and stamped whenever a real array is costed against that kit.
Early-stage quotes use the ballpark and are **labelled as such**; once the
array is sized, the real BOM cost replaces it. That gives Fred his fallback
without two independently-maintained numbers that can disagree.

**RESOLVED — keep the ballpark.** Fred raised a specific use for it in an
earlier conversation (reason not recorded, but it was accepted as valid at the
time). Build `ballpark_cost_per_panel` as above: one source of truth, cached,
clearly labelled as an estimate wherever it's used instead of a real BOM cost.

Worth capturing *why* next time it comes up, so this doesn't get re-litigated.

### D6 — Quote snapshots — the one to answer first

**Highest-stakes item here, and the only one that adds a table this design
doesn't have.**

Every price in this design is computed live from current product costs. So
reopening a job three months after quoting **recalculates** and shows a
different number. Consequences:

- No answer to "what did we actually quote this customer?" — the quote is not
  stored, only re-derived.
- No margin analysis after install: comparing quoted cost basis against what
  was really paid is impossible if the quoted basis no longer exists.
- If a customer disputes a price, there is no record on your side.

This is decisions-doc **Q7** (repriced or frozen?) and it is the same table as
**Theme E** — Q31 ("should a quote become a proper record inside the CRM —
saved against the job, versioned, with a status?"), Q32 (quote history), Q33
(loss reasons). **They are one piece of work, not four**, which is worth
knowing when sequencing: answering Q31 yes means D6 is already paid for.

Shape, if confirmed:

```sql
quotes
  id, job_id, config_id, phase, status, version,
  roof_panels, gm_panels, battery_units, inverter_mode,
  -- frozen at save: every rate that fed the number
  margin, gst, solar_stc_price, battery_stc_price, ...
  base_cost, final_price, sent_at, outcome, loss_reason

quote_lines
  quote_id, stock_id, description, qty,
  unit_cost   -- SNAPSHOT of planning_cost at save time, never a live join
```

`quote_lines.unit_cost` is the critical column: a live join to `stocks` would
defeat the entire purpose.

**This changes the build order.** As written, §8 step 7 links a quote to a job
by emitting BOM lines. If quotes become records, that step becomes "save a
quote" and the tables above need designing before it — probably alongside step
3, since both touch the configurator's output shape.

#### D6 — resolution in progress

The target flow (Vanessa) is:

```
calculate → create quote → email customer from the CRM → wait
  → [price may change] → convert → customer + job + stock items
```

Two things fall out of that, and they settle the question:

**1. The quote is the thing that creates the customer.** It must exist *before*
a customer or job does. So a quote record isn't optional — it's load-bearing
for conversion, regardless of whether anyone wants sales reporting.

**2. No new `leads` table is needed.** `customers` already exists independently
of `jobs` — nothing requires a customer to have one. So:

- **Prospect** = a `customers` row with no jobs
- **Conversion** = create a job for that customer
- **"Leads" list** = a view over customers with no jobs

No new entity, no status column to keep in sync, and it composes with the
existing RLS (a prospect has no assigned job, so installers correctly can't see
them). Do **not** add a `leads` table.

**3. Store the quote structured, not as a blob.** A blob can't answer
conversion rate, quote-to-win time, or quoted-vs-actual margin — the exact
things a stored quote is for. It's also the pattern already rejected once:
`jobs.job_order` was a blob and `docs/archive/schema-restructure-proposal.md` §2 broke
it into a real table for this reason. Structured costs no more to build.

**Why Fred "doesn't need quote tracking" and still needs quote records.**
These are two different things and the distinction is the whole answer:

- **Sales tracking** (conversion rates, follow-up lists, pipeline reporting) —
  he doesn't want it, and this design doesn't build it. His record of what was
  sent is the email in his sent folder.
- **The quote as a persisted object** — he needs this, and it isn't optional.
  Between generating a quote and it being accepted, the configuration has to
  survive. Without it, converting an accepted quote means **rebuilding it from
  memory** to get the customer, the system spec and the stock lines back. That
  is the operational case, and it stands regardless of anyone's view on sales
  reporting.

So the table is justified by conversion mechanics, not by analytics. Reporting
becomes *possible* later as a by-product; it is not the reason to build it.

**Gap this surfaces — capture the sent email.** Fred's "I have the email"
assumption breaks the moment the CRM sends the quote via API, because the send
never touches his mail client. Two cheap fixes, do both:

1. **BCC/CC Fred on every outbound quote**, configurable in Settings, so his
   existing habit keeps working unchanged.
2. **Store the rendered quote document against the `quotes` row** — so the
   system is the record of what the customer actually received, not just the
   inputs that produced it. Inputs plus a re-render is not the same evidence as
   the artefact that was sent.

Note this affects the email work already built (`supabase/functions/send-email`,
Settings page) — the BCC option belongs there, not in the quote feature.

**On retention.** Fred's position was that he doesn't need every quote kept.
Two things sit against a purge policy:

- He also said, in the initial meeting, that customers come back **~18 months
  later** ready to buy. That is his own observation, and it is the argument
  against short retention.
- Retention is a **policy, not a schema decision.** Add `status` and
  `expires_at`; purging expired quotes later is a scheduled delete. Purging
  early and wanting them back is impossible. At tens of quotes a year the
  storage cost is nil.

**Recommendation: build the table with no purge, revisit retention once there's
real data.** If Fred wants a purge, it's a policy setting later, not a reason
to not record. Frame it to him as the 18-month-return case, which is his own —
not a sales-reporting argument he's already declined.

**RESOLVED — frozen, with an explicit "recalculate?" prompt.** (Decisions-doc
Q7.) A saved quote never changes on its own. Reopening one whose costs have
moved shows it as quoted, flags that underlying prices have changed, and
offers a recalculate — never applies one.

Consequence worth stating up front: **recalculating creates a new version, it
does not mutate the existing row.** Otherwise "frozen" only holds until someone
clicks the button. So:

- `quotes.version` increments; the prior version is retained, not overwritten
- the superseded version keeps its own `quote_lines` snapshot
- `status` distinguishes `draft` / `sent` / `expired` / `superseded` /
  `accepted` / `lost`

This also delivers decisions-doc **Q32** (quote history — "if a customer is
quoted three configurations over two months, is it useful to see all three and
which one they took?") as a by-product rather than as separate work.

**Expiry: 18 months** (Vanessa's recommendation, adopted). `expires_at =
sent_at + 18 months`; the "expired" badge and the recalculate prompt key off
it. Deliberately long — it matches Fred's own observation that customers come
back around 18 months later ready to buy, so a returning customer's original
quote is still on file and still readable rather than having lapsed into
nothing. This is the retention policy in practical terms; no separate purge
rule is needed.

One follow-on, low stakes, decide at build time:

- **Sent quotes should be immutable.** Editing a `draft` in place is fine;
  editing something already emailed to a customer should force a new version.
  This falls out of the versioning above but needs enforcing in the save path,
  not just the UI.

---

## 10. Reference

- `100UP_suite_V46.html` — cost engine lines 2063–2230, 3016–3073;
  breakdown rendering 2542–2578, 3075–3128; `ASSUMPTION_META` 3160–3226;
  `ASSUMPTION_STOCK_LINKS` 3235–3255; `buildQuoteBom` 2696–2715;
  GM BOM 3985–4110
- `supabase/migrations/20260719010001_assumptions.sql` — the table this replaces
- `supabase/migrations/20260719020001_merge_stock_specs.sql` — current `stocks` shape
- `docs/bugs.md` #3, #5, #6
- `docs/archive/2026-07-29_status-gap-and-decisions.md` §4.1, §4.5, Theme A
