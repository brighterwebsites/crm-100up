import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useData } from '../../lib/data'
import type { Customer, Job } from '../../lib/data'
import { PIPELINE, isClosed, nextStepNeedsDate, stepLabel } from '../../lib/pipeline'
import { bookedInstalls, computeJobShortfalls } from '../../lib/stockCalc'
import { fmtDate, todayISO } from '../../lib/format'
import { copyText } from '../../lib/clipboard'
import {
  advanceJob,
  applyPendingNow,
  jobDetailsText,
  moveJobBack,
  rescheduleBooking,
  updateJob,
} from './actions'
import { supabase } from '../../lib/supabaseClient'
import { CesModal, JobOrderModal, LinkQuoteModal, printJobPo } from './modals'

export default function JobDetail({ job, onClose }: { job: Job; onClose: () => void }) {
  const { isAdmin } = useAuth()
  const { items, stocks, suppliers, cesSpecs, profiles, refresh, jobs, customers, installationRequests } = useData()
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [dateAsk, setDateAsk] = useState<null | { field: string; label: string }>(null)
  const [dateVal, setDateVal] = useState(todayISO())
  const [showCes, setShowCes] = useState(false)
  const [showJo, setShowJo] = useState(false)
  const [showLink, setShowLink] = useState(false)
  const [reschedule, setReschedule] = useState(false)

  const customer: Customer | undefined = customers.find((c) => c.id === job.customer_id)
  const existingIR = installationRequests.find((ir) => ir.job_id === job.id) ?? null

  // ── Job form state (non-customer fields) ──
  const [jobForm, setJobForm] = useState({
    location: job.location,
    system_description: job.system_description,
    value: String(job.value ?? 0),
    job_type: job.job_type,
    assigned_installer_id: job.assigned_installer_id ?? '',
    notes: job.notes,
    fixes_needed: job.fixes_needed,
  })
  // ── Customer form state (admin-editable contact fields) ──
  const [custForm, setCustForm] = useState({
    name: customer?.name ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    contact_method: customer?.contact_method ?? 'Email',
    address: customer?.address ?? '',
  })

  useEffect(() => {
    setJobForm({
      location: job.location,
      system_description: job.system_description,
      value: String(job.value ?? 0),
      job_type: job.job_type,
      assigned_installer_id: job.assigned_installer_id ?? '',
      notes: job.notes,
      fixes_needed: job.fixes_needed,
    })
  }, [job])

  useEffect(() => {
    setCustForm({
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      email: customer?.email ?? '',
      contact_method: customer?.contact_method ?? 'Email',
      address: customer?.address ?? '',
    })
  }, [customer])

  const jobItems = useMemo(() => items.filter((i) => i.job_id === job.id), [items, job.id])
  const pending = jobItems.filter((i) => i.status === 'pending')
  const assigned = jobItems.filter((i) => i.status === 'assigned')
  const consumed = jobItems.filter((i) => i.status === 'consumed')
  const shortMap = useMemo(
    () =>
      job.planned_install_date || job.install_completion_date
        ? computeJobShortfalls(jobs, items, stocks)[job.id] ?? {}
        : {},
    [jobs, items, stocks, job],
  )

  const stage = PIPELINE[job.stage]
  const closed = isClosed(job.stage, job.step)
  const stockName = (id: number) => stocks.find((s) => s.id === id)?.name ?? `#${id}`

  function note(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setErr(null)
    try {
      await fn()
      await refresh()
      if (okMsg) note(okMsg)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErr(msg.includes('version_conflict') ? 'This job changed on another device — data refreshed, please retry.' : msg)
      await refresh()
    }
  }

  function handleAdvance() {
    const need = nextStepNeedsDate(job.stage, job.step)
    if (need) {
      setDateVal(todayISO())
      setDateAsk({
        field: need,
        label:
          need === 'planned_install_date'
            ? 'Install booking date'
            : need === 'install_start_date'
              ? 'Install start date'
              : 'Install completion date',
      })
      return
    }
    run(() => advanceJob(job), 'Job advanced')
  }

  const clashes = useMemo(() => bookedInstalls(jobs, job.id), [jobs, job.id])
  const clashOnDate = clashes.filter((c) => c.date === dateVal)

  async function saveDetails() {
    const jobPatch = isAdmin
      ? {
          location: jobForm.location,
          system_description: jobForm.system_description,
          value: Number(jobForm.value) || 0,
          job_type: jobForm.job_type,
          assigned_installer_id: jobForm.assigned_installer_id || null,
          notes: jobForm.notes,
          fixes_needed: jobForm.fixes_needed,
        }
      : { notes: jobForm.notes, fixes_needed: jobForm.fixes_needed }

    await run(async () => {
      await updateJob(job, jobPatch)
      if (isAdmin && customer) {
        const { error } = await supabase
          .from('customers')
          .update({
            name: custForm.name,
            phone: custForm.phone,
            email: custForm.email,
            contact_method: custForm.contact_method,
            address: custForm.address,
          })
          .eq('id', customer.id)
          .eq('version', customer.version)
        if (error) throw new Error(error.message)
      }
    }, 'Saved')
  }

  async function addStock(stockId: number, qty: number) {
    await run(async () => {
      const existing = assigned.find((i) => i.stock_id === stockId)
      if (existing) {
        const { error } = await supabase
          .from('job_stock_items')
          .update({ qty: existing.qty + qty })
          .eq('id', existing.id)
        if (error) throw new Error(error.message)
      } else {
        const { error } = await supabase
          .from('job_stock_items')
          .insert({ job_id: job.id, stock_id: stockId, qty, status: 'assigned', assigned_at: new Date().toISOString() })
        if (error) throw new Error(error.message)
      }
    }, 'Stock assigned')
  }

  async function removeStock(itemId: number) {
    await run(async () => {
      const { error } = await supabase.from('job_stock_items').delete().eq('id', itemId)
      if (error) throw new Error(error.message)
    }, 'Removed')
  }

  const canCes = job.stage === 4 || (job.stage === 3 && !!job.planned_install_date)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{customer?.name ?? `Job #${job.id}`}</strong>
          <span className="stage-chip" style={{ background: stage.light, color: stage.text }}>
            {stage.short} › {stepLabel(job.stage, job.step)}
          </span>
          <button className="btn btn-gray" style={{ marginLeft: 'auto' }} onClick={onClose}>
            Close
          </button>
        </div>

        {err && <div className="login-error">{err}</div>}
        {toast && <div className="login-ok">{toast}</div>}

        {/* ── Pipeline controls ── */}
        <section className="section">
          <div className="section-title">Pipeline</div>
          <div className="row">
            {!closed && (
              <button className="btn btn-primary" onClick={handleAdvance}>
                Advance → {nextLabel(job)}
              </button>
            )}
            {(job.stage > 1 || job.step > 0) && (
              <button className="btn btn-gray" onClick={() => run(() => moveJobBack(job), 'Moved back')}>
                ← Move back
              </button>
            )}
            {isAdmin && job.planned_install_date && !job.install_completion_date && (
              <button className="btn btn-gray" onClick={() => setReschedule(!reschedule)}>
                📅 Reschedule booking
              </button>
            )}
          </div>
          <div className="date-strip">
            {job.planned_install_date && <span>📅 Booked {fmtDate(job.planned_install_date)}</span>}
            {job.install_start_date && <span>🔧 Started {fmtDate(job.install_start_date)}</span>}
            {job.install_completion_date && <span>✅ Installed {fmtDate(job.install_completion_date)}</span>}
            {job.ces_submitted && <span>📋 CES sub {fmtDate(job.ces_submitted)}</span>}
            {job.ces_received && <span>📋 CES rec {fmtDate(job.ces_received)}</span>}
            {job.rebate_submitted && <span>💰 Rebate sub {fmtDate(job.rebate_submitted)}</span>}
            {job.rebate_received && <span>💰 Rebate rec {fmtDate(job.rebate_received)}</span>}
          </div>
          {reschedule && (
            <DatePick
              label="New booking date"
              value={dateVal}
              onChange={setDateVal}
              clashes={clashOnDate}
              allBooked={clashes}
              onConfirm={() => {
                setReschedule(false)
                run(() => rescheduleBooking(job, dateVal), 'Rebooked')
              }}
              onCancel={() => setReschedule(false)}
            />
          )}
          {dateAsk && (
            <DatePick
              label={dateAsk.label}
              value={dateVal}
              onChange={setDateVal}
              clashes={dateAsk.field === 'planned_install_date' ? clashOnDate : []}
              allBooked={dateAsk.field === 'planned_install_date' ? clashes : []}
              onConfirm={() => {
                setDateAsk(null)
                run(() => advanceJob(job, dateVal), 'Job advanced')
              }}
              onCancel={() => setDateAsk(null)}
            />
          )}
        </section>

        {/* ── Details ── */}
        <section className="section">
          <div className="section-title">Details</div>
          <div className="form-grid">
            <label>
              Customer name
              <input
                disabled={!isAdmin}
                value={custForm.name}
                onChange={(e) => setCustForm({ ...custForm, name: e.target.value })}
              />
            </label>
            <label>
              Location
              <input
                disabled={!isAdmin}
                value={jobForm.location}
                onChange={(e) => setJobForm({ ...jobForm, location: e.target.value })}
              />
            </label>
            <label>
              Phone
              <input
                disabled={!isAdmin}
                value={custForm.phone}
                onChange={(e) => setCustForm({ ...custForm, phone: e.target.value })}
              />
            </label>
            <label>
              Email
              <input
                disabled={!isAdmin}
                value={custForm.email}
                onChange={(e) => setCustForm({ ...custForm, email: e.target.value })}
              />
            </label>
            <label>
              System
              <input
                disabled={!isAdmin}
                value={jobForm.system_description}
                onChange={(e) => setJobForm({ ...jobForm, system_description: e.target.value })}
              />
            </label>
            <label>
              Value (AUD)
              <input
                disabled={!isAdmin}
                type="number"
                value={jobForm.value}
                onChange={(e) => setJobForm({ ...jobForm, value: e.target.value })}
              />
            </label>
            <label>
              Job type
              <select
                disabled={!isAdmin}
                value={jobForm.job_type}
                onChange={(e) => setJobForm({ ...jobForm, job_type: e.target.value as 'install' | 'service' })}
              >
                <option value="install">🔧 New install</option>
                <option value="service">🛠 Service / upgrade</option>
              </select>
            </label>
            <label>
              Assigned installer
              <select
                disabled={!isAdmin}
                value={jobForm.assigned_installer_id}
                onChange={(e) => setJobForm({ ...jobForm, assigned_installer_id: e.target.value })}
              >
                <option value="">— unassigned —</option>
                {profiles
                  .filter((p) => p.role === 'installer')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name || p.id.slice(0, 8)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label className="notes-label">
            Notes
            <textarea rows={4} value={jobForm.notes} onChange={(e) => setJobForm({ ...jobForm, notes: e.target.value })} />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={jobForm.fixes_needed}
              onChange={(e) => setJobForm({ ...jobForm, fixes_needed: e.target.checked })}
            />
            Fixes needed
          </label>
          <div className="row">
            <button className="btn btn-primary" onClick={saveDetails}>
              Save details
            </button>
          </div>
        </section>

        {/* ── Stock ── */}
        <section className="section">
          <div className="section-title">Stock</div>
          {pending.length > 0 && (
            <div className="stock-block">
              <div className="stock-block-title">Pending (from linked quote — auto-assigns on booking)</div>
              {pending.map((i) => (
                <div key={i.id} className="stock-line">
                  <span>{stockName(i.stock_id)}</span>
                  <span>× {i.qty}</span>
                </div>
              ))}
              {isAdmin && (
                <button className="btn btn-gray" onClick={() => run(() => applyPendingNow(job.id), 'Assigned now')}>
                  Assign now
                </button>
              )}
            </div>
          )}
          <div className="stock-block">
            <div className="stock-block-title">Assigned</div>
            {assigned.length === 0 && <div className="mutedtext">No stock assigned.</div>}
            {assigned.map((i) => (
              <div key={i.id} className="stock-line">
                <span>
                  {stockName(i.stock_id)}
                  {shortMap[i.stock_id] ? <span className="short-pill"> ⚠ {shortMap[i.stock_id]} short</span> : null}
                </span>
                <span>
                  × {i.qty}
                  {isAdmin && (
                    <button className="btn-x" title="Remove" onClick={() => removeStock(i.id)}>
                      ✕
                    </button>
                  )}
                </span>
              </div>
            ))}
            {isAdmin && <AddStockRow stocks={stocks} onAdd={addStock} />}
          </div>
          {consumed.length > 0 && (
            <div className="stock-block">
              <div className="stock-block-title">Consumed at install</div>
              {consumed.map((i) => (
                <div key={i.id} className="stock-line consumed">
                  <span>{stockName(i.stock_id)}</span>
                  <span>× {i.qty}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Documents / output ── */}
        <section className="section">
          <div className="section-title">Documents</div>
          <div className="row wrap">
            <button
              className="btn btn-gray"
              onClick={async () => {
                if (!customer) return
                await copyText(jobDetailsText(job, customer, items, stocks))
                note('📋 Copied — paste into email or SMS!')
              }}
            >
              📋 Copy details
            </button>
            {canCes && (
              <button className="btn btn-gray" onClick={() => setShowCes(true)}>
                📋 CES summary
              </button>
            )}
            {isAdmin && (
              <>
                <button className="btn btn-gray" onClick={() => setShowJo(true)}>
                  📄 Job order
                </button>
                <button
                  className="btn btn-gray"
                  onClick={() =>
                    printJobPo(job, customer?.name ?? `Job #${job.id}`, assigned.length ? assigned : pending, stocks, suppliers)
                  }
                >
                  🖨 Purchase order
                </button>
                <button className="btn btn-gray" onClick={() => setShowLink(true)}>
                  🔗 Link calculator quote
                </button>
              </>
            )}
          </div>
        </section>

        {showCes && customer && (
          <CesModal
            job={job}
            customer={customer}
            items={items}
            stocks={stocks}
            cesSpecs={cesSpecs}
            onClose={() => setShowCes(false)}
          />
        )}
        {showJo && (
          <JobOrderModal
            job={job}
            existingIR={existingIR}
            onClose={() => setShowJo(false)}
            onSaved={() => refresh()}
          />
        )}
        {showLink && (
          <LinkQuoteModal
            job={job}
            stocks={stocks}
            onClose={() => setShowLink(false)}
            onDone={(msg) => {
              setShowLink(false)
              refresh()
              note(msg)
            }}
          />
        )}
      </div>
    </div>
  )
}

function nextLabel(job: Job): string {
  const maxStep = PIPELINE[job.stage].steps.length - 1
  if (job.step < maxStep) return stepLabel(job.stage, job.step + 1)
  if (job.stage < 4) return stepLabel(job.stage + 1, 0)
  return 'Done'
}

function DatePick(props: {
  label: string
  value: string
  onChange: (v: string) => void
  clashes: { date: string; job: Job }[]
  allBooked: { date: string; job: Job }[]
  onConfirm: () => void
  onCancel: () => void
}) {
  const { customers } = useData()
  const customerName = (j: Job) => customers.find((c) => c.id === j.customer_id)?.name ?? `Job #${j.id}`
  return (
    <div className="datepick">
      <label>
        {props.label}
        <input type="date" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      </label>
      {props.clashes.length > 0 && (
        <div className="clash-warn">
          ⚠ Same-day clash: {props.clashes.map((c) => customerName(c.job)).join(', ')} already booked on this date.
        </div>
      )}
      {props.allBooked.length > 0 && (
        <div className="booked-list">
          Booked installs: {props.allBooked.map((c) => `${fmtDate(c.date)} — ${customerName(c.job)}`).join(' · ')}
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" onClick={props.onConfirm}>
          Confirm
        </button>
        <button className="btn btn-gray" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function AddStockRow({
  stocks,
  onAdd,
}: {
  stocks: { id: number; name: string; qty: number }[]
  onAdd: (stockId: number, qty: number) => void
}) {
  const [sel, setSel] = useState('')
  const [qty, setQty] = useState('1')
  return (
    <div className="add-stock-row">
      <select value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">+ Add stock item…</option>
        {stocks.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.qty} on hand)
          </option>
        ))}
      </select>
      <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 64 }} />
      <button
        className="btn btn-gray"
        disabled={!sel || Number(qty) < 1}
        onClick={() => {
          onAdd(Number(sel), Number(qty))
          setSel('')
          setQty('1')
        }}
      >
        Add
      </button>
    </div>
  )
}
