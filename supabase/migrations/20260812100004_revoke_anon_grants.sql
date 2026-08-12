-- 100UP CRM — take back the grants Postgres handed out by default.
--
-- This project carries an ALTER DEFAULT PRIVILEGES rule (postgres and
-- supabase_admin, object type 'r') that grants ALL to anon, authenticated and
-- service_role on every new table in public. So a migration that says
--
--   grant select on public.email_sends to authenticated;
--
-- does not describe the outcome: the table already had DELETE, INSERT,
-- REFERENCES, TRIGGER, TRUNCATE and UPDATE for anon and authenticated before
-- that line ran. Every other table here was tightened; three were missed.
--
-- Exposure today is limited rather than absent. All three have RLS enabled
-- with policies naming only `authenticated`, so anon is denied every row
-- operation, and PostgREST exposes no TRUNCATE endpoint — the one privilege
-- RLS does not govern. This is defence in depth and a correction of intent,
-- not an incident.
--
-- purchase_order_items is the pre-existing instance of the same slip, fixed
-- here because it has the identical cause and leaving it would mean the next
-- person to check finds the rule already broken.
--
-- Rule 5 in CLAUDE.md: explicit grant, enable RLS, one policy per operation,
-- and anon gets nothing.

-- ── new tables from this batch ────────────────────────────────────────────
revoke all on public.email_sends from anon, authenticated;
revoke all on public.ai_call_log from anon, authenticated;

-- Re-grant only what the app reads. Inserts come from Edge Functions on the
-- service role, which is unaffected by these revokes.
grant select on public.email_sends to authenticated;
grant select on public.ai_call_log to authenticated;

-- ── pre-existing ──────────────────────────────────────────────────────────
-- Policies already cover select (all), insert/update/delete (admin), so the
-- grants below match the policy set exactly.
revoke all on public.purchase_order_items from anon, authenticated;
grant select, insert, update, delete on public.purchase_order_items to authenticated;
