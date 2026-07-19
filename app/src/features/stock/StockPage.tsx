import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useData } from '../../lib/data'
import { supabase } from '../../lib/supabaseClient'
import { allocatedMap } from '../../lib/stockCalc'
import type { Enums, TablesUpdate } from '../../types/database.types'
import ReceiveModal from './ReceiveModal'

type CesCategory = Enums<'ces_category'>

const CATEGORY_LABEL: Record<CesCategory, string> = {
  battery: 'Battery',
  inverter: 'Inverter',
  panel: 'Panel',
  other: 'Other',
}

/** Which spec column is meaningful for a given category — the others are
 * blank inputs the admin can ignore rather than four always-visible
 * fields with no context. */
const SPEC_FIELD: Record<CesCategory, { key: 'kwh' | 'kva' | 'watts'; label: string } | null> = {
  battery: { key: 'kwh', label: 'kWh' },
  inverter: { key: 'kva', label: 'kVA' },
  panel: { key: 'watts', label: 'W' },
  other: null,
}

export default function StockPage() {
  const { isAdmin } = useAuth()
  const { stocks, suppliers, jobs, items, refresh } = useData()
  const [err, setErr] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [receiving, setReceiving] = useState(false)

  const alloc = useMemo(() => allocatedMap(jobs, items), [jobs, items])

  async function run(fn: () => Promise<unknown>) {
    setErr(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const setQty = (id: number, qty: number) =>
    run(async () => {
      const { error } = await supabase.from('stocks').update({ qty: Math.max(0, qty) }).eq('id', id)
      if (error) throw new Error(error.message)
    })

  const setPreferredSupplier = (id: number, supplierId: number | null) =>
    run(async () => {
      const { error } = await supabase.from('stocks').update({ preferred_supplier_id: supplierId }).eq('id', id)
      if (error) throw new Error(error.message)
    })

  const setField = (id: number, patch: TablesUpdate<'stocks'>) =>
    run(async () => {
      const { error } = await supabase.from('stocks').update(patch).eq('id', id)
      if (error) throw new Error(error.message)
    })

  const addItem = () =>
    run(async () => {
      if (!newName.trim()) return
      const { error } = await supabase.from('stocks').insert({ name: newName.trim(), qty: 0 })
      if (error) throw new Error(error.message)
      setNewName('')
    })

  const removeItem = (id: number) =>
    run(async () => {
      const { error } = await supabase.from('stocks').delete().eq('id', id)
      if (error)
        throw new Error(
          error.message.includes('foreign key')
            ? 'This item is referenced by job stock lines and can’t be deleted.'
            : error.message
        )
    })

  return (
    <div>
      {err && <div className="login-error">{err}</div>}
      <div className="filter-row">
        {isAdmin && (
          <>
            <input
              placeholder="New stock item name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
            />
            <button className="btn btn-gray" onClick={addItem}>
              + Add item
            </button>
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setReceiving(true)}>
              📦 Receive stock
            </button>
          </>
        )}
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Item</th>
              <th>Category</th>
              <th style={{ textAlign: 'left' }}>Manufacturer / model</th>
              <th>Spec</th>
              <th>On hand</th>
              <th>Allocated</th>
              <th>Available</th>
              <th>Last cost</th>
              <th style={{ textAlign: 'left' }}>Preferred supplier</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {stocks.map((s) => {
              const a = alloc[s.id] ?? 0
              const avail = s.qty - a
              const spec = SPEC_FIELD[s.category]
              return (
                <tr key={s.id} className={avail < 0 ? 'row-short' : s.qty === 0 ? 'row-zero' : ''}>
                  <td style={{ textAlign: 'left' }}>{s.name}</td>
                  <td>
                    {isAdmin ? (
                      <select
                        value={s.category}
                        onChange={(e) => setField(s.id, { category: e.target.value as CesCategory })}
                      >
                        {(Object.keys(CATEGORY_LABEL) as CesCategory[]).map((c) => (
                          <option key={c} value={c}>
                            {CATEGORY_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      CATEGORY_LABEL[s.category]
                    )}
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    {isAdmin ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input
                          placeholder="Manufacturer"
                          value={s.manufacturer}
                          onChange={(e) => setField(s.id, { manufacturer: e.target.value })}
                          style={{ width: 100 }}
                        />
                        <input
                          placeholder="Model"
                          value={s.model}
                          onChange={(e) => setField(s.id, { model: e.target.value })}
                          style={{ width: 110 }}
                        />
                      </div>
                    ) : (
                      [s.manufacturer, s.model].filter(Boolean).join(' ') || '—'
                    )}
                  </td>
                  <td>
                    {spec ? (
                      isAdmin ? (
                        <input
                          className="qty-input"
                          type="number"
                          min={0}
                          value={s[spec.key] ?? ''}
                          onChange={(e) => setField(s.id, { [spec.key]: e.target.value ? Number(e.target.value) : null })}
                          title={spec.label}
                        />
                      ) : (
                        s[spec.key] != null ? `${s[spec.key]} ${spec.label}` : '—'
                      )
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {isAdmin ? (
                      <input
                        className="qty-input"
                        type="number"
                        min={0}
                        value={s.qty}
                        onChange={(e) => setQty(s.id, Number(e.target.value))}
                      />
                    ) : (
                      s.qty
                    )}
                  </td>
                  <td>{a}</td>
                  <td>{avail < 0 ? <strong>⚠ {avail}</strong> : avail}</td>
                  <td>
                    {isAdmin ? (
                      <input
                        className="qty-input"
                        type="number"
                        min={0}
                        step="0.01"
                        value={s.last_cost}
                        onChange={(e) => setField(s.id, { last_cost: Number(e.target.value) || 0 })}
                      />
                    ) : (
                      s.last_cost > 0 ? `$${s.last_cost.toFixed(2)}` : '—'
                    )}
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    {isAdmin ? (
                      <select
                        value={s.preferred_supplier_id ?? ''}
                        onChange={(e) => setPreferredSupplier(s.id, e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">—</option>
                        {suppliers.map((sp) => (
                          <option key={sp.id} value={sp.id}>
                            {sp.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      suppliers.find((sp) => sp.id === s.preferred_supplier_id)?.name ?? '—'
                    )}
                  </td>
                  {isAdmin && (
                    <td>
                      <button className="btn-x" title="Delete item" onClick={() => removeItem(s.id)}>
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {receiving && <ReceiveModal onClose={() => setReceiving(false)} />}
    </div>
  )
}
