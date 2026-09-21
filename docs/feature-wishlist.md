# Feature wishlist

Ideas raised and deliberately parked. Not commitments, and not bugs — see
`docs/bugs.md` for defects, `docs/refinements.md` for incomplete / not-fully-
working features, and `docs/archive/2026-07-29_status-gap-and-decisions.md` for the
open decision register.

Each entry records the idea, why it was parked, and enough of the thinking
that picking it up later does not mean re-deriving it.

---

## W1 — File supplier documents to Google Drive | CLOSED


**Raised** 2026-08-12 (Vanessa), while designing goods receipts.

The goods receipt flow reads a supplier invoice or delivery docket and keeps
the extracted data. It does **not** keep the original file — that was decided
against for v1 (see `docs/design/goods-receipt-design.md` D7) because storing PDFs
needs a Supabase Storage bucket with its own RLS, and the extraction result is
what the CRM actually queries.

The document itself still has value: an audit trail, and the thing you reach
for when a supplier disputes a price. Rather than a storage bucket, push it to
Google Drive in an organised folder structure — somewhere Fred already looks,
and already backed up.

Sketch of a shape, not a decision:

```
100UP Supplier Documents/
  L&H Wendouree/
    2026/
      2026-07-10  INV-0071234  (PO-20260705-18).pdf
```

Filing by supplier then year then a name carrying date, supplier ref and PO
ref makes the file findable without the CRM, which is the point.

**Open before this can be built**
- Fred has to want it. Ask before building.
- Auth: a Google Drive OAuth scope on top of the Gmail connection, or a
  separate service account. The Gmail connection is currently
  `gmail.readonly`, and widening a granted scope forces re-consent.
- Does the CRM store the resulting Drive file ID against the document row, so
  the receipt can deep-link to it? Probably yes — a filed document nobody can
  navigate back to is only half the feature.
- What happens when filing fails? It must not block the receipt: the stock
  movement is the real work, filing is bookkeeping.


**Closed** 2026-09-19 not required

---

## W2 — Cost provenance on stock items

**Raised** 2026-08-12 (Vanessa), parked for more thought. *"Keep as is for
now, but I want to think about that more."*

`stocks.last_cost` is hand-typed on the Stock page today. Once goods receipts
start populating it from real supplier invoices, two writers exist for one
field and they can disagree with no record of which is which — the same shape
as bug #3, in a new place.

Hand-editing cannot simply be removed. An invoice can be wrong, a price can be
agreed verbally, and a correction path is needed. So the question is not
whether to allow both, but how to make the disagreement visible.

**Options, roughly in increasing effort**

1. **Provenance stamp.** Add `last_cost_source` (`manual` / `receipt`) and
   `last_cost_set_at`, and show it on the Stock page: *"$1,550 — from INV-0071234,
   10 Jul"* versus *"$1,550 — set by hand, 3 Jun"*. Cheapest, and it makes the
   answer to "where did this number come from" always available.
2. **Stamp plus staleness flag.** As above, and flag when a receipt has since
   landed a different price than the manual value, the way the Stock page
   already flags costs that differ from what quotes use.
3. **Separate the fields.** `last_cost_invoiced` (receipts only, never
   hand-edited) alongside `planning_cost` (hand-set, what quotes use). No
   conflict possible because nothing is shared. Biggest change, and it
   overlaps the `docs/design/quote-configurator-design.md` work on linking
   assumptions to stock — worth resolving together rather than twice.

Leaning toward 1 as a first step, since it is additive and makes 2 or 3
easier later rather than harder.

**Related**: `docs/bugs.md` #3 (assumption costs and stock costs drift
silently) and #4 (`receive_stock` captures no unit cost — being fixed by the
goods receipt work, which is what creates this question).


---

## W3 — Quote → customer: look up, then send, not just create

**Raised** 2026-09-20 (Vanessa), immediately after the Calculator's
"Create job from this quote" shipped. **For after Sprint 2/3**, once Fred has
a closer MVP in front of him — not now.

