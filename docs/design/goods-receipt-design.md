# Goods Receipt — design

Target design for AI-assisted goods receipting against purchase orders.
Proposed, not built. Decisions marked **D-n** were settled with Vanessa on
2026-08-12; questions still open are listed in §9.

---

## 1. Why the current model cannot do this

`purchase_orders` is doing three jobs at once, and the receipt path is the
worst of them.

```sql
-- receive_stock(), the whole receipt:
insert into public.purchase_orders (supplier_id, invoice_ref, occurred_at,
                                    item_count, total_units, po_status)
values (p_supplier_id, p_invoice_ref, p_occurred_at, v_count, v_units, 'closed')
```

No `purchase_order_items` rows are written. A receipt records *"5 items, 23
units, from L&H, 10 July"* and nothing else — **which items is not stored
anywhere.** Only the `stocks.qty` increment survives, with no trace of what
caused it.

Three consequences, and every requirement in this document is blocked behind
at least one:

| Consequence | Blocks |
|---|---|
| A receipt **is** a PO row | Several receipts against one order |
| Receipt lines are never stored | Cost capture, cross-check against ordered qty, any audit trail |
| `occurred_at` means "ordered" or "received" depending on which path wrote it | Knowing when stock actually arrived |

Historical receipt rows cannot be repaired — the line detail was never
captured. **D1: they are dummy data and get dropped** rather than migrated.

---

## 2. The model

Three concepts where there is currently one.

**The order** — `purchase_orders` + `purchase_order_items`, unchanged. What we
asked for, at what price.

**The receipt** — `goods_receipts` + `goods_receipt_items`. A stock movement
event. `purchase_order_id` is nullable, so receiving without a PO is a
first-class case rather than a workaround.

**The document** — `supplier_documents`. The piece of paper: delivery docket
or invoice, with its refs, dates, totals and freight.

### 2.1 The load-bearing idea

> **Stock moves once. Prices can arrive later.**

Separating documents from movements is what makes the messy real-world cases
ordinary:

| Situation | How it lands |
|---|---|
| Docket with goods, invoice two weeks later | One receipt (stock moved once), two documents. The invoice fills in prices without touching stock. |
| Invoice only, no docket | One receipt, one document, doing both jobs. |
| One invoice covering two deliveries | Two receipts, one document linked to both. |
| One delivery, split across two invoices | One receipt, two documents. |

The last two are why the document↔receipt link is **many-to-many** (**D2** —
Vanessa confirmed one invoice can cover two deliveries).

Note what this does to the duplicate problem. "Did we already receive this?"
was hard. "Which receipt does this document belong to?" is easy, and Fred
answers it rather than the AI guessing.

### 2.2 Schema sketch

```
suppliers
  └─ purchase_orders ──── purchase_order_items
                                  ▲
                                  │ (nullable link, gives the cross-check)
                                  │
  └─ goods_receipts ───── goods_receipt_items
          │
          └─ goods_receipt_documents (join) ─── supplier_documents
```

`purchase_order_items.qty_received` becomes a **trigger-maintained rollup** of
the receipt lines pointing at it, rather than a value anyone writes directly.
`po_status` advances off the same rollup: `sent` → `partially_received` →
`closed`.

---

## 3. AI reads. Rules decide.

The single most important constraint in this design.

| Step | Who | Why |
|---|---|---|
| Read the document, produce structured lines | **AI** | Genuine reading comprehension over a scan |
| Reconcile totals, determine GST basis | **Arithmetic** | Deterministic, and it catches AI misreads |
| Match to an open PO | **Rules** | Must be explainable when it is wrong |
| Detect a duplicate document | **Rules** | Same |
| Confirm anything that moves stock | **Fred** | Nothing commits unreviewed |

This mirrors `match_customer_by_email` in BW-CRM, where rules-based matching
runs *before* any AI call. If AI picks the PO, a wrong match is unauditable —
and it will be wrong precisely on the confusing documents where it matters.

### 3.1 PO matching

Score every open PO (`sent` / `partially_received`) for that supplier:

- line overlap — how many receipt lines match a PO line on `stock_id`
- quantity closeness on those matched lines
- date proximity between PO and document

