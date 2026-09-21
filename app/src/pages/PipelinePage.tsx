import { Mail, Package, Phone, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useData } from '../lib/data'
import type { Customer, Job } from '../lib/data'
import { PIPELINE, isClosed, stepOrdinal } from '../lib/pipeline'
import { allocatedMap, computeJobShortfalls, computeOrderData, onOrderMap } from '../lib/stockCalc'
import { dotSeverity, jobAttention } from '../lib/attention'
import type { AttentionItem } from '../lib/attention'
import { fmtDate } from '../lib/format'
import JobDetailPanel from '../features/jobs/JobDetailPanel'
import AttentionPanel from '../features/pipeline/AttentionPanel'
import type { StockRow } from '../features/pipeline/AttentionPanel'

type Filter = 'all' | 'active' | 'closed' | 'alerts' | 'stale' | 'install' | 'service' | 'stock' | 'comms' | 'quoting' | 'compliance'

// All stage+step columns in order
const COLUMNS = Object.entries(PIPELINE).flatMap(([stageStr, s]) =>
  s.steps.map((stepName, step) => ({ stage: Number(stageStr), step, stepName, stageDef: s })),
)

// How many steps per stage (for colspan)
const STAGE_SPANS: Record<number, number> = {}
for (const { stage } of COLUMNS) {
  STAGE_SPANS[stage] = (STAGE_SPANS[stage] ?? 0) + 1
}
const STAGE_ORDER = [1, 2, 3, 4]

