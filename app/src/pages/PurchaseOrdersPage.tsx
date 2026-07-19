import { useMemo, useState } from 'react'
import { useData } from '../lib/data'
import type { PurchaseOrder } from '../lib/data'
import { supabase } from '../lib/supabaseClient'
import { fmtDate } from '../lib/format'

const STATUS_LABEL: Record<PurchaseOrder['po_status'], string> = {
  sent: 'Sent',
  partially_received: 'Partially received',
  closed: 'Closed',
}

const STATUS_STYLE: Record<PurchaseOrder['po_status'], { bg: string; text: string }> = {
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

// Note: this page is read-only for now (list + line items). "Receive
// against a PO" — the action that would move sent -> partially_received
// -> closed and fill in qty_received — is a follow-up (docs/bugs.md #4);
// ad-hoc Receive Stock (Stock page) still creates its own closed PO.
export default function PurchaseOrdersPage() {
  const { purchaseOrders, purchaseOrderItems, suppliers, stocks, refresh } = useData()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

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

  async function cancelPo(id: number) {
    setErr(null)
    if (!confirm('Delete this PO? Only possible while nothing has been received against it.')) return
    const { error } = await supabase.from('purchase_orders').delete().eq('id', id)
    if (error) { setErr(error.message); return }
    setSelectedId(null)
    await refresh()
  }

  return (
    <div className="master-detail">
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
              {selected.po_status === 'sent' && (
                <button className="btn btn-gray" style={{ fontSize: 12 }} onClick={() => cancelPo(selected.id)}>
                  ✕ Delete PO
                </button>
              )}
            </div>

            <div className="jdp-section">
              <div className="jdp-2col">
                <div className="jdp-field">
                  <span className="jdp-label">Date</span>
                  <span>{fmtDate(selected.occurred_at)}</span>
                </div>
                <div className="jdp-field">
                  <span className="jdp-label">Supplier</span>
                  <span>{suppliers.find((sp) => sp.id === selected.supplier_id)?.name ?? 'No supplier'}</span>
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
        )}
      </div>
    </div>
  )
}
