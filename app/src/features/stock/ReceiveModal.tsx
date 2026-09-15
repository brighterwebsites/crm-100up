import { Package } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useData } from '../../lib/data'
import type { PurchaseOrder, PurchaseOrderItem } from '../../lib/data'
import { supabase } from '../../lib/supabaseClient'
import { matchStock, normalizePart } from '../../lib/normalizePart'
import { todayISO, fmtMoneyExact } from '../../lib/format'
import { extractInvoice, INVOICE_ACCEPT } from '../../lib/integrations'
import type { ExtractedDocument, Reconciliation } from '../../lib/integrations'

// Port of the V46 Receive Stock flow (renderReceiveModal, line 5344):
// read the supplier invoice, review line matching, then commit atomically via
// the receive_stock RPC (receipt + qty increments + new items in one
// transaction — the multi-table write the old app did in three steps).
//
// Only the reading step has changed. It used to mean uploading the PDF to a
// Claude chat by hand and pasting the JSON back; now the CRM calls Anthropic
// itself via the extract-invoice function. The paste path is kept as the
// second tab, because it is the way through when a scan defeats extraction —
// and because the review-and-commit half below is identical either way.
//
// Opened from a purchase order (`po`), the same screen receives AGAINST that
// order: the supplier is fixed, the reader gets the order's lines as a hint
// for resolving product names (never as a source of quantities), each line is
// matched to its PO line, and the commit goes through receive_goods, which
// links the receipt to the order, captures cost and rolls the PO's status.
// The ad-hoc path above is unchanged.

interface ParsedInvoice {
  supplier?: string | null
  invoiceRef?: string | null
  invoiceDate?: string | null
  lines: { name: string; qty: number; unitCost?: number | null; gstApplicable?: boolean | null }[]
}

interface ReviewLine {
  name: string
  qty: number
  stockId: number | '' | '__new__'
  newName: string
  /** Read from the invoice, shown for checking. See the note by the table. */
  unitCost: number | null
  gstApplicable: boolean | null
  /** PO mode: the order line this receipt line credits, or null if not on it. */
  poItemId: number | null
}

type Basis = Reconciliation['price_basis']

const PROMPT = `"Read this invoice and give me JSON with supplier, invoiceRef, invoiceDate, and a lines array of {name, qty, unitCost} for each part."`

const outstanding = (i: PurchaseOrderItem) => Math.max(0, i.qty_ordered - i.qty_received)

