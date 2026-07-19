import { useMemo, useState } from 'react'
import { useData } from '../lib/data'
import type { Customer } from '../lib/data'
import { PIPELINE, isClosed, stepLabel } from '../lib/pipeline'
import { supabase } from '../lib/supabaseClient'
import JobDetailPanel from '../features/jobs/JobDetailPanel'

export default function CustomersPage() {
  const { customers, jobs, refresh } = useData()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return customers
    const q = search.toLowerCase()
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.email.toLowerCase().includes(q),
    )
  }, [customers, search])

  const jobsForCustomer = useMemo(
    () => (customerId: number) => jobs.filter((j) => j.customer_id === customerId),
    [jobs],
  )

  const selectedCustomer: Customer | undefined = customers.find((c) => c.id === selectedId)
  const customerJobs = selectedId ? jobsForCustomer(selectedId) : []

  return (
    <div className="master-detail">
      {/* Left list */}
      <div className="master-list">
        <div className="master-list-search">
          <input
            placeholder="Search name, phone, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="master-list-items">
          {filtered.map((c) => {
            const cJobs = jobsForCustomer(c.id)
            const openCount = cJobs.filter((j) => !isClosed(j.stage, j.step)).length
            return (
              <button
                key={c.id}
                className={`master-item ${selectedId === c.id ? 'master-item-on' : ''}`}
                onClick={() => { setSelectedId(c.id); setSelectedJobId(null) }}
              >
                <div className="master-item-name">{c.name}</div>
                {c.phone && <div className="master-item-sub">📞 {c.phone}</div>}
                {c.email && <div className="master-item-sub" style={{ fontSize: 10 }}>✉ {c.email}</div>}
                <div className="master-item-stage">
                  <span className="mutedtext">{cJobs.length} job{cJobs.length !== 1 ? 's' : ''}</span>
                  {openCount > 0 && (
                    <span className="stage-chip" style={{ background: 'var(--stage-1-light)', color: 'var(--stage-1-text)', fontSize: 10, marginLeft: 6 }}>
                      {openCount} open
                    </span>
                  )}
                </div>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <div style={{ padding: '24px 12px', color: 'var(--muted)', textAlign: 'center', fontSize: 13 }}>
              No customers found.
            </div>
          )}
        </div>
      </div>

      {/* Detail */}
      <div className="detail-area">
        {!selectedCustomer && <div className="detail-empty">Select a customer</div>}
        {selectedCustomer && !selectedJobId && (
          <CustomerDetail
            customer={selectedCustomer}
            jobs={customerJobs}
            onSelectJob={(id) => setSelectedJobId(id)}
            onSave={refresh}
          />
        )}
        {selectedCustomer && selectedJobId && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
              <button className="btn-link" onClick={() => setSelectedJobId(null)}>
                ← Back to {selectedCustomer.name}
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <JobDetailPanel jobId={selectedJobId} onClose={() => setSelectedJobId(null)} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CustomerDetail({
  customer,
  jobs,
  onSelectJob,
  onSave,
}: {
  customer: Customer
  jobs: ReturnType<typeof useData>['jobs']
  onSelectJob: (id: number) => void
  onSave: () => void
}) {
  const [form, setForm] = useState({
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    contact_method: customer.contact_method,
    address: customer.address,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function save() {
    setSaving(true)
    setErr(null)
    const { error } = await supabase
      .from('customers')
      .update({ ...form })
      .eq('id', customer.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    setOk(true)
    setTimeout(() => setOk(false), 2000)
    onSave()
  }

  return (
    <div className="jdp">
      <div className="jdp-header">
        <div className="jdp-title">
          <div className="jdp-name">{customer.name}</div>
          <span className="mutedtext">{jobs.length} job{jobs.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {err && <div className="login-error" style={{ marginBottom: 6 }}>{err}</div>}
      {ok  && <div className="login-ok"    style={{ marginBottom: 6 }}>Saved</div>}

      <div className="jdp-section">
        <div className="jdp-section-title">Customer Details</div>
        <div className="jdp-2col">
          <div className="jdp-field jdp-full">
            <span className="jdp-label">Name</span>
            <input className="jdp-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="jdp-field">
            <span className="jdp-label">Phone</span>
            <input className="jdp-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="jdp-field">
            <span className="jdp-label">Email</span>
            <input className="jdp-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="jdp-field jdp-full">
            <span className="jdp-label">Address</span>
            <input className="jdp-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="jdp-field">
            <span className="jdp-label">Contact method</span>
            <select className="jdp-input" value={form.contact_method} onChange={(e) => setForm({ ...form, contact_method: e.target.value })}>
              <option>Email</option>
              <option>Phone</option>
              <option>SMS</option>
            </select>
          </div>
        </div>
        <div className="jdp-save-row">
          <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Jobs for this customer */}
      <div className="jdp-section">
        <div className="jdp-section-title">Jobs ({jobs.length})</div>
        {jobs.length === 0 && <div className="mutedtext">No jobs yet.</div>}
        {jobs.map((j) => {
          const closed = isClosed(j.stage, j.step)
          const s = PIPELINE[j.stage]
          return (
            <button
              key={j.id}
              className="card"
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', cursor: 'pointer', textAlign: 'left', border: '1px solid var(--line)', background: 'var(--card)', marginBottom: 6 }}
              onClick={() => onSelectJob(j.id)}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  {j.location || j.system_description || `Job #${j.id}`}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {j.planned_install_date && `📅 ${j.planned_install_date}  `}
                  {j.system_description && j.system_description}
                </div>
              </div>
              <span
                className="stage-chip"
                style={{ background: closed ? '#eef0f3' : s.light, color: closed ? 'var(--muted)' : s.text, fontSize: 10, flexShrink: 0 }}
              >
                {closed ? '✓ Closed' : `${s.short} › ${stepLabel(j.stage, j.step)}`}
              </span>
              <span style={{ color: 'var(--muted)', fontSize: 14 }}>›</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
