import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useData } from '../../lib/data'
import { supabase } from '../../lib/supabaseClient'
import { fmtDate } from '../../lib/format'

export default function SuppliersPage() {
  const { isAdmin } = useAuth()
  const { suppliers, purchaseOrders, refresh } = useData()
  const [err, setErr] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  async function run(fn: () => Promise<unknown>) {
    setErr(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const add = () =>
    run(async () => {
      if (!newName.trim()) return
      const { error } = await supabase.from('suppliers').insert({ name: newName.trim() })
      if (error)
        throw new Error(
          error.message.includes('suppliers_name_norm_uq')
            ? 'A supplier with that name (ignoring case/spaces) already exists.'
            : error.message
        )
      setNewName('')
    })

  const update = (id: number, patch: Partial<Pick<(typeof suppliers)[number], 'name' | 'phone' | 'email' | 'notes'>>) =>
    run(async () => {
      const { error } = await supabase.from('suppliers').update(patch).eq('id', id)
      if (error) throw new Error(error.message)
    })

  const remove = (id: number) =>
    run(async () => {
      const { error } = await supabase.from('suppliers').delete().eq('id', id)
      if (error)
        throw new Error(
          error.message.includes('foreign key') || error.message.includes('violates')
            ? 'This supplier is referenced by stock or receipts — reassign those first.'
            : error.message
        )
    })

  return (
    <div>
      {err && <div className="login-error">{err}</div>}
      {isAdmin && (
        <div className="filter-row">
          <input
            placeholder="New supplier name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn btn-gray" onClick={add}>
            + Add supplier
          </button>
        </div>
      )}
      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Supplier</th>
              <th style={{ textAlign: 'left' }}>Phone</th>
              <th style={{ textAlign: 'left' }}>Email</th>
              <th style={{ textAlign: 'left' }}>Notes</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {suppliers.map((sp) => (
              <tr key={sp.id}>
                {(['name', 'phone', 'email', 'notes'] as const).map((f) => (
                  <td key={f} style={{ textAlign: 'left' }}>
                    {isAdmin ? (
                      <input
                        defaultValue={sp[f]}
                        onBlur={(e) => e.target.value !== sp[f] && update(sp.id, { [f]: e.target.value })}
                      />
                    ) : (
                      sp[f]
                    )}
                  </td>
                ))}
                {isAdmin && (
                  <td>
                    <button className="btn-x" title="Delete supplier" onClick={() => remove(sp.id)}>
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ margin: '22px 0 8px' }}>Stock received</h3>
      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Date</th>
              <th style={{ textAlign: 'left' }}>Supplier</th>
              <th style={{ textAlign: 'left' }}>Invoice</th>
              <th>Items</th>
              <th>Units</th>
            </tr>
          </thead>
          <tbody>
            {purchaseOrders.map((r) => (
              <tr key={r.id}>
                <td style={{ textAlign: 'left' }}>{fmtDate(r.occurred_at)}</td>
                <td style={{ textAlign: 'left' }}>{suppliers.find((sp) => sp.id === r.supplier_id)?.name ?? 'No supplier'}</td>
                <td style={{ textAlign: 'left' }}>{r.invoice_ref}</td>
                <td>{r.item_count}</td>
                <td>{r.total_units}</td>
              </tr>
            ))}
            {purchaseOrders.length === 0 && (
              <tr>
                <td colSpan={5} className="mutedtext">
                  No receipts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
