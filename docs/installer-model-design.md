# Installer model — design

Status as of 2026-09-15. Decisions are Vanessa's; one question is still with
Fred (see *Open*).

## Principle

Permission rules live in the database as data, and the step functions enforce
them. The UI reads the same rows to decide what to offer. "Hidden" and
"blocked" therefore cannot disagree. Before this, the UI hid some actions but
the database allowed all of them: on 2026-09-14 Installer One advanced job 200
to *Job closed* through the ordinary Advance button.

## Decisions

| # | Decision | State |
|---|---|---|
| 1 | A job reaches the installer when an installer is **assigned**. That moment issues the job order: ref (`JO-0200-2026`) and date issued are set automatically, then locked. Reassigning keeps both. | Not built |
| 2 | Split *Inspector review* into *requested* and *completed*: two steps in the data, **one column** on the Pipeline board (hollow dot = requested, filled = completed). | Not built |
| 3 | **Strict step order.** If Fred hasn't ticked *Parts ordered*, the installer cannot mark the install started. | Built |
| 4 | Installers see their job's stock at every stage (pending, assigned, consumed). Empty groups are hidden rather than shown as "No stock assigned" beside a full list. | Built |
| 5 | Split notes: *Notes for installer* (they read it) and admin-only *Internal notes*. Existing notes move to internal, because they are Fred's CES follow-ups. Installers write in *Installer notes*. | Installer notes built; split not built |

## Who sets each step

`pipeline_steps.installer_can_set` is true for four steps:
*Install in progress* ("Started"), *Install complete* ("Installed"),
*CES submitted* and *Fixes complete*. Every other step is admin-only.

| Action | Allowed for |
|---|---|
| Advance into a step | Admin, or installer if that step's flag is set |
| Move back off a step (undo) | Admin, or installer if the step being left has the flag |
| Jump to a step (`p_override_stage`) | Admin only |
| Edit a step's date | Admin, or installer if the flag is set; only for steps already reached |

Installers are limited to their own assigned jobs throughout
(`private.lock_job_for_transition`).

## Dates

Every step has a date, shown and edited in the **Job progress** panel.

- Seven steps keep their date on `jobs` (`pipeline_steps.date_column`):
  booked, started, installed, CES submitted/received, rebate submitted/received.
  Clash detection, overdue checks and the date pills read these.
- Every other step's date lives in `job_step_dates`: written on advance,
  cleared on move back, editable. Backfilled from `job_events`, whose history
  starts 2026-07-19, so older imported jobs show only their seven dated steps.
- `set_step_date()` edits either kind. The booking date routes through
  `reschedule_booking`, which re-applies pending stock. Every edit is logged
  to `job_events` as `step_date_changed`.

Step functions identify steps by `pipeline_steps.key`, never by
`(stage, step)` number. Adding or splitting a step is therefore a data change.

## What installers see

| Installers see | Installers don't see |
|---|---|
| Their jobs, the job ref, Job progress | Job value, Fred's internal notes |
| Their customers' name, phone, email and address | Other jobs and customers |
| Stock names and quantities on their jobs | Stock costs, suppliers, POs, receipts |
| Notes for installer (read), installer notes (edit) | Pricing, margin, assumptions, quote tools |

**Not enforced yet** (`docs/bugs.md` #14). `useData` currently fetches stocks,
suppliers, purchase orders and assumptions for every user, so an installer's
browser already holds Fred's costs. The page is simply never shown. Planned fix:

- Cost, pricing, supplier and PO tables become admin-only to read, and
  `useData` stops fetching them for installers.
- **Stocks:** stay one table, admin-only, plus a narrow read function that
  returns name and qty for the caller's own job lines. A side table for stock
  costs was considered and rejected: those columns are read by five screens,
  including `quoteEngine.ts`, and written by the receiving functions.
- **Job value and internal notes:** move to an admin-only side table. Value
  has two references, so this is cheap, and it gives internal notes a home.

## Open — for Fred

- Every job currently has to pass through *Fixes complete*, even when the
  inspector passes it first time. Should a clean inspection go straight to
  *CES received*, with *Fixes complete* shown as skipped?
- After fixes, is there a re-inspection before *CES received*? If so it needs
  a step.

## Build order

1. **Done 2026-09-15:** step keys, `installer_can_set`, `date_column`;
   permission checks in `advance_job_stage` / `move_job_back`;
   `job_step_dates` + backfill; `set_step_date()`; Job progress panel;
   installer notes; installer stock display.
2. **Next:** job order auto-issue (and fold the two remaining
   `installation_requests` fields into `jobs`); Inspector review split;
   notes split; optional installer picker in the booking date prompt.
3. **Before any real installer logs in:** the read lockdown above.
