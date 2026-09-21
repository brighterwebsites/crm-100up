# WP Quick System Estimate — product + tech spec

**Status:** All decisions locked 2026-08-15 (Vanessa). Ready to build.  
**Repo:** `brighterwebsites/100up-tools` (local path often `F:\GIT_REPOS_INDIV\100up-conversion-tools` — re-clone before coding; current local copy may be stale).  
**Not SCOS.** 100UP-specific. Ships inside the `100up-tools` plugin only.  
**Related wishlist:** `docs/feature-wishlist.md` § Public estimator (lines ~111–187).

---

## Goal

Public lead-gen tool on bedroom-count landing pages (quiz routes here). Mirrors CRM / V46 **Quick System Estimate**: bedroom/occupant load → email gate → side-by-side fully off-grid vs generator-assisted indicative prices (July Ballarat worst-case).

**Do not** modify existing shortcodes for lead capture:

- `[100-up-daily-energy]` — leave as-is  
- `[100-up-quiz-system]` — routing menu only; leave as-is  
- `[solar_quick_estimate]` / `[solar_calculator]` — leave as-is; new tool is separate  

---

## Shortcode

```
[100up_quick_system_estimate bedrooms="5" acf_bedrooms="bedroom_count" gen_pct="25"]
```

| Attr | Behaviour |
|------|-----------|
| `bedrooms` | Default bedroom selection (0–8). Studio = `0`. |
| `acf_bedrooms` | Optional ACF field name on current post. If set and readable, **wins over** `bedrooms`. |
| `gen_pct` | Default generator-slider position (0–75, step 5) — **pinned but adjustable** (decided 2026-08-15): sets where the slider starts, visitor can still move it. Overrides the global default of **25%** (matches CRM/V46, not the 10% site mock). |
| Fallback | If neither `acf_bedrooms` nor `bedrooms` resolves → **`2`** (decided 2026-08-14). |

**Resolution order:** ACF → shortcode attr → hardcoded default.

Embed on each bedroom landing page the quiz routes to, with that page's bedroom count preselected. A generatorless-design page sets `gen_pct="0"` — starts on the off-grid comparison, visitor can still drag the slider up.

---

## UX flow — reveal and accumulate (decided 2026-08-14)

Not a step-wizard that hides what came before. Each section reveals below
the previous one and **stays visible and live** — household inputs are
never locked away once you've moved past them. This is what makes "can they
change bedrooms/people after the email gate" a non-question: Step 1 is
always right there, and changing it just recomputes whatever's below it.

### Step 1 — Household load (open, no email)

**View-by toggle** (decided 2026-08-14 — replaces always-showing both rows):
bedrooms and occupants are the same underlying calc with two UI skins, so
show one picker row at a time behind a small segmented control —
`Bedrooms | Occupants` — instead of both simultaneously. Switching the
toggle re-renders the same synced value in the other unit; it doesn't reset
the selection.

- **Selected row** (whichever the toggle points at): Studio → 8+ bed, or 1 person → 9+ people  
- **Synced always:** people = bedrooms + 1 (and reverse) — no independent-override mode  
- **Live result card** (no pricing yet), example:

```
35.0 kWh/day
5 bedrooms · 6 people
5 bedrooms → 6 people
5 kWh base + 6 × 5 kWh/person
= 35 kWh/day total
```

**Formula (fixed, public “100UP Way”):**

```
daily_kwh = 5 + (5 × people)
```

Selecting a value reveals Step 2 below. Step 1 stays in place and stays
editable for the rest of the session.

---

### Step 2 — Email gate (first lead capture)

Reveals below Step 1 once it has a selection. Hard gate before any $ /
system size — nothing below this renders until it succeeds.

**Fields (Phase 1):**

- Email (required)  
- Consent line (privacy / marketing) — short; checkbox if required legally  
- Submit: **Show my estimate**

**Not Phase 1:** name, phone, postcode.

**On success:**

1. Persist lead (see Lead capture)  
2. Reveal Step 3 below, using Step 1's current household context  

