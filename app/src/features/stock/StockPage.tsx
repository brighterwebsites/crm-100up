import { ClipboardList, Package } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { brandFor, useData } from '../../lib/data'
import { allocatedMap } from '../../lib/stockCalc'
import { PHASE_LABEL, PRODUCT_GROUPS, PRODUCT_TYPE_LABEL, inGroup } from '../../lib/productTypes'
import type { ProductGroup } from '../../lib/productTypes'
import ReceiveModal from './ReceiveModal'
import StockDetailPanel from './StockDetailPanel'
import StockTakeModal from './StockTakeModal'
import { inTransitMap } from './stockTakeSheet'

/** Planning price and last paid price have diverged. Not an error — it is
 * what happens when a supplier reprices — but worth surfacing so the quoting
 * price cannot drift unnoticed. */
function stale(s: { planning_cost: number; last_cost: number }): boolean {
  return s.last_cost > 0 && s.planning_cost > 0 && s.last_cost !== s.planning_cost
}

export default function StockPage() {
  const { isAdmin } = useAuth()
  const { stocks, manufacturers, suppliers, jobs, items, purchaseOrders, purchaseOrderItems } = useData()
  const [receiving, setReceiving] = useState(false)
  const [stockTake, setStockTake] = useState(false)
  const [filter, setFilter] = useState<ProductGroup>('all')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<number | 'new' | null>(null)

  const alloc = useMemo(() => allocatedMap(jobs, items), [jobs, items])
  const transit = useMemo(
    () => inTransitMap(purchaseOrders, purchaseOrderItems),
    [purchaseOrders, purchaseOrderItems],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return stocks.filter((s) => {
      if (filter === 'outofstock' && s.qty !== 0) return false
      if (!inGroup(s.product_type, filter)) return false
      if (q) {
        // Searchable on brand and product type as well as name/model, so
        // "gateway" or "Deye" finds things whose name does not contain them.
        const hay = `${s.name} ${brandFor(s, manufacturers)} ${s.model} ${PRODUCT_TYPE_LABEL[s.product_type]}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [stocks, manufacturers, filter, search])

  // The sheet counts what is on screen. Saying so on the document matters:
  // a filtered count reconciled as if it were a full one would write off
  // every item that was never on the page.
  const scope = useMemo(() => {
    const parts: string[] = []
    if (filter !== 'all') parts.push(PRODUCT_GROUPS.find((g) => g.key === filter)?.label ?? filter)
    if (search.trim()) parts.push(`search “${search.trim()}”`)
    return parts.join(' · ')
  }, [filter, search])

  const sheetInput = useMemo(
    () => ({ stocks: filtered, manufacturers, suppliers, allocated: alloc, transit, scope: scope || undefined }),
    [filtered, manufacturers, suppliers, alloc, transit, scope],
  )

  return (
    <div className="pipeline-page">
      <div className="filter-row">
        <input
          placeholder="Search item, manufacturer, model…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 240 }}
        />
        {isAdmin && (
          <>
            <button className="btn btn-gray" onClick={() => setOpenId('new')}>
              + Add new
            </button>
            <button
              className="btn btn-gray"
              style={{ marginLeft: 'auto' }}
              onClick={() => setStockTake(true)}
              title="Printable count sheet for the products shown"
            >
              <ClipboardList size={13} aria-hidden /> Print stock take
            </button>
            <button className="btn btn-primary" onClick={() => setReceiving(true)}>
              <Package size={13} aria-hidden /> Receive stock
            </button>
          </>
        )}
      </div>

      <div className="quick-filters">
        <span>Show:</span>
        {PRODUCT_GROUPS.map(({ key, label }) => (
          <button key={key} className={`fbtn ${filter === key ? 'fbtn-on' : ''}`} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      <div className="pipeline-content">
        <div className="pipeline-grid-wrap">
          <div className="card table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Item</th>
                  <th>Type</th>
                  <th>On hand</th>
                  <th>Allocated</th>
                  <th>Available</th>
                  <th>Quote at</th>
                  <th>Last cost</th>
                  <th style={{ textAlign: 'left' }}>Preferred supplier</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const a = alloc[s.id] ?? 0
                  const avail = s.qty - a
                  const isSelected = s.id === openId
                  return (
                    <tr
                      key={s.id}
                      className={`p-row ${avail < 0 ? 'row-short' : s.qty === 0 ? 'row-zero' : ''} ${isSelected ? 'stock-row-on' : ''}`}
                    >
                      <td
                        style={{ textAlign: 'left', cursor: 'pointer' }}
                        onClick={() => setOpenId(isSelected ? null : s.id)}
                      >
                        <strong>{s.name}</strong>
                        {(brandFor(s, manufacturers) || s.model) && (
                          <div className="mutedtext" style={{ fontSize: 11 }}>
                            {[brandFor(s, manufacturers), s.model].filter(Boolean).join(' ')}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="cat-tag" data-cat={s.category}>
                          {PRODUCT_TYPE_LABEL[s.product_type]}
                        </span>
                        {s.phase !== 'na' && (
                          <div className="mutedtext" style={{ fontSize: 10 }}>{PHASE_LABEL[s.phase]}</div>
                        )}
                      </td>
                      <td>{s.qty}</td>
                      <td>{a}</td>
                      <td>{avail < 0 ? <strong>{avail}</strong> : avail}</td>
                      <td className="num">{s.planning_cost > 0 ? `$${s.planning_cost.toFixed(2)}` : '—'}</td>
                      {/* Shown beside the quoting price on purpose: when a
                          supplier price moves but old stock is still on the
                          shelf, whether to quote the old or new price is
                          Fred's call, and he needs both numbers to make it. */}
                      <td className="num" title={stale(s) ? 'Differs from the price quotes use' : undefined}>
                        {s.last_cost > 0 ? `$${s.last_cost.toFixed(2)}` : '—'}
                        {stale(s) && <span className="stale-dot" aria-label="Planning price differs from last cost"> ●</span>}
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        {suppliers.find((sp) => sp.id === s.preferred_supplier_id)?.name ?? '—'}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '28px 0', color: 'var(--muted)' }}>
                      No products match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className={`pipeline-detail-panel ${openId !== null ? 'panel-is-open' : ''}`}>
          {openId !== null && (
            <StockDetailPanel
              stockId={openId}
              onClose={() => setOpenId(null)}
              onCreated={(id) => setOpenId(id)}
            />
          )}
        </div>
      </div>

      {receiving && <ReceiveModal onClose={() => setReceiving(false)} />}
      {stockTake && <StockTakeModal input={sheetInput} onClose={() => setStockTake(false)} />}
    </div>
  )
}
