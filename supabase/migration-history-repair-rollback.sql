-- ROLLBACK for the migration-history repair performed 2026-08-11.
--
-- Context: the remote migration history (supabase_migrations.schema_migrations)
-- had seven entries whose version timestamps did not match ANY local migration
-- filename, and two local migrations (phase2_restructure, private_integrations)
-- whose objects existed in the database but had no history row at all — they
-- were applied out-of-band rather than through the migration system.
--
-- Effect: `supabase db push` matches on version string, found none of the nine
-- local versions present, and would have attempted to re-apply all of them
-- (failing immediately on `create table public.stocks`).
--
-- The repair re-stamped the seven existing rows to their local filename
-- versions (an UPDATE, so the recorded `statements` arrays are preserved) and
-- inserted the two missing rows with null statements — the same end state
-- `supabase migration repair --status applied <version>` produces.
--
-- Nothing in this repair touched the schema itself. Only the bookkeeping table.
--
-- Run this file only to undo the repair and restore the pre-2026-08-11 state.

begin;

update supabase_migrations.schema_migrations m
set version = v.old_version, name = v.old_name
from (values
  ('20260718090001', '20260719011108', 'core_schema'),
  ('20260718090002', '20260719011146', 'rls_policies'),
  ('20260718090003', '20260719011254', 'functions_triggers'),
  ('20260718090004', '20260719011413', 'allow_direct_sql_transitions'),
  ('20260719010001', '20260719085045', 'assumptions'),
  ('20260719020001', '20260719092149', 'merge_stock_specs'),
  ('20260719030001', '20260719115047', 'purchase_orders')
) as v(new_version, old_version, old_name)
where m.version = v.new_version;

delete from supabase_migrations.schema_migrations
where version in ('20260719000001', '20260722210001');

commit;

-- Expected result: 7 rows, versions 20260719011108 .. 20260719115047.
