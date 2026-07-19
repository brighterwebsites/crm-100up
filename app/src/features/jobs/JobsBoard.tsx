import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useData } from '../../lib/data'
import type { Job } from '../../lib/data'
import { PIPELINE, isClosed, stepLabel, stepOrdinal, TOTAL_STEPS } from '../../lib/pipeline'
import { computeJobShortfalls } from '../../lib/stockCalc'
import { fmtDate, fmtMoney } from '../../lib/format'
import { createJob } from './actions'
import JobDetail from './JobDetail'

type Filter = 'all' | 'active' | '1' | '2' | '3' | '4' | 'service' | 'closed'

export default function JobsBoard() {
  const { isAdmin } = useAuth()
  const { jobs, items, stocks, refresh, loading } = useData()
  const [filter, setFilter] = useState<Filter>('active')
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const shortfalls = useMemo(() => computeJobShortfalls(jobs, items, stocks), [jobs, items, stocks])

  const list = useMemo(() => {
    let l = jobs
    if (filter === 'active') l = l.filter((j) => !isClosed(j.stage, j.step))
    else if (filter === 'closed') l = l.filter((j) => isClosed(j.stage, j.step))
    else if (filter === 'service') l = l.filter((j) => j.job_type === 'service')
    else if (filter !== 'all') l = l.filter((j) => j.stage === Number(filter))
    return l
  }, [jobs, filter])

  const openJob = openId != null ? jobs.find((j) => j.id === openId) ?? null : null

  async function handleCreate() {
    if (!newName.trim()) return
    const job = await createJob(newName)
    setNewName('')
    setCreating(false)
    await refresh()
    setOpenId(job.id)
  }

  if (loading) return <div className="placeholder">Loading jobs…</div>

  return (
    <div>
      <div className="filter-row">
        {(
          [
            ['active', 'Active'],
            ['all', 'All'],
            ['1', PIPELINE[1].short],
            ['2', PIPELINE[2].short],
            ['3', PIPELINE[3].short],
            ['4', PIPELINE[4].short],
            ['service', '🛠 Service'],
            ['closed', '✓ Closed'],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <button
            key={f}
            className={`fbtn ${filter === f ? 'fbtn-on' : ''}`}
            onClick={() => setFilter(f)}
          >
            {label}
          </button>
        ))}
        {isAdmin && (
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setCreating(true)}>
            + New job
          </button>
        )}
      </div>

      {creating && (
        <div className="card new-job-row">
          <input
            autoFocus
            placeholder="Customer name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <button className="btn btn-primary" onClick={handleCreate}>
            Create
          </button>
          <button className="btn btn-gray" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
      )}

      <div className="job-grid">
        {list.map((j) => (
          <JobCard key={j.id} job={j} short={!!shortfalls[j.id]} onOpen={() => setOpenId(j.id)} />
        ))}
        {list.length === 0 && <div className="placeholder">No jobs match this filter.</div>}
      </div>

      {openJob && <JobDetail job={openJob} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function JobCard({ job, short, onOpen }: { job: Job; short: boolean; onOpen: () => void }) {
  const stage = PIPELINE[job.stage]
  const closed = isClosed(job.stage, job.step)
  const pct = Math.round(((stepOrdinal(job.stage, job.step) + 1) / TOTAL_STEPS) * 100)
  return (
    <button className={`job-card ${closed ? 'job-closed' : ''}`} onClick={onOpen}>
      <div className="job-card-top">
        <span className="job-name">
          {job.name}
          {closed && <span className="job-done"> ✓</span>}
        </span>
        {job.job_type === 'service' && <span className="type-pill">🛠 service</span>}
        {short && <span className="short-pill">⚠ stock</span>}
      </div>
      {job.location && <div className="job-loc">{job.location}</div>}
      <div className="job-meta">
        <span className="stage-chip" style={{ background: stage.light, color: stage.text }}>
          {stage.short} › {stepLabel(job.stage, job.step)}
        </span>
        {job.date_booked && !job.install_date && <span className="job-date">📅 {fmtDate(job.date_booked)}</span>}
        {job.value > 0 && <span className="job-value">{fmtMoney(job.value)}</span>}
      </div>
      <div className="job-progress">
        <div className="job-progress-fill" style={{ width: `${pct}%`, background: stage.color }} />
      </div>
    </button>
  )
}
