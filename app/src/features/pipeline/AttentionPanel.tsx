import { useState } from 'react'
import type { Customer, Stock } from '../../lib/data'
import type { AttentionItem } from '../../lib/attention'

export interface StockRow {
  stock: Stock
  toOrder: number
  onOrder: number
}

const STOCK_ROWS = 6
const FOLLOW_UPS = 8

/** The Pipeline's right-hand column when no job is open: only exceptions, so
 * it stays short however large the catalogue grows. Opening a job replaces
 * it with the job panel; closing the job brings it back. */
export default function AttentionPanel({
  items,
  stockRows,
  summary,
  customers,
  onOpenJob,
  onOpenOrderList,
}: {
  items: AttentionItem[]
  stockRows: StockRow[]
  summary: { shortItems: number; unitsToOrder: number; jobsAffected: number }
  customers: Customer[]
  onOpenJob: (id: number) => void
  onOpenOrderList?: () => void
}) {
  const [allStock, setAllStock] = useState(false)
  const [allItems, setAllItems] = useState(false)
  const name = (customerId: number, jobId: number) => customers.find((c) => c.id === customerId)?.name ?? `Job #${jobId}`
  const shownStock = allStock ? stockRows : stockRows.slice(0, STOCK_ROWS)
  const shownItems = allItems ? items : items.slice(0, FOLLOW_UPS)

  return (
    <aside className="pipeline-attention" aria-label="Needs attention">
      <div className="attn-title">Needs attention</div>

      <section>
        <div className="attn-head">
          <span>Stock</span>
          {onOpenOrderList && <button className="btn-link" onClick={onOpenOrderList}>Order list →</button>}
        </div>
        <div className="mutedtext">
          {summary.shortItems} short item{summary.shortItems !== 1 && 's'} · {summary.unitsToOrder} unit
          {summary.unitsToOrder !== 1 && 's'} to order · {summary.jobsAffected} job{summary.jobsAffected !== 1 && 's'}
        </div>
        {stockRows.length === 0 ? (
          <div className="mutedtext" style={{ marginTop: 6 }}>Nothing short.</div>
        ) : (
          <table className="attn-table">
            <thead>
              <tr><th>Item</th><th>To order</th><th>On order</th></tr>
            </thead>
            <tbody>
              {shownStock.map((r) => (
                <tr key={r.stock.id}>
                  <td>{r.stock.name}</td>
                  <td style={r.toOrder > 0 ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>{r.toOrder || '—'}</td>
                  <td>{r.onOrder || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {stockRows.length > STOCK_ROWS && (
          <button className="btn-link" onClick={() => setAllStock(!allStock)}>
            {allStock ? 'Show fewer' : `+ ${stockRows.length - STOCK_ROWS} more`}
          </button>
        )}
      </section>

      <section>
        <div className="attn-head">
          <span>Follow-ups</span>
          <span className="mutedtext">{items.length}</span>
        </div>
        {items.length === 0 && <div className="mutedtext">Nothing needs chasing.</div>}
        {shownItems.map((it, i) => (
          <button key={`${it.job.id}-${i}`} className="attn-item" onClick={() => onOpenJob(it.job.id)}>
            <span className={`attn-dot attn-${it.severity}`} aria-hidden />
            <strong>{name(it.job.customer_id, it.job.id)}</strong>
            <span className="attn-text">{it.text}</span>
          </button>
        ))}
        {items.length > FOLLOW_UPS && (
          <button className="btn-link" onClick={() => setAllItems(!allItems)}>
            {allItems ? 'Show fewer' : `+ ${items.length - FOLLOW_UPS} more`}
          </button>
        )}
      </section>
    </aside>
  )
}
