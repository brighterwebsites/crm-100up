-- 100UP CRM — who has signed in, and when.
--
-- Fred is testing on his own and Vanessa needs to see whether he is actually
-- in there, without asking him. `job_events` already answers "what has he
-- changed" — it carries an actor and a timestamp on every stage move, date
-- edit and reschedule — but it says nothing about someone who logged in and
-- only looked around, which is most of what early testing is.
--
-- `auth.users.last_sign_in_at` has that, and PostgREST cannot reach it:
-- `auth` is not in the exposed schema list, and it should not be. A narrow
-- SECURITY DEFINER function is the smallest way across that line, and a much
-- smaller one than an Edge Function with the service-role key.
--
-- SECURITY DEFINER, so the admin check is INSIDE the function body rather
-- than left to the caller — the function runs as its owner, so anyone allowed
-- to execute it would otherwise read every row. It returns nothing at all to
-- a non-admin, and exposes three columns and a timestamp, never a password
-- hash, token or recovery field.
--
-- `last_sign_in_at` is the last time credentials were exchanged, not liveness:
-- a session lasts days, so "signed in this morning" is compatible with both
-- "using it now" and "closed the laptop at 9am". Paired with the most recent
-- job_event it is close enough to answer the real question.

create or replace function public.user_activity()
returns table (
  id              uuid,
  full_name       text,
  role            text,
  last_sign_in_at timestamptz,
  created_at      timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select p.id, p.full_name, p.role::text, u.last_sign_in_at, p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where (select private.is_admin())
  order by u.last_sign_in_at desc nulls last;
$$;

revoke all on function public.user_activity() from public, anon;
grant execute on function public.user_activity() to authenticated;

comment on function public.user_activity() is
  'Admin-only: every profile with its last sign-in from auth.users, which PostgREST cannot serve directly. The is_admin() check is inside the body because the function is SECURITY DEFINER. Returns no rows to a non-admin.';
