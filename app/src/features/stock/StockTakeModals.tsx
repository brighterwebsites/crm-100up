import { ClipboardList, Printer } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useData } from '../../lib/data'
import type { StockTake } from '../../lib/data'
import { PRODUCT_TYPE_LABEL } from '../../lib/productTypes'
import type { ProductType } from '../../lib/productTypes'
import { openPrintWindow } from '../jobs/actions'
import { ALL_TYPES, DEFAULT_EXCLUDED, buildStockTakeHtml, countGroups, countable, createStockTake } from './stockTake'

/** Pick product types, then create the stock take. The ST number exists from
 * this moment, so it is on the sheet that gets printed. */
export function NewStockTakeModal({ onClose, onCreated }: { onClose: () => void; onCreated: (take: StockTake) => void }) {
  const { stocks, refresh } = useData()
  const [types, setTypes] = useState<ProductType[]>(ALL_TYPES.filter((t) => !DEFAULT_EXCLUDED.includes(t)))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const itemCount = countable(stocks, types).length

  function toggle(t: ProductType) {
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))
  }

  async function create() {
    setErr(null)
    setBusy(true)
    try {
      const take = await createStockTake(types)
      await refresh()
      onCreated(take)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong><ClipboardList size={14} aria-hidden /> New stock take</strong>
          <button className="btn btn-gray" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
        </div>
        {err && <div className="login-error">{err}</div>}
        <div className="mutedtext">Tick the product types to count. The sheet is grouped by type, then supplier, then name.</div>
        <div className="stocktake-types">
          {ALL_TYPES.map((t) => {
            const n = countable(stocks, [t]).length
            return (
              <label key={t} className="stocktake-type">
                <input type="checkbox" checked={types.includes(t)} onChange={() => toggle(t)} disabled={n === 0} />
                {PRODUCT_TYPE_LABEL[t]} <span className="mutedtext">({n})</span>
              </label>
            )
          })}
        </div>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || itemCount === 0} onClick={create}>
            <Printer size={13} aria-hidden /> {busy ? 'Creating…' : `Create stock take & preview sheet (${itemCount} items)`}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Preview then print: the preview is the document itself in an iframe, so
 * what is on screen is what prints. Reopening an open stock take reprints the
 * same snapshot, date included. */
export function StockTakeSheetModal({ take, onClose }: { take: StockTake; onClose: () => void }) {
  const { stocks, suppliers, stockTakeLines } = useData()
  const frame = useRef<HTMLIFrameElement>(null)
  const html = useMemo(
    () => buildStockTakeHtml(take, countGroups(stockTakeLines.filter((l) => l.stock_take_id === take.id), stocks, suppliers)),
    [take, stockTakeLines, stocks, suppliers],
  )

  function print() {
    const w = frame.current?.contentWindow
    // Some browsers refuse print() on a srcdoc frame; fall back to a window.
    if (!w) {
      openPrintWindow(html)
      return
    }
    try {
      w.focus()
      w.print()
    } catch {
      openPrintWindow(html)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong><ClipboardList size={14} aria-hidden /> Stock take sheet — {take.ref}</strong>
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={print}>
            <Printer size={13} aria-hidden /> Print / Save PDF
          </button>
          <button className="btn btn-gray" onClick={onClose}>Close</button>
        </div>
        <iframe ref={frame} className="sheet-frame" title={`Stock take sheet ${take.ref}`} srcDoc={html} />
      </div>
    </div>
  )
}
