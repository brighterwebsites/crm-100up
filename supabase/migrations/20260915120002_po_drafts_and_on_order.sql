-- ── PO drafts, part 2: lifecycle, send, delete guard ───────────────────
-- POs were created already marked 'sent', and nothing counted them as on
-- order, so the Order List kept offering the same shortfall: SigenStor
-- BAT 10.0 x5 was ordered five times. Now:
--   * create_purchase_order makes a DRAFT, and a supplier may have only one
--     draft at a time: send (or delete) it before creating the next.
--   * mark_purchase_order_sent moves draft -> sent and stamps sent_at. The
--     app's "Send to supplier" emails the PO first, then calls this.
--   * Drafts, sent and part-received POs count as on order in the app, so
--     covered items leave the Order List (app/src/lib/stockCalc.ts).
--   * Deleting a PO is refused once anything has been received against it.
--     Receipts reference POs ON DELETE SET NULL, so until now a delete
--     silently detached them; only a hidden button stood in the way.
--   * The receipt roll-up keeps a draft a draft instead of forcing 'sent'.

-- The seven POs created during testing (2026-07-19 and 2026-09-15) are all
-- dummies, confirmed by Vanessa 2026-09-15. None has anything received.
delete from public.purchase_orders po
where po.id in (2, 3, 4, 5, 6, 7, 8)
  and po.po_status = 'sent'
  and not exists (select 1 from public.purchase_order_items i
                  where i.purchase_order_id = po.id and i.qty_received > 0)
  and not exists (select 1 from public.goods_receipts g where g.purchase_order_id = po.id);

alter table public.purchase_orders add column sent_at timestamptz;

-- One draft per supplier, the no-supplier group included.
create unique index purchase_orders_one_draft_per_supplier
  on public.purchase_orders (supplier_id) nulls not distinct
  where po_status = 'draft';

-- ── create_purchase_order: creates a draft ─────────────────────────────
-- Last defined in 20260719030001_purchase_orders.sql.
create or replace function public.create_purchase_order(
  p_supplier_id bigint,
  p_lines jsonb
) returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  l          jsonb;
  v_qty      integer;
  v_cost     numeric;
  v_count    integer := 0;
  v_units    integer := 0;
  v_amount   numeric := 0;
  v_po_id    bigint;
  r          public.purchase_orders%rowtype;
begin
  if not private.is_elevated() then
    raise exception 'not_allowed: admin only';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'invalid_lines: expected a non-empty array of {stock_id, qty_ordered, cost}';
  end if;
  if p_supplier_id is not null
     and not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'supplier_not_found: supplier % does not exist', p_supplier_id;
  end if;
  if exists (select 1 from public.purchase_orders
             where po_status = 'draft' and supplier_id is not distinct from p_supplier_id) then
    raise exception 'draft_exists: this supplier already has a draft PO; send or delete it first';
  end if;

  insert into public.purchase_orders (supplier_id, po_status)
  values (p_supplier_id, 'draft')
  returning id into v_po_id;

  for l in select * from jsonb_array_elements(p_lines)
  loop
    v_qty  := coalesce((l ->> 'qty_ordered')::integer, 0);
    v_cost := coalesce((l ->> 'cost')::numeric, 0);
    if v_qty <= 0 or not (l ? 'stock_id') then
      continue;
    end if;
    insert into public.purchase_order_items (purchase_order_id, stock_id, qty_ordered, cost)
    values (v_po_id, (l ->> 'stock_id')::bigint, v_qty, v_cost);
    v_count  := v_count + 1;
    v_units  := v_units + v_qty;
    v_amount := v_amount + (v_qty * v_cost);
  end loop;

  if v_count = 0 then
    raise exception 'invalid_lines: no line had a valid stock_id and positive qty_ordered';
  end if;

  update public.purchase_orders
  set item_count = v_count, total_units = v_units, po_amount = v_amount
  where id = v_po_id
  returning * into r;
  return r;
end;
$$;

-- ── mark_purchase_order_sent ───────────────────────────────────────────
create or replace function public.mark_purchase_order_sent(p_po_id bigint)
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.purchase_orders%rowtype;
begin
  if not private.is_elevated() then
    raise exception 'not_allowed: admin only';
  end if;
  update public.purchase_orders
  set po_status = 'sent', sent_at = now()
  where id = p_po_id and po_status = 'draft'
  returning * into r;
  if not found then
    raise exception 'not_a_draft: PO % is not a draft (already sent, or does not exist)', p_po_id;
  end if;
  return r;
end;
$$;

revoke all on function public.mark_purchase_order_sent(bigint) from public, anon;
grant execute on function public.mark_purchase_order_sent(bigint) to authenticated;

-- ── Delete guard ───────────────────────────────────────────────────────
create or replace function private.guard_purchase_order_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.po_status not in ('draft', 'sent')
     or exists (select 1 from public.purchase_order_items i
                where i.purchase_order_id = old.id and i.qty_received > 0)
     or exists (select 1 from public.goods_receipts g where g.purchase_order_id = old.id)
  then
    raise exception 'po_delete_blocked: % has stock received against it', old.po_ref;
  end if;
  return old;
end;
$$;

create trigger a_guard_purchase_order_delete
  before delete on public.purchase_orders
  for each row execute function private.guard_purchase_order_delete();

-- ── recalc_po_from_receipts: a draft stays a draft ─────────────────────
-- Last defined in 20260812110003_po_receipt_rollup.sql. Only the final
-- else branch changes.
create or replace function private.recalc_po_from_receipts(p_poi_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po_id bigint;
begin
  if p_poi_id is null then
    return;
  end if;

  update public.purchase_order_items i
     set qty_received = coalesce((
           select sum(g.qty_received)
           from public.goods_receipt_items g
           where g.purchase_order_item_id = i.id
         ), 0)
   where i.id = p_poi_id
  returning i.purchase_order_id into v_po_id;

  if v_po_id is null then
    return;
  end if;

  -- Over-receipt counts as satisfied: 12 arriving against 10 ordered closes
  -- the line rather than leaving the PO open forever (design §5, D4 — accept
  -- and flag, never block). The flag lives in the UI; the status is honest
  -- about the line being done with.
  update public.purchase_orders po
     set po_status = case
           when (select bool_and(i.qty_received >= i.qty_ordered)
                   from public.purchase_order_items i
                  where i.purchase_order_id = po.id)
             then 'closed'::public.po_status
           when (select bool_or(i.qty_received > 0)
                   from public.purchase_order_items i
                  where i.purchase_order_id = po.id)
             then 'partially_received'::public.po_status
           when po.po_status = 'draft'
             then 'draft'::public.po_status
           else 'sent'::public.po_status
         end
   where po.id = v_po_id
     -- A PO with no lines has nothing to derive a status from. bool_and over
     -- an empty set returns null, which would otherwise blank the status.
     and exists (select 1 from public.purchase_order_items i
                  where i.purchase_order_id = po.id);
end;
$$;
