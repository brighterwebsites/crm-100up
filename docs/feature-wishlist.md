# Feature wishlist

Ideas raised and deliberately parked. Not commitments, and not bugs — see
`docs/bugs.md` for defects and `docs/2026-07-29_status-gap-and-decisions.md`
for the open decision register.

Each entry records the idea, why it was parked, and enough of the thinking
that picking it up later does not mean re-deriving it.

---

## W1 — File supplier documents to Google Drive

**Raised** 2026-08-12 (Vanessa), while designing goods receipts.

The goods receipt flow reads a supplier invoice or delivery docket and keeps
the extracted data. It does **not** keep the original file — that was decided
against for v1 (see `docs/goods-receipt-design.md` D7) because storing PDFs
needs a Supabase Storage bucket with its own RLS, and the extraction result is
what the CRM actually queries.

The document itself still has value: an audit trail, and the thing you reach
for when a supplier disputes a price. Rather than a storage bucket, push it to
Google Drive in an organised folder structure — somewhere Fred already looks,
and already backed up.

Sketch of a shape, not a decision:

```
100UP Supplier Documents/
  L&H Wendouree/
    2026/
      2026-07-10  INV-0071234  (PO-20260705-18).pdf
```

Filing by supplier then year then a name carrying date, supplier ref and PO
ref makes the file findable without the CRM, which is the point.

**Open before this can be built**
- Fred has to want it. Ask before building.
- Auth: a Google Drive OAuth scope on top of the Gmail connection, or a
  separate service account. The Gmail connection is currently
  `gmail.readonly`, and widening a granted scope forces re-consent.
- Does the CRM store the resulting Drive file ID against the document row, so
  the receipt can deep-link to it? Probably yes — a filed document nobody can
  navigate back to is only half the feature.
- What happens when filing fails? It must not block the receipt: the stock
  movement is the real work, filing is bookkeeping.

---

## W2 — Cost provenance on stock items

**Raised** 2026-08-12 (Vanessa), parked for more thought. *"Keep as is for
now, but I want to think about that more."*

`stocks.last_cost` is hand-typed on the Stock page today. Once goods receipts
start populating it from real supplier invoices, two writers exist for one
field and they can disagree with no record of which is which — the same shape
as bug #3, in a new place.

Hand-editing cannot simply be removed. An invoice can be wrong, a price can be
agreed verbally, and a correction path is needed. So the question is not
whether to allow both, but how to make the disagreement visible.

**Options, roughly in increasing effort**

1. **Provenance stamp.** Add `last_cost_source` (`manual` / `receipt`) and
   `last_cost_set_at`, and show it on the Stock page: *"$1,550 — from INV-0071234,
   10 Jul"* versus *"$1,550 — set by hand, 3 Jun"*. Cheapest, and it makes the
   answer to "where did this number come from" always available.
2. **Stamp plus staleness flag.** As above, and flag when a receipt has since
   landed a different price than the manual value, the way the Stock page
   already flags costs that differ from what quotes use.
3. **Separate the fields.** `last_cost_invoiced` (receipts only, never
   hand-edited) alongside `planning_cost` (hand-set, what quotes use). No
   conflict possible because nothing is shared. Biggest change, and it
   overlaps the `docs/quote-configurator-design.md` work on linking
   assumptions to stock — worth resolving together rather than twice.

Leaning toward 1 as a first step, since it is additive and makes 2 or 3
easier later rather than harder.

**Related**: `docs/bugs.md` #3 (assumption costs and stock costs drift
silently) and #4 (`receive_stock` captures no unit cost — being fixed by the
goods receipt work, which is what creates this question).
