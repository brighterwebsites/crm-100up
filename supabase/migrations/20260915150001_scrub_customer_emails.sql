-- ── Customer emails → dummy addresses while the CRM is in testing ──────
-- The CRM is not in business use yet and email notifications are next to be
-- built, so no test may reach a real customer. Every customer email becomes
-- support+{initials}{customer id}@brighterwebsites.com.au, which lands in the
-- Brighter Websites support inbox and still says whose it is: Jeffrey Owens
-- (customer 8) becomes support+jo8@…. Initials are the first characters of
-- the first and last words of the name. Customers with no email stay blank.
-- Requested by Vanessa 2026-09-15.
--
-- The originals are kept in private.customer_email_backup, which the API
-- cannot reach (PostgREST serves public only). At cutover the data is
-- re-imported from the V46 freeze export anyway; restore from this table
-- only if a customer was created in the CRM itself.

create table private.customer_email_backup (
  customer_id  bigint primary key,
  email        text not null,
  backed_up_at timestamptz not null default now()
);
revoke all on private.customer_email_backup from public, anon, authenticated;

insert into private.customer_email_backup (customer_id, email)
select id, email from public.customers where email <> '';

update public.customers c
set email = 'support+'
  || lower(
       left(regexp_replace(split_part(trim(c.name), ' ', 1), '[^A-Za-z0-9]', '', 'g'), 1)
    || left(regexp_replace(reverse(split_part(reverse(trim(c.name)), ' ', 1)), '[^A-Za-z0-9]', '', 'g'), 1)
     )
  || c.id
  || '@brighterwebsites.com.au'
where c.email <> '';
