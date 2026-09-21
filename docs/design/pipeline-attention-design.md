# Pipeline — Needs attention & follow-up rules

Built 2026-09-15. Decisions are Vanessa's, on Fred's ask to see missing stock on
the Pipeline.

**Status: the six rules below are starting defaults. Vanessa emailed them to
Fred on 2026-09-15 for him to adjust.** The four per-step thresholds are data
(`pipeline_steps.follow_up_days` / `follow_up_action`), so his numbers are an
`UPDATE`, not a code change.

## What it is

The Pipeline's right-hand column shows **Needs attention** whenever no job is
open; opening a job swaps in the job panel, closing it brings the list back.
It lists exceptions only, so it stays short however large the stock catalogue
grows (the reason a V46-style strip of every stock item was not carried over).

- **Stock**: the Order List's summary (short items · units to order · jobs
  affected, linking to the Order List) and a table of every item jobs need
  beyond the shelf: *Item · To order · On order*, most to order first.
- **Follow-ups**: one line per rule hit, most pressing first. Clicking opens
  the job.

The same rules drive the **pulsing dots** on the board (V46's colours, as a
ring so the stage colour still shows) and the **Alerts** and **Stale** quick
filters, which until now had nothing real behind them. V46 stored `alert` and
`stale` flags on each job, but nothing in V46 ever set them.

## The six rules

| # | Rule | Flags when | Says | Signal |
|---|---|---|---|---|
| 1 | Send quote | at *Send quote* more than **7 days** | Follow up the quote | red |
| 2 | CES submitted | at *CES submitted* more than **14 days** (V46's rule) | Chase the inspector | red |
| 3 | Rebate submitted | at *Rebate submitted* more than **30 days** | Chase the rebate | red |
| 4 | Any other step | at the step more than **21 days** (the existing Stale filter's number) | No movement for N days | amber |
| 5 | Install overdue | booked install date has passed, install not complete | Install N days overdue | red |
| 6 | Short for a booked install | install booked, stock neither on the shelf nor on order | Installs {date}, N items not ordered | brown |

Rules 1–4 are per step (`pipeline_steps`); *Job closed* never flags. Rules 5
and 6 are date-based and computed in `app/src/lib/attention.ts`.

Dot precedence follows V46: red, then amber, then brown. Red and brown pulse;
amber is a steady ring. With reduced motion, all three are steady rings.

## Details worth knowing

- **"Time at a step"** is measured from the step's own date: its `jobs` date
  column, or `job_step_dates` for steps without one, falling back to the job's
  last change for jobs imported from V46 without history. The booking date is
  a plan, not an arrival, so it never counts as one.
- **No stale flag while an install is booked in the future.** A job waiting on
  the calendar is not neglected, and would otherwise nag every day until the
  install.
- **An overdue install replaces the step rule for that job**, so it gets one
  line, not two.
- **An install in progress past its booked date counts as overdue.** That
  matches the job panel's existing "Install overdue" alert.
- **V46 measured CES waiting from CES submitted until CES received**, across the
  inspector steps. Per-step timing resets the clock when the job moves on to
  *Inspector review*. That is reasonable, since the move means something
  happened, but if Fred wants the old behaviour, give *Inspector review* (and
  *Fixes complete*) the same 14 days and "Chase the inspector".

## Later

- A Settings screen for Fred to edit the thresholds and actions per step.
- A way to collapse the panel. It already hides below 1100px wide.
