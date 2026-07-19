import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useData } from '../../lib/data'
import { allocatedMap } from '../../lib/stockCalc'
import type { Enums } from '../../types/database.types'
import ReceiveModal from './ReceiveModal'
import StockDetailPanel from './StockDetailPanel'

type CesCategory = Enums<'ces_category'>
type CatFilter = 'all' | CesCategory | 'outofstock'

const CATEGORY_LABEL: Record<CesCategory, string> = {
  battery: 'Battery',
  inverter: 'Inverter',
  panel: 'Panel',
  other: 'Other',
}

export default function StockPage() {
  const { isAdmin } = useAuth()
  const { stocks, suppliers, jobs, items } = useData()
  const [receiving, setReceiving] = useState(false)
  const [filter, setFilter] = useState<CatFilter>('all')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<number | 'new' | null>(null)

  const alloc = useMemo(() => allocatedMap(jobs, items), [jobs, items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return stocks.filter((s) => {
      if (filter === 'outofstock' && s.qty !== 0) return false
      if (filter !== 'all' && filter !== 'outofstock' && s.category !== filter) return false
      if (q) {
        const hay = `${s.name} ${s.manufacturer} ${s.model} ${CATEGORY_LABEL[s.category]}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [stocks, filter, search])

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
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setReceiving(true)}>
              📦 Receive stock
            </button>
          </>
        )}
      </div>

      <div className="quick-filters">
        <span>Show:</span>
        {([
          ['all', 'All'],
          ['battery', '🔋 Battery'],
          ['inverter', '⚡ Inverter'],
          ['panel', '☀ Panel'],
          ['other', 'Other'],
          ['outofstock', '⚠ Out of stock'],
        ] as [CatFilter, string][]).map(([f, label]) => (
          <button key={f} className={`fbtn ${filter === f ? 'fbtn-on' : ''}`} onClick={() => setFilter(f)}>
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
                  <th>Category</th>
                  <th>On hand</th>
                  <th>Allocated</th>
                  <th>Available</th>
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
                        {(s.manufacturer || s.model) && (
                          <div className="mutedtext" style={{ fontSize: 11 }}>
                            {[s.manufacturer, s.model].filter(Boolean).join(' ')}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="cat-tag" data-cat={s.category}>
                          {CATEGORY_LABEL[s.category]}
                        </span>
                      </td>
                      <td>{s.qty}</td>
                      <td>{a}</td>
                      <td>{avail < 0 ? <strong>⚠ {avail}</strong> : avail}</td>
                      <td>{s.last_cost > 0 ? `$${s.last_cost.toFixed(2)}` : '—'}</td>
                      <td style={{ textAlign: 'left' }}>
                        {suppliers.find((sp) => sp.id === s.preferred_supplier_id)?.name ?? '—'}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '28px 0', color: 'var(--muted)' }}>
                      No stock items match this filter.
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
    </div>
  )
}
