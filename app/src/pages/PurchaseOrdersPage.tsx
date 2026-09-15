import { Mail, Package, Printer, Send, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useData } from '../lib/data'
import type { PurchaseOrder } from '../lib/data'
import { fmtDate } from '../lib/format'
import { deletePo, markPoSent, poLines, printPurchaseOrder, sendPurchaseOrder } from '../features/stock/poActions'
import ReceiveModal from '../features/stock/ReceiveModal'

const STATUS_LABEL: Record<PurchaseOrder['po_status'], string> = {
  draft: 'Draft — not sent',
  sent: 'Sent',
  partially_received: 'Partially received',
  closed: 'Closed',
}

const STATUS_STYLE: Record<PurchaseOrder['po_status'], { bg: string; text: string }> = {
  draft: { bg: 'var(--stage-3-light)', text: 'var(--stage-3-text)' },
  sent: { bg: 'var(--stage-1-light)', text: 'var(--stage-1-text)' },
  partially_received: { bg: 'var(--stage-2-light)', text: 'var(--stage-2-text)' },
  closed: { bg: '#eef0f3', text: 'var(--muted)' },
}

function StatusChip({ status }: { status: PurchaseOrder['po_status'] }) {
  const s = STATUS_STYLE[status]
  return (
    <span className="stage-chip" style={{ background: s.bg, color: s.text, fontSize: 10 }}>
      {STATUS_LABEL[status]}
    </span>
  )
}