Soft errors (invalid email, network) stay on Step 2; nothing below reveals.

**After success** (decided 2026-08-14): Step 1 stays editable. Changing
bedrooms/people re-renders Step 3 immediately against the already-captured
email/session — no second gate. Logged against that same session/email
(see Lead capture, Event A vs Event B).

---

### Step 3 — Instant estimate + generator compare

Reveals below Step 2 once email succeeds. Recomputes live if Step 1 changes.

1. **Context strip** — bedrooms · people · daily kWh (from Step 1)  
2. **Generator dependence**  
   - Label: *Set generator dependence*  
   - Slider 0–75%, step 5, always visible and adjustable  
   - Copy: `⛽ Generator covers X% of daily load`  
   - Default: **25%** (decided 2026-08-14 — matches CRM/V46; starting position overridable per-page via `gen_pct`, e.g. `0` on a generatorless-design page — decided 2026-08-15)  
3. **Side-by-side panels** (V46/CRM layout; **site** colours/tokens — not CRM neon-on-navy):

| Without generator | With generator (X%) |
|-------------------|---------------------|
| Full daily load | Solar+battery load = daily × (1 − X%) |
| Solar kW / panels | Smaller array |
| Battery kWh | Smaller battery |
| Deye (budget) $ | Deye $ + optional “Save up to $Y” |
| Sigenergy (premium) $ | Sigenergy $ |
| July worst-case · Ballarat · after rebates | Generator **not** included in price |

**Both brands shown, with pricing** (decided 2026-08-14).

4. **CTA:** Email me this spec — second event for same email (quote blob), not a new lead identity.  
5. **Disclaimer (final copy, decided 2026-08-14):**