export default function PipelinePage({ onOpenOrderList }: { onOpenOrderList?: () => void }) {
  const { jobs, customers, items, stocks, suppliers, purchaseOrders, purchaseOrderItems, pipelineSteps, stepDates } = useData()
  const [filter, setFilter] = useState<Filter>('active')
  const [openId, setOpenId] = useState<number | null>(null)

  const onOrder = useMemo(() => onOrderMap(purchaseOrders, purchaseOrderItems), [purchaseOrders, purchaseOrderItems])
  const stockStatus = useMemo(() => computeJobShortfalls(jobs, items, stocks, onOrder), [jobs, items, stocks, onOrder])
  const shortfalls = stockStatus.short

  // The follow-up rules (lib/attention.ts): one list drives the right-hand
  // panel, the pulsing dots and the Alerts / Stale filters.
  const attention = useMemo(
    () => jobAttention(jobs, pipelineSteps, stepDates, shortfalls),
    [jobs, pipelineSteps, stepDates, shortfalls],
  )
  const attentionByJob = useMemo(() => {
    const m = new Map<number, AttentionItem[]>()
    for (const it of attention) m.set(it.job.id, [...(m.get(it.job.id) ?? []), it])
    return m
  }, [attention])

  // Stock for the panel: every item jobs need beyond the shelf, split into
  // what still has to be ordered and what an open PO already covers.
  const orderData = useMemo(
    () => computeOrderData(jobs, items, stocks, suppliers, onOrder),
    [jobs, items, stocks, suppliers, onOrder],
  )
  const stockRows = useMemo((): StockRow[] => {
    const alloc = allocatedMap(jobs, items)
    return stocks
      .map((s) => {
        const need = Math.max(0, (alloc[s.id] ?? 0) - s.qty)
        const covered = Math.min(onOrder[s.id] ?? 0, need)
        return { stock: s, toOrder: need - covered, onOrder: onOrder[s.id] ?? 0, need }
      })
      .filter((r) => r.need > 0)
      .sort((a, b) => b.toOrder - a.toOrder || b.onOrder - a.onOrder || a.stock.name.localeCompare(b.stock.name))
      .map(({ stock, toOrder, onOrder: o }) => ({ stock, toOrder, onOrder: o }))
  }, [jobs, items, stocks, onOrder])

  // Stat counts
  const counts = useMemo(() => ({
    total:      jobs.length,
    comms:      jobs.filter((j) => j.stage === 1).length,
    quoting:    jobs.filter((j) => j.stage === 2).length,
    install:    jobs.filter((j) => j.stage === 3).length,
    compliance: jobs.filter((j) => j.stage === 4 && !isClosed(j.stage, j.step)).length,
    closed:     jobs.filter((j) => isClosed(j.stage, j.step)).length,
  }), [jobs])

  const filtered = useMemo(() => {
    const has = (id: number, ...sev: AttentionItem['severity'][]) =>
      (attentionByJob.get(id) ?? []).some((it) => sev.includes(it.severity))
    return jobs.filter((j) => {
      if (filter === 'active')     return !isClosed(j.stage, j.step)
      if (filter === 'closed')     return isClosed(j.stage, j.step)
      if (filter === 'alerts')     return has(j.id, 'alert', 'stock')
      if (filter === 'stale')      return has(j.id, 'stale')
      if (filter === 'install')    return j.job_type === 'install'
      if (filter === 'service')    return j.job_type === 'service'
      if (filter === 'stock')      return !!shortfalls[j.id]
      if (filter === 'comms')      return j.stage === 1
      if (filter === 'quoting')    return j.stage === 2
      if (filter === 'compliance') return j.stage === 4 && !isClosed(j.stage, j.step)
      return true
    })
  }, [jobs, filter, shortfalls, attentionByJob])

  const custMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])

  function dotDate(j: Job): string | null {
    if (j.install_completion_date) return fmtDate(j.install_completion_date)
    if (j.install_start_date)      return fmtDate(j.install_start_date)
    if (j.planned_install_date)    return fmtDate(j.planned_install_date)
    return null
  }

  const statItems: { key: Filter; label: string; n: number; color?: string }[] = [
    { key: 'active',  label: 'Total Jobs',   n: counts.total },
    { key: 'comms',   label: 'Communication', n: counts.comms,      color: PIPELINE[1].color },
    { key: 'quoting', label: 'Quoting',       n: counts.quoting,    color: PIPELINE[2].color },
    { key: 'install', label: 'Installation',  n: counts.install,    color: PIPELINE[3].color },
    { key: 'compliance', label: 'Compliance', n: counts.compliance, color: PIPELINE[4].color },
    // Was keyed 'all', so clicking the Closed tile showed EVERY job while the
    // tile's own count said otherwise. The count was always right.
    { key: 'closed',  label: 'Closed',      n: counts.closed,     color: '#3a4150' },
  ]

  return (
    <div className="pipeline-page page-flush">
      {/* Stat cards */}
      <div className="stat-bar">
        {statItems.map(({ key, label, n, color }) => (
          <button
            key={key}
            className={`stat-card ${filter === key ? 'stat-card-on' : ''}`}
            onClick={() => setFilter(key)}
          >
            <span className="stat-number" style={color ? { color } : undefined}>{n}</span>
            <span className="stat-label">{label}</span>
          </button>
        ))}
      </div>

      {/* Quick filters */}
      <div className="quick-filters">
        <span>Show:</span>
        {([
          ['active',  'All jobs'],
          ['alerts',  'Alerts'],
          ['stale',   'Stale'],
          ['install', 'New install'],
          ['service', 'Upgrades'],
          ['stock',   'Stock short'],
        ] as [Filter, string][]).map(([f, label]) => (
          <button key={f} className={`fbtn ${filter === f ? 'fbtn-on' : ''}`} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
      </div>

      {/* Grid + panel */}
      <div className="pipeline-content">
        <div className="pipeline-grid-wrap">
          <table className="pipeline-table">
            <thead>
              {/* Row 1: stage headers */}
              <tr>
                <th className="p-th-left" rowSpan={2} style={{ verticalAlign: 'bottom', paddingBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.6 }}>
                    {filtered.length} job{filtered.length !== 1 ? 's' : ''}
                  </span>
                </th>
                {STAGE_ORDER.map((stage) => {
                  const s = PIPELINE[stage]
                  return (
                    <th
                      key={stage}
                      colSpan={STAGE_SPANS[stage]}
                      className="p-stage-header"
                      style={{ borderBottom: `2px solid ${s.color}`, color: s.text, background: s.light }}
                    >
                      Stage {stage} — {s.name}
                    </th>
                  )
                })}
              </tr>
              {/* Row 2: step headers */}
              <tr>
                {COLUMNS.map(({ stage, step, stepName, stageDef }) => (
                  <th
                    key={`${stage}-${step}`}
                    /* step 0 is the first column of a stage, so it carries the
                       divider. Coloured to its own stage so the boundary ties
                       back to the header band above it. */
                    className={`p-step-header${step === 0 ? ' stage-start' : ''}`}
                    style={{
                      background: stageDef.light + '80',
                      ...(step === 0 ? { borderLeftColor: stageDef.color } : null),
                    }}
                  >
                    {stepName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((j) => {
                const cust: Customer | undefined = custMap.get(j.customer_id)
                const closed = isClosed(j.stage, j.step)
                const short = !!shortfalls[j.id]
                const jobOnOrder = !!stockStatus.onOrder[j.id]
                const jobAlerts = attentionByJob.get(j.id) ?? []
                const signal = dotSeverity(jobAlerts)
                const isSelected = j.id === openId
                const dotCol = stepOrdinal(j.stage, j.step)
                const stageDef = PIPELINE[j.stage]
                const date = dotDate(j)

                return (
                  <tr key={j.id} className={`p-row ${closed ? 'p-row-closed' : ''}`}>
                    {/* Left info cell */}
                    <td
                      className={`p-job-left ${isSelected ? 'p-job-left-on' : ''}`}
                      onClick={() => setOpenId(isSelected ? null : j.id)}
                    >
                      <div className="p-job-name">{cust?.name ?? `Job #${j.id}`}</div>
                      {j.location && <div className="p-job-loc">{j.location}</div>}
                      {(cust?.phone || cust?.email) && (
                        <div className="p-job-contact">
                          {cust.phone && <a href={`tel:${cust.phone}`} onClick={(e) => e.stopPropagation()}><Phone size={11} aria-hidden /> {cust.phone}</a>}
                          {cust.email && <a href={`mailto:${cust.email}`} onClick={(e) => e.stopPropagation()}><Mail size={11} aria-hidden /></a>}
                        </div>
                      )}
                      {(short || jobOnOrder) && (
                        <div className="p-alerts">
                          {short      && <span className="short-pill"><Package size={11} aria-hidden /> stock short</span>}
                          {jobOnOrder && <span className="short-pill short-pill-onorder"><Truck size={11} aria-hidden /> on order</span>}
                        </div>
                      )}
                    </td>

                    {/* Step columns */}
                    {COLUMNS.map(({ stage, step }, colIdx) => {
                      const isThisCol = colIdx === dotCol
                      return (
                        <td
                          key={`${stage}-${step}`}
                          className={`p-dot-cell${step === 0 ? ' stage-start' : ''}`}
                          style={{
                            background: colIdx < dotCol ? stageDef.light + '30' : undefined,
                            ...(step === 0 ? { borderLeftColor: PIPELINE[stage].color } : null),
                          }}
                          onClick={() => isThisCol && setOpenId(isSelected ? null : j.id)}
                        >
                          {isThisCol && (
                            <div
                              className={`p-dot${signal ? ` p-dot-${signal}` : ''}`}
                              style={{ background: stageDef.color }}
                              title={[`${cust?.name ?? `Job #${j.id}`} — ${stageDef.steps[j.step]}`, ...jobAlerts.map((a) => a.text)].join('\n')}
                            >
                              {date && <span className="p-dot-date">{date}</span>}
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} style={{ textAlign: 'center', padding: '28px 0', color: 'var(--muted)' }}>
                    No jobs match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Right column: what needs attention, until a job is opened. */}
        {openId === null && (
          <AttentionPanel
            items={attention}
            stockRows={stockRows}
            summary={{
              shortItems: orderData.shortItems.length,
              unitsToOrder: orderData.totalUnitsToOrder,
              jobsAffected: orderData.totalJobsAffected,
            }}
            customers={customers}
            onOpenJob={setOpenId}
            onOpenOrderList={onOpenOrderList}
          />
        )}

        {/* Slide-in detail panel */}
        <div className={`pipeline-detail-panel ${openId !== null ? 'panel-is-open' : ''}`}>
          {openId !== null && <JobDetailPanel jobId={openId} onClose={() => setOpenId(null)} />}
        </div>
      </div>
    </div>
  )
}
