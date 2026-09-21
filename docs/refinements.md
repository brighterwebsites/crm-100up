# Refinements / new requirements

Not bugs. Features that are incomplete, labelled wrong, or not yet working
the way the CRM needs to. Logged here instead of `docs/bugs.md` so the
defect register stays defects.

Raised 2026-09-21 (Vanessa), from using the live app. No build this pass —
capture only.

Related: `docs/bugs.md` (defects), `docs/feature-wishlist.md` (parked ideas).

---

## R1 — Assigning an installer should mint the job order and stamp the step date

**Screen:** Job detail → Install Details → Assigned installer, then Job progress.

When a job gets an installer assigned, **Job progress** should automatically
get:

1. A **job order ref** (`installation_requests.job_order_ref`).
2. The **Installation Job info to installer** date (`pipeline_steps.key` =
   `job_info_to_installer`).

Today those are two separate manual saves. Assigning the installer only
patches `jobs.assigned_installer_id` (`saveJobAndCustomer`). The job-order
row is a second form (`saveIR` / `JobOrderModal`), and the step date is a
third (`set_step_date`). Nothing ties them together.

The modal already knows a default ref shape: `JO-{jobId padded 4}-{year}`.
That is a reasonable auto value if one is not already set. Do not overwrite
an existing ref. The step-date write still has to go through `set_step_date`
— do not date-stamp the jobs row directly.

---

## R2 — Customers → Customer details: no working way to save edits

**Screen:** Customers → pick a customer → Customer Details card.

Reported: there is no way to update or save input changes on the customer
record.

**As built:** a Save button exists at the bottom of the Customer Details
card (`CustomersPage.tsx` `CustomerDetail`). The layout spec
(`docs/Customers-layout.md`) puts EDIT/SAVE at the **top** of the main
section; the live UI puts it under the fields. Job detail can also save the
same customer fields via **Save details**.

Treat as “feature not fully working”, not missing. Likely causes to check
when this is picked up:

- Save is easy to miss (bottom of the card, no top action).
- Validation (`checkContact`) can block the write with an error that is easy
  to overlook.
- `CustomerDetail` initialises form state from `customer` once and is not
  keyed on `customer.id`, so switching customers can show a stale form.

Reproduce before changing anything: edit name/phone/email/address on
Customers, click Save, refresh, confirm whether the row actually changed.

---

## R3 — Pipeline filter “All jobs” should read “All Open Jobs”

**Screen:** Pipeline → Show: filters.

The first quick-filter is labelled **All jobs**. It is wired to `filter ===
'active'`, which already excludes closed jobs. Rename the label to **All
Open Jobs**.

Default board filter is already `active` (open only). That part is correct.

**Related, not this item:** the Closed stat tile is wired to filter key
`all`, which shows *every* job, not closed ones. That is why “JobClosed Tile
doesnt work” is sitting in the scratch notes at the bottom of
`docs/feature-wishlist.md`. Separate defect; do not fold it into a rename.

---

## R4 — Inventory nav: Stock Received and Suppliers as first-class screens

**Screens:** sidebar Inventory group; Suppliers page; Receive Stock (modal
only today).

The current GUI feels primitive. Suppliers and stock received are jammed
together rather than being their own places. Required menu order:

1. Stock
2. Order List
3. Purchase Orders
4. Stock Received
5. Suppliers

**Suppliers** should follow the Customers pattern: left list + detail.
Supplier info up top, then cards for **Purchase Orders** and **Stock
received** — single-line items that link through to the PO and the stock-
received record.

**Stock Received** needs its own section (flat list of receipts), not only a
modal launched from Stock / Purchase Orders.

This is not a new design. `docs/goods-receipt-design.md` §7 already specified
the nav split, the Customers-style Suppliers layout, and a Stock Received
tab. Schema and receive RPCs landed; the GUI split did not. Build the
designed screens rather than inventing a third layout.

---

## R5 — Header Backup button: leftover V46 JSON export, not a real backup

**Question asked:** what is the Backup button actually doing? Assumed it has
drifted far from the original and is probably in the wrong place (Settings).
Purpose was likely mirroring V46’s import/backup because that system ran on
JSON files and HTML.

