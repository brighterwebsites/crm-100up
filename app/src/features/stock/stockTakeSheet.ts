import { brandFor } from '../../lib/data'
import type { Manufacturer, PurchaseOrder, PurchaseOrderItem, Stock, Supplier } from '../../lib/data'
import { PRODUCT_TYPE_LABEL } from '../../lib/productTypes'

/** Units ordered on a PO that is still open, i.e. counted as "coming" rather
 * than "here". Closed POs are excluded — ad-hoc Receive Stock writes a closed
 * PO for stock already on the shelf, and that stock is in `qty` already. */
export function inTransitMap(
  purchaseOrders: PurchaseOrder[],
  purchaseOrderItems: PurchaseOrderItem[]
): Record<number, number> {
  const open = new Set(purchaseOrders.filter((po) => po.po_status !== 'closed').map((po) => po.id))
  const map: Record<number, number> = {}
  for (const it of purchaseOrderItems) {
    if (!open.has(it.purchase_order_id)) continue
    const outstanding = it.qty_ordered - it.qty_received
    if (outstanding > 0) map[it.stock_id] = (map[it.stock_id] ?? 0) + outstanding
  }
  return map
}

export interface SheetInput {
  stocks: Stock[]
  manufacturers: Manufacturer[]
  suppliers: Supplier[]
  /** Assigned-but-not-consumed units per stock (allocatedMap). */
  allocated: Record<number, number>
  /** Outstanding PO units per stock (inTransitMap). */
  transit: Record<number, number>
  /** Describes any filter the list was narrowed by, so a partial count sheet
   * cannot be mistaken for a full one. */
  scope?: string
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function stockTakeRef(d = new Date()): string {
  return `ST-${d.toLocaleDateString('en-CA').replace(/-/g, '')}`
}

interface Group {
  name: string
  rows: Stock[]
}

/** Counting happens shelf by shelf, and the shelf a thing sits on tracks who
 * it came from, so the sheet is ordered by supplier rather than by product
 * type. Items with no preferred supplier land in one group at the end. */
function groupBySupplier(stocks: Stock[], suppliers: Supplier[]): Group[] {
  const byName = new Map<string, Stock[]>()
  for (const s of stocks) {
    const name = suppliers.find((sp) => sp.id === s.preferred_supplier_id)?.name ?? ''
    const list = byName.get(name) ?? []
    list.push(s)
    byName.set(name, list)
  }
  return [...byName.entries()]
    .map(([name, rows]) => ({ name, rows }))
    .sort((a, b) => (a.name === '' ? 1 : b.name === '' ? -1 : a.name.localeCompare(b.name)))
    .map((g) => ({ name: g.name || 'No supplier assigned', rows: g.rows }))
}

function rowHtml(s: Stock, alloc: number, transit: number, manufacturers: Manufacturer[]): string {
  const avail = s.qty - alloc
  const sub = [brandFor(s, manufacturers), s.model].filter(Boolean).join(' ')
  const type = PRODUCT_TYPE_LABEL[s.product_type]
  return `<tr>
<td class="item"><strong>${esc(s.name)}</strong>${sub || type ? `<div class="sub">${esc([sub, type].filter(Boolean).join(' · '))}</div>` : ''}</td>
<td class="n">${s.qty}</td>
<td class="n dim">${alloc}</td>
<td class="n${avail < 0 ? ' short' : ' dim'}">${avail}</td>
<td class="n dim">${transit}</td>
<td class="box"></td>
<td class="box"></td>
<td class="notes"></td>
</tr>`
}

function groupHtml(g: Group, input: SheetInput): string {
  const rows = g.rows
    .map((s) => rowHtml(s, input.allocated[s.id] ?? 0, input.transit[s.id] ?? 0, input.manufacturers))
    .join('')
  return `<section class="grp">
<h2>${esc(g.name)} <span class="count">(${g.rows.length} item${g.rows.length === 1 ? '' : 's'})</span></h2>
<table>
<thead><tr>
<th class="item">Item</th><th>System</th><th>Allocated</th><th>Available</th><th>Transit</th>
<th>Counted</th><th>Diff</th><th class="notes">Notes</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
</section>`
}

/** A self-contained count sheet: system quantities on the left, blank columns
 * on the right to write into. Derived output only — nothing is persisted, and
 * the counted figures come back through the Stock modal by hand (same
 * clipboard-and-print shape as the PO documents). */
export function buildStockTakeHtml(input: SheetInput): string {
  const ref = stockTakeRef()
  const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
  const groups = groupBySupplier(input.stocks, input.suppliers)
  const totalUnits = input.stocks.reduce((sum, s) => sum + s.qty, 0)
  const body = groups.length
    ? groups.map((g) => groupHtml(g, input)).join('')
    : '<p class="empty">No products match this filter — nothing to count.</p>'

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>Stock take — ${esc(ref)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap');
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
@page { size: A4 portrait; margin: 14mm 12mm; }
* { box-sizing: border-box; }
body { margin: 0; padding: 22px 26px 30px; background: #fff; color: #14181f;
  font-family: 'DM Sans', system-ui, -apple-system, sans-serif; font-size: 12px; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px;
  border-bottom: 3px solid #e8720c; padding-bottom: 10px; }
.brand { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #e8720c; }
.brand span { background: #14181f; color: #fff; padding: 1px 5px; margin-left: 4px; }
h1 { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 26px; margin: 6px 0 2px; letter-spacing: -.01em; }
.gen { color: #6b7280; font-size: 11px; }
.totals { text-align: right; }
.totals .big { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 30px; font-weight: 600; line-height: 1; }
.totals .lbl { font-size: 10px; letter-spacing: .07em; text-transform: uppercase; color: #6b7280; margin-top: 4px; }
.totals .sub { font-size: 11px; color: #6b7280; }
.how { color: #6b7280; font-size: 11px; margin: 10px 0 4px; max-width: 78ch; line-height: 1.5; }
.scope { display: inline-block; margin: 4px 0 0; padding: 2px 7px; border-radius: 3px;
  background: #fdeede; color: #8f4405; font-size: 11px; font-weight: 600; }
.grp { margin-top: 18px; break-inside: auto; }
.grp h2 { font-size: 12px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: #e8720c;
  margin: 0 0 6px; padding-bottom: 4px; border-bottom: 1px solid #f0d9c2; break-after: avoid; }
.grp h2 .count { color: #9aa1ab; font-weight: 500; letter-spacing: 0; text-transform: none; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th { background: #14181f; color: #fff; font-size: 10px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; padding: 7px 8px; text-align: center; }
th.item, td.item { text-align: left; }
th.notes { text-align: left; width: 15%; }
tr { break-inside: avoid; }
tbody tr:nth-child(even) { background: #f7f8f9; }
td { padding: 8px; border-bottom: 1px solid #e6e8ec; text-align: center; vertical-align: middle; }
td.item { width: 26%; }
td .sub { color: #7b828d; font-size: 10px; font-weight: 400; margin-top: 2px; }
td.n { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
td.dim { color: #6b7280; }
td.short { color: #c0392b; font-weight: 700; }
td.box { width: 9%; }
td.box::after { content: ''; display: block; height: 22px; border: 1px solid #b8bec7; border-radius: 3px; background: #fff; }
td.notes::after { content: ''; display: block; height: 22px; border-bottom: 1px solid #ccd1d8; }
.sign { display: flex; gap: 26px; margin-top: 26px; break-inside: avoid; }
.sign div { flex: 1; }
.sign .lbl { font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #6b7280; margin-bottom: 5px; }
.sign .line { height: 40px; border: 1px solid #b8bec7; border-radius: 4px; }
.foot { margin-top: 22px; padding-top: 8px; border-top: 1px solid #e6e8ec; text-align: center;
  color: #9aa1ab; font-size: 10px; }
.empty { color: #6b7280; padding: 30px 0; text-align: center; }
</style></head><body>
<div class="head">
  <div>
    <div class="brand">100UP Solar — <span>Stock take sheet</span></div>
    <h1>${esc(ref)}</h1>
    <div class="gen">Generated: ${esc(today)}</div>
    ${input.scope ? `<div class="scope">Partial count — ${esc(input.scope)}</div>` : ''}
  </div>
  <div class="totals">
    <div class="big">${totalUnits}</div>
    <div class="lbl">Units on hand (system)</div>
    <div class="sub">${input.stocks.length} item${input.stocks.length === 1 ? '' : 's'}</div>
  </div>
</div>
<p class="how">Count each item physically and write the result in the <strong>Counted</strong> column.
Diff = Counted &minus; System. Use Notes for damaged stock, wrong location, etc. Enter results back into
the Stock modal once counting is complete.</p>
${body}
<div class="sign">
  <div><div class="lbl">Counted by / date</div><div class="line"></div></div>
  <div><div class="lbl">Checked by / date</div><div class="line"></div></div>
</div>
<div class="foot">100UP Solar · ${esc(ref)} · Generated ${esc(new Date().toLocaleDateString('en-AU'))}</div>
</body></html>`
}
