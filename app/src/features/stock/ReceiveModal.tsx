import { Package } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useData } from '../../lib/data'
import { supabase } from '../../lib/supabaseClient'
import { matchStock, normalizePart } from '../../lib/normalizePart'
import { todayISO, fmtMoneyExact } from '../../lib/format'
import { extractInvoice, INVOICE_ACCEPT } from '../../lib/integrations'

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

interface ParsedInvoice {
  supplier?: string | null
  invoiceRef?: string | null
  invoiceDate?: string | null
  lines: { name: string; qty: number; unitCost?: number | null }[]
}

interface ReviewLine {
  name: string
  qty: number
  stockId: number | '' | '__new__'
  newName: string
  /** Read from the invoice, shown for checking. See the note by the table. */
  unitCost: number | null
}

const PROMPT = `"Read this invoice and give me JSON with supplier, invoiceRef, invoiceDate, and a lines array of {name, qty, unitCost} for each part."`

export default function ReceiveModal({ onClose }: { onClose: () => void }) {
  const { stocks, suppliers, refresh, purchaseOrders } = useData()
  const [tab, setTab] = useState<'upload' | 'paste'>('upload')
  const [raw, setRaw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [supplierId, setSupplierId] = useState<string>('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [occurredAt, setOccurredAt] = useState(todayISO())
  const [review, setReview] = useState<ReviewLine[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const recent = useMemo(() => purchaseOrders.slice(0, 5), [purchaseOrders])

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
    // (matchSupplierByName semantics + the EnergySpurt fix).
    if (p.supplier) {
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
        const match = matchStock(l.name, stocks)
        return {
          name: l.name,
          qty: l.qty || 0,
          stockId: match ? match.id : '__new__',
          newName: match ? '' : normalizePart(l.name).name ?? l.name,
          unitCost: l.unitCost ?? null,
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
    setReading(true)
    try {
      applyInvoice(await extractInvoice(file))
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong><Package size={14} aria-hidden /> Receive stock</strong>
          <button className="btn btn-gray" style={{ marginLeft: 'auto' }} onClick={onClose}>
            Close
          </button>
        </div>
        {err && <div className="login-error">{err}</div>}
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
                  photo of it. It is read here and the lines are matched against your stock for you to
                  check. <strong>Nothing is added until you confirm.</strong>
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
            {recent.length > 0 && (
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
            )}
          </>
        ) : (
          <>
            <div className="form-grid">
              <label>
                Supplier
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">— no supplier —</option>
                  {suppliers.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Invoice ref
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
                  </tr>
                </thead>
                <tbody>
                  {review.map((l, i) => (
                    <tr key={i}>
                      <td style={{ textAlign: 'left' }}>{l.name}</td>
                      <td style={{ textAlign: 'left' }}>
                        <select
                          value={String(l.stockId)}
                          onChange={(e) => {
                            const v = e.target.value
                            const next = [...review]
                            next[i] = { ...l, stockId: v === '__new__' ? '__new__' : v === '' ? '' : Number(v) }
                            setReview(next)
                          }}
                        >
                          <option value="__new__">+ Create new item</option>
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
                            onChange={(e) => {
                              const next = [...review]
                              next[i] = { ...l, newName: e.target.value }
                              setReview(next)
                            }}
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
                          onChange={(e) => {
                            const next = [...review]
                            next[i] = { ...l, qty: Number(e.target.value) }
                            setReview(next)
                          }}
                        />
                      </td>
                      <td className="mutedtext">
                        {l.unitCost == null ? '—' : fmtMoneyExact(l.unitCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <span className="settings-hint">
              Unit cost is shown for checking only — <code>receive_stock</code> takes no cost, so
              <code> last_cost</code> stays hand-typed on the Stock page. Capturing it properly needs a
              change to the RPC (see the open &ldquo;real cost capture on receipt&rdquo; item).
            </span>
            <div className="row">
              <button className="btn btn-primary" onClick={commit}>
                Receive into stock
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
