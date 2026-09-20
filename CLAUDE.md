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
| **Holds** | All six Quote Designer calculators | The whole CRM half, plus four of the six calculators |
| **Status** | Still the only way to produce a quote *end to end* — the new Calculator can price a system but can't hand it to a job yet | Deployed and multi-user, but **not in business use yet** — Fred checks in on progress |

Fred quotes in the old file, then pastes the result into the new app via the
"Link quote" screen. **Do not treat either as dead.** The old file is the
behavioural specification for the calculator rebuild and must not be broken;
the new app is where all new work goes.

Supabase project ref: `nmyczgnvjhwhgpgvwfdx`.

## Repo layout and sibling repos

**This repo's root is `F:\GIT_REPOS_INDIV\crm-100up` — it is the working
directory, and `.git` lives there.** Until 2026-09-15 the repo sat one level
down in a non-git wrapper folder of the same name (`crm-100up\crm-100up`),
which meant this file never auto-loaded and `git` commands from the workspace
root failed. That nesting is gone — if you ever see a `crm-100up` subfolder
reappear here, something has re-cloned into the wrong place.

Three related repos, opened together via `100up-crm.code-workspace`:

| Repo | Path | What it is |
|---|---|---|
| `crm-100up` | `F:\GIT_REPOS_INDIV\crm-100up` | This repo — the CRM and Quote Designer |
| `BW-CRM` | `..\BW-CRM` | Brighter Websites' own CRM. Separate product, shares patterns, **not** a dependency |
| `100up-tools` | `..\100up-tools` | The public 100up.com.au WordPress plugin — solar ticker, daily energy, system-finder quiz, quick estimate |

`100up-tools` matters here because the public estimator is meant to consume
**this** repo's pricing: the `assumptions` table is the single source of truth
and gets pushed to WordPress, never edited independently on the WP side. Spec
lives in `docs/wp-quick-system-estimate-spec.md`. Branch `main` is current;
the `combined` branch holds an accidental nested duplicate and was never
deployed — ignore it.

> A stale, pre-restructure copy of that plugin used to sit at
> `F:\GIT_REPOS_INDIV\100up-conversion-tools` with no `.git` at all. It was
> archived to `100up-conversion-tools.stale-20260915` on 2026-09-15. Do not
> edit it, and do not treat it as the plugin — it predates the rename to
> `100up-solar.php` and the `includes/` restructure.

## Read these before starting work

| Doc | Why |
|---|---|
| `docs/2026-09-20_mvp-plan.md` | Current plan: repo state, the three sprints to cutover, and what was decided without asking Fred. **Start here.** |
| `docs/2026-08-12-Fredupdate` | Fred's own written answers — installer model, job refs, per-step permissions, parity accepted. His words, not a summary |
| `docs/2026-07-29_status-gap-and-decisions.md` | Older status and gap register, plus the original 37 decision questions. Much is now answered — read the two above first |
| `docs/bugs.md` | Defects in both codebases, what's fixed and what's carried forward |
| `docs/quote-configurator-design.md` | Target design for Assumptions → product-driven configurator (proposed, not built) |
| `docs/schema-restructure-proposal.md` | Phase 2 schema design — partly implemented; check migrations for what actually landed |
| `supabase/migrations/*.sql` | **Ground truth for the schema.** Docs can be stale; migrations are not |

## What's built (new app)