Pre-select the winner, show the runners-up, and always offer **"No PO —
receive standalone"**. Entering from the Purchase Orders screen pre-selects
that PO but still runs the scoring, so a document filed against the wrong
order gets challenged rather than accepted.

### 3.2 Duplicate detection

Flag a likely duplicate when, for the same supplier:

- the same `supplier_ref` is already stored → **hard stop**, this document
  exists
- **or** ≥70% of lines match an existing receipt on `stock_id` and quantity,
  within 30 days → **soft flag**

On a soft flag, show both side by side and offer: *link to receipt #12* /
*create a new receipt* / *cancel*, with the likely answer pre-selected.

---

## 4. GST (D3)

Australian supplier invoices vary. Per Vanessa: usually an inclusive total
with a GST subtotal; most commonly line items **ex-GST** with a separate GST
subtotal at the bottom; sometimes a per-line GST breakdown on mixed orders.
Most of what Fred tracks attracts GST.

Rather than guess or ask, **work backwards from the totals** — deterministic
arithmetic over the figures the AI read:

| Test | Conclusion |
|---|---|
| `sum(line totals) ≈ subtotal_ex_gst` | lines are ex-GST |
| `sum(line totals) ≈ total_inc_gst` | lines are inc-GST |
| `subtotal_ex_gst × 0.10 ≈ gst_amount` | the read is internally consistent |
| nothing reconciles | **flag for Fred — do not guess** |

Store the determined basis on the document (`price_basis`, and whether it was
`reconciled` or set by hand), and normalise line costs to **ex-GST as
canonical**. The original is always recoverable from the basis.

`gst_applicable` defaults true per line, overridden only when the document
genuinely shows a per-line breakdown.

The side benefit is larger than GST: an invoice whose lines do not add up to
its own subtotal means the extraction dropped something. This is the same
safeguard as the claimed line/unit counts in §5 — arithmetic catching a
truncated scan.

---

## 5. Fields

Confirmed against Vanessa's list, with the source of each.

### Document (`supplier_documents`)

| Field | Source | Note |
|---|---|---|
| supplier_id | AI-suggested, Fred confirms | |
| doc_type | AI | `delivery_docket` / `invoice` / `both` |
| supplier_ref | AI | Their invoice or docket number |
| doc_date | AI | The document's own date |
| claimed_line_count | AI | **Check figure, not data** |
| claimed_total_units | AI | **Check figure, not data** |
| subtotal_ex_gst, gst_amount, total_inc_gst | AI | Drives §4 |
| freight_ex_gst | AI | Own field, never a stock line — see §6 |
| other_charges_ex_gst | AI | Surcharges, handling |
| price_basis, price_basis_source | Derived | §4 |

**Claimed totals earn their place.** Storing what the document *says* and
comparing it to what we parsed catches the page-2-didn't-scan case, which
would otherwise silently under-receive.

### Receipt (`goods_receipts`)

| Field | Note |
|---|---|
| supplier_id | |
| purchase_order_id | **Nullable** — standalone receipts are normal |
| received_at | **When the goods physically arrived.** Distinct from `doc_date`: goods land Monday, invoice is dated Friday. Stock accuracy needs the first, the cost trail the second. |
| notes | |

### Receipt line (`goods_receipt_items`)

| Field | Source |
|---|---|
| stock_id | Matched from the document line |
| purchase_order_item_id | Nullable — supplies QtyOrdered and OrderPrice for the cross-check |
| qty_received | Document |
| unit_cost_ex_gst | Document, normalised per §4 |
| gst_applicable | Default true |
| landed_unit_cost | Derived, §6 |
| line_note | Damaged, backordered, substituted — nowhere to put this today |

### Over-receipt (D4)

10 ordered, 12 arrive: **accept and flag.** Never block — the goods are
physically on the shelf and refusing to record them makes stock wrong. Flag on
the PO line and surface it on the receipt.

---

## 6. Freight and landed cost (D5)

Primary need is *"what am I spending on freight"*, ideally per supplier.
Landed cost is wanted but secondary. **Both confirmed 2026-08-12** — they are
not alternatives, and building one gives the other nearly free.

**Freight is stored raw as its own column on the document**, which is the
reporting answer outright. Landed cost is then derived on top:

