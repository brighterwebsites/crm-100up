# CLAUDE.md — 100UP CRM

## Project overview

Custom CRM + Quote Designer for **100UP Solar**, a solar installation business
run by Fred (Melbourne, AU). Manages jobs, customers, stock, procurement, and
compliance documentation for solar installs.

**The project is mid-migration between two codebases.** Both are in this repo
and both are currently real:

| | Legacy | Current build |
|---|---|---|
| **What** | `100UP_suite_V46.html` — single self-contained HTML file, inline JS/CSS, `localStorage` only | `app/` — React + TypeScript + Vite, Supabase backend, deployed to Cloudflare |
| **Holds** | The six Quote Designer calculators | The whole CRM half |
| **Status** | Still the only way to produce a quote | Live, multi-user, hosted |

Fred quotes in the old file, then pastes the result into the new app via the
"Link quote" screen. **Do not treat either as dead.** The old file is the
behavioural specification for the calculator rebuild and must not be broken;
the new app is where all new work goes.

Supabase project ref: `nmyczgnvjhwhgpgvwfdx`.

## Read these before starting work

| Doc | Why |
|---|---|
| `docs/2026-07-29_status-gap-and-decisions.md` | Current status, gap register, and the 37 open decision questions for Fred. **Start here.** |
| `docs/bugs.md` | Defects in both codebases, what's fixed and what's carried forward |
| `docs/quote-configurator-design.md` | Target design for Assumptions → product-driven configurator (proposed, not built) |
| `docs/schema-restructure-proposal.md` | Phase 2 schema design — partly implemented; check migrations for what actually landed |
| `supabase/migrations/*.sql` | **Ground truth for the schema.** Docs can be stale; migrations are not |

## What's built (new app)

Pipeline board (19 steps), Customer Jobs, Customers, Job detail, Stock, Order
List, Purchase Orders (view-only), Suppliers, Receive Stock (paste-invoice),
Settings (email service), Daily Load Profile.

Auth with two roles: **admin** (Fred — everything) and **installer** (assigned
jobs only, can edit `notes` and `fixes_needed` only). Enforced by RLS, not UI.

## What's not built

All six Quote Designer tools — Quick Estimate, Calculator, 3 Phase,
Assumptions, Ground Mount BOM, Simulation. They appear as `StubPage`
placeholders in `Shell.tsx`. Assumptions data **is** in the database
(`public.assumptions`, seeded) but has no editing screen, so cost changes must
still be made in the old file.

Also open: receive-against-PO, real cost capture on receipt, notifications
(email service exists, nothing sends), and `scripts/import_from_export.py` is
out of date against the current schema — **a hard blocker on cutover**.

## Conventions

1. **Migrations are immutable history.** Never edit an applied migration file.
   All schema changes land in a new numbered migration. Functions needing
   changes must be fully redefined (`create or replace`) in the new file.

   **Apply them with `supabase db push`, not through an MCP/agent connection.**
   This matters and has already bitten once. The MCP `apply_migration` tool
   stamps the remote history with **a timestamp generated at apply time**, not
   the local filename's — so the file and the history diverge the moment you
   use it. Raw `execute_sql` is worse: it records nothing, leaving schema
   changes with no history row at all. Both happened here; by 2026-08-11 not
   one of nine local filenames matched a remote version and two migrations were
   entirely unrecorded, which left `supabase db push` unable to run. Repaired
   in commit `6e609a4` (see `supabase/migration-history-repair-rollback.sql`
   for the prior state).

   The CLI is **not currently installed on the dev machine** — install it
   before the next migration, or the drift restarts on the first one.
   If a migration ever does have to go through an agent connection, re-stamp
   the history to the local filename version immediately afterwards.
2. **Check which migration last defined a function** before changing it —
   e.g. `reschedule_booking` lives in migration 004, not 003.
3. **Regenerate `app/src/types/database.types.ts`** after any migration.
4. **Stage/step and pipeline-gate dates are RPC-only.** `advance_job_stage`,
   `move_job_back`, `reschedule_booking` plus the `private.guard_jobs_update()`
   trigger. This exists specifically to fix the old app's bug where setting a
   date directly bypassed stock consumption — **do not weaken it.**
5. **RLS discipline**: explicit `grant`, `enable row level security`, then one
   policy per operation. `anon` gets nothing.
6. **Clipboard-and-print for outputs** — CES summaries, job details, POs are
   rich HTML tables or plain text for pasting, not file exports. New output
   features follow the same pattern.
7. **Minimal, targeted changes.** Don't refactor surrounding code unless asked.
8. **Legacy file only**: if you must touch `100UP_suite_V46.html`, bump every
   version string together. **They have all drifted apart** — you cannot tell
   which build you're looking at from any single one:

   | Where | Reads |
   |---|---|
   | Filename | `V46` |
   | `<title>` (line 6) and nav badge (line 1052) | `V3` |
   | Quote Designer pill (line 1066) | `v78` |
   | Stock CRM header badge (line 1665) | `V17` |

   Unresolved — confirm with Fred which is authoritative before assuming any
   of them, and resync as part of the next change to that file.

## Known gotchas

- **Pricing/stock linkage is a regex.** The calculator generates part *names*
  from templates, and `app/src/lib/normalizePart.ts` fuzzy-matches them against
  `stocks.name`. It fails silently when it doesn't match. This is the central
  problem `docs/quote-configurator-design.md` sets out to remove — read it
  before touching anything in the quote → stock path.
- **`last_cost` is hand-typed.** `receive_stock` captures no unit cost, so what
  Fred paid is not what the system knows.
- **Assumption costs and stock costs are unlinked** and drift silently
  (`docs/bugs.md` #3).
- **CES manufacturer names**: Deye and Jinko are verified against CEC listings.
  **Sigenergy and Trina are not** — don't treat them as authoritative.
- **The V46 cost breakdown double-counts** the mounting kit and Deye PDU/Base
  in its itemised rows (`docs/bugs.md` #6). Base cost is correct; the display
  isn't.
- Fred tests against real data. Never change data schemas without a migration
  plan.

## Reference files

| File | Purpose |
|---|---|
| `100UP_suite_V46.html` | Legacy app — behavioural spec for the calculator rebuild |
| `100UP_assumptions_2026-06-20.json` | The 45 assumption values, as seeded into `public.assumptions` |
| `100UP_stock-crm_2026-06-25.json` | Legacy data export — 18 jobs, 17 stock items, 3 suppliers |
| `scripts/import_from_export.py` | Cutover importer — **out of date, needs rework** |
| `archive/` | Superseded iterations — never the source of truth |

## Working in this repo

- New app: `cd app && npm install && npm run dev`. Lint with `oxlint`.
- Legacy file: open directly in a browser, no build step.
- Local Supabase workflows via the `supabase` CLI; prefer testing locally
  before applying to the remote project.
- `.agents/skills/supabase-postgres-best-practices/` is vendored here — consult
  it for RLS, indexing, and function-security patterns.
