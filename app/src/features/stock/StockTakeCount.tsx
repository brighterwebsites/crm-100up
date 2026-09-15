import { Check, Save, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useData } from '../../lib/data'
import type { StockTake } from '../../lib/data'
import { PRODUCT_TYPE_LABEL } from '../../lib/productTypes'
import { applyStockTake, countGroups, saveStockTakeCounts } from './stockTake'

/** Count mode: the stock take's items in the same order as the printed sheet,
 * each with a Counted box. Blank means not counted; apply leaves it alone. */
export default function StockTakeCount({ take, onExit }: { take: StockTake; onExit: () => void }) {
  const { stocks, suppliers, stockTakeLines, refresh } = useData()
  const lines = useMemo(() => stockTakeLines.filter((l) => l.stock_take_id === take.id), [stockTakeLines, take.id])
  const groups = useMemo(() => countGroups(lines, stocks, suppliers), [lines, stocks, suppliers])
  const rows = groups.flatMap((g) => g.rows)

  const saved = useMemo(
    () => Object.fromEntries(lines.map((l) => [l.stock_id, l.qty_counted === null ? '' : String(l.qty_counted)])) as Record<number, string>,
    [lines],
  )
  // Filled once, not re-synced: the app refreshes on any change anywhere, and
  // re-syncing would wipe counts typed but not yet saved.
  const [draft, setDraft] = useState<Record<number, string>>(saved)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const parse = (v: string | undefined): number | null | 'bad' => {
    if (v === undefined || v.trim() === '') return null
    const n = Number(v)
    return Number.isInteger(n) && n >= 0 ? n : 'bad'
  }
  const invalid = rows.filter((r) => parse(draft[r.stock.id]) === 'bad')
  const counted = rows.filter((r) => typeof parse(draft[r.stock.id]) === 'number').length
  const dirty = rows.some((r) => (draft[r.stock.id] ?? '') !== (saved[r.stock.id] ?? ''))

  async function save(): Promise<boolean> {
    if (invalid.length) {
      setErr(`Counts must be whole numbers, 0 or more. Check: ${invalid.map((r) => r.stock.name).join(', ')}`)
      return false
    }
    setErr(null)
    setBusy(true)
    try {
      await saveStockTakeCounts(
        take,
        rows.map((r) => ({ stock_id: r.stock.id, qty_counted: parse(draft[r.stock.id]) as number | null })),
      )
      await refresh()
      setToast('Counts saved')
      setTimeout(() => setToast(null), 2000)
      return true
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (counted === 0) {
      setErr('Enter at least one count before applying.')
      return
    }
    const msg =
      `Apply ${take.ref}? On hand will be set to the counted figure for ${counted} item${counted === 1 ? '' : 's'}. ` +
      `Items left blank stay as they are. This can't be undone.`
    if (!confirm(msg)) return
    if (!(await save())) return
    setBusy(true)
    try {
      await applyStockTake(take)
      await refresh()
      onExit()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  function exit() {
    if (dirty && !confirm('Leave count mode? Counts you have not saved will be lost.')) return
    onExit()
  }

  return (
    <div className="card table-wrap">
      <div className="stocktake-banner">
        <strong>Counting {take.ref}</strong>
        <span>{counted} of {rows.length} counted</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="btn btn-gray" disabled={busy || !dirty} onClick={save}>
            <Save size={13} aria-hidden /> Save counts
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={apply}>
            <Check size={13} aria-hidden /> Apply stock take
          </button>
          <button className="btn btn-gray" disabled={busy} onClick={exit}>
            <X size={13} aria-hidden /> Exit count mode
          </button>
        </span>
      </div>
      {err && <div className="login-error" style={{ margin: '0 0 8px' }}>{err}</div>}
      {toast && <div className="login-ok" style={{ margin: '0 0 8px' }}>{toast}</div>}
      <table className="table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Item</th>
            <th>Type</th>
            <th title="On hand when the sheet was printed">On sheet</th>
            <th title="On hand now. Differs from the sheet if stock moved since printing">On hand now</th>
            <th>Counted</th>
            <th title="Counted minus on hand now: what applying will change">Change</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g.type} label={PRODUCT_TYPE_LABEL[g.type]}>
              {g.rows.map((r) => {
                const idx = rows.indexOf(r)
                const val = parse(draft[r.stock.id])
                const change = typeof val === 'number' ? val - r.stock.qty : null
                return (
                  <tr key={r.stock.id}>
                    <td style={{ textAlign: 'left' }}>
                      <strong>{r.stock.name}</strong>
                      {r.supplierName && <div className="mutedtext" style={{ fontSize: 11 }}>{r.supplierName}</div>}
                    </td>
                    <td>{PRODUCT_TYPE_LABEL[r.stock.product_type]}</td>
                    <td>{r.line.qty_printed}</td>
                    <td style={r.stock.qty !== r.line.qty_printed ? { fontWeight: 700 } : undefined}>{r.stock.qty}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        className="jdp-input"
                        style={{ width: 80, textAlign: 'center', ...(val === 'bad' ? { borderColor: 'var(--danger)' } : null) }}
                        data-count-idx={idx}
                        value={draft[r.stock.id] ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [r.stock.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          // Enter moves down the list, the way the sheet is read.
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            document.querySelector<HTMLInputElement>(`[data-count-idx="${idx + 1}"]`)?.focus()
                          }
                        }}
                      />
                    </td>
                    <td
                      style={{
                        fontWeight: change ? 700 : undefined,
                        color: change === null || change === 0 ? 'var(--muted)' : change < 0 ? 'var(--danger)' : undefined,
                      }}
                    >
                      {change === null ? '' : change > 0 ? `+${change}` : change}
                    </td>
                  </tr>
                )
              })}
            </GroupRows>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupRows({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={6} className="stocktake-group">{label}</td>
      </tr>
      {children}
    </>
  )
}
