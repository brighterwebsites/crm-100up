import { useMemo, useState } from 'react'
import { useData } from '../../lib/data'
import { supabase } from '../../lib/supabaseClient'
import { computeOrderData } from '../../lib/stockCalc'
import type { OrderCard } from '../../lib/stockCalc'
import { STAGE_NAMES_SHORT, isClosed } from './stageNames'
import { fmtDate } from '../../lib/format'
import { buildPoHtml, openPrintWindow } from '../jobs/actions'
import { copyPartsList } from '../jobs/modals'

// Admin-only procurement view (port of renderOrderView / computeOrderData,
// lines 5969-6120): priority-attributed shortfalls, short + zero-stock
// cards, per-supplier grouping with PO + copy-parts actions.
export default function OrderList({ onOpenJob }: { onOpenJob: (id: number) => void }) {
  const { jobs, items, stocks, suppliers, refresh } = useData()
  const [copied, setCopied] = useState<string | null>(null)

  const data = useMemo(() => computeOrderData(jobs, items, stocks, suppliers), [jobs, items, stocks, suppliers])

  async function setStockSupplier(stockId: number, supplierId: number | null) {
    await supabase.from('stocks').update({ supplier_id: supplierId }).eq('id', stockId)
    await refresh()
  }

  async function copyGroup(name: string, cards: OrderCard[]) {
    await copyPartsList(cards.map((c) => ({ name: c.stock.name, qty: c.toOrder || c.alloc })))
    setCopied(name)
    setTimeout(() => setCopied(null), 2000)
  }

  function printGroupPo(name: string, cards: OrderCard[]) {
    const ref = `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
    openPrintWindow(
      buildPoHtml(`Purchase Order — ${name}`, ref, name, cards.map((c) => ({ name: c.stock.name, qty: c.toOrder || c.alloc })))
    )
  }

  if (data.shortItems.length === 0 && data.zeroItems.length === 0) {
    return <div className="placeholder">✅ Nothing needs ordering — no short or zero-stock items.</div>
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
      </div>

      {data.supplierGroups.map((g) => {
        const name = g.supplier?.name ?? 'Unassigned — no supplier set'
        const all = [...g.short, ...g.zero]
        return (
          <div key={name} className="card supplier-group">
            <div className="supplier-group-head">
              <strong>{name}</strong>
              {g.short.length > 0 && (
                <>
                  <button className="btn btn-gray" onClick={() => copyGroup(name, g.short)}>
                    {copied === name ? '✓ Copied' : '📋 Copy parts list'}
                  </button>
                  <button className="btn btn-gray" onClick={() => printGroupPo(name, g.short)}>
                    🖨 Print / save PO
                  </button>
                </>
              )}
            </div>
            {all.map((card) => (
              <div key={card.stock.id} className={`order-card ${card.kind === 'short' ? 'order-card-neg' : 'order-card-zero'}`}>
                <div className="order-card-head">
                  <span className="order-item-name">📦 {card.stock.name}</span>
                  <span className="mutedtext">
                    On hand: {card.stock.qty} | Allocated: {card.alloc}
                  </span>
                  <span className={`order-pill ${card.kind === 'short' ? 'pill-short' : 'pill-zero'}`}>
                    {card.kind === 'short' ? `ORDER ${card.toOrder} unit${card.toOrder !== 1 ? 's' : ''}` : 'ZERO STOCK'}
                  </span>
                  <select
                    value={card.stock.supplier_id ?? ''}
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
                    const dt = job.date_booked || job.install_date
                    return (
                      <div key={job.id} className="order-cust-row">
                        <button className="btn-link-name" onClick={() => onOpenJob(job.id)}>
                          {job.name}
                        </button>
                        <span>{card.kind === 'short' ? `⚠ ${qty} short` : `×${qty} needed`}</span>
                        <span className="mutedtext">
                          {isClosed(job.stage, job.step) ? '✓ Closed' : STAGE_NAMES_SHORT[job.stage]} ·{' '}
                          {dt ? fmtDate(dt) : 'No date set'}
                        </span>
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
