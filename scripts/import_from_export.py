#!/usr/bin/env python3
"""One-time import: 100UP CRM JSON export -> Supabase SQL.

Usage:
  python3 scripts/import_from_export.py --export 100UP_stock-crm_2026-06-25.json --dry-run
  python3 scripts/import_from_export.py --export <fresh-export>.json --emit-sql /tmp/import.sql

Reads the localStorage-era JSON export, validates it (FK resolution, valid
stage/step pairs, supplier-name matching for receipts), prints a report, and
optionally emits a single transactional SQL script that preserves legacy ids
and resets sequences afterwards.

Reusable at final cutover: run with the fresh export, review the report,
truncate the tables, apply the SQL (per the "old app stays authoritative
during the trial" decision).
"""

import argparse
import json
import re
import sys
from datetime import date

# ── CES catalog, transcribed from getCesCatalog() in 100UP_suite_V46.html
# (lines 6848-6876). Panel entries there pull mfr/model/watts live from the
# calculator Assumptions; baked here from 100UP_assumptions_2026-06-20.json
# (panelMfr=Jinko, panelModel=JKM475, panelW=475) per the approved plan.
# verified: Deye + Jinko names are confirmed per CLAUDE.md; ALL Sigenergy
# entries are unconfirmed against CEC listings (broader than the in-code
# verify flag, which only marked ids 13-16) so they import as verified=false.
SIG = "Sigenergy Technology Co., Ltd"
DEYE_INV = "NingBo Deye Inverter Technology Co Ltd"
DEYE_ESS = "Ningbo Deye Ess Technology Co Ltd"

CES_CATALOG = {
    1:  dict(category="inverter", manufacturer=SIG, model="SigenStor EC 12.0 SP (AS4777.2:2020)", kva=12, verified=False),
    2:  dict(category="battery", manufacturer=SIG, model="SigenStor BAT 8.0", kw=8, kwh=8.06, verified=False),
    3:  dict(category="inverter", manufacturer=DEYE_INV, model="AI-W5.1-8P1-AU-B (AS4777-2 2020)", kva=8, verified=True),
    4:  dict(category="battery", manufacturer=DEYE_ESS, model="AI-W5.1-B", kw=5.1, kwh=5.12, verified=True),
    5:  dict(category="inverter", manufacturer=SIG, model="SigenStor EC 8.0 SP (AS4777.2:2020)", kva=8, verified=False),
    6:  dict(category="panel", manufacturer="Jinko", model="JKM475", watts=475, verified=True),
    7:  dict(category="panel", manufacturer="Jinko", model="JKM475", watts=475, verified=True),
    8:  dict(category="other", verified=True),
    9:  dict(category="other", verified=True),
    13: dict(category="battery", manufacturer=SIG, model="SigenStor BAT 10.0", kw=10, kwh=10.24, verified=False),
    14: dict(category="inverter", manufacturer=SIG, model="SigenStor EC 15.0 TP (AS4777.2:2020)", kva=15, verified=False),
    15: dict(category="inverter", manufacturer=SIG, model="SigenStor EC 20.0 TP (AS4777.2:2020)", kva=20, verified=False),
    16: dict(category="inverter", manufacturer=SIG, model="SigenStor EC 30.0 TP (AS4777.2:2020)", kva=30, verified=False),
    17: dict(category="other", verified=True),
    18: dict(category="other", verified=True),
    19: dict(category="inverter", manufacturer=DEYE_INV, model="AI-W5.1-10P3-AU-B (AS4777-2 2020)", kva=10, verified=True),
    20: dict(category="inverter", manufacturer=DEYE_INV, model="AI-W5.1-12P3-AU-B (AS4777-2 2020)", kva=12, verified=True),
    21: dict(category="other", verified=True),
    22: dict(category="other", verified=True),
    25: dict(category="panel", manufacturer="Jinko", model="JKM475", watts=475, verified=True),
}

