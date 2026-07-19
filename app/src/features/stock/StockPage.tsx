import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useData } from '../../lib/data'
import { supabase } from '../../lib/supabaseClient'
import { allocatedMap } from '../../lib/stockCalc'
import ReceiveModal from './ReceiveModal'

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

  const setSupplier = (id: number, supplierId: number | null) =>
    run(async () => {
      const { error } = await supabase.from('stocks').update({ supplier_id: supplierId }).eq('id', id)
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
              <th>On hand</th>
              <th>Allocated</th>
              <th>Available</th>
              <th style={{ textAlign: 'left' }}>Supplier</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {stocks.map((s) => {
              const a = alloc[s.id] ?? 0
              const avail = s.qty - a
              return (
                <tr key={s.id} className={avail < 0 ? 'row-short' : s.qty === 0 ? 'row-zero' : ''}>
                  <td style={{ textAlign: 'left' }}>{s.name}</td>
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
                  <td style={{ textAlign: 'left' }}>
                    {isAdmin ? (
                      <select
                        value={s.supplier_id ?? ''}
                        onChange={(e) => setSupplier(s.id, e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">—</option>
                        {suppliers.map((sp) => (
                          <option key={sp.id} value={sp.id}>
                            {sp.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      suppliers.find((sp) => sp.id === s.supplier_id)?.name ?? '—'
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
