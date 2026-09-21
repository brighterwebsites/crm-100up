-- 100UP CRM — say out loud that this is not live yet, and record who typed what.
--
-- Fred started testing on 2026-09-20 and the risk is not that he breaks
-- something. It is that he starts RELYING on it: enters a real customer who
-- rang, books a real install, and then loses it, because the cutover import
-- (`scripts/import_from_export.py --truncate`) deletes every operational row
-- and rewrites `stocks.qty` from the V46 freeze export.
--
-- Which is also the reassuring half. Test jobs consuming test stock, test
-- purchase orders, test stock takes — none of it survives cutover, and none
-- of it has to be cleaned up by hand. The distortion is self-clearing. What
-- cannot be recovered is real work typed into the wrong system.
--
-- So the banner's job is not "we are still building". It is "keep doing real
-- work in V46, because everything here gets thrown away".

-- ── 1. Testing vs live ────────────────────────────────────────────────
-- Lives on app_notice because it is the same thing: app-wide state that
-- drives a banner, one row, already published to realtime so a change
-- reaches an open tab without a refresh. A second singleton table for one
-- enum would be ceremony.
alter table public.app_notice
  add column mode text not null default 'testing'
    check (mode in ('testing', 'live'));

comment on column public.app_notice.mode is
  'testing = pre-cutover; everything in the CRM is disposable and the banner says so. Flipped to live once at cutover, after the import has run. Drives ModeBanner.';

-- ── 2. Who created this record ────────────────────────────────────────
-- Answers "is this one of Fred's or one of mine?" without a test/real flag
-- system. A flag would be the wrong tool: nothing here is real, so there is
-- no real/test split to make — only an authorship question, and that has a
-- straight answer.
--
-- job_events already records who ADVANCED a job. Nothing recorded who made
-- one in the first place, which is the question that actually comes up.
alter table public.jobs
  add column created_by uuid references public.profiles (id) on delete set null
    default auth.uid();

alter table public.customers
  add column created_by uuid references public.profiles (id) on delete set null
    default auth.uid();

-- Existing rows stay null. That is honest: they came from the legacy import
-- or predate this, and guessing an author would be worse than saying nothing.
comment on column public.jobs.created_by is
  'Who created the job. Null for rows imported or created before 2026-09-21. Defaults to auth.uid(), so the app sets it without doing anything.';

-- guard_jobs_update names the columns it protects (stage, step, the pipeline
-- dates) and lists installer-writable columns explicitly, so a new column is
-- neither blocked nor accidentally granted. Nothing to change there.
