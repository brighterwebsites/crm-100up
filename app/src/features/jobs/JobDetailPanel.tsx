/**
 * JobDetailPanel — the new primary job detail component.
 * Used both as the always-visible right panel in CustomerJobsPage
 * and as the slide-in panel in PipelinePage.
 *
 * No modal wrapper — the parent decides how to frame it.
 */
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useData } from '../../lib/data'
import type { Customer, InstallationRequest, Job } from '../../lib/data'
import { PIPELINE, isClosed, nextStepNeedsDate, stepLabel } from '../../lib/pipeline'
import { bookedInstalls, computeJobShortfalls } from '../../lib/stockCalc'
import { fmtDate, todayISO } from '../../lib/format'
import { copyText } from '../../lib/clipboard'
import { advanceJob, applyPendingNow, jobDetailsText, moveJobBack, rescheduleBooking, updateJob } from './actions'
import { supabase } from '../../lib/supabaseClient'
import { CesModal, LinkQuoteModal, printJobPo } from './modals'

interface Props {
  jobId: number
  onClose?: () => void
}

export default function JobDetailPanel({ jobId, onClose }: Props) {
  const { isAdmin } = useAuth()
  const { jobs, customers, items, stocks, suppliers, cesSpecs, profiles, installationRequests, refresh } = useData()

  const job = jobs.find((j) => j.id === jobId)
  const customer: Customer | undefined = job ? customers.find((c) => c.id === job.customer_id) : undefined
  const ir: InstallationRequest | undefined = installationRequests.find((r) => r.job_id === jobId)

  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [dateAsk, setDateAsk] = useState<null | { field: string; label: string }>(null)
  const [dateVal, setDateVal] = useState(todayISO())
  const [reschedule, setReschedule] = useState(false)
  const [showCes, setShowCes] = useState(false)
  const [showLink, setShowLink] = useState(false)

  // ── job form state ──
  const [jobForm, setJobForm] = useState(jobFormFrom(job))
  useEffect(() => { setJobForm(jobFormFrom(job)) }, [job])

  // ── customer form state ──
  const [custForm, setCustForm] = useState(custFormFrom(customer))
  useEffect(() => { setCustForm(custFormFrom(customer)) }, [customer])

  // ── installation request form state ──
  const [irForm, setIrForm] = useState(irFormFrom(ir))
  useEffect(() => { setIrForm(irFormFrom(ir)) }, [ir])

  const jobItems = useMemo(() => items.filter((i) => i.job_id === jobId), [items, jobId])
  const pending  = jobItems.filter((i) => i.status === 'pending')
  const assigned = jobItems.filter((i) => i.status === 'assigned')
  const consumed = jobItems.filter((i) => i.status === 'consumed')
  const shortMap = useMemo(
    () => computeJobShortfalls(jobs, items, stocks)[jobId] ?? {},
    [jobs, items, stocks, jobId],
  )
  const clashes = useMemo(() => bookedInstalls(jobs, jobId), [jobs, jobId])
  const clashOnDate = clashes.filter((c) => c.date === dateVal)
  const stockName = (id: number) => stocks.find((s) => s.id === id)?.name ?? `#${id}`
  const installerName = (uid: string | null) => {
    if (!uid) return '— unassigned —'
    return profiles.find((p) => p.id === uid)?.full_name || uid.slice(0, 8)
  }

  // Has stock shortage?
  const hasShortage = Object.keys(shortMap).length > 0
  // Is install overdue?
  const isOverdue =
    job?.planned_install_date != null &&
    !job.install_completion_date &&
    new Date(job.planned_install_date) < new Date(new Date().toDateString())

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
      setErr(msg.includes('version_conflict') ? 'This job changed on another device — refreshed, please retry.' : msg)
      await refresh()
    }
  }

  function handleAdvance() {
    if (!job) return
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

  async function saveJobAndCustomer() {
    if (!job) return
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

  async function saveIR() {
    if (!job) return
    await run(async () => {
      const { error } = await supabase.from('installation_requests').upsert(
        {
          job_id: job.id,
          job_order_ref: irForm.ref,
          issued_date: irForm.issued || null,
          vehicle: irForm.vehicle,
          site_access_notes: irForm.siteAccess,
          special_instructions: irForm.specialInstructions,
          additional_notes: irForm.extraNotes,
        },
        { onConflict: 'job_id' },
      )
      if (error) throw new Error(error.message)
    }, 'Saved')
  }

  async function addStock(stockId: number, qty: number) {
    if (!job) return
    await run(async () => {
      const existing = assigned.find((i) => i.stock_id === stockId)
      if (existing) {
        const { error } = await supabase.from('job_stock_items').update({ qty: existing.qty + qty }).eq('id', existing.id)
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

  if (!job) return <div className="detail-empty">Job not found.</div>

  const stage = PIPELINE[job.stage]
  const closed = isClosed(job.stage, job.step)
  const canCes = job.stage === 4 || (job.stage === 3 && !!job.planned_install_date)

  return (
    <div className="jdp">
      {/* ── Header ── */}
      <div className="jdp-header">
        <div className="jdp-title">
          <div className="jdp-name">{customer?.name ?? `Job #${job.id}`}</div>
          <span className="stage-chip" style={{ background: stage.light, color: stage.text, marginTop: 4, display: 'inline-block' }}>
            {stage.short} › {stepLabel(job.stage, job.step)}
          </span>
        </div>
        {onClose && (
          <button className="jdp-close" onClick={onClose} title="Close">
            ✕
          </button>
        )}
      </div>

      {err  && <div className="login-error"  style={{ marginBottom: 6 }}>{err}</div>}
      {toast && <div className="login-ok" style={{ marginBottom: 6 }}>{toast}</div>}

      {/* ── Pipeline controls ── */}
      <div className="jdp-section">
        <div className="jdp-section-title">Pipeline</div>
        <div className="jdp-pipeline-row">
          {!closed && (
            <button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 12px' }} onClick={handleAdvance}>
              Advance → {nextLabel(job)}
            </button>
          )}
          {(job.stage > 1 || job.step > 0) && (
            <button className="btn btn-gray" style={{ fontSize: 12, padding: '7px 12px' }} onClick={() => run(() => moveJobBack(job), 'Moved back')}>
              ← Move back
            </button>
          )}
          {isAdmin && job.planned_install_date && !job.install_completion_date && (
            <button className="btn btn-gray" style={{ fontSize: 12, padding: '7px 12px' }} onClick={() => setReschedule(!reschedule)}>
              📅 Reschedule
            </button>
          )}
        </div>

        <div className="jdp-date-strip">
          {job.planned_install_date   && <span>📅 Booked {fmtDate(job.planned_install_date)}</span>}
          {job.install_start_date     && <span>🔧 Started {fmtDate(job.install_start_date)}</span>}
          {job.install_completion_date && <span>✅ Installed {fmtDate(job.install_completion_date)}</span>}
          {job.ces_submitted           && <span>📋 CES sub {fmtDate(job.ces_submitted)}</span>}
          {job.ces_received            && <span>📋 CES rec {fmtDate(job.ces_received)}</span>}
          {job.rebate_submitted        && <span>💰 Rebate sub {fmtDate(job.rebate_submitted)}</span>}
          {job.rebate_received         && <span>💰 Rebate rec {fmtDate(job.rebate_received)}</span>}
        </div>

        {reschedule && (
          <InlineDatePick
            label="New booking date"
            value={dateVal}
            onChange={setDateVal}
            clashes={clashOnDate}
            allBooked={clashes}
            customers={customers}
            onConfirm={() => { setReschedule(false); run(() => rescheduleBooking(job, dateVal), 'Rebooked') }}
            onCancel={() => setReschedule(false)}
          />
        )}
        {dateAsk && (
          <InlineDatePick
            label={dateAsk.label}
            value={dateVal}
            onChange={setDateVal}
            clashes={dateAsk.field === 'planned_install_date' ? clashOnDate : []}
            allBooked={dateAsk.field === 'planned_install_date' ? clashes : []}
            customers={customers}
            onConfirm={() => { setDateAsk(null); run(() => advanceJob(job, dateVal), 'Job advanced') }}
            onCancel={() => setDateAsk(null)}
          />
        )}
      </div>

      {/* ── Alerts ── */}
      {(hasShortage || isOverdue || job.fixes_needed) && (
        <div className="jdp-section">
          <div className="jdp-section-title">Alerts</div>
          <div className="jdp-alerts">
            {hasShortage  && <span className="alert-tag">📦 Stock short</span>}
            {isOverdue    && <span className="alert-tag">📅 Install overdue</span>}
            {job.fixes_needed && <span className="alert-tag alert-tag-info">🔧 Fixes needed</span>}
          </div>
        </div>
      )}

      {/* ── Customer Details ── */}
      <div className="jdp-section">
        <div className="jdp-section-title">Customer Details</div>
        <div className="jdp-2col">
          <F label="Customer name" full>
            <input className="jdp-input" disabled={!isAdmin} value={custForm.name} onChange={(e) => setCustForm({ ...custForm, name: e.target.value })} />
          </F>
          <F label="Phone">
            <div className="jdp-contact-row">
              <input className="jdp-input" disabled={!isAdmin} value={custForm.phone} onChange={(e) => setCustForm({ ...custForm, phone: e.target.value })} />
              {custForm.phone && <a className="jdp-contact-link" href={`tel:${custForm.phone}`}>📞</a>}
              {custForm.phone && <a className="jdp-contact-link" href={`sms:${custForm.phone}`}>💬</a>}
            </div>
          </F>
          <F label="Email">
            <div className="jdp-contact-row">
              <input className="jdp-input" disabled={!isAdmin} value={custForm.email} onChange={(e) => setCustForm({ ...custForm, email: e.target.value })} />
              {custForm.email && <a className="jdp-contact-link" href={`mailto:${custForm.email}`}>✉</a>}
            </div>
          </F>
          <F label="Address" full>
            <input className="jdp-input" disabled={!isAdmin} value={custForm.address} onChange={(e) => setCustForm({ ...custForm, address: e.target.value })} />
          </F>
        </div>
      </div>

      {/* ── Install Details ── */}
      <div className="jdp-section">
        <div className="jdp-section-title">Install Details</div>
        <div className="jdp-2col">
          <F label="Job type">
            <select
              className="jdp-input"
              disabled={!isAdmin}
              value={jobForm.job_type}
              onChange={(e) => setJobForm({ ...jobForm, job_type: e.target.value as 'install' | 'service' })}
            >
              <option value="install">🔧 New install</option>
              <option value="service">🛠 Service / upgrade</option>
            </select>
          </F>
          <F label="Value (AUD)">
            <input className="jdp-input" disabled={!isAdmin} type="number" value={jobForm.value} onChange={(e) => setJobForm({ ...jobForm, value: e.target.value })} />
          </F>
          <F label="System">
            <input className="jdp-input" disabled={!isAdmin} value={jobForm.system_description} onChange={(e) => setJobForm({ ...jobForm, system_description: e.target.value })} />
          </F>
          <F label="Location">
            <input className="jdp-input" disabled={!isAdmin} value={jobForm.location} onChange={(e) => setJobForm({ ...jobForm, location: e.target.value })} />
          </F>
          <F label="Assigned installer" full>
            <select
              className="jdp-input"
              disabled={!isAdmin}
              value={jobForm.assigned_installer_id}
              onChange={(e) => setJobForm({ ...jobForm, assigned_installer_id: e.target.value })}
            >
              <option value="">— unassigned —</option>
              {profiles.filter((p) => p.role === 'installer').map((p) => (
                <option key={p.id} value={p.id}>{p.full_name || p.id.slice(0, 8)}</option>
              ))}
            </select>
          </F>
          <F label="Notes" full>
            <textarea className="jdp-input" rows={3} value={jobForm.notes} onChange={(e) => setJobForm({ ...jobForm, notes: e.target.value })} />
          </F>
          <F label="" full>
            <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={jobForm.fixes_needed} onChange={(e) => setJobForm({ ...jobForm, fixes_needed: e.target.checked })} />
              Fixes needed
            </label>
          </F>
        </div>
        {isAdmin && (
          <div className="jdp-save-row">
            <button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 14px' }} onClick={saveJobAndCustomer}>Save details</button>
          </div>
        )}
        {!isAdmin && (
          <div className="jdp-save-row">
            <button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 14px' }} onClick={saveJobAndCustomer}>Save notes</button>
          </div>
        )}
      </div>

      {/* ── Stock ── */}
      <div className="jdp-section">
        <div className="jdp-section-title">Stock</div>
        {pending.length > 0 && (
          <div className="stock-block">
            <div className="stock-block-title">Pending (auto-assigns on booking)</div>
            {pending.map((i) => (
              <div key={i.id} className="stock-line">
                <span>{stockName(i.stock_id)}</span>
                <span>× {i.qty}</span>
              </div>
            ))}
            {isAdmin && (
              <button className="btn btn-gray" style={{ fontSize: 11, marginTop: 6 }} onClick={() => run(() => applyPendingNow(job.id), 'Assigned now')}>
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
                {isAdmin && <button className="btn-x" title="Remove" onClick={() => removeStock(i.id)}>✕</button>}
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
      </div>

      {/* ── Job details (installation_requests) ── */}
      {isAdmin && (
        <div className="jdp-section">
          <div className="jdp-section-title">Job Details</div>
          <div className="jdp-2col">
            <F label="Job order ref">
              <input className="jdp-input" value={irForm.ref} onChange={(e) => setIrForm({ ...irForm, ref: e.target.value })} />
            </F>
            <F label="Date issued">
              <input className="jdp-input" type="date" value={irForm.issued} onChange={(e) => setIrForm({ ...irForm, issued: e.target.value })} />
            </F>
            <F label="Installer">
              <input className="jdp-input" disabled value={installerName(job.assigned_installer_id)} />
            </F>
            <F label="Vehicle / rego">
              <input className="jdp-input" value={irForm.vehicle} onChange={(e) => setIrForm({ ...irForm, vehicle: e.target.value })} />
            </F>
            <F label="Planned install date">
              <input className="jdp-input" disabled value={job.planned_install_date ?? ''} />
            </F>
          </div>

          <div style={{ marginTop: 10 }}>
            <div className="jdp-section-title">Site &amp; Instructions</div>
            <div className="jdp-2col">
              <F label="Site access notes" full>
                <textarea className="jdp-input" rows={2} value={irForm.siteAccess} onChange={(e) => setIrForm({ ...irForm, siteAccess: e.target.value })} />
              </F>
              <F label="Special instructions" full>
                <textarea className="jdp-input" rows={2} value={irForm.specialInstructions} onChange={(e) => setIrForm({ ...irForm, specialInstructions: e.target.value })} />
              </F>
              <F label="Additional notes" full>
                <textarea className="jdp-input" rows={2} value={irForm.extraNotes} onChange={(e) => setIrForm({ ...irForm, extraNotes: e.target.value })} />
              </F>
            </div>
          </div>
          <div className="jdp-save-row">
            <button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 14px' }} onClick={saveIR}>Save job order</button>
          </div>
        </div>
      )}

      {/* Installer view of site & instructions (read-ish) */}
      {!isAdmin && ir && (
        <div className="jdp-section">
          <div className="jdp-section-title">Site &amp; Instructions</div>
          <div className="jdp-2col">
            {ir.site_access_notes && <F label="Site access" full><div style={{ fontSize: 13, padding: '4px 0' }}>{ir.site_access_notes}</div></F>}
            {ir.special_instructions && <F label="Special instructions" full><div style={{ fontSize: 13, padding: '4px 0' }}>{ir.special_instructions}</div></F>}
            {ir.additional_notes && <F label="Additional notes" full><div style={{ fontSize: 13, padding: '4px 0' }}>{ir.additional_notes}</div></F>}
          </div>
        </div>
      )}

      {/* ── Documents ── */}
      <div className="jdp-section">
        <div className="jdp-section-title">Documents</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <button
            className="btn btn-gray"
            style={{ fontSize: 12 }}
            onClick={async () => {
              if (!customer) return
              await copyText(jobDetailsText(job, customer, items, stocks))
              note('📋 Copied!')
            }}
          >
            📋 Copy details
          </button>
          {canCes && (
            <button className="btn btn-gray" style={{ fontSize: 12 }} onClick={() => setShowCes(true)}>
              📋 CES summary
            </button>
          )}
          {isAdmin && (
            <button
              className="btn btn-gray"
              style={{ fontSize: 12 }}
              onClick={() => printJobPo(job, customer?.name ?? `Job #${job.id}`, assigned.length ? assigned : pending, stocks, suppliers)}
            >
              🖨 Print PO
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-gray" style={{ fontSize: 12 }} onClick={() => setShowLink(true)}>
              🔗 Link quote
            </button>
          )}
        </div>
      </div>

      {showCes && customer && (
        <CesModal job={job} customer={customer} items={items} stocks={stocks} cesSpecs={cesSpecs} onClose={() => setShowCes(false)} />
      )}
      {showLink && (
        <LinkQuoteModal
          job={job}
          stocks={stocks}
          onClose={() => setShowLink(false)}
          onDone={(msg) => { setShowLink(false); refresh(); note(msg) }}
        />
      )}
    </div>
  )
}

/* ── helpers ── */

function jobFormFrom(job: Job | undefined) {
  return {
    location: job?.location ?? '',
    system_description: job?.system_description ?? '',
    value: String(job?.value ?? 0),
    job_type: (job?.job_type ?? 'install') as 'install' | 'service',
    assigned_installer_id: job?.assigned_installer_id ?? '',
    notes: job?.notes ?? '',
    fixes_needed: job?.fixes_needed ?? false,
  }
}

function custFormFrom(c: Customer | undefined) {
  return {
    name: c?.name ?? '',
    phone: c?.phone ?? '',
    email: c?.email ?? '',
    contact_method: c?.contact_method ?? 'Email',
    address: c?.address ?? '',
  }
}

function irFormFrom(ir: InstallationRequest | undefined) {
  return {
    ref: ir?.job_order_ref ?? '',
    issued: ir?.issued_date ?? '',
    vehicle: ir?.vehicle ?? '',
    siteAccess: ir?.site_access_notes ?? '',
    specialInstructions: ir?.special_instructions ?? '',
    extraNotes: ir?.additional_notes ?? '',
  }
}

function nextLabel(job: Job): string {
  const maxStep = PIPELINE[job.stage].steps.length - 1
  if (job.step < maxStep) return stepLabel(job.stage, job.step + 1)
  if (job.stage < 4) return stepLabel(job.stage + 1, 0)
  return 'Done'
}

/** Inline date picker (no overlay) */
function InlineDatePick(props: {
  label: string
  value: string
  onChange: (v: string) => void
  clashes: { date: string; job: Job }[]
  allBooked: { date: string; job: Job }[]
  customers: ReturnType<typeof useData>['customers']
  onConfirm: () => void
  onCancel: () => void
}) {
  const custName = (j: Job) => props.customers.find((c) => c.id === j.customer_id)?.name ?? `Job #${j.id}`
  return (
    <div className="datepick" style={{ marginTop: 8 }}>
      <label>
        {props.label}
        <input type="date" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      </label>
      {props.clashes.length > 0 && (
        <div className="clash-warn">⚠ Same-day clash: {props.clashes.map((c) => custName(c.job)).join(', ')}</div>
      )}
      {props.allBooked.length > 0 && (
        <div className="booked-list">Booked: {props.allBooked.map((c) => `${fmtDate(c.date)} — ${custName(c.job)}`).join(' · ')}</div>
      )}
      <div className="row">
        <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={props.onConfirm}>Confirm</button>
        <button className="btn btn-gray" style={{ fontSize: 12 }} onClick={props.onCancel}>Cancel</button>
      </div>
    </div>
  )
}

/** Labelled field wrapper */
function F({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`jdp-field${full ? ' jdp-full' : ''}`}>
      {label && <span className="jdp-label">{label}</span>}
      {children}
    </div>
  )
}

function AddStockRow({ stocks, onAdd }: { stocks: { id: number; name: string; qty: number }[]; onAdd: (sid: number, qty: number) => void }) {
  const [sel, setSel] = useState('')
  const [qty, setQty] = useState('1')
  return (
    <div className="add-stock-row">
      <select value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">+ Add stock…</option>
        {stocks.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.qty} on hand)</option>)}
      </select>
      <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 58 }} />
      <button className="btn btn-gray" style={{ fontSize: 12 }} disabled={!sel || Number(qty) < 1}
        onClick={() => { onAdd(Number(sel), Number(qty)); setSel(''); setQty('1') }}>
        Add
      </button>
    </div>
  )
}
