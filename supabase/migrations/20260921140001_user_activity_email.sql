-- 100UP CRM — show the account's email alongside its name.
--
-- `user_activity()` (20260921110002) returned name, role and last sign-in,
-- which answers "is Fred in there". It does not answer "which account IS
-- this", and that is the question that comes up when you need to sign in as
-- the test installer to re-verify docs/bugs.md #14 — the display name
-- "Installer One" appears in three docs and the address appears nowhere.
--
-- The email is the only durable handle on an account. It is not a secret,
-- the function is already admin-only, and an admin can see every profile
-- anyway; withholding it just sends them to the Supabase dashboard for
-- something the app should be able to tell them.
--
-- Still never returned: anything from auth.users beyond the address and the
-- sign-in timestamp. No password hash, no tokens, no recovery fields.
--
-- Return type changes, so the function has to be dropped rather than
-- replaced — `create or replace` cannot alter an OUT signature.

drop function if exists public.user_activity();

create function public.user_activity()
returns table (
  id              uuid,
  full_name       text,
  email           text,
  role            text,
  last_sign_in_at timestamptz,
  created_at      timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select p.id, p.full_name, u.email::text, p.role::text, u.last_sign_in_at, p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where (select private.is_admin())
  order by u.last_sign_in_at desc nulls last;
$$;

revoke all on function public.user_activity() from public, anon;
grant execute on function public.user_activity() to authenticated;

comment on function public.user_activity() is
  'Admin-only: every profile with its email and last sign-in from auth.users, which PostgREST cannot serve directly. The is_admin() check is inside the body because the function is SECURITY DEFINER. Returns no rows to a non-admin, and never returns a password hash, token or recovery field.';
