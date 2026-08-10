# 100UP CRM — Design Brief: A Cohesive Visual System

**Date:** 11 August 2026
**Prepared by:** Brighter Websites
**Status:** Proposal — nothing built. For Cursor/dev implementation once agreed.
**Scope:** Visual/interaction design only. Information architecture, page layouts, and data model are already decided in `docs/main-layout.md` and the per-page layout docs — this brief does not revisit those.

---

## 1. The brief in one sentence

Give the app **one visual language** — instead of the three it currently has spread across the old file and the new build — grounded in what this tool actually is: a trade operations system for a solar electrician, used in an office and on a phone on a roof.

---

## 2. Where things actually stand

I read the code, not just the docs. Three systems exist today:

| System | Where | Character |
|---|---|---|
| **Quote Designer (`#app-calc`)** | `100UP_suite_V46.html` | Dark control-panel aesthetic — `#0d1117` background, acid-green (`#00c48c`) and blue (`#3b9eff`) brand accents, monospace numerals for every figure, dense KPI cards. This half is actually well-executed for what it is. |
| **CRM (`#app-crm`)** | same file, same `<html>` | Cream background (`#F7F5F0`), Arial, boxy 1.5px borders, olive-green accents. Nothing about it shares a token, a radius value, or a font with the calc half three lines away in the same file. |
| **New app** | `app/` (Vite + React, live rebuild) | Light theme, DM Sans, a real `:root` token set (`--bg`, `--ink`, `--primary`, four named stage colours). This is a genuinely better starting point than either half of V46 — it's the one to build forward from, not V46. |

**So "make it better than V46" is a low bar** — V46 isn't one design, it's two unrelated ones stapled together, which is exactly the incohesion you're reacting to. The real work is making the **new app** distinctive and disciplined before the last 6 unbuilt screens (the Quote Designer calculators) get poured into it in whatever style feels convenient at the time, which is how V46 ended up split in the first place.

**Two concrete cracks already forming in the new app**, worth fixing now while the surface area is still small:
- **129 inline `style={{...}}` overrides** across 14 files, bypassing the token system that already exists in `index.css`. Every one is a future inconsistency — a button or spacing value that drifts from the system because it was faster to type inline at the time.
- **Emoji as the entire icon system** (`📋 🛠️ ⚙️ 📦 🚚 🔧`) in the sidebar and buttons. Renders differently per OS/browser, carries no consistent stroke weight or size, and reads as a placeholder rather than a considered choice — because it is one.

Neither is a crisis. Both are cheap to fix now and expensive to fix after 6 more screens copy the pattern.

---

## 3. Design direction

Per the design-lead approach: named tokens, not vibes. Grounded in the actual subject — solar install trade work, CEC compliance, site electrics — not a generic SaaS dashboard palette.

### 3.1 Colour

Keep the current `--primary` green (`#1d9e75`) — it's already doing double duty as "go/complete/success" and works fine. The gap is that everything else is default-SaaS (purple, orange, amber stage colours with no relationship to the subject). Proposed:

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#171b21` | body text, headers |
| `--muted` | `#6b7280` | secondary text |
| `--bg` | `#f6f5f2` | app background — warm off-white, not cold grey; nods to site paperwork/spec-sheet stock, not generic dashboard `#f5f6f8` |
| `--card` | `#ffffff` | surfaces |
| `--line` | `#e6e3dc` | hairline borders, warm-toned to match `--bg` |
| `--primary` | `#1d9e75` | keep — primary action, "complete" |
| `--signal` | `#e8720c` | **new accent** — safety-orange, used sparingly for alerts, stock-short flags, overdue installs. Direct pull from hi-vis/site-signage vocabulary rather than a generic red or amber. Replaces the current ad hoc `--danger` red for anything that's "needs attention" rather than "is broken." |
| `--danger` | `#b3261e` | keep — genuine errors only (failed save, destructive delete) |
| `--stage-comms` | `#1d9e75` | Stage 1 |
| `--stage-quoting` | `#2563a8` | Stage 2 — steel blue, not purple; reads as "in progress/technical" rather than decorative |
| `--stage-install` | `#e8720c` | Stage 3 — same safety-orange family as `--signal`, since install is the physical/on-site stage |
| `--stage-compliance` | `#854f0b` | keep current amber-brown — reads correctly as "paperwork/certification" |

This is a **6-value core palette** (ink, muted, bg, card, primary, signal) with the stage colours derived from it rather than invented separately — the current app has stage colours that don't relate to anything else in the system, which is part of why it reads as templated.

### 3.2 Typography

Keep **DM Sans** for UI text — it's already licensed, loaded, and correctly matched to the brief (a geometric sans with enough warmth not to feel like a spreadsheet). Add one role that's currently missing:

