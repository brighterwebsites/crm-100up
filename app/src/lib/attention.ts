// "Needs attention": the follow-up rules behind the Pipeline's right-hand
// panel, its pulsing dots and its Alerts / Stale filters.
// Design and the six rules: docs/design/pipeline-attention-design.md.
//
// Four rules are per step and live in pipeline_steps (follow_up_days,
// follow_up_action), so Fred's thresholds are data. Two are date-based and
// computed here: install overdue, and stock short for a booked install.

import type { Job, JobStepDate, PipelineStep } from './data'
import { fmtDate } from './format'
import { isClosed } from './pipeline'
import type { JobShortfall } from './stockCalc'

/** alert = chase or overdue (red), stale = no movement (amber),
 * stock = booked but short, nothing ordered (brown). V46's dot colours. */
export type Severity = 'alert' | 'stale' | 'stock'

export interface AttentionItem {
  job: Job
  severity: Severity
  /** How pressing within its kind: days overdue, days waiting, or days
   * until the install (negated, so sooner sorts first). */
  weight: number
  text: string
}

const DAY = 86_400_000

function daysSince(iso: string, today: Date): number {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return Math.floor((today.getTime() - d.getTime()) / DAY)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** When the job reached its current step: that step's own date where it has
 * one, else the job's last change. The booking date is a plan, not an
 * arrival, so it never counts as one. */
function reachedCurrentStep(job: Job, cur: PipelineStep, stepDates: JobStepDate[]): string {
  if (cur.date_column && cur.date_column !== 'planned_install_date') {
    const v = job[cur.date_column as keyof Job]
    if (typeof v === 'string' && v) return v
  }
  return stepDates.find((d) => d.job_id === job.id && d.step_key === cur.key)?.date ?? job.updated_at
}

export function jobAttention(
  jobs: Job[],
  steps: PipelineStep[],
  stepDates: JobStepDate[],
  shortByJob: Record<number, JobShortfall>,
  today: Date = new Date(),
): AttentionItem[] {
  const todayIso = today.toLocaleDateString('en-CA')
  const items: AttentionItem[] = []

  for (const job of jobs) {
    if (isClosed(job.stage, job.step)) continue
    const booked = job.planned_install_date
    const installed = !!job.install_completion_date
    const overdue = !!booked && !installed && booked < todayIso

    // Install overdue: the booked date has passed and the install isn't done.
    if (overdue) {
      const n = daysSince(booked, today)
      items.push({ job, severity: 'alert', weight: n, text: `Install ${plural(n, 'day')} overdue (booked ${fmtDate(booked)})` })
    }

    // Short for a booked install: stock neither on the shelf nor on order.
    const short = shortByJob[job.id]
    if (booked && !installed && short) {
      const k = Object.keys(short).length
      items.push({ job, severity: 'stock', weight: -daysSince(booked, today), text: `Installs ${fmtDate(booked)}, ${plural(k, 'item')} not ordered` })
    }

    // Time at the current step. Skipped when the install is overdue (that
    // says it better) and while an install is booked in the future (waiting
    // on the calendar is not neglect).
    const cur = steps.find((s) => s.stage === job.stage && s.step === job.step)
    const waitingOnInstall = !!booked && !installed && !overdue
    if (cur?.follow_up_days && !overdue && !waitingOnInstall) {
      const n = daysSince(reachedCurrentStep(job, cur, stepDates), today)
      if (n > cur.follow_up_days) {
        items.push(
          cur.follow_up_action
            ? { job, severity: 'alert', weight: n, text: `${cur.step_name} ${n} days ago. ${cur.follow_up_action}` }
            : { job, severity: 'stale', weight: n, text: `No movement for ${n} days (${cur.step_name})` },
        )
      }
    }
  }

  const rank: Record<Severity, number> = { alert: 0, stock: 1, stale: 2 }
  return items.sort((a, b) => rank[a.severity] - rank[b.severity] || b.weight - a.weight)
}

/** The dot's signal, in V46's order of precedence: alert, then stale, then stock. */
export function dotSeverity(items: AttentionItem[]): Severity | null {
  if (items.some((i) => i.severity === 'alert')) return 'alert'
  if (items.some((i) => i.severity === 'stale')) return 'stale'
  if (items.some((i) => i.severity === 'stock')) return 'stock'
  return null
}
