import { ClipboardList, Package } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { brandFor, useData } from '../../lib/data'
import type { StockTake } from '../../lib/data'
import { fmtDate } from '../../lib/format'
import { allocatedMap } from '../../lib/stockCalc'
import { PHASE_LABEL, PRODUCT_GROUPS, PRODUCT_TYPE_LABEL, inGroup } from '../../lib/productTypes'
import type { ProductGroup } from '../../lib/productTypes'
import ReceiveModal from './ReceiveModal'
import StockDetailPanel from './StockDetailPanel'
import StockTakeCount from './StockTakeCount'
import { NewStockTakeModal, StockTakeSheetModal } from './StockTakeModals'
import { cancelStockTake } from './stockTake'

/** Planning price and last paid price have diverged. Not an error — it is
 * what happens when a supplier reprices — but worth surfacing so the quoting
 * price cannot drift unnoticed. */
function stale(s: { planning_cost: number; last_cost: number }): boolean {
  return s.last_cost > 0 && s.planning_cost > 0 && s.last_cost !== s.planning_cost
}

export default function StockPage() {
  const { isAdmin } = useAuth()
  const { stocks, manufacturers, suppliers, jobs, items, stockTakes, stockTakeLines, refresh } = useData()
  const [receiving, setReceiving] = useState(false)
  const [filter, setFilter] = useState<ProductGroup>('all')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<number | 'new' | null>(null)
  const [newTake, setNewTake] = useState(false)
  const [sheetTake, setSheetTake] = useState<StockTake | null>(null)
  const [counting, setCounting] = useState(false)
  const [takeErr, setTakeErr] = useState<string | null>(null)

  const alloc = useMemo(() => allocatedMap(jobs, items), [jobs, items])
  const openTake = stockTakes.find((t) => t.status === 'open')
  const openTakeLines = openTake ? stockTakeLines.filter((l) => l.stock_take_id === openTake.id) : []

  async function cancelTake(take: StockTake) {
    const msg = `Cancel ${take.ref}? Its number stays on record as cancelled. Counts entered so far are discarded and on hand does not change.`
    if (!confirm(msg)) return
    setTakeErr(null)
    try {
      await cancelStockTake(take)
      await refresh()
      setCounting(false)
    } catch (e) {
      setTakeErr(e instanceof Error ? e.message : String(e))
    }
  }

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
              disabled={!!openTake}
              title={openTake ? `${openTake.ref} is still open: apply or cancel it first` : 'Print a count sheet and start a stock take'}
              onClick={() => setNewTake(true)}
            >
              <ClipboardList size={13} aria-hidden /> Stock take
            </button>
            <button className="btn btn-primary" onClick={() => setReceiving(true)}>
              <Package size={13} aria-hidden /> Receive stock
            </button>
          </>
        )}
      </div>

      {isAdmin && openTake && !counting && (
        <div className="stocktake-banner">
          <strong>Stock take {openTake.ref} is open</strong>
          <span>
            printed {fmtDate(openTake.printed_at)} · {openTakeLines.filter((l) => l.qty_counted !== null).length} of{' '}
            {openTakeLines.length} counted
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn btn-primary" onClick={() => setCounting(true)}>Enter counts</button>
            <button className="btn btn-gray" onClick={() => setSheetTake(openTake)}>Reprint sheet</button>
            <button className="btn btn-gray" onClick={() => cancelTake(openTake)}>Cancel stock take</button>
          </span>
        </div>
      )}
      {takeErr && <div className="login-error">{takeErr}</div>}

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
          {isAdmin && counting && openTake ? (
            <StockTakeCount key={openTake.id} take={openTake} onExit={() => setCounting(false)} />
          ) : (
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
          )}
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
      {newTake && (
        <NewStockTakeModal
          onClose={() => setNewTake(false)}
          onCreated={(take) => {
            setNewTake(false)
            setSheetTake(take)
          }}
        />
      )}
      {sheetTake && <StockTakeSheetModal take={sheetTake} onClose={() => setSheetTake(null)} />}
    </div>
  )
}