- **A monospace face for numerals** — kW, kWh, dollar figures, quantities, PO numbers. V46's `#app-calc` half already does this correctly (`var(--mono)` on every KPI value, cost row, spec number) and it's the single best idea in that file: aligned decimal points, unambiguous digit shapes, and it visually distinguishes "a number you're meant to scan/compare" from "a label you're meant to read." The new app currently sets every number in DM Sans, so a job value, a stock quantity, and a customer name all carry equal visual weight. Recommend **JetBrains Mono** or **IBM Plex Mono** at the same weight discipline DM Sans already uses (400/500/600/700).
- Type scale: keep current sizing (13–14px body, the app is dense and used on phones — don't inflate it for aesthetics). Tighten heading weights to 700/800 only, drop any 500-weight headings for consistency.

### 3.3 Layout & elevation

Current cards use a single `box-shadow: 0 8px 30px rgba(10,15,30,.06)` — fine, keep it, but apply it **consistently** (it's currently only on a few card types per the CSS scan). Define three elevation levels and use them everywhere, nowhere else:

- `--shadow-flat` — none (sidebar, header, table rows)
- `--shadow-card` — the existing soft shadow (stat cards, detail panels)
- `--shadow-modal` — a stronger shadow + backdrop dim (Job Order modal, Receive Stock modal, CES summary modal)

### 3.4 Icons — the concrete near-term fix

Replace the emoji sidebar/button icons with a real icon set. Given no build-step constraint on the old file but a real bundler in `app/`, use **Lucide** (MIT, tree-shakeable, one `<Icon />` component per name, matches the geometric character of DM Sans). This is a mechanical, low-risk swap — same nav structure, same labels, just `<Package />` instead of `📦`. Worth doing early because it's the single highest-visibility "does this look like a considered product or a prototype" signal, and it touches every screen at once.

### 3.5 Signature element

Per the design-lead framework — one thing this app should be remembered by, not scattered decoration. Proposed: **the monospace numeral treatment (3.2) applied consistently to every measurable quantity in the app** — kW, kWh, $, qty on hand, days-in-stage. Nothing else in a trade CRM competes for "memorable," and it's honest to the subject matter (this is a tool for people who think in numbers — panel counts, battery capacity, dollar figures) rather than a decorative flourish bolted onto a business app for its own sake.

### 3.6 Quote Designer — light theme, "instrument" premium, resolved

**Decided: light theme, not V46's dark `#app-calc`.** But "light" doesn't mean "plain" — Fred is looking at these screens to price real jobs, and V46's dark theme earned its "premium" feel from precision, not from being dark. The move is to keep the precision and drop the darkness. Concretely, the calculators get a **distinct internal treatment layered on top of the core system** — same tokens, same fonts, but tighter, more instrumented — so they read as the app's high-precision instrument, the way a spec sheet or a lab readout feels different from a form, without forking into a second theme:

- **Hairlines do the work shadows do elsewhere.** Calculator cards get a crisp `1px solid var(--line)` border plus only a whisper of shadow (`0 1px 2px rgba(23,27,33,.04)`) — not the CRM's soft `--shadow-card`. A thin, exact edge reads as "engineered" the way a soft drop shadow reads as "friendly SaaS." Add a 1px `inset 0 1px 0 rgba(255,255,255,.7)` top highlight on white cards over the warm `--bg` — the suggestion of a machined panel edge catching light, not a gradient.
- **One precision accent, used as a system-status colour, not decoration.** A small accent — `--tech: #2563a8` (the same steel blue proposed for Stage 2 in §3.1, reused deliberately so the calculators don't invent a fourth colour) — appears only as: a live/settled status dot next to the headline result, the active state of a segmented toggle (see below), and the recommended-option highlight in a comparison table. Nowhere else. Restraint is what makes it read as premium rather than decorative.
- **Hero numerals get bigger and tighter, not louder.** The final price / headline kW figure sets in the monospace face from §3.2 at 32–40px, weight 500, tight tracking (`-0.02em`), tabular figures. Every unit label next to it (kWh, kW, AUD) is a separate small element — 10–11px, uppercase, `letter-spacing: 0.08em`, `--muted` — styled the way a datasheet annotates a number, not inline with it. This is the single biggest lever for "premium": generic apps set numbers and labels in the same style at the same size; instrument-grade ones separate them typographically.
- **Segmented toggles instead of tabs or dropdowns** for the binary/small-set choices that already exist in the brief — Sigenergy vs Deye, single-phase vs 3-phase, roof vs ground mount. A tight pill-shaped segmented control (border `1px solid var(--line)`, active segment filled `--tech` at low opacity with a solid 1px active border) reads as a physical toggle switch — closer to the subject matter (electrical equipment) than a browser-default tab strip.
- **The Sigenergy-vs-Deye comparison is the signature moment.** This is the one piece of content in the whole app that's naturally a side-by-side technical comparison, so it's where the "spec sheet" feeling should be spent deliberately rather than spread thin everywhere: two columns, right-aligned monospace figures, `1px` hairline row dividers, the recommended column carrying a subtle `--tech`-tinted background (not a badge, not a shadow — just a $2–3% tint difference, the way a datasheet shades the recommended part). This single component is worth the most craft time in the whole calculator set.
- **Motion signals "live," not "animated."** When a figure recalculates (changing panel count, switching brand), the number should tick/roll to its new value over ~200ms ease-out — no bounce, no overshoot, that reads as a live instrument rather than a UI transition. Keep it to the number itself; don't animate cards in/out. If a calculation takes a moment, the status dot (above) goes from settled to a slow pulse rather than a spinner — a spinner reads as "app," a pulsing status light reads as "equipment."
- **Grid discipline.** An 8px baseline across every calculator card — KPI row, cost breakdown, comparison table all share the same column rhythm. This is invisible when done and the first thing that feels "off" when it isn't; worth being strict about specifically here because these screens live or die on Fred trusting the numbers, and sloppy alignment undercuts that trust before he's read a single figure.

None of this needs a second colour system or a second font — it's the same `:root` tokens from §3.1–3.2, used with more restraint and more precision inside `#app-calc`'s successor. That's deliberate: "premium" comes from discipline applied harder in one place, not from a different palette.

---

## 4. Component system to formalise

Not new components — codifying what the app already needs across its current 9 screens plus the 6 unbuilt Quote Designer tools, so the calculators launch inside the same system instead of reinventing `#app-calc`'s dark theme in isolation:

| Component | Currently | Action |
|---|---|---|
| Stat tile (pipeline counts) | Bespoke CSS in `index.css`, one-off | Formalise as `.stat-tile`, reuse for calculator KPI cards |
| Stage/status badge | `.role-pill`, `.stage-*` classes, inconsistent radius | One `<Badge tone="stage-2">` pattern, `999px` pill radius always |
| Side detail panel | `JobDetailPanel`, `StockDetailPanel` — similar but independently styled | One `.detail-panel` shell (header, tabs/sections, footer actions) both consume |
| Data table | Repeated per page (Stock, Suppliers, Purchase Orders) | One `.data-table` with consistent header weight, row hover, numeral alignment (right-aligned, monospace per 3.2) |
| Modal | Job Order, Receive Stock, CES summary — each hand-rolled | One `.modal` shell with the `--shadow-modal` treatment from 3.3 |
| Empty/stub state | `StubPage.tsx` — icon + title + note, reused as-is for the 6 unbuilt calculators | Keep the pattern, just needs the icon swap (3.4) and a clearer visual distinction between "not built yet" and "built, no data yet" — currently both would look identical |
| Result/KPI card (Quote Designer only) | Exists only in V46's dark `#app-calc` theme | **Resolved (§3.6)**: light theme, not ported dark — but with a distinct "instrument" treatment (hairline edges, oversized tabular-mono hero numerals, segmented toggles, status-dot) layered on the same core tokens, so it reads as the app's premium/precision surface without forking into a second theme. |
| Segmented toggle (brand/phase/mount choice) | Doesn't exist yet — V46 uses plain buttons/dropdowns | New component per §3.6, `--tech` accent, reused across all Quote Designer tools that offer a binary/small-set choice |
| Comparison table (Sigenergy vs Deye) | Exists only in V46, plain HTML table | Signature component per §3.6 — the single highest-craft item in the Quote Designer set |

---

## 5. What this does *not* cover

- IA and screen layout — already specified per-page in `docs/*-layout.md`, unchanged by this brief.
- The Quote Designer's actual calculation logic, product-catalogue configurator work in `docs/quote-configurator-design.md` — that's a data/logic project, this is skin.
- Mobile-specific interaction patterns beyond what `index.css`'s existing two `@media` breakpoints (640px, 768px) already handle — worth a dedicated pass once the token/component work above lands, since `docs/2026-07-29_status-gap-and-decisions.md` and the CSS file both flag installers using this on phones as a real constraint, not an edge case.

---

## 6. Suggested sequencing

Not sized or scheduled — that's a Cursor/dev conversation — but in dependency order:

1. **Token pass** — update `:root` in `app/src/index.css` per §3.1–3.2. Mechanical, low-risk, immediately visible everywhere.
2. **Icon swap** — Lucide in, emoji out, per §3.4. Independent of the token pass, can happen in parallel.
3. **Inline-style cleanup** — fold the 129 `style={{...}}` overrides back into classes as they're touched (not a dedicated sweep — piggyback on other work per CLAUDE.md's "minimal, targeted changes" convention).
4. **Component formalisation** — §4, as each screen is next touched rather than a big-bang refactor.
5. **Quote Designer port** — the 6 stub screens inherit the system built in 1–4, plus the §3.6 instrument treatment (hairline cards, hero mono numerals, segmented toggles, status dot), with the Sigenergy-vs-Deye comparison table as the one component worth spending the most craft time on.

---

## 7. Decisions made this round

- **Light theme for the Quote Designer, confirmed** — not a ported version of V46's dark `#app-calc`. Two themes in one app would reintroduce the exact incohesion this brief exists to fix, and a dark screen is a worse call for a tradesperson reading it on a phone outdoors.
- **"Premium" comes from precision, not from a colour scheme** — §3.6 layers hairline edges, oversized tabular-mono numerals, restrained single-accent status colour, segmented toggles, and tight motion onto the *same* core tokens from §3.1–3.2, rather than giving the calculators their own palette. That discipline is what should read as "ultra tech," not darkness or gradients.