```
landed_unit_cost = unit_cost_ex_gst
                 + freight_ex_gst × (line value ÷ total goods value on that document)
```

Apportionment is by line value across **every line on that document**,
including lines on other receipts when one invoice spans two deliveries.

**Two costs are carried on the stock item, not one:**

| Column | Meaning |
|---|---|
| `stocks.last_cost` | Ex-GST invoice price — what the supplier charged per unit |
| `stocks.last_landed_cost` | With freight apportioned |

Folding freight irreversibly into a single unit cost would collapse *"what did
I pay L&H per panel"* and *"what did that panel cost me landed"* into one
number, leaving neither recoverable. Keeping freight raw also means a change
to the apportionment rule is a recompute, not a re-key.

**Rejected: freight as a hidden stock item.** It would acquire a quantity, be
"received" into stock on hand, and surface in anything that scans stock —
fighting to keep it hidden in more places over time — and it still could not
be apportioned across the lines it relates to.

---

## 7. Screens

### Add Goods Receipt

Reachable from **Purchase Orders**, **Stock**, and **Suppliers**. Same flow
throughout; entry point only changes the pre-selection.

1. **Upload** — PDF or photo of a docket or invoice.
2. **Read** — AI extraction (§3), then reconciliation (§4).
3. **Confirm** — supplier, PO match with alternatives, duplicate warning if
   any, line matching to stock, quantities against ordered, prices, freight.
   Reconciliation failures and over-receipts are called out here.
4. **Commit** — one atomic RPC: receipt + lines + document + stock increments
   + PO rollup + `po_status` advance.

Nothing moves before step 4.

### Navigation

Two new top-level tabs:

- **Suppliers** — Customers-style layout: supplier info, then an Orders card
  and a Stock Received card.
- **Stock Received** — flat list of receipts. Deliberately simple for v1.

`suppliers` currently holds only name, phone, email and notes, which is too
thin for a detail panel. **Fields to add** (D6, confirmed): ABN, address
(street / suburb / state / postcode), account number (Fred's account with
them), website, default payment terms, contact name.

---

## 8. Build order

1. Schema — receipts, lines, documents, join table, `qty_received` rollup
   trigger, supplier fields, `stocks.last_landed_cost`
2. `receive_goods` RPC replacing `receive_stock` — atomic, captures lines and
   cost, advances PO status
3. Extraction — extend `extract-invoice` for docket-vs-invoice, PO refs,
   freight, claimed totals, GST figures
4. Matching — PO scoring and duplicate detection, both rules-based
5. Add Goods Receipt screen, from all three entry points
6. Nav split and Suppliers rework

Steps 1–2 are load-bearing; 3–6 are comparatively mechanical.

---

## 9. Resolved since drafting

**D7 — the original PDF is not stored.** Keep the extracted data, not the
file. A Supabase Storage bucket plus its own RLS is not worth it when the
extraction result is what the CRM actually queries. Filing the document to
Google Drive instead is parked as `docs/feature-wishlist.md` W1, pending Fred
wanting it.

**D8 — freight apportions across all lines on the document**, including lines
belonging to other receipts when one invoice covers two deliveries. Confirmed
2026-08-12. Consistent with freight being a property of the document, which is
where the supplier charged it.

**`create_purchase_order` needs no change.** Verified against the deployed
function: it inserts the PO at `sent` and writes `purchase_order_items` with
`qty_received` left at its default of 0, never touching received quantities or
advancing status. The rollup trigger takes over from there without conflict.

**D9 — `stocks.last_cost` stays as it is for now.** Receipts will write it,
hand-editing on the Stock page continues, and the resulting two-writer problem
is deliberately deferred rather than solved here. Written up with options as
`docs/feature-wishlist.md` W2. Worth knowing that this is bug #3's shape
appearing in a new place, so it should not stay deferred indefinitely.

## 10. Still open

Nothing blocking the build. Items that want a decision during it:

- **New stock items from a receipt.** `receive_stock` accepts `new_name` and
  creates a stock row mid-receipt. Does the new flow keep that, or require the
  item to exist first? Creating stock from a misread line is a worse outcome
  than being made to add it deliberately.
- **Whether `receive_stock` is dropped or left in place** once `receive_goods`
  lands. Nothing else calls it, but confirm before removing.