export default function ReceiveModal({ onClose, po }: { onClose: () => void; po?: PurchaseOrder }) {
  const { stocks, suppliers, refresh, purchaseOrders, purchaseOrderItems } = useData()
  const [tab, setTab] = useState<'upload' | 'paste'>('upload')
  const [raw, setRaw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [supplierId, setSupplierId] = useState<string>(po?.supplier_id ? String(po.supplier_id) : '')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [occurredAt, setOccurredAt] = useState(todayISO())
  const [review, setReview] = useState<ReviewLine[] | null>(null)
  // PO mode: the full extraction, needed by receive_goods (totals, freight,
  // GST basis). `basis` can be settled by hand when the arithmetic could not.
  const [doc, setDoc] = useState<ExtractedDocument | null>(null)
  const [basis, setBasis] = useState<Basis>('unknown')
  const [basisManual, setBasisManual] = useState(false)
  const [dropPrices, setDropPrices] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const recent = useMemo(() => purchaseOrders.slice(0, 5), [purchaseOrders])
  const poItems = useMemo(
    () => (po ? purchaseOrderItems.filter((i) => i.purchase_order_id === po.id) : []),
    [po, purchaseOrderItems],
  )
  const poStocks = useMemo(() => stocks.filter((s) => poItems.some((i) => i.stock_id === s.id)), [stocks, poItems])
  const stockName = (id: number) => stocks.find((s) => s.id === id)?.name ?? `Stock #${id}`

  /** The order line a stock item credits: the first with anything still
   * outstanding, else the first for that item. Null when it is not on the PO. */
  function poItemFor(stockId: ReviewLine['stockId']): number | null {
    if (!po || typeof stockId !== 'number') return null
    const onPo = poItems.filter((i) => i.stock_id === stockId)
    return (onPo.find((i) => outstanding(i) > 0) ?? onPo[0])?.id ?? null
  }

  /**
   * Both input paths land here. Nothing is written yet — this only proposes
   * matches for Fred to confirm, so a misread invoice costs a correction
   * rather than a wrong stock count.
   */
  function applyInvoice(p: ParsedInvoice) {
    if (!Array.isArray(p.lines) || p.lines.length === 0) {
      throw new Error('No lines found on the invoice.')
    }
    // Supplier match: exact-lowercase, then substring, then space-stripped
    // (matchSupplierByName semantics + the EnergySpurt fix). Against a PO the
    // supplier is the order's, whatever the document says.
    if (!po && p.supplier) {
      const supplier = p.supplier
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').trim()
      const hit =
        suppliers.find((sp) => sp.name.toLowerCase() === supplier.toLowerCase().trim()) ??
        suppliers.find(
          (sp) =>
            supplier.toLowerCase().includes(sp.name.toLowerCase()) ||
            sp.name.toLowerCase().includes(supplier.toLowerCase())
        ) ??
        suppliers.find((sp) => norm(sp.name) === norm(supplier))
      if (hit) setSupplierId(String(hit.id))
    }
    if (p.invoiceRef) setInvoiceRef(p.invoiceRef)
    if (p.invoiceDate && /^\d{4}-\d{2}-\d{2}/.test(p.invoiceDate)) setOccurredAt(p.invoiceDate.slice(0, 10))
    setReview(
      p.lines.map((l) => {
        // Against a PO, try the order's own items first: those are the names
        // the reader was steered toward.
        const match = (po ? matchStock(l.name, poStocks) : null) ?? matchStock(l.name, stocks)
        const stockId: ReviewLine['stockId'] = match ? match.id : po ? '' : '__new__'
        return {
          name: l.name,
          qty: l.qty || 0,
          stockId,
          newName: match || po ? '' : normalizePart(l.name).name ?? l.name,
          unitCost: l.unitCost ?? null,
          gstApplicable: l.gstApplicable ?? null,
          poItemId: poItemFor(stockId),
        }
      })
    )
  }

  function parse() {
    setErr(null)
    try {
      applyInvoice(JSON.parse(raw) as ParsedInvoice)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not parse the pasted JSON.')
    }
  }

  async function readFile(file: File) {
    setErr(null)
    setWarnings([])
    setReading(true)
    try {
      const hint = po
        ? {
            po_ref: po.po_ref,
            lines: poItems.map((i) => ({ name: stockName(i.stock_id), qty_ordered: i.qty_ordered, qty_outstanding: outstanding(i) })),
          }
        : undefined
      const { document, reconciliation } = await extractInvoice(file, hint)
      setDoc(document)
      setBasis(reconciliation.price_basis)
      setBasisManual(false)
      setDropPrices(false)
      applyInvoice({
        supplier: document.supplier,
        invoiceRef: document.supplier_ref,
        invoiceDate: document.doc_date,
        lines: document.lines.map((l) => ({ name: l.name, qty: l.qty, unitCost: l.unit_cost, gstApplicable: l.gst_applicable })),
      })
      const notes = [...reconciliation.warnings]
      if (reconciliation.price_basis === 'inc_gst') {
        notes.push(
          po
            ? 'Unit costs on this document INCLUDE GST. They are stored ex GST when received.'
            : 'Unit costs on this document INCLUDE GST — shown as printed, not adjusted.',
        )
      }
      if (document.po_ref) {
        if (!po) {
          notes.push(`The supplier quoted purchase order ${document.po_ref}. To receive against it, open it on the Purchase Orders page and use Receive stock.`)
        } else if (document.po_ref.replace(/\s+/g, '').toLowerCase() !== po.po_ref.toLowerCase()) {
          notes.push(`This document quotes purchase order ${document.po_ref}, but you are receiving against ${po.po_ref}. Check it is the right order.`)
        }
      }
      // receive_goods apportions freight into landed cost; receive_stock cannot.
      if (!po && (document.freight_ex_gst ?? 0) > 0) {
        notes.push(`Freight of $${(document.freight_ex_gst ?? 0).toFixed(2)} was on this document and is not captured yet.`)
      }
      setWarnings(notes)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not read that invoice.')
    } finally {
      setReading(false)
      // Clear the input so re-picking the same file after a failure re-fires.
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function commit() {
    if (!review) return
    setErr(null)
    if (po) {
      await commitAgainstPo(po, review)
      return
    }
    const lines = review
      .filter((l) => l.qty > 0 && l.stockId !== '')
      .map((l) =>
        l.stockId === '__new__' ? { new_name: l.newName.trim(), qty: l.qty } : { stock_id: l.stockId, qty: l.qty }
      )
      .filter((l) => !('new_name' in l) || l.new_name)
    if (lines.length === 0) {
      setErr('No lines with a positive quantity to receive.')
      return
    }
    const { error } = await supabase.rpc('receive_stock', {
      p_supplier_id: (supplierId ? Number(supplierId) : null) as number,
      p_invoice_ref: invoiceRef,
      p_occurred_at: (occurredAt || null) as string,
      p_lines: lines,
    })
    if (error) {
      setErr(error.message)
      return
    }
    await refresh()
    onClose()
  }

  // ── receiving against a PO ──────────────────────────────────────────────
  const included = (review ?? []).filter((l) => l.qty > 0 && typeof l.stockId === 'number')
  const hasPrices = !dropPrices && included.some((l) => l.unitCost != null)
  const notOnDocument = poItems.filter(
    (i) => outstanding(i) > 0 && !included.some((l) => l.poItemId === i.id),
  )

  async function commitAgainstPo(order: PurchaseOrder, lines: ReviewLine[]) {
    const receive = lines.filter((l) => l.qty > 0 && typeof l.stockId === 'number')
    if (receive.length === 0) {
      setErr('No lines with a matched item and a positive quantity to receive.')
      return
    }
    if (!invoiceRef.trim()) {
      setErr('Enter the invoice or docket number. It is the reference this receipt is filed under.')
      return
    }
    if (hasPrices && basis === 'unknown') {
      setErr('Say whether the prices include GST, or choose not to record them.')
      return
    }
    setBusy(true)
    const { error } = await supabase.rpc('receive_goods', {
      p_supplier_id: order.supplier_id as number,
      p_purchase_order_id: order.id,
      p_received_at: occurredAt || undefined,
      p_lines: receive.map((l) => ({
        stock_id: l.stockId,
        qty_received: l.qty,
        purchase_order_item_id: l.poItemId,
        unit_cost: hasPrices ? l.unitCost : null,
        gst_applicable: l.gstApplicable,
      })),
      p_document: {
        doc_type: doc?.doc_type ?? 'invoice',
        supplier_ref: invoiceRef.trim(),
        doc_date: occurredAt || null,
        claimed_line_count: doc?.claimed_line_count ?? null,
        claimed_total_units: doc?.claimed_total_units ?? null,
        subtotal_ex_gst: doc?.subtotal_ex_gst ?? null,
        gst_amount: doc?.gst_amount ?? null,
        total_inc_gst: doc?.total_inc_gst ?? null,
        freight_ex_gst: doc?.freight_ex_gst ?? 0,
        other_charges_ex_gst: doc?.other_charges_ex_gst ?? 0,
        price_basis: hasPrices ? basis : 'unknown',
        price_basis_source: basisManual ? 'manual' : 'reconciled',
      },
    })
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    await refresh()
    onClose()
  }

  function setLine(i: number, patch: Partial<ReviewLine>) {
    if (!review) return
    const next = [...review]
    next[i] = { ...next[i], ...patch }
    setReview(next)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>
            <Package size={14} aria-hidden /> Receive stock
            {po && ` — against ${po.po_ref}`}
          </strong>
          <button className="btn btn-gray" style={{ marginLeft: 'auto' }} onClick={onClose}>
            Close
          </button>
        </div>
        {err && <div className="login-error">{err}</div>}
        {/* Reconciliation findings. Not errors — the receipt is still valid —
            but a document whose lines do not add up to its own totals usually
            means a page did not scan, and that is worth seeing BEFORE the
            quantities are committed rather than discovering it in a stocktake. */}
        {warnings.length > 0 && (
          <div className="warn-box">
            <strong>Check before receiving:</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
        {!review ? (
          <>
            <div className="tab-row">
              <button
                className={`tab-btn${tab === 'upload' ? ' tab-btn-on' : ''}`}
                onClick={() => setTab('upload')}
              >
                Upload invoice
              </button>
              <button
                className={`tab-btn${tab === 'paste' ? ' tab-btn-on' : ''}`}
                onClick={() => setTab('paste')}
              >
                Paste JSON
              </button>
            </div>

            {tab === 'upload' ? (
              <>
                <div className="warn-box">
                  <strong>How this works:</strong> pick the supplier invoice or delivery docket — PDF or a
                  photo of it.{' '}
                  {po
                    ? `It is read with ${po.po_ref}'s items as a hint for the product names, then matched to the order for you to check.`
                    : 'It is read here and the lines are matched against your stock for you to check.'}{' '}
                  <strong>Nothing is added until you confirm.</strong>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept={INVOICE_ACCEPT}
                  disabled={reading}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void readFile(f)
                  }}
                />
                <span className="settings-hint">
                  PDF, JPEG, PNG or WebP, up to 10 MB. iPhone photos saved as HEIC are not accepted —
                  set the camera to &ldquo;Most Compatible&rdquo;, or take a screenshot of the photo.
                </span>
                {reading && <p className="mutedtext" style={{ marginTop: 8 }}>Reading the invoice…</p>}
              </>
            ) : (
              <>
                <div className="warn-box">
                  <strong>Fallback.</strong> Upload a supplier invoice to any Claude chat with the prompt
                  below, then paste the JSON back here. Useful when a scan is too poor to read
                  automatically.
                </div>
                <pre className="prompt-box">{PROMPT}</pre>
                <textarea
                  rows={8}
                  placeholder='{"supplier": "L&H Wendouree", "invoiceRef": "INV-0071234", "invoiceDate": "2026-07-10", "lines": [{"name": "SigenStor EC 8.0 SP", "qty": 4}]}'
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                />
                <div className="row">
                  <button className="btn btn-primary" onClick={parse}>
                    Parse invoice JSON
                  </button>
                </div>
              </>
            )}
            {po ? (
              <div className="stock-block">
                <div className="stock-block-title">On this order</div>
                {poItems.map((i) => (
                  <div key={i.id} className="stock-line">
                    <span>{stockName(i.stock_id)}</span>
                    <span>
                      {i.qty_ordered} ordered · {i.qty_received} received
                      {outstanding(i) > 0 && ` · ${outstanding(i)} to come`}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              recent.length > 0 && (
                <div className="stock-block">
                  <div className="stock-block-title">Recent receipts</div>
                  {recent.map((r) => (
                    <div key={r.id} className="stock-line">
                      <span>
                        {r.occurred_at} — {suppliers.find((sp) => sp.id === r.supplier_id)?.name ?? 'No supplier'}
                        {r.invoice_ref ? ` (${r.invoice_ref})` : ''}
                      </span>
                      <span>
                        {r.item_count} items, {r.total_units} units
                      </span>
                    </div>
                  ))}
                </div>
              )
            )}
          </>
        ) : (
          <>
            <div className="form-grid">
              <label>
                Supplier
                <select value={supplierId} disabled={!!po} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">— no supplier —</option>
                  {suppliers.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {po ? 'Invoice / docket no.' : 'Invoice ref'}
                <input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
              </label>
              <label>
                Date
                <input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
              </label>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Invoice line</th>
                    <th style={{ textAlign: 'left' }}>Match to stock</th>
                    <th>Qty</th>
                    <th>Unit cost</th>
                    {po && <th style={{ textAlign: 'left' }}>On order</th>}
                  </tr>
                </thead>
                <tbody>
                  {review.map((l, i) => {
                    const poItem = po && l.poItemId ? poItems.find((x) => x.id === l.poItemId) : undefined
                    const over = poItem ? l.qty - outstanding(poItem) : 0
                    return (
                      <tr key={i}>
                        <td style={{ textAlign: 'left' }}>{l.name}</td>
                        <td style={{ textAlign: 'left' }}>
                          <select
                            value={String(l.stockId)}
                            onChange={(e) => {
                              const v = e.target.value
                              const stockId: ReviewLine['stockId'] = v === '__new__' ? '__new__' : v === '' ? '' : Number(v)
                              setLine(i, { stockId, poItemId: poItemFor(stockId) })
                            }}
                          >
                            {/* receive_goods refuses to create items from an
                                invoice line; add the item on the Stock page first. */}
                            {!po && <option value="__new__">+ Create new item</option>}
                            <option value="">(skip line)</option>
                            {stocks.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} ({s.qty} on hand)
                              </option>
                            ))}
                          </select>
                          {l.stockId === '__new__' && (
                            <input
                              placeholder="New item name"
                              value={l.newName}
                              onChange={(e) => setLine(i, { newName: e.target.value })}
                              style={{ marginTop: 4, width: '100%' }}
                            />
                          )}
                        </td>
                        <td>
                          <input
                            className="qty-input"
                            type="number"
                            min={0}
                            value={l.qty}
                            onChange={(e) => setLine(i, { qty: Number(e.target.value) })}
                          />
                        </td>
                        <td className="mutedtext">
                          {l.unitCost == null ? '—' : fmtMoneyExact(l.unitCost)}
                        </td>
                        {po && (
                          <td style={{ textAlign: 'left', fontSize: 12 }}>
                            {typeof l.stockId !== 'number' ? (
                              ''
                            ) : poItem ? (
                              <>
                                {poItem.qty_ordered} ordered · {poItem.qty_received} received
                                {over > 0 && (
                                  <div style={{ color: 'var(--danger)', fontWeight: 700 }}>
                                    {over} more than outstanding
                                  </div>
                                )}
                              </>
                            ) : (
                              <span style={{ color: 'var(--danger)' }}>Not on this order</span>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {po && notOnDocument.length > 0 && (
              <div className="warn-box">
                <strong>Still outstanding, not on this document:</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {notOnDocument.map((i) => (
                    <li key={i.id}>{stockName(i.stock_id)}: {outstanding(i)} to come</li>
                  ))}
                </ul>
                They stay on order. Receive them when they arrive.
              </div>
            )}

            {po && included.some((l) => l.unitCost != null) && (
              basis === 'unknown' || basisManual ? (
                <div className="warn-box">
                  <strong>The prices did not add up to the document&rsquo;s totals, so whether they include GST is unknown.</strong>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
                    {([
                      ['ex_gst', 'Prices are ex GST'],
                      ['inc_gst', 'Prices include GST'],
                    ] as const).map(([v, label]) => (
                      <label key={v} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="radio"
                          name="basis"
                          checked={!dropPrices && basisManual && basis === v}
                          onChange={() => { setBasis(v); setBasisManual(true); setDropPrices(false) }}
                        />
                        {label}
                      </label>
                    ))}
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="radio"
                        name="basis"
                        checked={dropPrices}
                        onChange={() => { setDropPrices(true); setBasisManual(true) }}
                      />
                      Don&rsquo;t record prices
                    </label>
                  </div>
                </div>
              ) : (
                <span className="settings-hint">
                  Prices read as {basis === 'ex_gst' ? 'ex GST' : basis === 'inc_gst' ? 'including GST' : 'mixed GST'}.
                  Receiving updates each item&rsquo;s last cost (ex GST) and landed cost.
                </span>
              )
            )}

            {!po && (
              <span className="settings-hint">
                Unit cost is shown for checking only — <code>receive_stock</code> takes no cost, so
                <code> last_cost</code> stays hand-typed on the Stock page. Capturing it properly needs a
                change to the RPC (see the open &ldquo;real cost capture on receipt&rdquo; item).
              </span>
            )}
            <div className="row">
              <button className="btn btn-primary" disabled={busy} onClick={commit}>
                {po ? (busy ? 'Receiving…' : `Receive against ${po.po_ref}`) : 'Receive into stock'}
              </button>
              <button className="btn btn-gray" onClick={() => setReview(null)}>
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
