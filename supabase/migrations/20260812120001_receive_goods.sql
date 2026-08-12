-- 100UP CRM — receive_goods and attach_supplier_document (step 2).
--
-- Two entry points, because the two things that happen are genuinely
-- different and a single function with a mode flag would hide that:
--
--   receive_goods()             goods arrived — move stock, record what and
--                               at what price, advance the PO
--   attach_supplier_document()  the invoice turned up for goods already
--                               received — record prices, move nothing
--
-- That split is the "stock moves once, prices can arrive later" rule made
-- executable. Calling receive_goods() twice for one delivery double-counts
-- stock; calling attach_supplier_document() twice is harmless.
--
-- Both are SECURITY DEFINER and gated on private.is_elevated() — admin, or a
-- service-role caller with no auth.uid(), matching receive_stock() so an Edge
-- Function can drive them.

-- ── shared: GST normalisation ─────────────────────────────────────────────
-- Line prices are stored ex-GST always. What arrives depends on how the
-- supplier prints their invoice, which is determined by reconciling the
-- document totals (docs/goods-receipt-design.md §4) rather than guessed.
--
--   ex_gst   store as printed
--   inc_gst  divide out GST, but only on lines that actually attract it
--   mixed    the document itemises GST per line, so the printed line price is
--            already ex-GST — same handling as ex_gst
--   unknown  nothing reconciled. Refuse rather than guess: a 10% error in a
--            cost figure is worse than a failed save.
create or replace function private.to_ex_gst(
  p_printed numeric,
  p_basis   text,
  p_gst_applicable boolean
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_printed is null then null
    when p_basis = 'inc_gst' and p_gst_applicable then p_printed / 1.10
    else p_printed
  end;
$$;

revoke all on function private.to_ex_gst(numeric, text, boolean) from public, anon, authenticated;

-- ── receive_goods ─────────────────────────────────────────────────────────
create or replace function public.receive_goods(
  p_supplier_id       bigint,
  p_lines             jsonb,
  p_document          jsonb,
  p_purchase_order_id bigint default null,
  p_received_at       date    default null,
  p_notes             text    default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l              jsonb;
  v_receipt_id   bigint;
  v_doc_id       bigint;
  v_basis        text;
  v_ref          text;
  v_stock_id     bigint;
  v_poi_id       bigint;
  v_qty          integer;
  v_printed      numeric;
  v_gst_app      boolean;
  v_count        integer := 0;
  v_units        integer := 0;
  v_priced       integer := 0;
  v_over         integer := 0;
begin
  if not private.is_elevated() then
    raise exception 'not_allowed: admin only';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'invalid_lines: expected a non-empty array of {stock_id, qty_received}';
  end if;

  if p_document is null or jsonb_typeof(p_document) <> 'object' then
    raise exception 'invalid_document: a receipt must record the docket or invoice it came from';
  end if;

  if not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'supplier_not_found: supplier % does not exist', p_supplier_id;
  end if;

  -- A PO from a different supplier is always a mistake, and silently
  -- accepting it would put the receipt on the wrong order.
  if p_purchase_order_id is not null then
    if not exists (
      select 1 from public.purchase_orders
       where id = p_purchase_order_id and supplier_id = p_supplier_id
    ) then
      raise exception 'po_mismatch: purchase order % does not belong to supplier %',
        p_purchase_order_id, p_supplier_id;
    end if;
  end if;

  v_basis := coalesce(p_document ->> 'price_basis', 'unknown');
  v_ref   := coalesce(p_document ->> 'supplier_ref', '');

  -- ── the document ────────────────────────────────────────────────────────
  begin
    insert into public.supplier_documents (
      supplier_id, doc_type, supplier_ref, doc_date,
      claimed_line_count, claimed_total_units,
      subtotal_ex_gst, gst_amount, total_inc_gst,
      freight_ex_gst, other_charges_ex_gst,
      price_basis, price_basis_source, notes, created_by
    ) values (
      p_supplier_id,
      coalesce(p_document ->> 'doc_type', 'invoice'),
      v_ref,
      (p_document ->> 'doc_date')::date,
      (p_document ->> 'claimed_line_count')::integer,
      (p_document ->> 'claimed_total_units')::numeric,
      (p_document ->> 'subtotal_ex_gst')::numeric,
      (p_document ->> 'gst_amount')::numeric,
      (p_document ->> 'total_inc_gst')::numeric,
      coalesce((p_document ->> 'freight_ex_gst')::numeric, 0),
      coalesce((p_document ->> 'other_charges_ex_gst')::numeric, 0),
      v_basis,
      coalesce(p_document ->> 'price_basis_source', 'reconciled'),
      coalesce(p_document ->> 'notes', ''),
      (select auth.uid())
    )
    returning id into v_doc_id;
  exception when unique_violation then
    -- The (supplier, supplier_ref) unique index. This is the hard-stop half of
    -- duplicate detection, and hitting it means the document is already filed.
    raise exception 'duplicate_document: % has already been recorded for this supplier', v_ref;
  end;

  -- ── the receipt ─────────────────────────────────────────────────────────
  insert into public.goods_receipts (supplier_id, purchase_order_id, received_at, notes, created_by)
  values (p_supplier_id, p_purchase_order_id, coalesce(p_received_at, current_date),
          coalesce(p_notes, ''), (select auth.uid()))
  returning id into v_receipt_id;

  insert into public.goods_receipt_documents (goods_receipt_id, supplier_document_id)
  values (v_receipt_id, v_doc_id);

  -- ── the lines ───────────────────────────────────────────────────────────
  for l in select * from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce((l ->> 'qty_received')::integer, 0);
    if v_qty <= 0 then
      continue;
    end if;

    -- Deliberately no new_name escape hatch, unlike receive_stock(). Creating
    -- a stock item from a misread invoice line is worse than being made to add
    -- it on purpose first — the bad row is permanent and quietly joins the
    -- catalogue, where the refusal is a five-second detour.
    if not (l ? 'stock_id') or (l ->> 'stock_id') is null then
      raise exception 'unknown_stock_item: every line needs a stock_id — add the item to Stock first (%)', l::text;
    end if;
    v_stock_id := (l ->> 'stock_id')::bigint;

    v_poi_id  := nullif(l ->> 'purchase_order_item_id', '')::bigint;
    v_printed := nullif(l ->> 'unit_cost', '')::numeric;
    v_gst_app := coalesce((l ->> 'gst_applicable')::boolean, true);

    if v_printed is not null and v_basis = 'unknown' then
      raise exception 'unresolved_gst_basis: the document has prices but its GST basis did not reconcile — resolve it before saving';
    end if;

    -- The PO line must belong to the PO being received against, or the rollup
    -- silently credits a different order.
    if v_poi_id is not null then
      if p_purchase_order_id is null
         or not exists (select 1 from public.purchase_order_items
                         where id = v_poi_id and purchase_order_id = p_purchase_order_id) then
        raise exception 'po_line_mismatch: purchase order item % is not on purchase order %',
          v_poi_id, p_purchase_order_id;
      end if;
    end if;

    insert into public.goods_receipt_items (
      goods_receipt_id, stock_id, purchase_order_item_id,
      qty_received, unit_cost_ex_gst, gst_applicable, line_note
    ) values (
      v_receipt_id, v_stock_id, v_poi_id,
      v_qty, private.to_ex_gst(v_printed, v_basis, v_gst_app), v_gst_app,
      coalesce(l ->> 'line_note', '')
    );

    -- Per line rather than aggregated, so two lines for the same item (a split
    -- delivery on one docket) both count.
    update public.stocks set qty = qty + v_qty where id = v_stock_id;
    if not found then
      raise exception 'stock_not_found: stock item % does not exist', v_stock_id;
    end if;

    v_count := v_count + 1;
    v_units := v_units + v_qty;
    if v_printed is not null then
      v_priced := v_priced + 1;
    end if;
  end loop;

  if v_count = 0 then
    raise exception 'invalid_lines: no line had a positive quantity';
  end if;

  -- ── costs ───────────────────────────────────────────────────────────────
  -- Read back through the landed view so freight apportionment is applied
  -- consistently rather than recomputed here. Only where a price is actually
  -- known: a docket-only receipt must not zero out a real last_cost.
  update public.stocks s
     set last_cost        = v.unit_cost_ex_gst,
         last_landed_cost = v.landed_unit_cost
    from public.goods_receipt_items_landed v
   where v.goods_receipt_id = v_receipt_id
     and v.stock_id = s.id
     and v.unit_cost_ex_gst is not null;

  -- ── over-receipt (reported, never blocked) ──────────────────────────────
  select count(*) into v_over
    from public.goods_receipt_items g
    join public.purchase_order_items i on i.id = g.purchase_order_item_id
   where g.goods_receipt_id = v_receipt_id
     and i.qty_received > i.qty_ordered;

  return jsonb_build_object(
    'receipt_id',         v_receipt_id,
    'document_id',        v_doc_id,
    'lines',              v_count,
    'units',              v_units,
    'lines_priced',       v_priced,
    'over_receipt_lines', v_over,
    'purchase_order_id',  p_purchase_order_id,
    'po_status',          (select po_status from public.purchase_orders where id = p_purchase_order_id),
    -- Non-fatal reconciliation checks. A document claiming more lines or units
    -- than we recorded usually means a page did not scan (design §5).
    'claimed_line_count', (p_document ->> 'claimed_line_count')::integer,
    'claimed_total_units',(p_document ->> 'claimed_total_units')::numeric,
    'line_count_matches',  (p_document ->> 'claimed_line_count') is null
                             or (p_document ->> 'claimed_line_count')::integer = v_count,
    'total_units_matches', (p_document ->> 'claimed_total_units') is null
                             or (p_document ->> 'claimed_total_units')::numeric = v_units
  );
end;
$$;

revoke all on function public.receive_goods(bigint, jsonb, jsonb, bigint, date, text) from public, anon;
grant execute on function public.receive_goods(bigint, jsonb, jsonb, bigint, date, text) to authenticated;

comment on function public.receive_goods(bigint, jsonb, jsonb, bigint, date, text) is
  'Atomically records a delivery: document, receipt, lines, stock increments, costs and PO rollup. Moves stock — use attach_supplier_document for an invoice covering goods already received.';

-- ── attach_supplier_document ──────────────────────────────────────────────
-- The invoice that arrives after the goods. Records prices against receipts
-- that already exist and moves NO stock.
--
-- p_receipt_ids is an array because one invoice can cover two deliveries (D8);
-- freight on this document then apportions across every line of every receipt
-- listed, which the landed view does on read.
create or replace function public.attach_supplier_document(
  p_supplier_id bigint,
  p_receipt_ids bigint[],
  p_document    jsonb,
  p_prices      jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l           jsonb;
  v_doc_id    bigint;
  v_basis     text;
  v_ref       text;
  v_stock_id  bigint;
  v_printed   numeric;
  v_updated   integer := 0;
  v_total     integer := 0;
begin
  if not private.is_elevated() then
    raise exception 'not_allowed: admin only';
  end if;

  if p_receipt_ids is null or array_length(p_receipt_ids, 1) is null then
    raise exception 'invalid_receipts: at least one receipt id is required';
  end if;

  if exists (
    select 1 from unnest(p_receipt_ids) as rid
     where not exists (
       select 1 from public.goods_receipts g
        where g.id = rid and g.supplier_id = p_supplier_id
     )
  ) then
    raise exception 'receipt_mismatch: every receipt must exist and belong to supplier %', p_supplier_id;
  end if;

  v_basis := coalesce(p_document ->> 'price_basis', 'unknown');
  v_ref   := coalesce(p_document ->> 'supplier_ref', '');

  if jsonb_array_length(coalesce(p_prices, '[]'::jsonb)) > 0 and v_basis = 'unknown' then
    raise exception 'unresolved_gst_basis: the document has prices but its GST basis did not reconcile — resolve it before saving';
  end if;

  begin
    insert into public.supplier_documents (
      supplier_id, doc_type, supplier_ref, doc_date,
      claimed_line_count, claimed_total_units,
      subtotal_ex_gst, gst_amount, total_inc_gst,
      freight_ex_gst, other_charges_ex_gst,
      price_basis, price_basis_source, notes, created_by
    ) values (
      p_supplier_id,
      coalesce(p_document ->> 'doc_type', 'invoice'),
      v_ref,
      (p_document ->> 'doc_date')::date,
      (p_document ->> 'claimed_line_count')::integer,
      (p_document ->> 'claimed_total_units')::numeric,
      (p_document ->> 'subtotal_ex_gst')::numeric,
      (p_document ->> 'gst_amount')::numeric,
      (p_document ->> 'total_inc_gst')::numeric,
      coalesce((p_document ->> 'freight_ex_gst')::numeric, 0),
      coalesce((p_document ->> 'other_charges_ex_gst')::numeric, 0),
      v_basis,
      coalesce(p_document ->> 'price_basis_source', 'reconciled'),
      coalesce(p_document ->> 'notes', ''),
      (select auth.uid())
    )
    returning id into v_doc_id;
  exception when unique_violation then
    raise exception 'duplicate_document: % has already been recorded for this supplier', v_ref;
  end;

  insert into public.goods_receipt_documents (goods_receipt_id, supplier_document_id)
  select rid, v_doc_id from unnest(p_receipt_ids) as rid
  on conflict do nothing;

  -- Prices match to receipt lines by stock item. gst_applicable is read from
  -- the line rather than passed in, because the receipt already recorded it.
  for l in select * from jsonb_array_elements(coalesce(p_prices, '[]'::jsonb))
  loop
    v_stock_id := (l ->> 'stock_id')::bigint;
    v_printed  := nullif(l ->> 'unit_cost', '')::numeric;
    if v_stock_id is null or v_printed is null then
      continue;
    end if;

    update public.goods_receipt_items g
       set unit_cost_ex_gst = private.to_ex_gst(v_printed, v_basis, g.gst_applicable)
     where g.goods_receipt_id = any(p_receipt_ids)
       and g.stock_id = v_stock_id;

    get diagnostics v_total = row_count;
    v_updated := v_updated + v_total;
  end loop;

  update public.stocks s
     set last_cost        = v.unit_cost_ex_gst,
         last_landed_cost = v.landed_unit_cost
    from public.goods_receipt_items_landed v
   where v.goods_receipt_id = any(p_receipt_ids)
     and v.stock_id = s.id
     and v.unit_cost_ex_gst is not null;

  return jsonb_build_object(
    'document_id',   v_doc_id,
    'receipts',      array_length(p_receipt_ids, 1),
    'lines_priced',  v_updated
  );
end;
$$;

revoke all on function public.attach_supplier_document(bigint, bigint[], jsonb, jsonb) from public, anon;
grant execute on function public.attach_supplier_document(bigint, bigint[], jsonb, jsonb) to authenticated;

comment on function public.attach_supplier_document(bigint, bigint[], jsonb, jsonb) is
  'Files a supplier invoice against receipts that already exist, recording prices without moving stock. Accepts several receipts because one invoice can cover several deliveries.';

-- receive_stock() is still LEFT IN PLACE: the Receive Stock screen calls it,
-- and it goes when that screen is switched over in step 5, not before.
