/**
 * StockDetailPanel — slide-in side panel for a single stock item.
 * Used both for editing an existing item and for the "Add New" flow
 * (stockId === 'new'), which drafts a row locally and inserts on save
 * instead of requiring a name up front.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../../lib/auth'
import { useData } from '../../lib/data'
import { supabase } from '../../lib/supabaseClient'
import { allocatedMap } from '../../lib/stockCalc'
import type { Enums, TablesInsert } from '../../types/database.types'

type CesCategory = Enums<'ces_category'>

const CATEGORY_LABEL: Record<CesCategory, string> = {
  battery: 'Battery',
  inverter: 'Inverter',
  panel: 'Panel',
  other: 'Other',
}

interface Props {
  stockId: number | 'new'
  onClose: () => void
  onCreated: (id: number) => void
}

interface Form {
  name: string
  category: CesCategory
  manufacturer: string
  model: string
  preferred_supplier_id: string
  last_cost: string
  qty: string
  kva: string
  kw: string
  kwh: string
  watts: string
  verified: boolean
}

const BLANK_FORM: Form = {
  name: '',
  category: 'other',
  manufacturer: '',
  model: '',
  preferred_supplier_id: '',
  last_cost: '0',
  qty: '0',
  kva: '',
  kw: '',
  kwh: '',
  watts: '',
  verified: false,
}

export default function StockDetailPanel({ stockId, onClose, onCreated }: Props) {
  const { isAdmin } = useAuth()
  const { stocks, suppliers, jobs, items, refresh } = useData()
  const stock = stockId === 'new' ? undefined : stocks.find((s) => s.id === stockId)

  const [form, setForm] = useState<Form>(BLANK_FORM)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (stockId === 'new') {
      setForm(BLANK_FORM)
    } else if (stock) {
      setForm({
        name: stock.name,
        category: stock.category,
        manufacturer: stock.manufacturer,
        model: stock.model,
        preferred_supplier_id: stock.preferred_supplier_id != null ? String(stock.preferred_supplier_id) : '',
        last_cost: String(stock.last_cost),
        qty: String(stock.qty),
        kva: stock.kva != null ? String(stock.kva) : '',
        kw: stock.kw != null ? String(stock.kw) : '',
        kwh: stock.kwh != null ? String(stock.kwh) : '',
        watts: stock.watts != null ? String(stock.watts) : '',
        verified: stock.verified,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockId, stock?.id])

  const alloc = stock ? allocatedMap(jobs, items)[stock.id] ?? 0 : 0
  const avail = stock ? stock.qty - alloc : Number(form.qty) || 0

  function note(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  function toPatch(): TablesInsert<'stocks'> {
    return {
      name: form.name.trim(),
      category: form.category,
      manufacturer: form.manufacturer.trim(),
      model: form.model.trim(),
      preferred_supplier_id: form.preferred_supplier_id ? Number(form.preferred_supplier_id) : null,
      last_cost: Number(form.last_cost) || 0,
      qty: Math.max(0, Number(form.qty) || 0),
      kva: form.kva ? Number(form.kva) : null,
      kw: form.kw ? Number(form.kw) : null,
      kwh: form.kwh ? Number(form.kwh) : null,
      watts: form.watts ? Number(form.watts) : null,
      verified: form.verified,
    }
  }

  async function save() {
    setErr(null)
    if (!form.name.trim()) {
      setErr('Name is required.')
      return
    }
    try {
      if (stockId === 'new') {
        const { data, error } = await supabase.from('stocks').insert(toPatch()).select('id').single()
        if (error) throw new Error(error.message)
        await refresh()
        onCreated(data.id)
        note('Item created')
      } else {
        const { error } = await supabase.from('stocks').update(toPatch()).eq('id', stockId)
        if (error) throw new Error(error.message)
        await refresh()
        note('Saved')
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  async function remove() {
    if (stockId === 'new') return
    setErr(null)
    try {
      const { error } = await supabase.from('stocks').delete().eq('id', stockId)
      if (error) throw new Error(error.message)
      await refresh()
      onClose()
    } catch (e) {
      setErr(
        e instanceof Error && e.message.includes('foreign key')
          ? 'This item is referenced by job stock lines and can’t be deleted.'
          : e instanceof Error
            ? e.message
            : String(e)
      )
    }
  }

  if (stockId !== 'new' && !stock) return <div className="detail-empty">Item not found.</div>

  return (
    <div className="jdp">
      <div className="jdp-header">
        <div className="jdp-title">
          <div className="jdp-name">{stockId === 'new' ? 'New stock item' : stock!.name || `Item #${stock!.id}`}</div>
          <span className="cat-tag" data-cat={form.category}>
            {CATEGORY_LABEL[form.category]}
          </span>
        </div>
        <button className="jdp-close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {err && <div className="login-error" style={{ marginBottom: 6 }}>{err}</div>}
      {toast && <div className="login-ok" style={{ marginBottom: 6 }}>{toast}</div>}

      <div className="jdp-section">
        <div className="jdp-section-title">Item Details</div>
        <div className="jdp-2col">
          <F label="Name" full>
            <input className="jdp-input" disabled={!isAdmin} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </F>
          <F label="Category">
            <select
              className="jdp-input"
              disabled={!isAdmin}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as CesCategory })}
            >
              {(Object.keys(CATEGORY_LABEL) as CesCategory[]).map((c) => (
                <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
              ))}
            </select>
          </F>
          <F label="Manufacturer">
            <input className="jdp-input" disabled={!isAdmin} value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} />
          </F>
          <F label="Model">
            <input className="jdp-input" disabled={!isAdmin} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </F>
        </div>
      </div>

      <div className="jdp-section">
        <div className="jdp-section-title">Stock Details</div>
        <div className="jdp-2col">
          <F label="Preferred supplier">
            <select
              className="jdp-input"
              disabled={!isAdmin}
              value={form.preferred_supplier_id}
              onChange={(e) => setForm({ ...form, preferred_supplier_id: e.target.value })}
            >
              <option value="">—</option>
              {suppliers.map((sp) => (
                <option key={sp.id} value={sp.id}>{sp.name}</option>
              ))}
            </select>
          </F>
          <F label="Last cost (AUD)">
            <input className="jdp-input" disabled={!isAdmin} type="number" min={0} step="0.01" value={form.last_cost} onChange={(e) => setForm({ ...form, last_cost: e.target.value })} />
          </F>
          <F label="On hand">
            <input className="jdp-input" disabled={!isAdmin} type="number" min={0} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
          </F>
          <F label="Allocated">
            <input className="jdp-input" disabled value={alloc} />
          </F>
          <F label="Available">
            <input className="jdp-input" disabled value={avail} style={avail < 0 ? { color: '#b3261e', fontWeight: 700 } : undefined} />
          </F>
        </div>
      </div>

      <div className="jdp-section">
        <div className="jdp-section-title">CEC Specification Details</div>
        <div className="jdp-2col">
          <F label="Inverter kVA">
            <input className="jdp-input" disabled={!isAdmin} type="number" min={0} value={form.kva} onChange={(e) => setForm({ ...form, kva: e.target.value })} />
          </F>
          <F label="Nominal kW">
            <input className="jdp-input" disabled={!isAdmin} type="number" min={0} value={form.kw} onChange={(e) => setForm({ ...form, kw: e.target.value })} />
          </F>
          <F label="Battery kWh">
            <input className="jdp-input" disabled={!isAdmin} type="number" min={0} value={form.kwh} onChange={(e) => setForm({ ...form, kwh: e.target.value })} />
          </F>
          <F label="Panel watts">
            <input className="jdp-input" disabled={!isAdmin} type="number" min={0} value={form.watts} onChange={(e) => setForm({ ...form, watts: e.target.value })} />
          </F>
          <F label="" full>
            <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13, cursor: isAdmin ? 'pointer' : 'default' }}>
              <input type="checkbox" disabled={!isAdmin} checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} />
              Verified against CEC listing
            </label>
          </F>
        </div>
      </div>

      {isAdmin && (
        <div className="jdp-save-row">
          <button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 14px' }} onClick={save}>
            {stockId === 'new' ? 'Create item' : 'Save details'}
          </button>
          {stockId !== 'new' && (
            <button className="btn btn-gray" style={{ fontSize: 12, padding: '7px 14px' }} onClick={remove}>
              🗑 Delete item
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function F({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={`jdp-field${full ? ' jdp-full' : ''}`}>
      {label && <span className="jdp-label">{label}</span>}
      {children}
    </div>
  )
}