// Drafts can be sent (emailed to the supplier, then marked sent) or marked
// sent, and any PO can be printed under its real number. Delete is offered
// while nothing has been received; the DB refuses it otherwise. "Receive
// against a PO" in the UI is still a follow-up (docs/bugs.md #4).
export default function PurchaseOrdersPage() {
  const { purchaseOrders, purchaseOrderItems, suppliers, stocks, refresh } = useData()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [receiving, setReceiving] = useState(false)

  const filtered = useMemo(() => {
    if (!search.trim()) return purchaseOrders
    const q = search.toLowerCase()
    return purchaseOrders.filter(
      (po) =>
        po.po_ref.toLowerCase().includes(q) ||
        (suppliers.find((sp) => sp.id === po.supplier_id)?.name ?? '').toLowerCase().includes(q) ||
        po.invoice_ref.toLowerCase().includes(q),
    )
  }, [purchaseOrders, suppliers, search])

  const selected = purchaseOrders.find((po) => po.id === selectedId)
  const selectedItems = useMemo(
    () => purchaseOrderItems.filter((it) => it.purchase_order_id === selectedId),
    [purchaseOrderItems, selectedId],
  )

  const selectedSupplier = suppliers.find((sp) => sp.id === selected?.supplier_id)

  async function act(fn: () => Promise<unknown>) {
    setErr(null)
    setBusy(true)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function removePo(po: PurchaseOrder) {
    if (!confirm(`Delete ${po.po_ref}? Only possible while nothing has been received against it.`)) return
    return act(async () => {
      await deletePo(po)
      setSelectedId(null)
    })
  }

  function sendPo(po: PurchaseOrder) {
    if (!selectedSupplier?.email) return
    if (!confirm(`Email ${po.po_ref} to ${selectedSupplier.name} <${selectedSupplier.email}> and mark it sent?`)) return
    return act(() => sendPurchaseOrder(po, selectedSupplier, poLines(po, purchaseOrderItems, stocks)))
  }

  return (
    <div className="master-detail page-flush">
      <div className="master-list">
        <div className="master-list-search">
          <input
            placeholder="Search PO#, supplier, invoice…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="master-list-items">
          {filtered.map((po) => {
            const supplierName = suppliers.find((sp) => sp.id === po.supplier_id)?.name ?? 'No supplier'
            return (
              <button
                key={po.id}
                className={`master-item ${selectedId === po.id ? 'master-item-on' : ''}`}
                onClick={() => setSelectedId(po.id)}
              >
                <div className="master-item-name">{po.po_ref}</div>
                <div className="master-item-sub">{supplierName}</div>
                <div className="master-item-stage">
                  <span className="mutedtext">{fmtDate(po.occurred_at)}</span>
                  <span style={{ marginLeft: 6 }}><StatusChip status={po.po_status} /></span>
                </div>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <div style={{ padding: '24px 12px', color: 'var(--muted)', textAlign: 'center', fontSize: 13 }}>
              No purchase orders found.
            </div>
          )}
        </div>
      </div>

      <div className="detail-area">
        {!selected && <div className="detail-empty">Select a purchase order</div>}
        {selected && (
          <div className="jdp">
            {err && <div className="login-error" style={{ marginBottom: 6 }}>{err}</div>}
            <div className="jdp-header">
              <div className="jdp-title">
                <div className="jdp-name">{selected.po_ref}</div>
                <StatusChip status={selected.po_status} />
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {selected.po_status === 'draft' && (
                  <>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 12 }}
                      disabled={busy || !selectedSupplier?.email}
                      title={selectedSupplier?.email ? `Email to ${selectedSupplier.email}, then mark sent` : 'No email on this supplier. Use Mark sent.'}
                      onClick={() => sendPo(selected)}
                    >
                      <Mail size={13} aria-hidden /> Send to supplier
                    </button>
                    <button
                      className="btn btn-gray"
                      style={{ fontSize: 12 }}
                      disabled={busy}
                      title="Already sent another way (phone, their portal)"
                      onClick={() => act(() => markPoSent(selected))}
                    >
                      <Send size={13} aria-hidden /> Mark sent
                    </button>
                  </>
                )}
                {selected.po_status !== 'closed' && (
                  <button
                    className="btn btn-gray"
                    style={{ fontSize: 12 }}
                    disabled={busy || !selected.supplier_id}
                    title={selected.supplier_id ? 'Read the invoice or docket against this order' : 'This PO has no supplier, so it cannot be received against'}
                    onClick={() => setReceiving(true)}
                  >
                    <Package size={13} aria-hidden /> Receive stock
                  </button>
                )}
                <button
                  className="btn btn-gray"
                  style={{ fontSize: 12 }}
                  onClick={() => printPurchaseOrder(selected, selectedSupplier, poLines(selected, purchaseOrderItems, stocks))}
                >
                  <Printer size={13} aria-hidden /> Print PO
                </button>
                {(selected.po_status === 'draft' || selected.po_status === 'sent') && (
                  <button className="btn btn-gray" style={{ fontSize: 12 }} disabled={busy} onClick={() => removePo(selected)}>
                    <Trash2 size={13} aria-hidden /> Delete PO
                  </button>
                )}
              </div>
            </div>

            <div className="jdp-section">
              <div className="jdp-2col">
                <div className="jdp-field">
                  <span className="jdp-label">Date</span>
                  <span>{fmtDate(selected.occurred_at)}</span>
                </div>
                <div className="jdp-field">
                  <span className="jdp-label">Supplier</span>
                  <span>{selectedSupplier?.name ?? 'No supplier'}</span>
                </div>
                <div className="jdp-field">
                  <span className="jdp-label">Sent</span>
                  <span>{selected.sent_at ? fmtDate(selected.sent_at) : 'Not sent yet'}</span>
                </div>
                <div className="jdp-field">
                  <span className="jdp-label">Invoice</span>
                  <span>{selected.invoice_ref || '—'}</span>
                </div>
                <div className="jdp-field">
                  <span className="jdp-label">PO amount</span>
                  <span>${selected.po_amount.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="jdp-section">
              <div className="jdp-section-title">Line items ({selectedItems.length})</div>
              <div className="po-lines-card">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Item</th>
                        <th>Qty ordered</th>
                        <th>Cost</th>
                        <th>Qty received</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedItems.map((it) => (
                        <tr key={it.id}>
                          <td style={{ textAlign: 'left' }}>
                            {stocks.find((s) => s.id === it.stock_id)?.name ?? `Stock #${it.stock_id}`}
                          </td>
                          <td>{it.qty_ordered}</td>
                          <td>${it.cost.toFixed(2)}</td>
                          <td>{it.qty_received}</td>
                        </tr>
                      ))}
                      {selectedItems.length === 0 && (
                        <tr>
                          <td colSpan={4} className="mutedtext">No line items.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {receiving && selected && <ReceiveModal po={selected} onClose={() => setReceiving(false)} />}
    </div>
  )
}
