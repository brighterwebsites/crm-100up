import { useMemo, useState } from 'react'
import { useData } from '../lib/data'
import type { Job } from '../lib/data'
import { PIPELINE, isClosed, stepLabel } from '../lib/pipeline'
import { computeJobShortfalls } from '../lib/stockCalc'
import { useAuth } from '../lib/auth'
import { createJob } from '../features/jobs/actions'
import JobDetailPanel from '../features/jobs/JobDetailPanel'

interface Props {
  /** Installer view: only show jobs assigned to the current user */
  installerOnly?: boolean
  /** Pre-select a specific job on mount */
  initialJobId?: number | null
}

export default function CustomerJobsPage({ installerOnly, initialJobId }: Props) {
  const { profile, isAdmin } = useAuth()
  const { jobs, customers, items, stocks, refresh } = useData()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(initialJobId ?? null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const shortfalls = useMemo(() => computeJobShortfalls(jobs, items, stocks), [jobs, items, stocks])
  const custMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])

  const visibleJobs = useMemo(() => {
    let list = installerOnly
      ? jobs.filter((j) => j.assigned_installer_id === profile?.id)
      : jobs

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((j) => {
        const cust = custMap.get(j.customer_id)
        return (
          cust?.name.toLowerCase().includes(q) ||
          cust?.phone.includes(q) ||
          j.location?.toLowerCase().includes(q) ||
          j.system_description?.toLowerCase().includes(q)
        )
      })
    }

    return [...list].sort((a, b) => {
      // Open jobs first, then by most recently updated
      const aClosed = isClosed(a.stage, a.step) ? 1 : 0
      const bClosed = isClosed(b.stage, b.step) ? 1 : 0
      if (aClosed !== bClosed) return aClosed - bClosed
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })
  }, [jobs, customers, search, installerOnly, profile, custMap])

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const job = await createJob(newName)
      await refresh()
      setSelectedId(job.id)
      setNewName('')
    } finally {
      setCreating(false)
    }
  }

  function stageChip(j: Job) {
    const closed = isClosed(j.stage, j.step)
    const s = PIPELINE[j.stage]
    return (
      <span
        className="stage-chip"
        style={{
          background: closed ? '#eef0f3' : s.light,
          color: closed ? 'var(--muted)' : s.text,
          fontSize: 10,
        }}
      >
        {closed ? '✓ Closed' : `${s.short} › ${stepLabel(j.stage, j.step)}`}
      </span>
    )
  }

  return (
    <div className="master-detail">
      {/* Left list */}
      <div className="master-list">
        <div className="master-list-search">
          <input
            placeholder="Search customer, phone, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isAdmin && (
          <div className="new-item-btn">
            <div className="new-job-row">
              <input
                placeholder="New customer name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                style={{ flex: 1, fontSize: 13, padding: '7px 9px', borderRadius: 6, border: '1.5px solid var(--line)' }}
              />
              <button
                className="btn btn-primary"
                style={{ fontSize: 12, padding: '7px 12px' }}
                disabled={!newName.trim() || creating}
                onClick={handleCreate}
              >
                + New
              </button>
            </div>
          </div>
        )}

        <div className="master-list-items">
          {visibleJobs.map((j) => {
            const cust = custMap.get(j.customer_id)
            const short = !!shortfalls[j.id]
            const closed = isClosed(j.stage, j.step)
            return (
              <button
                key={j.id}
                className={`master-item ${selectedId === j.id ? 'master-item-on' : ''}`}
                onClick={() => setSelectedId(j.id)}
                style={{ opacity: closed ? 0.65 : 1 }}
              >
                <div className="master-item-name">
                  {cust?.name ?? `Job #${j.id}`}
                  {short && <span className="short-pill" style={{ marginLeft: 6 }}>📦</span>}
                  {j.fixes_needed && <span className="type-pill" style={{ marginLeft: 6 }}>🔧</span>}
                </div>
                {j.location && <div className="master-item-sub">{j.location}</div>}
                <div className="master-item-stage">{stageChip(j)}</div>
              </button>
            )
          })}
          {visibleJobs.length === 0 && (
            <div style={{ padding: '24px 12px', color: 'var(--muted)', textAlign: 'center', fontSize: 13 }}>
              {search ? 'No results.' : installerOnly ? 'No jobs assigned to you yet.' : 'No jobs yet.'}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className="detail-area">
        {selectedId ? (
          <JobDetailPanel key={selectedId} jobId={selectedId} />
        ) : (
          <div className="detail-empty">Select a job to view details</div>
        )}
      </div>
    </div>
  )
}
