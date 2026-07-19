// Ports of the V46 allocation/shortfall/procurement logic
// (getAllocatedMap / computeJobShortfalls / computeOrderData, lines
// 5969+): shortfalls are attributed oldest-commitment-first, so a job
// whose need is covered by on-hand stock never shows as "short".

import type { Job, JobStockItem, Stock, Supplier } from './data'
import { isClosed } from './pipeline'

export interface JobShortfall {
  [stockId: number]: number
}

export interface OrderCard {
  stock: Stock
  avail: number
  alloc: number
  toOrder: number
  kind: 'short' | 'zero'
  allocJobs: { job: Job; qty: number }[]
}

export interface SupplierGroup {
  supplier: Supplier | null
  short: OrderCard[]
  zero: OrderCard[]
}

/** Assigned (not consumed, not pending) units per stock across open jobs. */
export function allocatedMap(jobs: Job[], items: JobStockItem[]): Record<number, number> {
  const open = new Set(jobs.filter((j) => !isClosed(j.stage, j.step)).map((j) => j.id))
  const map: Record<number, number> = {}
  for (const it of items) {
    if (it.status !== 'assigned' || !open.has(it.job_id)) continue
    map[it.stock_id] = (map[it.stock_id] ?? 0) + it.qty
  }
  return map
}

/** Priority date for "oldest commitments claim stock first". */
function commitDate(j: Job): string {
  return j.planned_install_date ?? j.install_completion_date ?? j.created_at
}

/** Per-job shortfall attribution: {jobId: {stockId: shortQty}}. */
export function computeJobShortfalls(
  jobs: Job[],
  items: JobStockItem[],
  stocks: Stock[]
): Record<number, JobShortfall> {
  const jobById = new Map(jobs.map((j) => [j.id, j]))
  const result: Record<number, JobShortfall> = {}
  const byStock = new Map<number, { job: Job; qty: number }[]>()

  for (const it of items) {
    if (it.status !== 'assigned') continue
    const job = jobById.get(it.job_id)
    if (!job || isClosed(job.stage, job.step)) continue
    const list = byStock.get(it.stock_id) ?? []
    list.push({ job, qty: it.qty })
    byStock.set(it.stock_id, list)
  }

  for (const [stockId, list] of byStock) {
    const stock = stocks.find((s) => s.id === stockId)
    let avail = stock?.qty ?? 0
    list.sort((a, b) => commitDate(a.job).localeCompare(commitDate(b.job)))
    for (const { job, qty } of list) {
      const covered = Math.min(avail, qty)
      avail -= covered
      const short = qty - covered
      if (short > 0) {
        result[job.id] = result[job.id] ?? {}
        result[job.id][stockId] = (result[job.id][stockId] ?? 0) + short
      }
    }
  }
  return result
}

/** Procurement view data: short + zero-stock cards grouped by supplier. */
export function computeOrderData(
  jobs: Job[],
  items: JobStockItem[],
  stocks: Stock[],
  suppliers: Supplier[]
): {
  shortItems: OrderCard[]
  zeroItems: OrderCard[]
  totalJobsAffected: number
  totalUnitsToOrder: number
  supplierGroups: SupplierGroup[]
} {
  const alloc = allocatedMap(jobs, items)
  const shortfalls = computeJobShortfalls(jobs, items, stocks)
  const jobById = new Map(jobs.map((j) => [j.id, j]))

  const shortItems: OrderCard[] = []
  const zeroItems: OrderCard[] = []

  for (const s of stocks) {
    const a = alloc[s.id] ?? 0
    const avail = s.qty - a
    if (avail < 0) {
      // Only jobs actually attributed the shortfall belong on a SHORT card.
      const allocJobs: { job: Job; qty: number }[] = []
      for (const [jobIdStr, m] of Object.entries(shortfalls)) {
        const q = m[s.id]
        if (q) {
          const job = jobById.get(Number(jobIdStr))
          if (job) allocJobs.push({ job, qty: q })
        }
      }
      shortItems.push({ stock: s, avail, alloc: a, toOrder: -avail, kind: 'short', allocJobs })
    } else if (s.qty === 0 && a > 0) {
      // ZERO card: every allocated job legitimately listed.
      const allocJobs = items
        .filter((it) => it.stock_id === s.id && it.status === 'assigned')
        .map((it) => ({ job: jobById.get(it.job_id), qty: it.qty }))
        .filter((x): x is { job: Job; qty: number } => !!x.job && !isClosed(x.job.stage, x.job.step))
      zeroItems.push({ stock: s, avail, alloc: a, toOrder: 0, kind: 'zero', allocJobs })
    }
  }

  const affected = new Set<number>()
  for (const c of shortItems) c.allocJobs.forEach((x) => affected.add(x.job.id))
  const totalUnitsToOrder = shortItems.reduce((sum, c) => sum + c.toOrder, 0)

  const groups = new Map<number | null, SupplierGroup>()
  for (const card of [...shortItems, ...zeroItems]) {
    const key = card.stock.supplier_id
    const g = groups.get(key) ?? {
      supplier: suppliers.find((sp) => sp.id === key) ?? null,
      short: [],
      zero: [],
    }
    if (card.kind === 'short') g.short.push(card)
    else g.zero.push(card)
    groups.set(key, g)
  }

  return {
    shortItems,
    zeroItems,
    totalJobsAffected: affected.size,
    totalUnitsToOrder,
    supplierGroups: [...groups.values()].sort((a, b) =>
      (a.supplier?.name ?? 'zzz').localeCompare(b.supplier?.name ?? 'zzz')
    ),
  }
}

/** Same-day install clash list: booked jobs not yet installed (port of
 * bookedInstalls, line 7331 — cross-job, same-day granularity). */
export function bookedInstalls(jobs: Job[], excludeId?: number): { date: string; job: Job }[] {
  return jobs
    .filter((j) => j.planned_install_date && !j.install_completion_date && j.id !== excludeId)
    .map((j) => ({ date: j.planned_install_date!, job: j }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