Pipeline board (19 steps, with a Needs attention panel and follow-up rules:
`docs/pipeline-attention-design.md`), Customer Jobs, Customers, Job detail, Stock, Order
List, Purchase Orders (draft → send to supplier / mark sent, receive against
the PO, print, delete; open POs count as stock on order), Suppliers, Receive
Stock (AI-read invoice; ad-hoc from the Stock page via `receive_stock`, or
against a PO via `receive_goods` with the PO's lines as a reading hint),
Stock takes (printed count sheet → counts → apply; `docs/stock-take-design.md`),
Settings (email service), Daily Load Profile.

Auth with two roles: **admin** (Fred — everything) and **installer** (assigned
jobs only; can edit `installer_notes` and nothing else — Fred's `notes` are
read-only to them). Writes are enforced in the database (RLS plus the
allowlist in `private.guard_jobs_update()`), not the UI. **Reads are not yet:**
installers can read every cost and pricing table through the API, whatever the
UI shows them — `docs/bugs.md` #14, a blocker before real installers log in.
Public signups are disabled; users are created by an admin.

## What's not built

**Four of the six Quote Designer tools are now built** — Quick Estimate,
Calculator, Assumptions and Simulation, plus Daily Load Profile, all on
`app/src/lib/quoteEngine.ts` (a faithful V46 port). Assumptions has a full
editing screen, so cost changes no longer have to go through the old file.

Still `StubPage` placeholders in `Shell.tsx`: **3 Phase** and **Ground Mount
BOM**. Both stay stubs through cutover by decision — V46 still does them.

**The quote loop does not close.** The Link-quote modal instructs the user to
press *Send system to CRM* in the calculator, but that button was never ported
to `CalculatorPage.tsx` — it exists only in V46 (payload built at line 2719).
The receiving half (parse → fuzzy-match stock → set job value → apply) is
complete in `features/jobs/modals.tsx`. Joining them is the MVP gate; see
`docs/2026-09-20_mvp-plan.md`.

Also open: real cost capture on receipt, notifications (email now sends, but
nothing triggers it automatically), and `scripts/import_from_export.py` is out
of date against the current schema — **a hard blocker on cutover**.

## Integrations

Three connectors, all admin-only, all keyed off `public.integrations` (one row
per provider, secret readable only by the service role). Settings → Integrations
manages them; Edge Functions verify the caller is an admin via `requireAdmin`
before touching anything.

| Provider | Used for | State |
|---|---|---|
| `email` | CyberPersons transactional send (`send-email`), logged to `email_sends` | Working — needs an API key entered |
| `anthropic` | `aiComplete` in `_shared/ai.ts`; invoice reading on Receive Stock (`extract-invoice`), logged to `ai_call_log` | Working — needs an API key entered |
| `gmail` | OAuth connection only (`gmail-oauth-start` / `-callback`). Stores a refresh token. **No sync yet** — no poller, no message table | Connection only |

Gmail OAuth needs four Edge Function secrets: `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REDIRECT_URI`, `CRM_APP_URL`.

The app has **no router** — `page` is `useState` in `Shell.tsx`. The OAuth
callback therefore returns to the app root with `?gmail=…`, and Shell reads it
on mount to open Settings. Any future external return trip has to do the same.

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

   The CLI **is installed** (v2.113.0, via npm, `supabase` on PATH) as of
   2026-09-15. What it does *not* reliably have is a valid access token — a
   stale PAT makes every `--linked` command fail with a bare 401:

   ```
   supabase migration list --linked
   → LegacyDbConfigLoginRoleStatusError: unexpected login role status 401
   ```

   That is an auth problem, **not** a "project is paused" problem and **not**
   a reason to fall back to an MCP connection. Fix it with `supabase login`
   (or set `SUPABASE_ACCESS_TOKEN` from a PAT) and carry on with `db push`.
   The project link itself survives in `supabase/.temp/project-ref`, which is
   gitignored — if that file is missing, re-run `supabase link` first.

   If a migration ever does have to go through an agent connection, re-stamp
   the history to the local filename version immediately afterwards.
2. **Check which migration last defined a function** before changing it —
   e.g. `reschedule_booking` lives in migration 004, not 003.
3. **Regenerate `app/src/types/database.types.ts`** after any migration:
   `supabase gen types typescript --linked --schema public > app/src/types/database.types.ts`
4. **Stage/step and pipeline-gate dates are RPC-only.** `advance_job_stage`,
   `move_job_back`, `reschedule_booking`, `set_step_date` plus the
   `private.guard_jobs_update()` trigger. This exists specifically to fix the
   old app's bug where setting a date directly bypassed stock consumption —
   **do not weaken it.**

   **Never hardcode step numbers.** Identify a step by `pipeline_steps.key`
   (`'install_in_progress'`, `'ces_received'`, …). The same row carries
   `installer_can_set` (who may tick it), `date_column` (which `jobs`
   column holds its date, if any; otherwise the date is in
   `job_step_dates`) and `follow_up_days` / `follow_up_action` (when a job
   sitting there needs chasing; `docs/pipeline-attention-design.md`).
   Hardcoded positions have already bitten twice: an
   off-by-one board offset, and a move-back that cleared the wrong date.
   Full model: `docs/installer-model-design.md`.
5. **RLS discipline**: explicit `grant`, `enable row level security`, then one
   policy per operation. `anon` gets nothing.

   **A `grant` alone does not describe what a new table ends up with.** This
   project carries an `ALTER DEFAULT PRIVILEGES` rule granting **ALL** to
   `anon`, `authenticated` and `service_role` on every new table in `public`.
   So `grant select on X to authenticated` leaves `anon` holding INSERT,
   UPDATE, DELETE and TRUNCATE as well. Start each new table's migration with
   `revoke all on X from anon, authenticated;` before granting, and verify
   afterwards with `information_schema.role_table_grants` — the migration text
   will otherwise mislead you. See `docs/bugs.md` #13; three tables were caught
   by this.
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
- **On hand (`stocks.qty`) is read-only to the app.** Every change must carry a
  reference: receiving (PO / receipt), installs (job), stock takes (ST-####).
  `private.guard_stock_qty()` refuses direct writes by app users and lets
  `SECURITY DEFINER` functions through, telling them apart by `current_user`,
  so it **must stay `SECURITY INVOKER`**. Anything new that moves stock must be
  a `SECURITY DEFINER` function that records its reference, not a table update
  from the app. See `docs/stock-take-design.md`.
- **`last_cost` is hand-typed.** `receive_stock` captures no unit cost, so what
  Fred paid is not what the system knows.
- **Assumption costs and stock costs are unlinked** and drift silently
  (`docs/bugs.md` #3).
- **V46's `ASSUMPTION_META` notes are not authoritative.** Some were
  AI-written and at least one **reversed Fred's actual rule**. The
  `deyeSingleInverterCost` row was labelled "Deye 10kW · AI-W5.1-10P3" with
  the note "10kW exists only as three-phase" — on a **single-phase** cost
  variable, mapped in `ASSUMPTION_STOCK_LINKS` to the three-phase stock row.
  Every part of that was wrong, and it cost two separate investigations
  (`docs/bugs.md` #9, then the 2026-09-20 three-phase question). Corrected
  2026-09-20 to `AI-W5.1-10P1`. **Treat any V46 note asserting a product fact
  as unverified** — check the catalogue or ask Fred. The rebuilt app can't
  reproduce this class of error: inverter costs come from
  `stocks.planning_cost` per product, so the label *is* the product.
- **The Deye 10kW three-phase is never quoted.** Fred, 2026-09-20: a
  three-phase inverter splits its rating across the phases, so a 10kW 3P gives
  ~3.33 kW per phase — not enough off-grid. The Deye three-phase option is the
  **12kW** (`AI-W5.1-12P3-AU-B`) and nothing else. V46 has always agreed
  (its 3ph Deye path hardcodes 12kW); `20260920090001` removes the 10P3 tier
  the configurator's blanket seed had picked up. **The `stocks` row stays** —
  real product, CES catalogue entry, historical jobs. There is no Deye 15kW;
  the 15kW is Sigenergy's `EC 15.0 TP`.
- **A forced inverter size class falls back to the config's other tiers.**
  Forcing a class is tier-*relative* ("each brand's bigger option"), so a brand
  with no product in that class must still answer or its column silently
  blanks. `quoteEngine.ts` falls back rather than returning null. Don't
  "simplify" that back into a hard filter.
- **CES manufacturer names**: Deye and Jinko are verified against CEC listings.
  **Sigenergy and Trina are not** — don't treat them as authoritative.
- **The V46 cost breakdown double-counts** the mounting kit and Deye PDU/Base
  in its itemised rows (`docs/bugs.md` #6). Base cost is correct; the display
  isn't.
- **Not in business use yet (as of 2026-09-15).** Fred still runs the business
  on V46. The CRM holds his imported legacy data plus test records, and he
  looks in to follow progress. Schema changes carry no business impact, so ship
  them in one go: no staged "deploy the frontend first, drop the column later"
  dance. Migration *history* discipline (convention 1) applies regardless.
  **This flips at cutover.** Once Fred depends on it, a column drop must follow
  the frontend deploy that stops using it, or the live app breaks mid-save.
- **Customer emails are dummies while testing** (since 2026-09-15):
  `support+{initials}{customer id}@brighterwebsites.com.au`, all landing in the
  Brighter Websites support inbox, so no notification test can reach a real
  customer. Originals are in `private.customer_email_backup` (not reachable
  through the API). New customers added during testing should get a dummy
  too. Supplier emails are dummy aliases as well. Phone numbers are still real.
- **Free-tier auto-pause.** The Supabase org is on the free plan. If the
  project (`nmyczgnvjhwhgpgvwfdx`) sees no database activity for 7
  consecutive days, Supabase pauses it — the whole Auth/API/DB stack goes
  unreachable until someone restores it from the dashboard (or
  `restore_project` via MCP). A gap in dev activity (no commits, nobody
  opening the app) is enough to trigger this even though nothing is actually
  broken in the code. If auth/login/data suddenly stops working with no
  code change to blame, check project status before debugging anything else.

## Reference files

| File | Purpose |
|---|---|
| `100UP_suite_V46.html` | Legacy app — behavioural spec for the calculator rebuild |
| `100UP_assumptions_2026-06-20.json` | The 45 assumption values, as seeded into `public.assumptions` |
| `100UP_stock-crm_2026-06-25.json` | Legacy data export — 18 jobs, 17 stock items, 3 suppliers |
| `scripts/import_from_export.py` | Cutover importer — **out of date, needs rework** |
| `archive/` | Superseded iterations — never the source of truth |

## Working in this repo

- **Deploy = push to `main`.** Cloudflare Workers Builds is connected to the
  GitHub repo and rebuilds the `crm-100up` worker on every push to `main`,
  live at **https://offgridcrm.100up.com.au/** (`crm.100up.com.au` in the
  noindex plan was a suggestion and does not exist). There's no CI workflow
  in the repo and no manual deploy step. `main` carries a GitHub rule requiring
  pull requests; Vanessa's account bypasses it, so a direct push succeeds with
  a "Changes must be made through a pull request" notice. That's expected,
  not a failure. To confirm a deploy landed, grep the live JS bundle for a
  string unique to the change: Cloudflare's bundle hash never matches a local
  build, so comparing filenames proves nothing.
  **Default workflow: once a change builds and lints clean, commit and push to
  `main`**, so it's live for Vanessa to test and Fred to check in on. Don't
  leave finished work committed-but-unpushed, or only running on a local dev
  server. `npm run deploy` (raw `wrangler deploy`) still exists but bypasses
  git, so the live app stops matching `main`; don't use it.
- Database changes are separate: Cloudflare never touches Supabase. Apply
  migrations with `supabase db push` (convention 1). Until cutover the remote
  project is the dev environment, so there's no local Supabase stack to test
  against first. If a `--linked` command 401s, that's a stale PAT — see
  convention 1, not a paused project.
- New app locally: `cd app && npm install && npm run dev`. Lint with `oxlint`.
- Legacy file: open directly in a browser, no build step.
- `.agents/skills/supabase-postgres-best-practices/` is vendored here — consult
  it for RLS, indexing, and function-security patterns.
- `app/.env.local` and `supabase/.temp/` are gitignored and machine-local.
  They survived the 2026-09-15 flatten, but a fresh clone won't have them:
  recreate `.env.local` from `app/.env.example` and re-run `supabase link`.
