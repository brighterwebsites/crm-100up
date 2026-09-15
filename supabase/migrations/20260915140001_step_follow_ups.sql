-- ── Follow-up thresholds per pipeline step ─────────────────────────────
-- Drives the Pipeline's "Needs attention" panel, its pulsing dots, and the
-- Alerts / Stale filters (which until now had no real rules behind them: V46
-- stored alert/stale flags on each job but nothing ever set them).
--
-- follow_up_days: flag a job that has sat at this step longer than this.
--                 null = never (a closed job needs nothing).
-- follow_up_action: the one-line prompt shown with it; '' = the generic
--                 "No movement for N days".
--
-- Starting defaults proposed 2026-09-15 and emailed to Fred for adjustment;
-- they are data, so his numbers are an UPDATE, not a code change. Full rule
-- set (these four plus two date-based rules computed in the app):
-- docs/pipeline-attention-design.md.

alter table public.pipeline_steps
  add column follow_up_days   integer check (follow_up_days is null or follow_up_days > 0),
  add column follow_up_action text not null default '';

update public.pipeline_steps set follow_up_days = 21;

update public.pipeline_steps set follow_up_days = 7,  follow_up_action = 'Follow up the quote'
where key = 'send_quote';

-- V46's one real rule: CES waiting more than 14 days, "Chase the inspector".
update public.pipeline_steps set follow_up_days = 14, follow_up_action = 'Chase the inspector'
where key = 'ces_submitted';

update public.pipeline_steps set follow_up_days = 30, follow_up_action = 'Chase the rebate'
where key = 'rebate_submitted';

update public.pipeline_steps set follow_up_days = null
where key = 'job_closed';
