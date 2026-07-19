-- 100UP CRM — merge stock_ces_specs into stocks, add cost tracking.
--
-- Rationale: stocks and stock_ces_specs were a 1:1 split with no upside —
-- every stock item needs exactly one spec row (or none, meaning "not in
-- the CES catalogue"). Folding specs directly onto stocks removes a join
-- everywhere they were used together (CES summary, future Assumptions
-- linkage) and gives us one place to look up "what is this item, what
-- does it cost, who do we buy it from".
--
-- supplier_id is renamed preferred_supplier_id to make clear it's a
-- default/remembered supplier, not "the supplier we bought this batch
-- from" (that's still per-receipt, on receipts.supplier_id).

alter table public.stocks
  add column category     public.ces_category not null default 'other',
  add column manufacturer text not null default '',
  add column model        text not null default '',
  add column kva          numeric,
  add column kw           numeric,
  add column kwh          numeric,
  add column watts        numeric,
  add column verified     boolean not null default false,
  -- Last known unit cost — updated manually for now; Receive Stock does
  -- not yet capture per-line cost (that's a separate Purchase Orders
  -- piece of work, tracked in docs/bugs.md).
  add column last_cost    numeric not null default 0 check (last_cost >= 0);

update public.stocks s
set category     = c.category,
    manufacturer = c.manufacturer,
    model        = c.model,
    kva          = c.kva,
    kw           = c.kw,
    kwh          = c.kwh,
    watts        = c.watts,
    verified     = c.verified
from public.stock_ces_specs c
where c.stock_id = s.id;

drop table public.stock_ces_specs;

alter table public.stocks rename column supplier_id to preferred_supplier_id;
alter index stocks_supplier_id_idx rename to stocks_preferred_supplier_id_idx;

-- receive_stock inserted brand-new stock rows with (name, qty, supplier_id)
-- — update the column name it targets. Behaviour is unchanged otherwise.
create or replace function public.receive_stock(
  p_supplier_id bigint,
  p_invoice_ref text,
  p_occurred_at date,
  p_lines jsonb
) returns public.receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  l           jsonb;
  v_stock_id  bigint;
  v_qty       integer;
  v_count     integer := 0;
  v_units     integer := 0;
  r           public.receipts%rowtype;
begin
  if not private.is_elevated() then
    raise exception 'not_allowed: admin only';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'invalid_lines: expected a non-empty array of {stock_id|new_name, qty}';
  end if;

  if p_supplier_id is not null
     and not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'supplier_not_found: supplier % does not exist', p_supplier_id;
  end if;

  for l in select * from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce((l ->> 'qty')::integer, 0);
    if v_qty <= 0 then
      continue;  -- skip zero/invalid lines, same as the old flow's review step
    end if;

    if l ? 'stock_id' then
      v_stock_id := (l ->> 'stock_id')::bigint;
      update public.stocks set qty = qty + v_qty where id = v_stock_id;
      if not found then
        raise exception 'stock_not_found: stock item % does not exist', v_stock_id;
      end if;
    elsif coalesce(trim(l ->> 'new_name'), '') <> '' then
      insert into public.stocks (name, qty, preferred_supplier_id)
      values (trim(l ->> 'new_name'), v_qty, p_supplier_id);
    else
      raise exception 'invalid_line: each line needs stock_id or new_name (%)', l::text;
    end if;

    v_count := v_count + 1;
    v_units := v_units + v_qty;
  end loop;

  if v_count = 0 then
    raise exception 'invalid_lines: no line had a positive quantity';
  end if;

  insert into public.receipts (supplier_id, invoice_ref, occurred_at, item_count, total_units)
  values (p_supplier_id, p_invoice_ref, p_occurred_at, v_count, v_units)
  returning * into r;

  return r;
end;
$$;
