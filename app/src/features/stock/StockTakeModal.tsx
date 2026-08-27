import { Package, Printer } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { openPrintWindow } from '../jobs/actions'
import { buildStockTakeHtml, stockTakeRef } from './stockTakeSheet'
import type { SheetInput } from './stockTakeSheet'

/**
 * Preview-then-print, rather than straight to a print dialog: a count sheet
 * is only useful if it covers the right shelves, and the filter it was built
 * from is easier to check on screen than in a print preview. The preview is
 * the document itself in an iframe, so what is on screen is what prints.
 */
export default function StockTakeModal({ input, onClose }: { input: SheetInput; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const html = useMemo(() => buildStockTakeHtml(input), [input])

  function print() {
    const w = frame.current?.contentWindow
    // Fall back to a real window if the iframe cannot be driven (some
    // browsers refuse print() on a srcdoc frame).
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
          <strong>
            <Package size={14} aria-hidden /> Stock take sheet preview — {stockTakeRef()}
          </strong>
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={print}>
            <Printer size={13} aria-hidden /> Print / Save PDF
          </button>
          <button className="btn btn-gray" onClick={onClose}>
            Close
          </button>
        </div>
        <iframe ref={frame} className="sheet-frame" title="Stock take sheet" srcDoc={html} />
      </div>
    </div>
  )
}
