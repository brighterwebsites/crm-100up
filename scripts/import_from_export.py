#!/usr/bin/env python3
"""Cutover import: 100UP legacy JSON export -> Supabase SQL.

Usage:
  python scripts/import_from_export.py --export <export>.json --dry-run
  python scripts/import_from_export.py --export <export>.json --emit-sql /tmp/import.sql
  python scripts/import_from_export.py --export <export>.json --emit-sql /tmp/import.sql --truncate

Apply the emitted file with psql or the Supabase SQL editor. It is one
transaction: it either all lands or none of it does.

WHAT CHANGED, 2026-09-20 — and why the old version could not be patched
----------------------------------------------------------------------
The original script was written against the July schema and assumed it was
filling an EMPTY database. Neither is true now, and the second point matters
more than the first.

1. The schema moved underneath it. `jobs` lost `name`, `email`, `phone`,
   `contact_method` (they became `customers`, 20260719000001), lost
   `fixes_needed` and `job_order` (20260915090002), and had its three install
   dates renamed to `planned_install_date` / `install_start_date` /
   `install_completion_date`. `stock_ces_specs` was merged into `stocks`
   (20260719020001). `receipts` became `purchase_orders` (20260719030001).
   `stocks.supplier_id` became `preferred_supplier_id`. Every one of those
   made the old INSERTs fail outright.

2. **The product catalogue is now curated, and the import must not touch it.**
   This is the real change. `stocks` carries planning costs Fred confirmed,
   `usable_kwh` that the quote engine sizes on, CES specs, product types,
   phases, manufacturer links and inverter size classes — none of which exist
   in the legacy export. `system_configs` references those stock ids. The old
   script inserted stock rows from the export, which today would either
   collide on the primary key or, worse, overwrite that work with a bare
   name and quantity.

   So this version **never inserts or updates a stock row's identity or
   cost**. It matches the export's stock ids against the live catalogue,
   fails loudly if any are missing, and writes exactly one column: `qty`.

What gets imported: customers, jobs, job stock allocations, installation
requests (the job order ref/date), suppliers, purchase orders, and on-hand
quantities. What does not: anything in the product catalogue or the settings
and configurator tables.

NOTES ON APPLYING IT
- Run it as `postgres` / the service role, not as an app user. Two things
  depend on that: RLS, and `private.guard_stock_qty()`, which refuses direct
  writes to `stocks.qty` when `current_user` is `authenticated` or `anon`
  (20260915130001). As `postgres` the guard passes through.
- `--truncate` empties the operational tables first. That is the documented
  cutover procedure, but it is destructive and therefore opt-in. It never
  touches `stocks`, `manufacturers`, `system_config*` or the settings tables.
- Customer emails: until cutover the live customers carry dummy
  `support+…@brighterwebsites.com.au` addresses with the originals in
  `private.customer_email_backup`. This import writes the REAL addresses from
  the export, which is correct for cutover — but it means notifications can
  reach real customers from that moment. Check that is intended before
  applying.
"""

import argparse
import json
import re
import sys

# stage -> number of steps. Matches public.pipeline_steps as seeded
# (19 steps across 4 stages). The emitted SQL re-checks this against the live
# table rather than trusting the constant, because a step split would change
# it and a silently wrong stage/step is a job in the wrong column.
VALID_STEPS = {1: 4, 2: 3, 3: 5, 4: 7}


def q(s):
    """SQL-quote a string literal."""
    if s is None:
        return "null"
    return "'" + str(s).replace("'", "''") + "'"


def qd(s):
    """SQL date literal from a YYYY-MM-DD string / ISO timestamp; '' -> null."""
    if not s:
        return "null"
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", str(s))
    if not m:
        return "null"
    return f"date '{m.group(1)}'"


def qts(s):
    """SQL timestamptz literal; '' -> null. Handles both ISO strings and the
    old app's epoch-milliseconds numbers (j.created = Date.now())."""
    if not s:
        return "null"
    if isinstance(s, (int, float)) or re.fullmatch(r"\d{12,}", str(s)):
        return f"to_timestamp({float(s) / 1000.0})"
    return f"{q(s)}::timestamptz"


def norm_name(s):
    """Supplier-name normalization: matchSupplierByName semantics plus
    whitespace stripping (the EnergySpurt / 'Energy Spurt' case)."""
    return re.sub(r"\s+", "", (s or "").lower().strip())


