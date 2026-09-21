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
| **Status** | Still what Fred quotes on, and still the only tool for 3 Phase / Ground Mount BOM | Deployed and multi-user. **Quotes now close end to end** (Sprint 1, 2026-09-20): the Calculator hands a system to a customer and job. **Not in business use yet** — Fred checks in on progress |

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
| `docs/2026-08-12-Fredupdate` | Vanessa's update **to** Fred with his replies interleaved. **Attribution is not marked** — the installer block is unsourced and the block after the final `---` is hers (it says "He also wants..."). Fred's 2026-09-20 email supersedes the installer block entirely |
| `docs/2026-07-29_status-gap-and-decisions.md` | Status and gap register with 37 decision questions, written deliberately for a client meeting. Much is now answered — read the two above first, but it is a good account of how the project looked in July |
| `docs/ai-in-crm-design.md` | AI/MCP design — post-cutover, nothing built. MCP server before in-app chat, and the security model that matters |
| `docs/bugs.md` | Defects in both codebases, what's fixed and what's carried forward |
| `docs/refinements.md` | Incomplete features / UI not fully working — not bugs. Log new ones here. |
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

Auth with two roles: **admin** (Fred — everything) and **installer**. As of
Fred's email of 2026-09-20 the installer role is **read-only except for their
own notes**: assigned jobs only, can edit `installer_notes` and nothing else
(Fred's `notes` are read-only to them), and **cannot advance, move back, or
set any date**. His words: *"install only need to see job description he can
not move or change anything, installer have to call me"*, and every pipeline
step is *"ALL completed by me"*. He also said **"NO alerts"** — do not build
notification triggers.

`20260920100001` sets `installer_can_set = false` on every step to implement
this. **It is a data change on purpose** — the mechanism (`installer_can_set`,
`set_step_date`, the per-step checks in the RPCs, the UI that reads them) is
untouched, so re-enabling an installer step later is one `update`, not a
rebuild. Vanessa's read is that Fred will likely want some of it back. Don't
"clean up" the unused machinery.

Writes are enforced in the database (RLS plus the allowlist in
`private.guard_jobs_update()`), not the UI. **Reads are too, as of
`20260920110001`** — 22 `*_select_all` policies moved from `using (true)` to
`using (private.is_admin())`, closing `docs/bugs.md` #14. Installers keep the
part names on their own job through **`public.stocks_visible`**, a redacting
view: same columns as `stocks`, every cost and `qty` forced to 0, rows limited
to their assigned jobs. `data.tsx` reads `stocks` when admin and the view when
not. **Don't add a new table with `using (true)`** — and if an installer
screen ever needs a new field, widen the view rather than the policy. The fix
has not yet been re-tested with a live installer login; do that before issuing
a real installer account. Public signups are disabled; users are created by an
admin.

## What's not built

**All six Quote Designer tools are built** as of 2026-09-20 — Quick Estimate,
Calculator, 3 Phase, Assumptions, Simulation and Ground Mount BOM, plus Daily
Load Profile. No `StubPage` is rendered anywhere now (the component is still
on disk for the next placeholder).

`CalculatorPage` serves **both** the single-phase and three-phase tools via a
`phase` prop — the engine has always taken phase as an input, picking
inverter tiers by the product's own phase, applying the 3Φ oversize rule and
filtering `system_config_components` by `phase_scope`. V46 kept these as two
tabs with two near-identical sets of cost functions, which is how they
drifted. Don't split them again; the only per-phase difference is the
starting numbers. Shell renders it twice **with keys** — without them React
reconciles the two positions as one component and carries state across.

Ground Mount BOM is `lib/groundMountBom.ts` (pure geometry, faithful port of
`calcGmBom`) plus a screen. It prices off the 20 `gm_component` rows in
`stocks`, matched on the part code in `stocks.model` — an exact join, not a
name regex — so there is no per-part cost editor: change the price on the
Stock page. Quantities and weights stay in code because they are geometry and
spec, not inventory.

**The quote loop closes** as of 2026-09-20. The Calculator has "Copy quote for
CRM" and "Create job from this quote"; the payload lives in
`app/src/lib/quotePayload.ts` and is **v2, carrying `stockId`** so a quote
raised in the new app never touches `normalizePart`'s fuzzy matcher. Name
matching survives only as the fallback for a v1 payload pasted out of V46.
**Known gap:** "Create job from this quote" always creates a *new* customer —
no lookup — so quoting an existing household twice duplicates it
(`docs/feature-wishlist.md` W3).

Also open: real cost capture on receipt. `scripts/import_from_export.py` was
**reworked 2026-09-20** and is no longer a cutover blocker — it now treats the
product catalogue as read-only, writing only `stocks.qty`, and aborts if the
export references a stock id the catalogue does not have. Run it as
`postgres`, not an app user: `private.guard_stock_qty()` keys off
`current_user`.
**Notifications are deferred, not cancelled** — Fred said "NO alerts" on
2026-09-20, meaning not yet. Leave them undeveloped; he is expected to want
them later. Email still sends on demand; nothing triggers it automatically.
"NO alerts" does **not** cover the Needs attention panel or pulsing dots —
those mirror V46 and stay.

## Integrations

Three connectors, all admin-only, all keyed off `public.integrations` (one row
per provider, secret readable only by the service role). Settings → Integrations
manages them; Edge Functions verify the caller is an admin via `requireAdmin`
before touching anything.

| Provider | Used for | State |
|---|---|---|
| `email` | CyberPersons transactional send (`send-email`), logged to `email_sends` | **Working, key entered** (confirmed 2026-09-20 — Settings shows the saved-key placeholder, which only renders when `integrations.secret` is non-empty) |
| `anthropic` | `aiComplete` in `_shared/ai.ts`; invoice reading on Receive Stock (`extract-invoice`), logged to `ai_call_log` | **Working, key entered** (same evidence) |
| `gmail` | OAuth connection only (`gmail-oauth-start` / `-callback`). Stores a refresh token. **No sync yet** — no poller, no message table | Connected, nothing depends on it. Ported cheaply from BW-CRM for later: visibility of mail to and from customers, and AI scanning of supplier invoices and receipts. **Not a cutover item** |

**Two different email systems, easily confused:**

| | What it sends | Where it is configured | State |
|---|---|---|---|
| **CRM email connector** (`integrations`, provider `email`) | Application mail — the `send-email` Edge Function, logged to `email_sends` | Settings → Integrations, *in the app* | Configured |
| **Supabase Auth SMTP** | Invites, password resets, confirmations | Supabase **Dashboard** → Authentication → SMTP Settings | Configured (2026-09-20) |

They share nothing, and neither is visible from the other. Configuring one
does not configure the other, and Auth's built-in sender is heavily
rate-limited until custom SMTP is enabled — which is how the CRM's own email
can work perfectly while invites fail in bursts. **Both are now set up**, so
don't re-raise either as outstanding.

**Email test mode does NOT cover Auth mail.** The redirect lives inside the
`send-email` Edge Function, and Supabase Auth never calls it. So while test
mode is on, CRM email is safely caged and **an invite or password reset still
goes to the real address**. That is correct — those are internal and should
send — but do not read "test mode is on" as "nothing can leave the system".
Inviting a real installer sends a real email.

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
- **A Cloudflare zone-level CSP applies to the CRM, and it is not in this
  repo.** `app/public/_headers` sets only `X-Robots-Tag`. Everything else on a
  live response — `content-security-policy`, HSTS, `x-frame-options`,
  `permissions-policy` — comes from zone config on `100up.com.au` and is
  inherited by the subdomain. It reads as a policy written for the WordPress
  marketing site (it allows `*.facebook.net`, `*.youtube.com`,
  `analytics.ahrefs.com`, `'unsafe-eval'`), which the CRM needs none of.
  **Nothing is currently broken**: `connect-src` names the Supabase project
  including `wss://` for realtime, and `font-src`/`style-src` cover Google
  Fonts. **But `connect-src` is an allowlist**, so any future call to a new
  origin is blocked before it leaves the browser — the planned MCP server on
  its own subdomain would be, for instance. Check the live headers, not the
  repo, when a fetch fails for no visible reason.
- **The CRM presents itself as NOT LIVE until cutover.** `app_notice.mode`
  (`testing` | `live`) drives a permanent banner telling Fred that anything he
  enters is deleted at go-live and to keep real work in V46. That is the
  literal truth: `scripts/import_from_export.py --truncate` clears every
  operational table and rewrites `stocks.qty` from the V46 export, so test
  jobs, test stock movements, test POs and test stock takes are all
  self-clearing. **Nothing in the CRM is real** — the only thing that can
  actually be lost is real work typed into the wrong system. Flip the mode in
  Settings → Development mode, once, after the import has run.
- **`jobs.created_by` / `customers.created_by`** answer "is this Fred's or
  mine?" (default `auth.uid()`; null on legacy-imported rows). The job list
  shows "added by …" while in testing mode only. There is deliberately **no
  test/real flag** — nothing is real, so there is no split to make, only an
  authorship question.
- **Fred is testing live, so deploys land under an open tab.** Two banners
  handle it (`app/src/features/notice/Banners.tsx`). The **update** banner is
  automatic: Vite compiles a build id into the bundle and emits a matching
  `version.json`, and the app offers a Reload when they differ. Don't remove
  the `emit-version-json` plugin from `vite.config.ts` or the check silently
  stops working — `isStale()` fails safe to "not stale", so a missing
  `version.json` shows nothing rather than erroring. The **maintenance**
  banner is manual (`public.app_notice`, set in Settings), realtime-published
  so it reaches an open tab without a refresh, and always carries an expiry.
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
- **Customer emails are REAL again** (restored 2026-09-21,
  `20260921110001`). They were dummies from 2026-09-15 so that no test could
  reach a customer; that protection now lives in the right place — the
  `send-email` Edge Function redirects every recipient while test mode is on,
  server-side and fail-safe. Scrambling the data was the blunt version, and it
  cost Fred seeing a fake address where his customer's should be.
  **The ordering is enforced, not trusted**: the restore migration refuses to
  run if email test mode is explicitly off. `private.customer_email_backup`
  stays as the record of what was scrubbed. Supplier emails are still dummy
  aliases. Phone numbers were always real, and now normalise to `+61…` E.164
  on entry (`app/src/lib/contact.ts`).
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
| `scripts/import_from_export.py` | Cutover importer. Reworked 2026-09-20: catalogue is read-only, `--truncate` uses ordered DELETEs (a cascading truncate would take `stocks` with `suppliers`) |
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
