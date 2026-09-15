# Stock takes — design

Built 2026-09-15 (`20260915130001_stock_takes.sql`). Decisions are Vanessa's,
on Fred's brief.

## The rule this serves

**Every change to on hand carries a reference.** Stock arrives against a PO or
receipt, leaves against a job, and is corrected against a stock take (ST-####).
When the numbers look wrong ("4 purchased, 6 on hand"), the references explain
it. On hand (`stocks.qty`) is therefore **read-only to the app**; the Stock item
panel's editable On hand field was the gap that let it drift without a trace.

Enforced by `private.guard_stock_qty()`: it refuses any change to `qty` made
directly by an app user. The functions allowed to move stock
(`advance_job_stage`, `move_job_back`, `receive_stock`, `receive_goods`,
`apply_stock_take`) are `SECURITY DEFINER` and run as their owner, which the
guard lets through. The guard must stay `SECURITY INVOKER`; as definer it would
see its own owner and stop telling the two apart. New stock items start at 0.

## Flow

1. **Stock take** (Stock page) opens a modal with a checkbox per product type.
   *Ground mount* and *Other* start unticked. Continuing creates the stock take
   (ST-0001) and snapshots its lines: every active item of the ticked types,
   plus inactive items still on the shelf, with on hand at that moment
   (`qty_printed`).
2. The **sheet** previews on screen, then prints or saves as PDF. Header: stock
   take number and date printed. Grouped by product type, then supplier (none
   last), then name A–Z. Columns: Item · Type · Qty on hand · Qty counted (a
   blank box), then Counted by / Date counted. Built from the snapshot, so a
   reprint matches the first print exactly, date included.
3. While a stock take is open, a banner shows progress with **Enter counts**,
   **Reprint sheet** and **Cancel stock take**. Only one can be open at a time;
   two overlapping counts applied in turn would overwrite each other.
4. **Enter counts** switches the Stock table to count mode, in the same order
   as the sheet, so figures go in top to bottom. It shows the quantity on the
   sheet, on hand now (bold if stock moved since printing), a Counted box and
   the change applying will make. Enter moves to the next box. Counts can be
   saved part-way.
5. **Apply** sets on hand to the counted figure for every counted item and
   records the figure it replaced (`qty_system`). Blank means not counted and
   the item is left alone. The stock take is then locked. Differences are
   measured against on hand at the moment of applying, so enter counts the day
   they are taken.
6. **Cancel** marks the stock take cancelled rather than deleting it: the sheet
   was printed, so its number stays accounted for. On hand does not change.

Each stock item's panel lists its applied stock takes:
*ST-0003 · 14 Jul 2026 · system 4 → counted 6 (+2)*.

## Later

- **Stock history panel** per item: every movement with its reference, in date
  order. Receipts and POs in, installs out (and back, on move-back), stock take
  corrections. This completes the answer to "why are there 6". The stock-take
  part of it is already on the item panel.
- **Photo of the filled sheet → counts.** Upload a photo of the completed paper
  sheet; a vision pass reads the Qty counted boxes against the stock take's
  lines, fills the count screen, and a person confirms before applying. The
  sheet's fixed column layout and printed stock take number are what make that
  matching reliable; keep both if the sheet is redesigned.
