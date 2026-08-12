-- 100UP CRM — allow over-receipt (D4).
--
-- purchase_order_items carries:
--
--   CHECK (qty_received >= 0 AND qty_received <= qty_ordered)
--
-- which forbids receiving more than was ordered. That was safe while
-- qty_received was hand-entered, but the rollup trigger now derives it from
-- what physically arrived, and suppliers over-deliver: a full pallet against a
-- part-pallet order, a substitution, a short-shipped line made good with
-- extras next run.
--
-- Caught by a functional test of the rollup rather than by review — the
-- constraint fired from inside recalc_po_from_receipts() on a PO line with
-- qty_ordered = 1. Left in place it would not have blocked the receipt
-- cleanly; it would have aborted the whole atomic receive at commit time,
-- with the failure surfacing from a trigger two frames removed from the cause.
--
-- Design decision is accept and flag, never block (docs/goods-receipt-design.md
-- §5): the goods are physically on the shelf, and refusing to record them
-- makes stock wrong to protect a number that is only advisory. The over-receipt
-- is surfaced in the UI by comparing qty_received against qty_ordered — no
-- constraint needed to notice it.
--
-- The lower bound is kept. Negative received quantities are not a business
-- case, they are a bug.

alter table public.purchase_order_items
  drop constraint purchase_order_items_check,
  add constraint purchase_order_items_qty_received_check
    check (qty_received >= 0);

comment on column public.purchase_order_items.qty_received is
  'Rollup of goods_receipt_items pointing at this line, maintained by the z_goods_receipt_items_rollup trigger. May exceed qty_ordered — over-receipt is accepted and flagged in the UI, not blocked.';
