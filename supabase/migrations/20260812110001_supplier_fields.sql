-- 100UP CRM — supplier detail fields.
--
-- `suppliers` holds name, phone, email and notes, which is too thin for the
-- Customers-style detail panel the Suppliers page is being reworked into
-- (docs/goods-receipt-design.md §7, D6).
--
-- Text with `not null default ''` throughout, matching the existing phone /
-- email / notes columns — the app treats blank as "not recorded" and never
-- has to null-check.
--
-- `state` is left as free text rather than an enum. The set is stable, but an
-- enum buys nothing here (no logic branches on it) and costs a migration the
-- first time an interstate supplier writes something unexpected.

alter table public.suppliers
  add column abn              text not null default '',
  add column address_line     text not null default '',
  add column suburb           text not null default '',
  add column state            text not null default '',
  add column postcode         text not null default '',
  -- 100UP's trading account with this supplier, as it appears on their
  -- paperwork. Distinct from any PO or invoice reference.
  add column account_number   text not null default '',
  add column website          text not null default '',
  add column payment_terms    text not null default '',
  add column contact_name     text not null default '';

comment on column public.suppliers.account_number is
  '100UP''s account number with this supplier, as printed on their invoices.';
comment on column public.suppliers.payment_terms is
  'Free text, e.g. "30 days EOM" — recorded for reference, not used in any calculation.';
