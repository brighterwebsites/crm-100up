import { ClipboardCheck, FileText, Link2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Customer, InstallationRequest, Job, JobStockItem, Manufacturer, Stock } from '../../lib/data'
import { supabase } from '../../lib/supabaseClient'
import { copyHtml, copyText } from '../../lib/clipboard'
import { matchStock, normalizePart } from '../../lib/normalizePart'
import { QUOTE_TYPE } from '../../lib/quotePayload'
import type { QuotePayload } from '../../lib/quotePayload'
import { assignQuoteBom, buildCes, updateJob } from './actions'

/* ── CES summary modal (copy-to-email HTML table) ─────────────── */

export function CesModal({
  job,
  customer,
  items,
  stocks,
  manufacturers,
  onClose,
}: {
  job: Job
  customer: Customer
  items: JobStockItem[]
  stocks: Stock[]
  manufacturers: Manufacturer[]
  onClose: () => void
}) {
  const { html, warnings } = useMemo(
    () => buildCes(job, customer, items, stocks, manufacturers),
    [job, customer, items, stocks, manufacturers],
  )
  const [copied, setCopied] = useState(false)

  async function copy() {
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    await copyHtml(html, tmp.innerText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong><ClipboardCheck size={14} aria-hidden /> CES summary — {customer.name}</strong>
          <button className="btn btn-gray" style={{ marginLeft: 'auto' }} onClick={onClose}>
            Close
          </button>
        </div>
        {warnings.length > 0 && (
          <div className="warn-box">
            {warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}
        <div className="ces-table-wrap" dangerouslySetInnerHTML={{ __html: html }} />
        <div className="row">
          <button className="btn btn-primary" onClick={copy}>
            {copied ? 'Copied' : 'Copy table for email'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Job order modal (persists to installation_requests table) ── */

export function JobOrderModal({
  job,
  existingIR,
  onClose,
  onSaved,
}: {
  job: Job
  existingIR: InstallationRequest | null
  onClose: () => void
  onSaved: () => void
}) {
  const defaultRef = `JO-${String(job.id).padStart(4, '0')}-${new Date().getFullYear()}`
  const [doc, setDoc] = useState({
    ref: existingIR?.job_order_ref || defaultRef,
    issued: existingIR?.issued_date || new Date().toLocaleDateString('en-CA'),
  })
  const [err, setErr] = useState<string | null>(null)

  // Note: no booking-date input — booking dates change only via Advance /
  // Reschedule; the DB guard trigger would reject the write anyway.
  async function save() {
    setErr(null)
    try {
      const { error } = await supabase.from('installation_requests').upsert(
        {
          job_id: job.id,
          job_order_ref: doc.ref,
          issued_date: doc.issued || null,
        },
        { onConflict: 'job_id' },
      )
      if (error) throw new Error(error.message)
      onSaved()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const set = (k: keyof typeof doc) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDoc({ ...doc, [k]: e.target.value })

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong><FileText size={14} aria-hidden /> Job order — {doc.ref}</strong>
          <button className="btn btn-gray" style={{ marginLeft: 'auto' }} onClick={onClose}>
            Close
          </button>
        </div>
        {err && <div className="login-error">{err}</div>}
        <div className="form-grid">
          <label>
            Job order ref
            <input value={doc.ref} onChange={set('ref')} />
          </label>
          <label>
            Issued date
            <input type="date" value={doc.issued} onChange={set('issued')} />
          </label>
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={save}>
            Save job order
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Link calculator quote (paste-JSON bridge, port of openLinkQuote/
      parseLinkQuote/applyLinkQuote lines 5614-5790) ─────────────── */

/* QuotePayload now lives in lib/quotePayload.ts — the Calculator builds one
   and this modal consumes it, so the shape belongs to neither end. */

export function LinkQuoteModal({
  job,
  stocks,
  onClose,
  onDone,
}: {
  job: Job
  stocks: Stock[]
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [raw, setRaw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [setValue, setSetValue] = useState(true)
  const [parsed, setParsed] = useState<QuotePayload | null>(null)

  /* A v2 payload from the rebuilt Calculator carries the stock id on every
     line, so it needs no matching at all. Name matching stays for v1 payloads
     pasted out of V46, which have nothing else to go on. */
  const mapped = useMemo(() => {
    if (!parsed?.bom) return []
    const byId = new Map(stocks.map((s) => [s.id, s]))
    return parsed.bom.map((line) => ({
      line,
      stock: (line.stockId != null ? byId.get(line.stockId) : undefined)
        ?? matchStock(line.name, stocks),
      canonical: normalizePart(line.name).name ?? line.name,
    }))
  }, [parsed, stocks])

  function parse() {
    setErr(null)
    try {
      const q = JSON.parse(raw) as QuotePayload
      if (q.type !== QUOTE_TYPE) throw new Error('Not a 100UP quote payload — copy it from the calculator’s "Send to CRM" button.')
      setParsed(q)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not parse the pasted JSON.')
    }
  }

  async function apply() {
    if (!parsed) return
    setErr(null)
    try {
      const status = job.planned_install_date ? 'assigned' : 'pending'
      const unmatched = await assignQuoteBom(
        job.id,
        job.planned_install_date,
        mapped.map((m) => ({ qty: m.line.qty, stock: m.stock, name: m.line.name })),
      )
      await updateJob(job, {
        system_description: parsed.system ?? job.system_description,
        ...(setValue && parsed.price ? { value: parsed.price } : {}),
      })
      onDone(
        unmatched.length
          ? `Quote linked — ${unmatched.length} line(s) had no matching stock item: ${unmatched.join(', ')}`
          : status === 'pending'
            ? 'Quote linked — parts will auto-assign when the install is booked.'
            : 'Quote linked — parts assigned.'
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong><Link2 size={14} aria-hidden /> Link calculator quote — #{job.id}</strong>
          <button className="btn btn-gray" style={{ marginLeft: 'auto' }} onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mutedtext">
          In the calculator, press <em>Send system to CRM</em> (copies the quote JSON), then paste it here.
        </p>
        {err && <div className="login-error">{err}</div>}
        {!parsed ? (
          <>
            <textarea
              rows={6}
              placeholder='{"v":1,"type":"100up-quote", …}'
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
            />
            <div className="row">
              <button className="btn btn-primary" onClick={parse}>
                Parse quote
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="stock-block">
              <div className="stock-block-title">{parsed.system ?? 'Quoted system'}</div>
              {mapped.map((m, i) => (
                <div key={i} className="stock-line">
                  <span>
                    {m.line.name}
                    {!m.stock && <span className="short-pill">no stock match</span>}
                  </span>
                  <span>× {m.line.qty}</span>
                </div>
              ))}
            </div>
            {parsed.price != null && (
              <label className="check-label">
                <input type="checkbox" checked={setValue} onChange={(e) => setSetValue(e.target.checked)} />
                Set job value to ${Math.round(parsed.price).toLocaleString()}
              </label>
            )}
            <div className="row">
              <button className="btn btn-primary" onClick={apply}>
                Apply to job
              </button>
              <button className="btn btn-gray" onClick={() => setParsed(null)}>
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ── Copy a parts list as plain text (order list / PO helper) ──── */
export async function copyPartsList(lines: { name: string; qty: number }[]): Promise<void> {
  await copyText(lines.map((l) => `${l.qty}× ${l.name}`).join('\n'))
}
