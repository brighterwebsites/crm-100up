-- ── Stock takes, and on hand made read-only ────────────────────────────
-- A stock take is created when its count sheet is printed, so the paper and
-- the system share one number (ST-0001). The sheet's lines are snapshotted at
-- that moment (qty_printed), so it can be recalled and reprinted exactly.
-- Counts are entered against it later and applied in one go; each applied
-- line records the on-hand figure it replaced, so every correction carries a
-- reference, the way a receipt carries a PO.
--
-- On hand (stocks.qty) becomes read-only to the app. It now changes only
-- through the SECURITY DEFINER functions that carry a reference: receiving
-- (PO / receipt), installs (job) and apply_stock_take (ST-####). Until now the
-- Stock item panel could overwrite it with no record, which is how
-- "4 purchased, 6 on hand" happens with nothing to explain it.
-- Design: docs/design/stock-take-design.md.

create sequence public.stock_take_ref_seq;

create table public.stock_takes (
  id            bigint generated always as identity primary key,
  ref           text not null unique
                default ('ST-' || lpad(nextval('public.stock_take_ref_seq')::text, 4, '0')),
  status        text not null default 'open' check (status in ('open', 'applied', 'cancelled')),
  product_types public.product_type[] not null,
  printed_at    timestamptz not null default now(),
  printed_by    uuid references public.profiles (id) on delete set null,
  applied_at    timestamptz,
  applied_by    uuid references public.profiles (id) on delete set null
);

-- One open stock take at a time: two overlapping counts applied one after
-- the other would silently overwrite each other.
create unique index stock_takes_one_open on public.stock_takes ((status)) where status = 'open';

create table public.stock_take_lines (
  stock_take_id bigint  not null references public.stock_takes (id) on delete cascade,
  stock_id      bigint  not null references public.stocks (id) on delete restrict,
  qty_printed   integer not null,                      -- on hand when the sheet was printed
  qty_counted   integer check (qty_counted >= 0),      -- null = not counted
  qty_system    integer,                               -- on hand it replaced, set on apply
  primary key (stock_take_id, stock_id)
);

-- Default privileges hand ALL to anon/authenticated on new tables
-- (docs/bugs.md #13), so revoke before granting. Admin-only reads; writes go
-- through the functions below.
revoke all on public.stock_takes, public.stock_take_lines from anon, authenticated;
grant select on public.stock_takes, public.stock_take_lines to authenticated;
alter table public.stock_takes enable row level security;
alter table public.stock_take_lines enable row level security;
create policy stock_takes_select_admin on public.stock_takes
  for select to authenticated using ((select private.is_admin()));
create policy stock_take_lines_select_admin on public.stock_take_lines
  for select to authenticated using ((select private.is_admin()));

alter publication supabase_realtime add table public.stock_takes, public.stock_take_lines;

-- ── create_stock_take: called when the sheet is printed ────────────────
create or replace function public.create_stock_take(p_product_types public.product_type[])
returns public.stock_takes
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.stock_takes%rowtype;
begin
  if not private.is_elevated() then
    raise exception 'not_allowed: admin only';
  end if;
  if p_product_types is null or cardinality(p_product_types) = 0 then
    raise exception 'no_types: pick at least one product type';
  end if;
  if exists (select 1 from public.stock_takes where status = 'open') then
    raise exception 'stock_take_open: apply or cancel the open stock take first';
  end if;

  insert into public.stock_takes (product_types, printed_by)
  values (p_product_types, (select auth.uid()))
  returning * into r;

  -- Active items, plus inactive ones that still have stock on the shelf.
  insert into public.stock_take_lines (stock_take_id, stock_id, qty_printed)
  select r.id, s.id, s.qty
  from public.stocks s
  where s.product_type = any (p_product_types)
    and (s.active or s.qty > 0);
  if not found then
    raise exception 'no_items: there are no stock items of those types to count';
  end if;

  return r;
end;
$$;

-- ── save_stock_take_counts: counts entered so far, before applying ─────
-- p_counts: [{ "stock_id": 12, "qty_counted": 4 | null }, …]
create or replace function public.save_stock_take_counts(p_stock_take_id bigint, p_counts jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb;
begin
  if not private.is_elevated() then
    raise exception 'not_allowed: admin only';
  end if;
  if not exists (select 1 from public.stock_takes where id = p_stock_take_id and status = 'open') then
    raise exception 'stock_take_closed: this stock take is no longer open';
  end if;

  for c in select * from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb))
  loop
    update public.stock_take_lines
    set qty_counted = case when jsonb_typeof(c -> 'qty_counted') in ('number', 'string')
                           then (c ->> 'qty_counted')::integer end
    where stock_take_id = p_stock_take_id
      and stock_id = (c ->> 'stock_id')::bigint;
  end loop;
end;
$$;

-- ── apply_stock_take: on hand becomes the counted figure ───────────────
create or replace function public.apply_stock_take(p_stock_take_id bigint)
returns public.stock_takes
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.stock_takes%rowtype;
begin
  if not private.is_elevated() then
    raise exception 'not_allowed: admin only';
  end if;

  select * into r from public.stock_takes where id = p_stock_take_id for update;
  if not found or r.status <> 'open' then
    raise exception 'stock_take_closed: this stock take is no longer open';
  end if;
  if not exists (select 1 from public.stock_take_lines
                 where stock_take_id = r.id and qty_counted is not null) then
    raise exception 'nothing_counted: enter at least one count before applying';
  end if;

  -- Lock the affected stock rows so a receipt or install cannot land between
  -- recording the old figure and replacing it.
  perform 1 from public.stocks s
  join public.stock_take_lines l on l.stock_id = s.id
  where l.stock_take_id = r.id and l.qty_counted is not null
  for update of s;

  update public.stock_take_lines l
  set qty_system = s.qty
  from public.stocks s
  where l.stock_take_id = r.id and l.qty_counted is not null and s.id = l.stock_id;

  update public.stocks s
  set qty = l.qty_counted
  from public.stock_take_lines l
  where l.stock_take_id = r.id and l.qty_counted is not null and s.id = l.stock_id;

  update public.stock_takes
  set status = 'applied', applied_at = now(), applied_by = (select auth.uid())
  where id = r.id
  returning * into r;
  return r;
end;
$$;

-- ── cancel_stock_take ──────────────────────────────────────────────────
-- Cancelled, not deleted: the printed sheet exists, so its number stays
-- accounted for.
create or replace function public.cancel_stock_take(p_stock_take_id bigint)
returns public.stock_takes
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.stock_takes%rowtype;
begin
  if not private.is_elevated() then
    raise exception 'not_allowed: admin only';
  end if;
  update public.stock_takes set status = 'cancelled'
  where id = p_stock_take_id and status = 'open'
  returning * into r;
  if not found then
    raise exception 'stock_take_closed: this stock take is no longer open';
  end if;
  return r;
end;
$$;

revoke all on function public.create_stock_take(public.product_type[]) from public, anon;
revoke all on function public.save_stock_take_counts(bigint, jsonb) from public, anon;
revoke all on function public.apply_stock_take(bigint) from public, anon;
revoke all on function public.cancel_stock_take(bigint) from public, anon;
grant execute on function public.create_stock_take(public.product_type[]) to authenticated;
grant execute on function public.save_stock_take_counts(bigint, jsonb) to authenticated;
grant execute on function public.apply_stock_take(bigint) to authenticated;
grant execute on function public.cancel_stock_take(bigint) to authenticated;

-- ── On hand is read-only to the app ────────────────────────────────────
-- Every function allowed to move stock (advance_job_stage, move_job_back,
-- receive_stock, receive_goods, apply_stock_take) is SECURITY DEFINER and
-- runs as its owner. A direct write from the app runs as `authenticated`.
-- This function is SECURITY INVOKER so current_user tells the two apart:
-- do not make it SECURITY DEFINER, or the check stops seeing the caller.
create or replace function private.guard_stock_qty()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.qty <> 0 then
      raise exception 'stock_qty_read_only: new items start at 0 on hand; receive stock or run a stock take';
    elsif tg_op = 'UPDATE' and new.qty is distinct from old.qty then
      raise exception 'stock_qty_read_only: on hand changes only through receiving, installs and stock takes';
    end if;
  end if;
  return new;
end;
$$;

create trigger a_guard_stock_qty
  before insert or update on public.stocks
  for each row execute function private.guard_stock_qty();