Two separate things, and the second probably supersedes the first.

### The gap as built

"Create job from this quote" calls `createJob(name)`, which **always inserts a
new customer**. There is no way to attach the quote to a customer who already
exists. Quote the same household twice — a revision, a second system, a
follow-up after six months — and the CRM grows a duplicate customer with a
name that matches and an id that doesn't.

Minimum fix: a customer lookup on that button. Search existing customers,
pick one, or create new. `createJob` splits into "create customer + job" and
"create job for customer id".

### The workflow that probably makes more sense

Rather than a button that quietly creates CRM rows, the real moment is
**sending the quote to the customer**. So:

> **Send quote to customer** → modal carrying the customer's name and email
> (looked up, or entered for a new one) → **Send**, plus **create
> contact / estimate** as part of the same action.

That reframes it. Creating the customer and the job stops being a separate
administrative step Fred has to remember, and becomes a side effect of the
thing he actually wants to do. The CRM records exist because a quote went
out, which is also the point at which they are worth having.

**Why this is parked, not built now.** It needs the email connector keyed up
(Sprint 3.3), it wants a decision on what the customer actually receives —
the Quick Estimate's customer text, a PDF, a link — and it overlaps the lead
question Fred reopened ("Stage 1 / First Contact is probably where the lead
stage actually fits"). Building the lookup alone is cheap and safe; building
the send flow before those three settle means building it twice.

**Related**: `docs/2026-09-20_mvp-plan.md` §4 Sprint 3, and the lead-capture
direction further down this file — an estimator lead and a quoted customer
are the same person arriving by different doors, and should probably not end
up as two records.

---

## W4 — AI in the CRM, and a Claude.ai MCP connector

**Raised** 2026-09-20 in `.cursor/plans/feedback_and_crm_ai_bb3bbf3e.plan.md`.
**Post-cutover.** The feedback desk that plan paired this with was built on
2026-09-21; this half still needs its spec (`docs/design/ai-in-crm-design.md`).

Baseline today: Anthropic via `aiComplete` → `extract-invoice` only, logged to
`ai_call_log`, key in `integrations`.

**One tool layer, two surfaces.** Read tools over the existing RLS and RPCs;
consequential writes go through the `SECURITY DEFINER` functions that already
guard them (`guard_jobs_update`, `guard_stock_qty`), never raw table patches
from a model.

**Revision to the original plan: build the MCP surface first.** The plan had
in-app chat as the product and MCP as the same tools exposed externally. In
cost terms that is backwards — in-app chat needs a chat UI, thread
persistence, streaming and tool-call rendering, *and the CRM pays for every
token*. A remote MCP server needs a Worker, auth and the tools, and **Fred's
own Claude subscription pays for the model**, with a better chat UI than we
would build. Same tool layer either way, so nothing is wasted.

**Answered 2026-09-21: Fred has Claude Max**, and ChatGPT Pro. That settles
the order — MCP-first. The ChatGPT half matters more than it looks: MCP is a
protocol, not a Claude feature, so an MCP server lets him use whichever
assistant he prefers, where an in-app chat picks for him permanently.

Remaining risk is only that adding a custom connector is a real ask for
someone whose watchword is "don't over-complicate" — mitigated by setting it
up with him once. Either way MCP-first serves Vanessa immediately (CRM
querying from Claude Code).

**Full design: `docs/design/ai-in-crm-design.md`.**

**Security, the part to get right.** A long-lived admin token pasted into
Claude.ai is a credential living in Anthropic's cloud, fronting a public
HTTPS endpoint with database access. Bug #14's lesson was that *reads* are
what gets missed. So: a restricted identity rather than admin, an explicit
column **allowlist** (not a denylist), per-tool logging like `ai_call_log`,
and rate limits. Never `integrations.secret`, `private.*`, or raw prompts.

**Out of scope, and worth saying to Fred plainly:** the AI does not change the
running system — no repo edits, no Git, no Cloudflare, no migrations. That
needs review, RLS and human judgement, and wiring it into an in-browser agent
is a large security surface for little gain. The MCP path can grow *data* and
*business-action* tools; it must not become a deploy bot.

**Phases:** 1 read-only · 2 narrow writes mapped to existing RPCs, confirmed
in UI · 3 actions (`send_email`, draft CES).

---

## W5 — Feedback desk screenshots | NOT BUILT, deliberately

**Raised and deferred** 2026-09-21, when the feedback desk shipped without
them.

Screenshots would be the first Supabase Storage use in this project — a
private bucket, signed URLs, RLS on `storage.objects`, upload UI and image
handling. That is roughly half the build effort of the whole feedback desk
for a fraction of its value.

It also cuts against a decision already made: W1 (file supplier documents to
Drive) was closed "not needed", and `supplier_documents` deliberately stores
*extracted data, not files*. **"The CRM does not hold files"** is an existing
principle here, and screenshots would be the first exception to it.

The auto-captured `screen` field plus Fred's own description has to prove
insufficient first. Purely additive if it does.


## VAnessa Notes to Add above
Needs to be added to correct docs/sections

## Installers

- Installer account/login
- Installer Jobs - what they need to see vs what they shouldnt see
- Email notifiication to installers (what notiifications and when)


##CEC Bridge Portal
- Export job details to csv (example coming)
- allows upload of job details that are stored in CRM directly to Special portal for rebate submissions
- CSV import in the portal seems to allow import of data, not sure if it is accumulative or import overwrites info, so if data is changed or updated in portal will it clear existing infor, (important becuae there isdata that wont be in the crm -  like many many images and serial numbers of parts installed)


Bugs
- Pipeline - JobClosed Tile doesnt work. Also remove closed jobs from default display, only show in filter all jobs, and tile closed. list 



##Public estimator: Quick System Estimate embed on 100UP website
Raised 2026-08-11 (Vanessa), from conversation exploring iframe and WP plugin options.

The Quick System Estimate (V46 section #qe) is a bedroom/occupant-based system sizer running the July Ballarat worst-case simulation. It produces two indicative prices (full off-grid vs smaller system + generator). Publicly useful as a lead-generation asset on the 100UP marketing site.

**Update 2026-08-14 (Vanessa + Claude, after auditing the actual WP repo/live site)**

Corrected facts, replacing assumptions this entry was originally written on:
- There is no "100UP MU plugin." The real repo is `brighterwebsites/100up-tools`
  (local: `F:\GIT_REPOS_INDIV\100up-conversion-tools`, currently a stale
  uncloned copy — re-clone before editing). It's a normal plugin, deployed at
  `/wp-content/plugins/100up-tools-claude-quiz-system-layout-x8kj4s/` on
  `100up.com.au`. `main` is the correct branch — confirmed byte-identical to
  what's live (checked via SSH, `hunpu_deploy_v1` key despite the `.mcp.json`
  entry saying `100up_deploy` — that filename is wrong, fix it there). A
  `combined` branch exists with an accidental nested duplicate
  (`plugins/100up-solar-calculator/...` inside itself) and was never
  deployed — dead end, ignore or delete.
- The plugin (`100up-solar.php`) already ships five shortcodes on `main`:
  `[100up-solar-ticker]`, `[100-up-daily-energy]`, `[100-up-quiz-system]`,
  `[solar_quick_estimate]`, `[solar_calculator]` — plus a "Solar Pricing"
  admin settings page backed by `wp_options` (`100up_solar_assumptions`).
  That option has never been saved in production, so it's currently running
  on hardcoded PHP defaults (`includes/defaults.php`) — no drift has
  happened yet, but it's a second, independently-editable pricing store the
  moment anyone touches that admin page.
- **Nothing captures a lead today, anywhere in this plugin.** `includes/ajax.php`
  exists but only proxies the Ballarat solar-radiation API for the ticker —
  there is no lead endpoint, table, or email field on any shortcode.

Decisions (Vanessa, 2026-08-14):
- **CRM/Supabase stays the single source of truth for pricing, product, and
  assumption data**, pushed to WP — not the WP admin page independently
  edited. The push-model architecture below still stands. How WP stores what
  it receives (a DB table, a `wp_options` value, or nothing durable at all
  beyond the JS bundle) is unspecified and not a blocker — a "last synced"
  display is a nice-to-have, not a requirement.
- **Lead capture is not needed on the two tools that already work as
  informational/navigational aids**, and neither needs further build:
  - `[100-up-daily-energy]` — purely informational. Leave as-is.
  - `[100-up-quiz-system]` — functions as a routing menu (picks the right
    bedroom-count landing page), not a pricing tool. No lead capture belongs
    on the quiz itself. Leave as-is.
- **The thing that needs building is new**, not a modification of
  `[solar_quick_estimate]` or `[solar_calculator]`: a side-by-side compare
  tool (full off-grid vs generator-assisted, adjustable % generator usage —
  the real V46 Quick Estimate behaviour) embedded on each bedroom-count
  landing page the quiz routes to. **This is the one that needs lead capture
  with email.** Scope it as a new shortcode/tool in the `100up-tools` repo,
  separate from the existing calculator/quick-estimate shortcodes.

Architecture agreed (original, still current for the CRM→WP push)

Push model, not pull: CRM pushes a sanitised assumptions snapshot to WordPress; the marketing site reads from its own storage at render time. Nothing on the marketing site connects to Supabase at runtime.

CRM side: Edge Function publish-estimator-assumptions — builds payload, HMAC-signs it, POSTs to WP, logs result. Triggered by an explicit "Publish to marketing site" button in the Assumptions UI (intentional publish, not automatic on save).
WP side: custom REST route in the `100up-tools` plugin. Validates HMAC, writes to storage (shape TBD — see 2026-08-14 note above), purges LiteSpeed Cache on the estimator page(s).
Estimator JS: extract the pure math from V46 (quickEstimate(), simulate(), assumption references) into a portable vanilla ES module — no framework, takes assumptions as a constructor argument. `assets/solar-calc.js` in the WP repo already has a client-side port of this for `[solar_quick_estimate]`/`[solar_calculator]` — check it before writing a new one; the new landing-page compare tool may be able to reuse it directly.
Lead capture direction

Fred currently routes enquiries via a spreadsheet. He does not yet see the pipeline value of tracking leads separately from jobs — the estimator lead capture is both a feature and an education tool. When "3 bedrooms, $28k estimated, submitted 9:47pm" arrives in the pipeline, the attribution becomes visible without a lecture.

Lead flow: WP form → WP custom table → CRM polls WP REST API on a schedule (application password auth). CRM initiates all connections; WP has no outbound calls to Supabase. Leads enter the pipeline tagged with source, estimated system size, and estimated value.

Not SCOS. The publish-assumptions payload and the estimator shortcode are 100UP-specific. They ship inside the `100up-tools` plugin (brighterwebsites/100up-tools), not a SCOS-shared plugin.

Confirm before building

website version needs lead capture, not just the calculator widget. - delivered via a plugin in separate repo - likely that  only "assumption data" needs to sync
entry point for estimator leads — Phase 1 captured via webhook to xsl Phase 2 new 'pre-stage that doesnt land in pipeline, would need to be kept sep from actual customers
*Decide if need for leads table design: columns, RLS, dedup key (email+phone hash).
WP application password: create a dedicated crm-sync WP user, not admin creds.
HMAC secret rotation plan — secret in Supabase env vars + wp-config.php, not wp_options.
LSCache purge scope: estimator page(s) only, not full site.
Failure alerting: notify if publish or lead-poll fails for >2 hours.
Publish diff view: show Fred what changes before he confirms (e.g. "panel cost $180→$195").
This is not a scos thing - this is 100up specific.