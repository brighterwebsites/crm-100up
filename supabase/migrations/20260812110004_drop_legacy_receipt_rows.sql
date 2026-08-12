-- 100UP CRM — drop the legacy receipt-shaped purchase orders (D1).
--
-- receive_stock() writes a receipt as a purchase_orders row with po_status
-- 'closed' and NO purchase_order_items at all, carrying only item_count and
-- total_units aggregates. Which items were received was never recorded, so
-- these rows cannot be migrated into goods_receipts — there is nothing to
-- migrate. Confirmed as dummy data and dropped.
--
-- The fingerprint is exact rather than approximate: create_purchase_order()
-- raises 'invalid_lines' unless at least one line inserts, so a PO with zero
-- line rows can only have come from receive_stock. The po_status = 'closed'
-- condition is belt-and-braces on top of that.
--
-- One row matched at the time of writing.
--
-- NOTE: stocks.qty is deliberately NOT unwound. Those increments happened,
-- quantities have been edited by hand since, and reversing them would make
-- on-hand figures less accurate rather than more. The consequence is that
-- current stock levels include movements with no surviving receipt behind
-- them — true of everything before this migration regardless, since the line
-- detail never existed.

do $$
declare
  v_deleted integer;
begin
  delete from public.purchase_orders po
   where po.po_status = 'closed'
     and not exists (
       select 1 from public.purchase_order_items i
        where i.purchase_order_id = po.id
     );

  get diagnostics v_deleted = row_count;
  raise notice 'dropped % legacy receipt-shaped purchase order(s)', v_deleted;
end;
$$;

-- receive_stock() itself is deliberately LEFT IN PLACE. The Receive Stock
-- screen still calls it, and removing it here would break a working flow
-- before receive_goods exists to take over. It goes when step 2 lands.
