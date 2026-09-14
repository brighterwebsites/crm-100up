-- ── Drop tidied job fields ─────────────────────────────────────────────
-- Part 2 of the 2026-09-15 job field tidy-up (the drop half). Applied only
-- after the frontend that stopped writing these columns was deployed; see
-- 20260915090001_installer_notes.sql.
--
-- Data dropped, checked 2026-09-15:
--   installation_requests.vehicle          empty in all 4 rows
--   site_access_notes, special_instructions,
--   additional_notes                       test text only (jobs 200, 202)
--   jobs.fixes_needed                      4 true: two test jobs, plus jobs
--                                          8 and 9, both CES-certificate
--                                          corrections whose notes already
--                                          record "fixes sent 2 May"
-- No views, policies or functions depend on these columns; guard_jobs_update
-- stopped referencing fixes_needed in part 1.

alter table public.jobs
  drop column fixes_needed;

alter table public.installation_requests
  drop column vehicle,
  drop column site_access_notes,
  drop column special_instructions,
  drop column additional_notes;