# Operational tables only, children before parents. The catalogue, the
# configurator and the settings tables are deliberately absent.
#
# DELETE, not `TRUNCATE ... CASCADE`. That matters more than it looks:
# `stocks.preferred_supplier_id` references `suppliers`, and CASCADE follows
# foreign keys — so truncating suppliers would truncate `stocks` too and take
# the entire curated catalogue with it, which is the one thing this script
# exists to protect. DELETE never cascades like that; if something unexpected
# still references a row it raises a foreign-key error and the transaction
# rolls back, which is the failure you want.
CLEAR_TABLES = [
    # job tree
    "public.job_stock_items",
    "public.installation_requests",
    "public.job_step_dates",
    "public.job_events",
    "public.jobs",
    "public.customers",
    # stock movement records (test data pre-cutover)
    "public.stock_take_lines",
    "public.stock_takes",
    "public.goods_receipt_documents",
    "public.goods_receipt_items",
    "public.goods_receipts",
    "public.supplier_documents",
    "public.purchase_order_items",
    "public.purchase_orders",
    # last: everything above may reference a supplier
    "public.suppliers",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--emit-sql")
    ap.add_argument("--truncate", action="store_true",
                    help="empty the operational tables first (destructive; never touches the catalogue)")
    args = ap.parse_args()

    with open(args.export, encoding="utf-8") as f:
        data = json.load(f)

    jobs = data["jobs"]
    stocks = data["stocks"]
    suppliers = data["suppliers"]
    receipts = data.get("receipts", [])

    stock_ids = {s["id"] for s in stocks}
    supplier_ids = {s["id"] for s in suppliers}
    problems = []
    notes = []

    # ── Validation ──────────────────────────────────────────────────────
    for s in stocks:
        if s.get("supplierId") is not None and s["supplierId"] not in supplier_ids:
            problems.append(f"stock {s['id']} ({s['name']}) references missing supplier {s['supplierId']}")
        if s.get("qty", 0) < 0:
            problems.append(f"stock {s['id']} ({s['name']}) has negative qty {s['qty']}")

    for j in jobs:
        st, sp = j.get("stage"), j.get("step")
        if st not in VALID_STEPS or not (0 <= sp < VALID_STEPS[st]):
            problems.append(f"job {j['id']} ({j.get('name')}) has invalid stage/step ({st},{sp})")
        for field in ("stockItems", "stockConsumed", "pendingBom"):
            for it in (j.get(field) or []):
                if it["stockId"] not in stock_ids:
                    problems.append(f"job {j['id']} {field} references missing stock {it['stockId']} ({it.get('name')})")
                if it.get("qty", 0) <= 0:
                    problems.append(f"job {j['id']} {field} stock {it['stockId']} has non-positive qty")
        seen = {}
        for field in ("stockItems", "stockConsumed", "pendingBom"):
            for it in (j.get(field) or []):
                if it["stockId"] in seen and seen[it["stockId"]] != field:
                    notes.append(f"job {j['id']}: stock {it['stockId']} appears in both {seen[it['stockId']]} and {field} (import keeps both rows — statuses differ)")
                seen[it["stockId"]] = field

    # One customer per job, exactly as the Phase 2 split did (20260719000001:
    # `insert into customers select name, phone, email, contact_method from
    # jobs order by id`). That means two jobs for the same household produce
    # two customer rows. Deliberate: merging on name alone would silently
    # join two different people. Reported so they can be merged by hand.
    by_person = {}
    for j in jobs:
        key = norm_name(j.get("name"))
        if not key:
            continue
        by_person.setdefault(key, []).append(j["id"])
    for key, ids in sorted(by_person.items()):
        if len(ids) > 1:
            name = next(j.get("name") for j in jobs if j["id"] == ids[0])
            notes.append(f"'{name}' appears on jobs {ids} — imports as {len(ids)} separate customers; merge by hand if they are the same household")

    # receipts: resolve supplier names
    by_norm = {norm_name(s["name"]): s["id"] for s in suppliers}
    receipt_supplier = {}
    for r in receipts:
        nm = r.get("supplier") or ""
        rid = by_norm.get(norm_name(nm))
        receipt_supplier[r["id"]] = rid
        if nm and rid is None:
            problems.append(f"receipt {r['id']} supplier '{nm}' matches no known supplier — imports with supplier_id null; create/merge manually")
        elif nm and norm_name(nm) != nm.lower().strip():
            notes.append(f"receipt {r['id']}: supplier '{nm}' matched '{next(s['name'] for s in suppliers if s['id'] == rid)}' after whitespace-stripping")

    notes.append(
        f"{len(stocks)} stock quantities will be written; no stock row is created or repriced. "
        "The SQL aborts if any of those ids is absent from the live catalogue."
    )

    # ── Report ──────────────────────────────────────────────────────────
    print(f"Export: {args.export}  (exportedAt={data.get('exportedAt')}, version={data.get('version')})")
    print(f"Counts: jobs={len(jobs)} stocks={len(stocks)} suppliers={len(suppliers)} receipts={len(receipts)}")
    print(f"Counters: nextId={data.get('nextId')} stockNextId={data.get('stockNextId')} "
          f"supplierNextId={data.get('supplierNextId')} receiptNextId={data.get('receiptNextId')}")
    print()
    if problems:
        print("PROBLEMS (need review):")
        for p in problems:
            print(f"  x {p}")
    else:
        print("PROBLEMS: none")
    print()
    if notes:
        print("NOTES:")
        for n in notes:
            print(f"  - {n}")
    print()

    if args.dry_run or not args.emit_sql:
        print("Dry run - no SQL emitted." if args.dry_run else "No --emit-sql given.")
        return 1 if problems else 0

    # ── SQL emission ────────────────────────────────────────────────────
    out = []
    a = out.append
    a("-- 100UP cutover import, generated from " + args.export)
    a("-- Apply as postgres / service role: RLS and private.guard_stock_qty()")
    a("-- both key off current_user.")
    a("begin;")

    # Pre-flight. Everything here is a reason to abort before writing a row.
    a("")
    a("-- Pre-flight 1: every stock id in the export must exist in the live")
    a("-- catalogue. The catalogue is curated (costs, usable_kwh, CES specs,")
    a("-- size classes) and the export cannot rebuild it, so a missing id is a")
    a("-- stop-and-think, never a silent insert.")
    if stock_ids:
        vals = ", ".join(f"({i})" for i in sorted(stock_ids))
        a("do $$")
        a("declare missing text;")
        a("begin")
        a(f"  select string_agg(v.x::text, ', ' order by v.x) into missing")
        a(f"  from (values {vals}) as v(x)")
        a("  where not exists (select 1 from public.stocks s where s.id = v.x);")
        a("  if missing is not null then")
        a("    raise exception 'catalogue is missing stock ids: %. Add them to the catalogue first.', missing;")
        a("  end if;")
        a("end $$;")

    a("")
    a("-- Pre-flight 2: the stage/step pairs in the export must exist in the")
    a("-- live pipeline. Splitting or removing a step would otherwise land a")
    a("-- job in the wrong column, silently.")
    pairs = sorted({(j["stage"], j["step"]) for j in jobs if j.get("stage") is not None})
    if pairs:
        vals = ", ".join(f"({s},{t})" for s, t in pairs)
        a("do $$")
        a("declare bad text;")
        a("begin")
        a("  select string_agg(v.s || '/' || v.t, ', ') into bad")
        a(f"  from (values {vals}) as v(s, t)")
        a("  where not exists (select 1 from public.pipeline_steps p where p.stage = v.s and p.step = v.t);")
        a("  if bad is not null then")
        a("    raise exception 'export uses stage/step pairs that no longer exist: %', bad;")
        a("  end if;")
        a("end $$;")

    a("")
    a("-- Pre-flight 3: name drift between the export and the catalogue. A")
    a("-- notice, not an error: a product legitimately gets renamed, and the")
    a("-- id is what binds the allocation.")
    for s in stocks:
        a(f"do $$ declare n text; begin select name into n from public.stocks where id = {s['id']};"
          f" if n is distinct from {q(s['name'])} then"
          f" raise notice 'stock {s['id']}: export says %, catalogue says %', {q(s['name'])}, n; end if; end $$;")

    if args.truncate:
        a("")
        a("-- Destructive, and opt-in via --truncate. Operational tables only:")
        a("-- the catalogue, configurator and settings tables are untouched.")
        a("--")
        a("-- DELETE rather than TRUNCATE CASCADE: stocks.preferred_supplier_id")
        a("-- references suppliers, so a cascading truncate would empty the")
        a("-- product catalogue as collateral. Release the reference first, then")
        a("-- delete children before parents. The qty pass below re-sets it.")
        a("update public.stocks set preferred_supplier_id = null "
          "where preferred_supplier_id is not null;")
        for t in CLEAR_TABLES:
            a(f"delete from {t};")

    # Suppliers keep their legacy ids so stocks.preferred_supplier_id and the
    # purchase orders below still line up.
    a("")
    a("-- Suppliers")
    for s in suppliers:
        a("insert into public.suppliers (id, name, phone, email, notes) values "
          f"({s['id']}, {q(s['name'])}, {q(s.get('phone', ''))}, {q(s.get('email', ''))}, {q(s.get('notes', ''))});")

    # The one thing written back to the catalogue, and only this column.
    a("")
    a("-- On-hand quantities. THE ONLY catalogue column this import writes.")
    a("-- Costs, specs, product types and supplier links stay as curated.")
    for s in stocks:
        sup = s.get("supplierId")
        a(f"update public.stocks set qty = {s.get('qty', 0)}"
          + (f", preferred_supplier_id = {sup}" if sup is not None else "")
          + f" where id = {s['id']};")

    # Customers, one per job, ids allocated in job order so the mapping below
    # is a straight lookup.
    a("")
    a("-- Customers: one per job, matching the Phase 2 split. `address` stays")
    a("-- empty — the legacy export carries the site address on the job")
    a("-- (`loc` -> jobs.location), and that split did not populate it either.")
    cust_id = {}
    for n, j in enumerate(sorted(jobs, key=lambda x: x["id"]), start=1):
        cust_id[j["id"]] = n
        a("insert into public.customers (id, name, phone, email, contact_method) values "
          f"({n}, {q(j.get('name', ''))}, {q(j.get('phone', ''))}, {q(j.get('email', ''))}, "
          f"{q(j.get('contact') or 'Email')});")

    a("")
    a("-- Jobs")
    for j in jobs:
        a("insert into public.jobs (id, customer_id, location, system_description, value, "
          "job_type, stage, step, notes, installer_notes, planned_install_date, "
          "install_start_date, install_completion_date, ces_submitted, ces_received, "
          "rebate_submitted, rebate_received, created_at) values "
          f"({j['id']}, {cust_id[j['id']]}, {q(j.get('loc', ''))}, {q(j.get('system', ''))}, "
          f"{j.get('value') or 0}, {q(j.get('jobType') or 'install')}::public.job_type, "
          f"{j['stage']}, {j['step']}, {q(j.get('notes', ''))}, {q(j.get('installerNotes', ''))}, "
          f"{qd(j.get('dateBooked'))}, {qd(j.get('installStart'))}, {qd(j.get('installDate'))}, "
          f"{qd(j.get('cesSubmitted'))}, {qd(j.get('cesReceived'))}, "
          f"{qd(j.get('rebateSubmitted'))}, {qd(j.get('rebateReceived'))}, "
          f"coalesce({qts(j.get('created'))}, now()));")

        jo = j.get("jobOrder")
        if jo and (jo.get("ref") or jo.get("issued") or jo.get("customItems")):
            a("insert into public.installation_requests (job_id, job_order_ref, issued_date, custom_items) values "
              f"({j['id']}, {q(jo.get('ref', ''))}, {qd(jo.get('issued'))}, "
              f"{q(json.dumps(jo.get('customItems') or []))}::jsonb);")

        for field, status in (("pendingBom", "pending"), ("stockItems", "assigned"), ("stockConsumed", "consumed")):
            for it in (j.get(field) or []):
                assigned = qd(j.get("dateBooked"))
                consumed = "null"
                if status == "consumed":
                    consumed = qd(j.get("installStart"))
                    if consumed == "null":
                        consumed = qd(j.get("installDate"))
                a("insert into public.job_stock_items (job_id, stock_id, qty, notes, status, assigned_at, consumed_at) values "
                  f"({j['id']}, {it['stockId']}, {it['qty']}, {q(it.get('notes', ''))}, "
                  f"{q(status)}::public.job_stock_item_status, "
                  f"{assigned if status != 'pending' else 'null'}, {consumed});")

    # Legacy receipts are purchase orders that already arrived. po_ref,
    # po_amount and po_status all have column defaults; 'closed' is the honest
    # status for something received before the CRM existed.
    a("")
    a("-- Purchase orders (legacy `receipts`)")
    for r in receipts:
        rid = receipt_supplier.get(r["id"])
        a("insert into public.purchase_orders (id, occurred_at, supplier_id, invoice_ref, item_count, total_units, po_status) values "
          f"({r['id']}, coalesce({qd(r.get('date'))}, current_date), {rid if rid is not None else 'null'}, "
          f"{q(r.get('invoiceRef', ''))}, {r.get('itemCount', 0)}, {r.get('totalUnits', 0)}, 'closed'::public.po_status);")

    # Sequences must clear both max(id) and the old app's own next-id
    # counters, or the first row the CRM creates collides with a legacy id.
    # `stocks` is absent on purpose: nothing here inserts one.
    a("")
    a("-- Sequences")
    for table, counter in (
        ("jobs", "nextId"),
        ("customers", None),
        ("suppliers", "supplierNextId"),
        ("purchase_orders", "receiptNextId"),
    ):
        floor = f"{data.get(counter, 1) - 1}" if counter else "0"
        a(f"select setval(pg_get_serial_sequence('public.{table}','id'), "
          f"greatest((select coalesce(max(id), 0) from public.{table}), {floor}));")

    a("")
    a("commit;")

    with open(args.emit_sql, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print(f"SQL written to {args.emit_sql} ({len(out)} lines)")
    if args.truncate:
        print("NOTE: --truncate was used. The SQL empties the operational tables before importing.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
