-- 100UP CRM — PO rollup from receipts, and the landed-cost view.
--
-- purchase_order_items.qty_received stops being a value anyone writes and
-- becomes a rollup of the receipt lines pointing at it. purchase_orders.po_status
-- follows from the same figures. That is what makes "several receipts against
-- one order" work without anyone having to keep two numbers in step by hand.

-- ── recalculation ─────────────────────────────────────────────────────────
-- Idempotent by construction: it sums from scratch rather than adjusting, so
-- calling it twice, or after a partial failure, cannot drift.
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
           else 'sent'::public.po_status
         end
   where po.id = v_po_id
     -- A PO with no lines has nothing to derive a status from. bool_and over
     -- an empty set returns null, which would otherwise blank the status.
     and exists (select 1 from public.purchase_order_items i
                  where i.purchase_order_id = po.id);
end;
$$;

revoke all on function private.recalc_po_from_receipts(bigint) from public, anon, authenticated;

-- ── trigger ───────────────────────────────────────────────────────────────
-- Both sides are recalculated on UPDATE. Re-pointing a receipt line from one
-- PO line to another leaves the ORIGINAL line overstated if only the new one
-- is touched, and that is exactly the correction someone makes after a
-- mismatched line is spotted.
create or replace function private.goods_receipt_items_rollup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.recalc_po_from_receipts(old.purchase_order_item_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.recalc_po_from_receipts(new.purchase_order_item_id);
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.goods_receipt_items_rollup() from public, anon, authenticated;

create trigger z_goods_receipt_items_rollup
  after insert or update or delete on public.goods_receipt_items
  for each row execute function private.goods_receipt_items_rollup();

-- ── landed cost ───────────────────────────────────────────────────────────
-- A view, not a stored column. Freight and prices arrive after the goods and
-- get corrected afterwards, so anything stored would be stale exactly when it
-- mattered. stocks.last_landed_cost stays a snapshot because "last known" is
-- what that column means.
--
-- Freight belongs to a DOCUMENT, and a document can span several receipts, so
-- it apportions by line value across every line the document covers — not
-- just the lines of one delivery (D8).
create view public.goods_receipt_items_landed
with (security_invoker = true)
as
with line_value as (
  select gri.id,
         gri.goods_receipt_id,
         gri.qty_received * coalesce(gri.unit_cost_ex_gst, 0) as value
  from public.goods_receipt_items gri
),
doc_lines as (
  -- Every line each document reaches, through the receipts it is linked to.
  select grd.supplier_document_id as doc_id,
         lv.id                    as line_id,
         lv.value
  from public.goods_receipt_documents grd
  join line_value lv on lv.goods_receipt_id = grd.goods_receipt_id
),
doc_totals as (
  select doc_id, sum(value) as total_value
  from doc_lines
  group by doc_id
),
freight_share as (
  -- Summed over documents: a receipt carrying both a docket and an invoice
  -- takes freight from whichever of them charged it.
  select dl.line_id,
         sum(
           case
             when dt.total_value > 0
               then sd.freight_ex_gst * (dl.value / dt.total_value)
             else 0
           end
         ) as freight_allocated
  from doc_lines dl
  join doc_totals dt on dt.doc_id = dl.doc_id
  join public.supplier_documents sd on sd.id = dl.doc_id
  group by dl.line_id
)
select gri.id,
       gri.goods_receipt_id,
       gri.stock_id,
       gri.purchase_order_item_id,
       gri.qty_received,
       gri.unit_cost_ex_gst,
       gri.gst_applicable,
       coalesce(fs.freight_allocated, 0) as freight_allocated,
       -- Zero where the document carried no prices — a docket-only receipt has
       -- no value to apportion against, and a landed cost built on no cost at
       -- all would be a fiction. It resolves itself when the invoice arrives.
       coalesce(gri.unit_cost_ex_gst, 0)
         + coalesce(fs.freight_allocated, 0) / gri.qty_received
         as landed_unit_cost
from public.goods_receipt_items gri
left join freight_share fs on fs.line_id = gri.id;

revoke all on public.goods_receipt_items_landed from anon, authenticated;
grant select on public.goods_receipt_items_landed to authenticated;

comment on view public.goods_receipt_items_landed is
  'Receipt lines with freight apportioned by line value across every line the charging document covers. security_invoker, so the underlying RLS applies.';
