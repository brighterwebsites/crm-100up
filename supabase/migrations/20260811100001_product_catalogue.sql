-- 100UP CRM — turn `stocks` into a product catalogue.
--
-- Step 0 of docs/quote-configurator-design.md (§3), A3 of
-- docs/phase-a-implementation-plan.md. Schema only: no data is classified
-- here (that is A4) and nothing reads these columns yet.
--
-- WHY: today a product's identity is a NAME STRING. The calculator generates
-- a part name from a template, and `normalizePart()` fuzzy-matches that
-- string against `stocks.name` to find the stock row. When it misses it
-- fails silently — the quote still prices and allocates nothing (see
-- docs/bugs.md #9, which is exactly this). These columns are the first half
-- of replacing that string match with a `stock_id` foreign key, so the link
-- becomes a database constraint instead of a regex that might hold.

-- What role a product plays in a system configuration. Deliberately NOT the
-- existing `ces_category`, which answers a different question — whether and
-- how the item appears on a CES compliance form. A SigenStor mounting kit is
-- ces_category='other' but product_type='mounting'; both facts are true and
-- neither substitutes for the other.
create type public.product_type as enum (
  'panel',
  'inverter',
  'battery',
  'gateway',
  'mounting',
  'bms',           -- Deye PDU3 / Base stack components
  'gm_component',  -- ground-mount frame parts (19 of them, added in A4)
  'consumable',
  'other'
);

create type public.electrical_phase as enum ('single', 'three', 'na');

alter table public.stocks
  add column product_type public.product_type    not null default 'other',
  -- An electrical property of the product itself, not a per-quote choice:
  -- an AI-W5.1-8P1 IS single-phase. The configurator filters pickers by this,
  -- which is what makes it structurally impossible to put a three-phase
  -- inverter in a single-phase system.
  add column phase        public.electrical_phase not null default 'na',
  -- Plain text, not a manufacturers FK. That normalisation stays PARKED
  -- (docs/schema-restructure-proposal.md §7); nothing here forecloses it.
  add column brand        text not null default '',

  -- Planning price: what quotes are costed at. Deliberately SEPARATE from
  -- last_cost (what was actually paid), so a mid-quarter supplier price rise
  -- cannot silently move live quotes. Fred confirmed last_cost must stay
  -- visible in the calculator — the Products page shows both side by side
  -- with a one-click "use last cost", so the planning price cannot drift
  -- unnoticed. Visible, not automatic. (design doc D3)
  add column planning_cost numeric not null default 0
    check (planning_cost >= 0),
  add column planning_cost_updated_at timestamptz,

  -- EOL flag. Inactive products stay in the catalogue so historical quotes
  -- and job stock lines keep resolving, but drop out of the configurator's
  -- pickers.
  add column active boolean not null default true;

-- NOTE: no `quotable` column, though the design sketched one. It turned out
-- redundant — the configurator never browses "all quotable products", it
-- attaches products by role, so every picker is already scoped by
-- product_type + phase + active. A hand-maintained allow-list on top of that
-- would only be one more thing to drift.

-- NO INDEXES. 17 rows today, a few dozen after A4 adds the ground-mount
-- parts. A seq scan is faster than an index here, and an unused index is
-- write overhead plus a maintenance obligation. Revisit if this ever reaches
-- thousands of rows.

-- NO RLS CHANGES NEEDED. Policies on public.stocks are table-level, not
-- column-level, and grants are table-level too — the new columns inherit
-- both. Verified against 20260718090002_rls.sql before writing this.

comment on column public.stocks.planning_cost is
  'Price quotes are costed at. Separate from last_cost (actually paid) so supplier price changes do not silently reprice live quotes.';
comment on column public.stocks.product_type is
  'Role in a system configuration. Distinct from ces_category, which is about CES compliance reporting.';
comment on column public.stocks.phase is
  'Electrical phase of the product itself. Filters configurator pickers so an incompatible unit cannot be selected.';