VALID_STEPS = {
    1: 4, 2: 3, 3: 5, 4: 7,  # stage -> number of steps
}


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--emit-sql")
    args = ap.parse_args()

    with open(args.export) as f:
        data = json.load(f)

    jobs = data["jobs"]
    stocks = data["stocks"]
    suppliers = data["suppliers"]
    receipts = data["receipts"]

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
            problems.append(f"job {j['id']} ({j['name']}) has invalid stage/step ({st},{sp})")
        for field in ("stockItems", "stockConsumed", "pendingBom"):
            for it in (j.get(field) or []):
                if it["stockId"] not in stock_ids:
                    problems.append(f"job {j['id']} {field} references missing stock {it['stockId']} ({it.get('name')})")
                if it.get("qty", 0) <= 0:
                    problems.append(f"job {j['id']} {field} stock {it['stockId']} has non-positive qty")
        # same stock live in more than one of the three arrays?
        seen = {}
        for field in ("stockItems", "stockConsumed", "pendingBom"):
            for it in (j.get(field) or []):
                if it["stockId"] in seen and seen[it["stockId"]] != field:
                    notes.append(f"job {j['id']}: stock {it['stockId']} appears in both {seen[it['stockId']]} and {field} (import keeps both rows — statuses differ)")
                seen[it["stockId"]] = field

    # receipts: resolve supplier names
    by_norm = {norm_name(s["name"]): s["id"] for s in suppliers}
    receipt_supplier = {}
    for r in receipts:
        nm = r.get("supplier") or ""
        rid = by_norm.get(norm_name(nm))
        receipt_supplier[r["id"]] = rid
        if nm and rid is None:
            problems.append(f"receipt {r['id']} supplier '{nm}' matches no known supplier — will import with supplier_id null; create/merge manually")
        elif nm and norm_name(nm) != nm.lower().strip():
            notes.append(f"receipt {r['id']}: supplier '{nm}' matched '{next(s['name'] for s in suppliers if s['id']==rid)}' after whitespace-stripping")

    # CES catalog coverage
    for cid in sorted(CES_CATALOG):
        if cid not in stock_ids:
            notes.append(f"CES catalog entry {cid} has no matching stock item in this export — skipped")
    for s in stocks:
        if s["id"] not in CES_CATALOG:
            notes.append(f"stock {s['id']} ({s['name']}) has no CES catalog entry — no CES row (matches old-app warning behavior)")

    # ── Report ──────────────────────────────────────────────────────────
    print(f"Export: {args.export}  (exportedAt={data.get('exportedAt')}, version={data.get('version')})")
    print(f"Counts: jobs={len(jobs)} stocks={len(stocks)} suppliers={len(suppliers)} receipts={len(receipts)}")
    print(f"Counters: nextId={data.get('nextId')} stockNextId={data.get('stockNextId')} "
          f"supplierNextId={data.get('supplierNextId')} receiptNextId={data.get('receiptNextId')}")
    print()
    if problems:
        print("PROBLEMS (need review):")
        for p in problems:
            print(f"  ✗ {p}")
    else:
        print("PROBLEMS: none")
    print()
    if notes:
        print("NOTES:")
        for n in notes:
            print(f"  • {n}")
    print()

    if args.dry_run or not args.emit_sql:
        print("Dry run — no SQL emitted." if args.dry_run else "No --emit-sql given.")
        return 1 if problems else 0

    # ── SQL emission ────────────────────────────────────────────────────
    out = []
    out.append("begin;")
    out.append("-- one-time import from " + args.export)

    for s in suppliers:
        out.append(
            "insert into public.suppliers (id, name, phone, email, notes) values "
            f"({s['id']}, {q(s['name'])}, {q(s.get('phone',''))}, {q(s.get('email',''))}, {q(s.get('notes',''))});"
        )

    for s in stocks:
        sup = s.get("supplierId")
        out.append(
            "insert into public.stocks (id, name, qty, supplier_id) values "
            f"({s['id']}, {q(s['name'])}, {s.get('qty',0)}, {sup if sup is not None else 'null'});"
        )

    for cid, c in sorted(CES_CATALOG.items()):
        if cid not in stock_ids:
            continue
        out.append(
            "insert into public.stock_ces_specs (stock_id, category, manufacturer, model, kva, kw, kwh, watts, verified) values "
            f"({cid}, {q(c['category'])}, {q(c.get('manufacturer',''))}, {q(c.get('model',''))}, "
            f"{c.get('kva','null')}, {c.get('kw','null')}, {c.get('kwh','null')}, {c.get('watts','null')}, "
            f"{'true' if c.get('verified') else 'false'});"
        )

    for j in jobs:
        job_order = j.get("jobOrder")
        out.append(
            "insert into public.jobs (id, name, location, system_description, value, email, phone, "
            "contact_method, job_type, stage, step, notes, date_booked, install_start, install_date, "
            "ces_submitted, ces_received, rebate_submitted, rebate_received, fixes_needed, job_order, created_at) values "
            f"({j['id']}, {q(j['name'])}, {q(j.get('loc',''))}, {q(j.get('system',''))}, {j.get('value') or 0}, "
            f"{q(j.get('email',''))}, {q(j.get('phone',''))}, {q(j.get('contact','Email'))}, "
            f"{q(j.get('jobType') or 'install')}, {j['stage']}, {j['step']}, {q(j.get('notes',''))}, "
            f"{qd(j.get('dateBooked'))}, {qd(j.get('installStart'))}, {qd(j.get('installDate'))}, "
            f"{qd(j.get('cesSubmitted'))}, {qd(j.get('cesReceived'))}, {qd(j.get('rebateSubmitted'))}, {qd(j.get('rebateReceived'))}, "
            f"{'true' if j.get('fixesNeeded') else 'false'}, "
            f"{q(json.dumps(job_order)) + '::jsonb' if job_order else 'null'}, "
            f"coalesce({qts(j.get('created'))}, now()));"
        )

        for field, status in (("pendingBom", "pending"), ("stockItems", "assigned"), ("stockConsumed", "consumed")):
            for it in (j.get(field) or []):
                assigned = qd(j.get("dateBooked"))
                consumed = qd(j.get("installStart")) if status == "consumed" else "null"
                if status == "consumed" and consumed == "null":
                    consumed = qd(j.get("installDate"))
                out.append(
                    "insert into public.job_stock_items (job_id, stock_id, qty, notes, status, assigned_at, consumed_at) values "
                    f"({j['id']}, {it['stockId']}, {it['qty']}, {q(it.get('notes',''))}, {q(status)}, "
                    f"{assigned if status != 'pending' else 'null'}, {consumed});"
                )

    for r in receipts:
        rid = receipt_supplier.get(r["id"])
        out.append(
            "insert into public.receipts (id, occurred_at, supplier_id, invoice_ref, item_count, total_units) values "
            f"({r['id']}, coalesce({qd(r.get('date'))}, current_date), {rid if rid is not None else 'null'}, "
            f"{q(r.get('invoiceRef',''))}, {r.get('itemCount',0)}, {r.get('totalUnits',0)});"
        )

    # sequences: nextval must clear both max(id) and the old app's counters
    out.append(
        f"select setval(pg_get_serial_sequence('public.jobs','id'), greatest((select max(id) from public.jobs), {data.get('nextId',1)-1}));"
    )
    out.append(
        f"select setval(pg_get_serial_sequence('public.stocks','id'), greatest((select max(id) from public.stocks), {data.get('stockNextId',1)-1}));"
    )
    out.append(
        f"select setval(pg_get_serial_sequence('public.suppliers','id'), greatest((select max(id) from public.suppliers), {data.get('supplierNextId',1)-1}));"
    )
    out.append(
        f"select setval(pg_get_serial_sequence('public.receipts','id'), greatest((select max(id) from public.receipts), {data.get('receiptNextId',1)-1}));"
    )
    out.append("commit;")

    with open(args.emit_sql, "w") as f:
        f.write("\n".join(out) + "\n")
    print(f"SQL written to {args.emit_sql} ({len(out)} statements)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
