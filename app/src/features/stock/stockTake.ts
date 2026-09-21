// Stock takes: created when the count sheet is printed, so the paper and the
// system share one number (ST-0001); counted; then applied, which sets on hand
// to the counted figures and records what each replaced.
// Design: docs/design/stock-take-design.md. DB: 20260915130001_stock_takes.sql.

import type { Stock, StockTake, StockTakeLine, Supplier } from '../../lib/data'
import { PRODUCT_TYPE_LABEL } from '../../lib/productTypes'
import type { ProductType } from '../../lib/productTypes'
import { supabase } from '../../lib/supabaseClient'

/** Every product type, in label order. */
export const ALL_TYPES = Object.keys(PRODUCT_TYPE_LABEL) as ProductType[]
/** Unticked by default on a new stock take: counted separately, if at all. */
export const DEFAULT_EXCLUDED: ProductType[] = ['gm_component', 'other']

/** Items a stock take of these types would list: active, or still on the shelf.
 * Mirrors the filter in create_stock_take. */
export function countable(stocks: Stock[], types: ProductType[]): Stock[] {
  return stocks.filter((s) => types.includes(s.product_type) && (s.active || s.qty > 0))
}

export async function createStockTake(types: ProductType[]): Promise<StockTake> {
  const { data, error } = await supabase.rpc('create_stock_take', { p_product_types: types })
  if (error) throw new Error(error.message)
  return data as StockTake
}

export async function saveStockTakeCounts(
  take: StockTake,
  counts: { stock_id: number; qty_counted: number | null }[],
): Promise<void> {
  const { error } = await supabase.rpc('save_stock_take_counts', { p_stock_take_id: take.id, p_counts: counts })
  if (error) throw new Error(error.message)
}

export async function applyStockTake(take: StockTake): Promise<void> {
  const { error } = await supabase.rpc('apply_stock_take', { p_stock_take_id: take.id })
  if (error) throw new Error(error.message)
}

export async function cancelStockTake(take: StockTake): Promise<void> {
  const { error } = await supabase.rpc('cancel_stock_take', { p_stock_take_id: take.id })
  if (error) throw new Error(error.message)
}

export interface CountRow {
  stock: Stock
  line: StockTakeLine
  supplierName: string
}

export interface CountGroup {
  type: ProductType
  rows: CountRow[]
}

/** The sheet and the count screen share this order, so counts go in top to
 * bottom straight off the paper: product type, then supplier (none last),
 * then name A–Z. */
export function countGroups(lines: StockTakeLine[], stocks: Stock[], suppliers: Supplier[]): CountGroup[] {
  const rows: CountRow[] = []
  for (const line of lines) {
    const stock = stocks.find((s) => s.id === line.stock_id)
    if (!stock) continue
    rows.push({ stock, line, supplierName: suppliers.find((sp) => sp.id === stock.preferred_supplier_id)?.name ?? '' })
  }
  return ALL_TYPES.map((type) => ({
    type,
    rows: rows
      .filter((r) => r.stock.product_type === type)
      .sort(
        (a, b) =>
          (a.supplierName === '' ? 1 : 0) - (b.supplierName === '' ? 1 : 0) ||
          a.supplierName.localeCompare(b.supplierName) ||
          a.stock.name.localeCompare(b.stock.name),
      ),
  })).filter((g) => g.rows.length > 0)
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The printable count sheet. Built from the stock take's snapshot lines, so a
 * reprint shows exactly what the first print did, with the original date. */
export function buildStockTakeHtml(take: StockTake, groups: CountGroup[]): string {
  const printed = new Date(take.printed_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  const included = take.product_types.map((t) => PRODUCT_TYPE_LABEL[t]).join(', ')
  const excluded = ALL_TYPES.filter((t) => !take.product_types.includes(t)).map((t) => PRODUCT_TYPE_LABEL[t])

  const body = groups
    .map(
      (g) => `<h2>${esc(PRODUCT_TYPE_LABEL[g.type])}</h2>
<table>
<thead><tr><th class="c-item">Item</th><th class="c-type">Type</th><th class="n c-qty">Qty on hand</th><th class="n c-count">Qty counted</th></tr></thead>
<tbody>${g.rows
        .map(
          (r) => `<tr>
<td>${esc(r.stock.name)}${r.supplierName ? `<div class="sub">${esc(r.supplierName)}</div>` : ''}</td>
<td>${esc(PRODUCT_TYPE_LABEL[r.stock.product_type])}</td>
<td class="n">${r.line.qty_printed}</td>
<td class="n"><div class="box"></div></td>
</tr>`,
        )
        .join('')}</tbody>
</table>`,
    )
    .join('')

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>Stock take ${esc(take.ref)}</title>
<style>
@page { size: A4 portrait; margin: 14mm 12mm; }
* { box-sizing: border-box; }
body { margin: 0; padding: 20px 24px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; background: #fff; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 8px; }
h1 { font-size: 19px; margin: 0; }
.meta { text-align: right; line-height: 1.5; }
.scope { color: #555; font-size: 11px; margin: 6px 0 4px; }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin: 16px 0 4px; break-after: avoid; }
/* Fixed layout so every group's columns line up down the page. */
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
thead { display: table-header-group; }
th { text-align: left; font-size: 11px; border-bottom: 1px solid #111; padding: 5px 6px; }
td { border-bottom: 1px solid #ccc; padding: 7px 6px; vertical-align: middle; overflow-wrap: anywhere; }
th.c-item { width: 48%; } th.c-type { width: 18%; } th.c-qty { width: 14%; } th.c-count { width: 20%; }
th.n, td.n { text-align: center; }
td .sub { color: #666; font-size: 10px; margin-top: 2px; }
.box { height: 22px; border: 1px solid #777; border-radius: 2px; }
tr { break-inside: avoid; }
.sign { display: flex; gap: 24px; margin-top: 28px; break-inside: avoid; }
.sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 11px; color: #555; }
</style></head><body>
<div class="head">
  <h1>100UP Solar — Stock take</h1>
  <div class="meta"><strong>Stock take #: ${esc(take.ref)}</strong><br />Date printed: ${esc(printed)}</div>
</div>
<div class="scope">Includes: ${esc(included)}${excluded.length ? ` · Not included: ${esc(excluded.join(', '))}` : ''}</div>
${body || '<p>No items to count.</p>'}
<div class="sign"><div>Counted by</div><div>Date counted</div></div>
</body></html>`
}
