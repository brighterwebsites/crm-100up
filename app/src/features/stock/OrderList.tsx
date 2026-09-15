import { Mail, Package, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useData } from '../../lib/data'
import type { PurchaseOrder, Supplier } from '../../lib/data'
import { supabase } from '../../lib/supabaseClient'
import { computeOrderData, onOrderMap } from '../../lib/stockCalc'
import type { OrderCard, SupplierGroup } from '../../lib/stockCalc'
import { STAGE_NAMES_SHORT, isClosed } from './stageNames'
import { fmtDate } from '../../lib/format'
import { copyPartsList } from '../jobs/modals'
import { createPurchaseOrder, markPoSent, poLines, sendPurchaseOrder } from './poActions'

// Admin-only procurement view (port of renderOrderView / computeOrderData,
// lines 5969-6120): priority-attributed shortfalls, short + zero-stock
// cards, per-supplier grouping with PO + copy-parts actions.
//
// Stock on open POs (drafts included) counts as on order, so a shortfall a
// PO covers drops off this list. A supplier's draft PO stays visible here
// until it is sent, and while it exists no second PO can be created for
// that supplier (the DB enforces one draft per supplier too).
export default function OrderList({ onOpenJob }: { onOpenJob: (id: number) => void }) {
  const { jobs, customers, items, stocks, suppliers, purchaseOrders, purchaseOrderItems, refresh } = useData()
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const onOrder = useMemo(() => onOrderMap(purchaseOrders, purchaseOrderItems), [purchaseOrders, purchaseOrderItems])
  const data = useMemo(
    () => computeOrderData(jobs, items, stocks, suppliers, onOrder),
    [jobs, items, stocks, suppliers, onOrder],
  )
  const drafts = useMemo(() => purchaseOrders.filter((po) => po.po_status === 'draft'), [purchaseOrders])

  // Suppliers with a draft still get a group even once the draft covers
  // everything they were short of: the unsent PO is the thing to act on.
  const groups = useMemo(() => {
    const list: SupplierGroup[] = [...data.supplierGroups]
    for (const d of drafts) {
      if (!list.some((g) => (g.supplier?.id ?? null) === d.supplier_id)) {
        list.push({ supplier: suppliers.find((sp) => sp.id === d.supplier_id) ?? null, short: [], zero: [] })
      }
    }
    return list.sort((a, b) => (a.supplier?.name ?? 'zzz').localeCompare(b.supplier?.name ?? 'zzz'))
  }, [data.supplierGroups, drafts, suppliers])

  async function act(key: string, fn: () => Promise<unknown>) {
    setErr(null)
    setBusy(key)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function setStockSupplier(stockId: number, supplierId: number | null) {
    await supabase.from('stocks').update({ preferred_supplier_id: supplierId }).eq('id', stockId)
    await refresh()
  }

  async function copyGroup(name: string, cards: OrderCard[]) {
    await copyPartsList(cards.map((c) => ({ name: c.stock.name, qty: c.toOrder || c.alloc })))
    setCopied(name)
    setTimeout(() => setCopied(null), 2000)
  }

  function createPo(name: string, supplierId: number | null, cards: OrderCard[]) {
    const lines = cards.map((c) => ({ stock_id: c.stock.id, qty_ordered: c.toOrder || c.alloc, cost: c.stock.last_cost }))
    return act(`create-${name}`, () => createPurchaseOrder(supplierId, lines))
  }

  function sendDraft(draft: PurchaseOrder, supplier: Supplier | null) {
    if (!supplier?.email) return
    if (!confirm(`Email ${draft.po_ref} to ${supplier.name} <${supplier.email}> and mark it sent?`)) return
    return act(`send-${draft.id}`, () => sendPurchaseOrder(draft, supplier, poLines(draft, purchaseOrderItems, stocks)))
  }

  if (data.shortItems.length === 0 && data.zeroItems.length === 0 && drafts.length === 0) {
    return <div className="placeholder">Nothing needs ordering — no short or zero-stock items.</div>
  }

  return (
    <div>
      <div className="order-summary">
        <span>
          <strong>{data.shortItems.length}</strong> short item{data.shortItems.length !== 1 && 's'}
        </span>
        <span>
          <strong>{data.totalUnitsToOrder}</strong> units to order
        </span>
        <span>
          <strong>{data.totalJobsAffected}</strong> job{data.totalJobsAffected !== 1 && 's'} affected
        </span>
        {drafts.length > 0 && (
          <span>
            <strong>{drafts.length}</strong> draft PO{drafts.length !== 1 && 's'} to send
          </span>
        )}
      </div>

      {err && <div className="login-error">{err}</div>}

      {groups.map((g) => {
        const name = g.supplier?.name ?? 'Unassigned — no supplier set'
        const all = [...g.short, ...g.zero]
        const draft = drafts.find((d) => d.supplier_id === (g.supplier?.id ?? null))
        const draftLines = draft ? poLines(draft, purchaseOrderItems, stocks) : []
        return (
          <div key={name} className="card supplier-group">
            <div className="supplier-group-head">
              <strong>{name}</strong>
              {g.short.length > 0 && (
                <button className="btn btn-gray" onClick={() => copyGroup(name, g.short)}>
                  {copied === name ? 'Copied' : 'Copy parts list'}
                </button>
              )}
              {g.short.length > 0 && !draft && (
                <button
                  className="btn btn-primary"
                  disabled={busy === `create-${name}`}
                  onClick={() => createPo(name, g.supplier?.id ?? null, g.short)}
                  title="Creates a draft purchase order. It counts as on order straight away; send it when ready."
                >
                  {busy === `create-${name}` ? 'Creating…' : 'Create PO'}
                </button>
              )}
            </div>

            {draft && (
              <div className="order-card" style={{ borderLeft: '3px solid var(--stage-3)' }}>
                <div className="order-card-head">
                  <span className="order-item-name">
                    {draft.po_ref} · <span className="short-pill">Draft — not sent</span>
                  </span>
                  <span className="mutedtext">
                    {draftLines.length} line{draftLines.length !== 1 && 's'} · ${draft.po_amount.toFixed(2)}
                  </span>
                  <button
                    className="btn btn-primary"
                    disabled={!g.supplier?.email || busy === `send-${draft.id}`}
                    title={g.supplier?.email ? `Email to ${g.supplier.email}, then mark sent` : 'No email on this supplier. Use Mark sent.'}
                    onClick={() => sendDraft(draft, g.supplier)}
                  >
                    <Mail size={13} aria-hidden /> {busy === `send-${draft.id}` ? 'Sending…' : 'Send to supplier'}
                  </button>
                  <button
                    className="btn btn-gray"
                    disabled={busy === `mark-${draft.id}`}
                    title="Already sent another way (phone, their portal)"
                    onClick={() => act(`mark-${draft.id}`, () => markPoSent(draft))}
                  >
                    <Send size={13} aria-hidden /> Mark sent
                  </button>
                </div>
                {draftLines.map((l) => (
                  <div key={l.name} className="order-cust-row">
                    <span>{l.name}</span>
                    <span className="order-qty-pill">×{l.qty}</span>
                  </div>
                ))}
                {g.short.length > 0 && (
                  <div className="mutedtext" style={{ padding: '6px 0' }}>
                    More items below have come up short since this draft. Send {draft.po_ref} first, then create a PO for them.
                  </div>
                )}
              </div>
            )}

            {all.map((card) => (
              <div key={card.stock.id} className={`order-card ${card.kind === 'short' ? 'order-card-neg' : 'order-card-zero'}`}>
                <div className="order-card-head">
                  <span className="order-item-name"><Package size={12} aria-hidden /> {card.stock.name}</span>
                  <span className="mutedtext">
                    On hand: {card.stock.qty} | Allocated: {card.alloc}
                    {card.onOrder > 0 && ` | On order: ${card.onOrder}`}
                  </span>
                  <span className={`order-pill ${card.kind === 'short' ? 'pill-short' : 'pill-zero'}`}>
                    {card.kind === 'short' ? `ORDER ${card.toOrder} unit${card.toOrder !== 1 ? 's' : ''}` : 'ZERO STOCK'}
                  </span>
                  <select
                    className="supplier-select"
                    value={card.stock.preferred_supplier_id ?? ''}
                    onChange={(e) => setStockSupplier(card.stock.id, e.target.value ? Number(e.target.value) : null)}
                    title="Assign supplier — remembered for next time"
                  >
                    <option value="">— supplier —</option>
                    {suppliers.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.name}
                      </option>
                    ))}
                  </select>
                </div>
                {card.allocJobs.length ? (
                  card.allocJobs.map(({ job, qty }) => {
                    const dt = job.planned_install_date || job.install_completion_date
                    const custName = customers.find((c) => c.id === job.customer_id)?.name ?? `Job #${job.id}`
                    return (
                      <div key={job.id} className="order-cust-row">
                        <button className="btn-link-name" onClick={() => onOpenJob(job.id)}>
                          {custName}
                        </button>
                        <span className="order-qty-pill">
                          {card.kind === 'short' ? `${qty} short` : `×${qty} needed`}
                        </span>
                        <span className="order-meta-pill">
                          {isClosed(job.stage, job.step) ? 'Closed' : STAGE_NAMES_SHORT[job.stage]}
                        </span>
                        {/* "No date set" is information, not an empty value —
                            an unscheduled job you are ordering stock for is
                            exactly the one worth noticing. */}
                        <span className="order-meta-pill">{dt ? fmtDate(dt) : 'No date set'}</span>
                      </div>
                    )
                  })
                ) : (
                  <div className="mutedtext" style={{ padding: '6px 0' }}>
                    {card.kind === 'short'
                      ? 'Short, but not attributed to a specific job — check for a stand-alone/manual allocation.'
                      : 'No jobs allocated.'}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
