// Purchase order actions shared by the Order List and Purchase Orders page.
// Lifecycle: draft (created, already counts as on order) → sent → partially
// received → closed. The DB allows one draft per supplier and refuses to
// delete a PO with stock received against it (20260915120002).

import type { PurchaseOrder, PurchaseOrderItem, Stock, Supplier } from '../../lib/data'
import { sendEmail } from '../../lib/integrations'
import { supabase } from '../../lib/supabaseClient'
import { buildPoHtml, openPrintWindow } from '../jobs/actions'

export interface PoLine {
  name: string
  qty: number
}

export async function createPurchaseOrder(
  supplierId: number | null,
  lines: { stock_id: number; qty_ordered: number; cost: number }[],
): Promise<PurchaseOrder> {
  const { data, error } = await supabase.rpc('create_purchase_order', {
    p_supplier_id: supplierId as number,
    p_lines: lines,
  })
  if (error) throw new Error(error.message)
  return data as PurchaseOrder
}

export async function markPoSent(po: PurchaseOrder): Promise<PurchaseOrder> {
  const { data, error } = await supabase.rpc('mark_purchase_order_sent', { p_po_id: po.id })
  if (error) throw new Error(error.message)
  return data as PurchaseOrder
}

export async function deletePo(po: PurchaseOrder): Promise<void> {
  const { error } = await supabase.from('purchase_orders').delete().eq('id', po.id)
  if (error) throw new Error(error.message)
}

export function poLines(po: PurchaseOrder, poItems: PurchaseOrderItem[], stocks: Stock[]): PoLine[] {
  return poItems
    .filter((it) => it.purchase_order_id === po.id)
    .map((it) => ({ name: stocks.find((s) => s.id === it.stock_id)?.name ?? `Stock #${it.stock_id}`, qty: it.qty_ordered }))
}

/** Prints the saved PO, under its real number and date. */
export function printPurchaseOrder(po: PurchaseOrder, supplier: Supplier | undefined, lines: PoLine[]) {
  openPrintWindow(
    buildPoHtml(`Purchase Order — ${supplier?.name ?? 'No supplier'}`, po.po_ref, supplier?.name ?? null, lines, {
      date: po.occurred_at,
    }),
  )
}

/** Emails the PO to the supplier, then marks it sent. If the email fails the
 * PO stays a draft. If the email goes but marking fails, "Mark sent" finishes
 * the job; the send is already in the email history either way. */
export async function sendPurchaseOrder(po: PurchaseOrder, supplier: Supplier | undefined, lines: PoLine[]): Promise<void> {
  if (!supplier?.email) {
    throw new Error('This supplier has no email address. Add one on the Suppliers page, or use Mark sent.')
  }
  await sendEmail({
    to: supplier.email,
    subject: `Purchase order ${po.po_ref} — 100UP Solar`,
    html: buildPoHtml(`Purchase Order — ${supplier.name}`, po.po_ref, supplier.name, lines, {
      date: po.occurred_at,
      forEmail: true,
    }),
    log: { purchase_order_id: po.id, screen_type: 'purchase_order' },
  })
  await markPoSent(po)
}