> This estimate uses our standard assumptions and finds the minimum battery
> size that survives a Ballarat July worst-case hourly simulation with your
> chosen generator dependency — this covers the hardest solar month in the
> region. A system that passes July will cover the rest of the year. Prices
> shown are after solar and battery STCs. Actual pricing depends on site
> conditions, roof space available, travel, and other site-specific
> factors. [Learn more](https://100up.com.au/off-grid-system-design/)

**Mobile:** stack panels vertically; slider full-width; price cells stack under each option. Selection tiles: strong border + check (mock UX), mapped to 100UP brand (quiz CSS tokens: e.g. `#c41e3a` accent, `#1e3a5f` buttons, white cards).

---

## Engine (Step 3)

Same semantics as CRM `QuickEstimatePage` / V46 `runQeForPersons`:

```
people = bedrooms + 1   // if synced
daily = 5 + 5 * people
gen_kwh = round(daily * genPct / 100, 1)
solar_daily = daily - gen_kwh

option1 = optimise(daily)       // Sig + Deye, July Ballarat, must pass
option2 = optimise(solar_daily) // only if genPct > 0
```

**Per option output:** panel count, solar kW, battery kWh, inverter count×kW, final price (GST + rebates), optional save delta vs full off-grid.

**Public price display (decided 2026-08-15):** round `finalPrice` to the
nearest $100 for display. Round for display only — keep the exact engine
value for the "save up to $Y" delta and for the quote-blob sent in Event B,
so that figure isn't compounding two roundings.

### Pricing / assumptions source

| Approach | Pros | Cons |
|----------|------|------|
| **A.** Reuse / extend `assets/solar-calc.js` in live `100up-tools` | Already on site | Parity check needed; WP admin assumptions can drift |
| **B.** Precomputed lookup pushed from CRM (bedrooms × genPct → both options) | Tiny JS, versionable | Coarse grid |
| **C.** Full portable ES module from V46/CRM | True parity | Heavier; still needs assumptions payload |

**Decided 2026-08-14:** frozen assumptions JSON, stored locally in WP
(exact location — `wp_options` vs a plugin-bundled file — is an
implementation detail, not a blocker). No live push/sync required for
Phase 1; CRM remains SoT and WP never connects to Supabase at runtime. **But**
the frozen JSON's field names must match — or carry a documented mapping to
— the CRM's `public.assumptions` table / `EngineSettings` shape in
`quoteEngine.ts`. Write that mapping down as part of Phase 1, even though
nothing consumes it yet, so Phase 1.5's HMAC pipeline is a drop-in rather
than a rework.

Later (wishlist architecture still stands): CRM Edge Function `publish-estimator-assumptions` → HMAC POST → WP REST → store + LiteSpeed purge of estimator page(s) only.

---

## Lead capture

### Phase 1 — Webhook → Google Sheet (+ optional WP table)

**Scope confirmed 2026-08-14:** this is deliberately just enough to wire up
later, not full lead management — Fred isn't ready for that yet. The
`source` field exists specifically so these rows can be reconciled and
backfilled once fuller tracking exists.

**Event A — Step 2 submit (primary lead)**

| Field | Notes |
|-------|--------|
| `submitted_at` | ISO / WP timezone |
| `page_url` | `window.location.href` |
| `email` | normalised lowercase |
| `bedrooms` | int |
| `people` | int |
| `daily_kwh` | float |
| `source` | fixed `quick_system_estimate` |
| `recommendation_blob` | empty / `"pending"` — Event B is what fills it in, on explicit "Email me this spec" (resolved 2026-08-15, following from decision #4: Event B is a distinct CTA-triggered event, not automatic on Step 3 render). Fred can still hand-derive a rough system from `bedrooms`/`gen_pct`/`daily_kwh` on rows that never get an Event B. |

**Event B — Email me this spec**

Same keys + full `recommendation_blob` (JSON or plain-text quote à la CRM `buildQuoteText`) + `gen_pct` + both option summaries/prices.

Webhook URL in `wp-config` or plugin setting — **never** in front-end JS. Make.com / Zapier / Apps Script → Sheet.

### Phase 1.5 — WP table (CSV export)

Table e.g. `wp_100up_estimator_leads`:

- `id`, `created_at`, `email`, `page_url`, `bedrooms`, `people`, `daily_kwh`, `gen_pct`, `payload_json`, `event_type` (`gate` | `email_spec`), optional `ip_hash`

Admin: list + **Export CSV**. No CRM poll yet.

### Phase 2 — CRM pre-stage

Separate from customers/jobs. CRM polls WP REST with application-password user `crm-sync` (not admin). WP has no outbound calls to Supabase. Out of scope for first ship of this shortcode.

---

## Plugin surface (new only)

- Shortcode: `[100up_quick_system_estimate]`  
- Assets: `assets/qe-compare.css`, `assets/qe-compare.js` (+ calc module or lookup JSON)  
- REST: `POST /wp-json/100up/v1/estimator-lead` (nonce + honeypot + rate limit)  
- Optional admin: webhook URL, last assumptions sync time, CSV export  

---

## Analytics (GA4)

Existing quiz events pattern; add:

- `qe_step1_interact`  
- `qe_email_submit`  
- `qe_estimate_view`  
- `qe_gen_slider` (debounced)  
- `qe_email_spec`  

---

## Suggested Phase 1 ship scope

1. New shortcode + Step 1–3 UI (site styles, mobile) — view-by toggle in Step 1, reveal-and-accumulate layout (not step-and-hide)  
2. Step 1 math client-side  
3. Document the WP-frozen-assumptions ↔ CRM `assumptions`/`EngineSettings` field mapping, even though the sync pipeline itself is deferred  
4. Step 3 from frozen assumptions + calc reuse or lookup (parity-check a few bedroom × gen% cases against CRM)  
5. Email gate → webhook (Sheet) + write WP table  
6. “Email me this spec” → second webhook/table row with quote blob  
7. Shortcode `bedrooms` / `gen_pct` + stub for ACF attr  
8. GA4 events + final disclaimer copy (locked, see Step 3)  

**Defer:** CRM HMAC publish, CRM lead poll, SMTP email, phone/name fields, admin assumptions UI as SoT, Turnstile (revisit if traffic or spam grows).

---

## Also consider

- **Cache:** LiteSpeed — page HTML cacheable; purge when assumptions JSON updates (estimator pages only).  
- **Session:** `sessionStorage` so refresh after email doesn’t lose Step 3.  
- **A11y:** keyboard tile selection, labelled slider, focus on step change.  
- **Empty state:** no passing system → “Talk to us” CTA; still keep the lead.  
- **Price display:** round to nearest $100 for public display (decided 2026-08-15); exact engine value used internally (see § Engine).  
- **Spam:** honeypot + rate limit only (decided 2026-08-14 — no Turnstile; traffic is under 100 users/week and the site already uses a hidden-honeypot pattern elsewhere. Revisit if traffic or spam grows).  
- **Legal:** disclaimer copy locked (see Step 3) + privacy link.  
- **Repo hygiene:** build on `main` of `100up-tools`; ignore/delete undeployed `combined` branch (nested duplicate). Fix `.mcp.json` key name (`hunpu_deploy_v1` vs wrong `100up_deploy`) when touching deploy config.  

---

## Decisions (locked 2026-08-14 – 15)

| # | Question | Decision |
|---|----------|----------|
| 1 | Gen default: 10% (site mock) vs 25% (CRM/V46)? | **25%**, matching CRM/V46. Starting position overridable per-page via `gen_pct` — pinned but adjustable (decided 2026-08-15), not a hard lock — needed for pages that talk about generatorless design. |
| 2 | Bedrooms ↔ people: always synced vs independent override? | Stay synced, no independent-override mode. UI: a single toggle switches which row is shown (Bedrooms / Occupants), not two rows shown at once — same calc, one skin at a time. |
| 3 | After email, can they change bedrooms/people? | Yes, without re-email — logged against the same session/email. The "reveal and accumulate" layout (Step 1 never hides) makes this the natural default rather than a special case to build. |
| 4 | "Email me this spec": SMTP vs webhook + toast vs `mailto:`? | Webhook + toast is enough. Fred isn't ready for full lead management — this is deliberately just enough to wire up later and backfill from `source` once it exists. |
| 5 | Pricing source v1: frozen JSON vs `solar-calc.js` vs wait for CRM publish? | Frozen JSON, stored locally in WP. No live sync needed yet, but its fields must map to the CRM's `assumptions`/`EngineSettings` shape — document that mapping now. |
| 6 | Show both Deye + Sigenergy on public site? | Yes, both with pricing. Final disclaimer copy locked (see Step 3). |
| 7 | Turnstile on gate form? | No. Traffic is under 100 users/week and the site already has a hidden-honeypot pattern on its forms; honeypot + rate limit on the REST endpoint (already planned) is enough for now. |
| 8 | Fallback bedroom if ACF/attr missing | **2**, confirmed. |
| 9 | Public price rounding: engine cents vs nearest $100? | **Nearest $100** for display (decided 2026-08-15). Exact value still used internally for save-delta and the Event B quote blob. |
| 10 | `gen_locked` (hard hide) vs pinned-but-adjustable default? | **Pinned but adjustable** (decided 2026-08-15) — dropped `gen_locked` entirely; `gen_pct` alone covers it. |

No open items remain.

---

## Architecture reminders (from wishlist)

- Push model for assumptions (CRM → WP), not WP → Supabase.  
- HMAC secret in Supabase env + `wp-config.php`, not `wp_options`.  
- WP Solar Pricing admin (`100up_solar_assumptions`) must not become a second SoT — CRM publish wins.  
- Failure alerting (publish / lead-poll >2h) and publish diff view are CRM-side follow-ons.  

---

## Next engineering step

1. Re-clone `brighterwebsites/100up-tools` to the local path.  
2. Audit `assets/solar-calc.js` (and existing quick-estimate shortcodes) for reuse vs lookup table.  
3. Implement Phase 1 shortcode — all decisions locked, nothing left to confirm.  