**Answer: yes.** The header button in `Shell.tsx` (`exportJson`) downloads a
client-side JSON file named `100UP_stock-crm_YYYY-MM-DD.json`, `version:
stock-1.2`. It denormalises the in-memory `jobs` / `customers` /
`installation_requests` / `stocks` / `suppliers` / `purchaseOrders` back into
the **old app’s flat export shape** so the file would still be importable
into V46 if ever needed (`docs/schema-restructure-proposal.md` § Backup
export).

It is **not**:

- a Supabase / database backup
- a restore path for the current CRM (there is no matching import in the new
  app; cutover import is `scripts/import_from_export.py`, postgres-only)
- complete: goods receipts, assumptions, system configs, pipeline step dates,
  POs as POs (they are flattened to the old `receipts` list), and most of the
  post-V46 schema are absent

V46 needed this because the live data lived in `localStorage`. The live data
now lives in Postgres. A real backup is the Supabase dashboard (or a
scheduled dump), not this button.

**Placement:** agreed it does not belong in the header. If it stays at all,
Settings is the honest home, labelled as “Download V46-shaped JSON” so it is
not mistaken for disaster recovery. Candidate to remove once Fred is off V46
and nobody needs a file the old HTML can ingest.

---

## R6 — Assumptions: show which stock items the calculators currently use

**Screens:** Assumptions → System setup, and Assumptions → Ground mount.

Fred needs at least a **read-only** view of which Stock items are assigned /
being used by the calculators right now. Editing the links can wait; the gap
is that there is no visibility at all.

**As built:**

- **Solar panels** already has a product selector (`panel_settings.stock_id`).
  That is the one place this is visible.
- **System setup** is an explicit placeholder (“Not built yet — next up”).
  The data already exists: `system_configs` + `system_config_inverters` /
  `_batteries` / `_components` → `stocks`. The Calculator reads those rows;
  Assumptions does not show them.
- **Ground mount** only shows labour / machinery / ballpark-frame numbers.
  The BOM prices off the 20 `gm_component` rows in `stocks`, matched on
  `stocks.model` (`lib/groundMountBom.ts`). None of those parts are listed
  here.

Minimum: a list (name, model, product type, maybe planning cost) of every
stock row currently attached to a system config, plus every `gm_component`
the Ground Mount BOM will pick up. No editors required. The real editor
belongs in the configurator (`docs/quote-configurator-design.md`); this is
the stop-gap so Fred can see what the quotes are standing on.

---

## R7 — Pipeline job panel: jump to any step (dropdown next to Advance)

**Screen:** Pipeline (and Customer Jobs) → job detail panel → Pipeline
controls, beside the green Advance button.

Add a dropdown to move the job to **any** step, not only the next one.
Admin only. Installers stay on Advance / Move back (and as of
`20260920100001` they have neither).

**Date policy — leave skipped step dates empty.** Do not fill previous /
jumped-over steps with today. Stamp only the **destination** step (today, or
the prompted date if landing on booked / install start / install complete —
same three prompts Advance already uses). Fred can fill real dates afterwards
in Job progress via `set_step_date`. Filling skipped steps with today would
fabricate CES, rebate and booking history that overdue, clash detection and
follow-up rules treat as real.

Jumping **back** still clears dates that belong to steps after the new
position (same rule as `move_job_back`).

**Stock gates still fire when crossed**, even if their dates stay empty.
Otherwise a jump from quoting to Install complete leaves parts on the shelf,
which is the bug these RPCs exist to prevent. Crossing `date_booked` applies
pending BOM; crossing `install_in_progress` consumes (forward) or restores
(back). Identify those steps by `pipeline_steps.key`, never by number.

**As built:** `advance_job_stage` already has admin-only `p_override_stage` /
`p_override_step`, unused by the UI. It only stamps the landing step (empty
skipped dates — that part is right) but it does **not** fire stock gates for
steps jumped *past*, and it does **not** restore stock or clear later dates
on a backward jump. Do not wire the dropdown to that override as-is. New
RPC (`move_job_to_step`, keyed), or fix the override before exposing it.

Stage/step/dates stay RPC-only (`docs/installer-model-design.md`).
