import { supabase } from '../../lib/supabaseClient'
import type { CesSpec, Job, JobStockItem, Stock } from '../../lib/data'
import { PIPELINE, stepLabel } from '../../lib/pipeline'
import { fmtDate } from '../../lib/format'

export async function advanceJob(job: Job, date?: string | null): Promise<Job> {
  const { data, error } = await supabase.rpc('advance_job_stage', {
    p_job_id: job.id,
    p_expected_version: job.version,
    p_date: date ?? undefined,
  })
  if (error) throw new Error(error.message)
  return data as Job
}

export async function moveJobBack(job: Job): Promise<Job> {
  const { data, error } = await supabase.rpc('move_job_back', {
    p_job_id: job.id,
    p_expected_version: job.version,
  })
  if (error) throw new Error(error.message)
  return data as Job
}

export async function rescheduleBooking(job: Job, newDate: string): Promise<Job> {
  const { data, error } = await supabase.rpc('reschedule_booking', {
    p_job_id: job.id,
    p_expected_version: job.version,
    p_new_date: newDate,
  })
  if (error) throw new Error(error.message)
  return data as Job
}

export async function applyPendingNow(jobId: number): Promise<number> {
  const { data, error } = await supabase.rpc('apply_pending_bom_now', { p_job_id: jobId })
  if (error) throw new Error(error.message)
  return data ?? 0
}

/** Optimistic-locked direct update (non-guarded columns only — the DB
 * rejects stage/date writes through this path by design). */
export async function updateJob(job: Job, patch: Partial<Job>): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .update(patch)
    .eq('id', job.id)
    .eq('version', job.version)
    .select()
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error('version_conflict: this job changed on another device — refreshing')
  }
  return data[0]
}

export async function createJob(name: string): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .insert({ name: name.trim() || 'New customer' })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

/** Port of copyJobDetails (line 7553) — plain text for email/SMS. */
export function jobDetailsText(job: Job, items: JobStockItem[], stocks: Stock[]): string {
  const lines: string[] = []
  lines.push(`JOB SUMMARY — ${job.name}`)
  lines.push('─'.repeat(36))
  if (job.location) lines.push(`📍 ${job.location}`)
  if (job.phone) lines.push(`📱 ${job.phone}`)
  if (job.email) lines.push(`✉  ${job.email}`)
  if (job.system_description) lines.push(`\n🔧 System: ${job.system_description}`)
  if (job.date_booked || job.install_date) {
    lines.push('')
    if (job.date_booked) lines.push(`📅 Install booked: ${fmtDate(job.date_booked)}`)
    if (job.install_date) lines.push(`✅ Install complete: ${fmtDate(job.install_date)}`)
  }
  const assigned = items.filter((i) => i.job_id === job.id && i.status === 'assigned')
  if (assigned.length) {
    lines.push('\n📦 Stock assigned:')
    for (const it of assigned) {
      const s = stocks.find((x) => x.id === it.stock_id)
      lines.push(`   • ${s?.name ?? `stock #${it.stock_id}`} × ${it.qty}`)
    }
  }
  lines.push(`\nPipeline: ${PIPELINE[job.stage]?.name} › ${stepLabel(job.stage, job.step)}`)
  return lines.join('\n')
}

// ── CES summary (port of buildCesData/buildCesTableHtml, lines 6886-6952,
// verified against the Book3 / Ann Schluter ground truth format) ──

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function fmtCesDate(d: string | null): string {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt.getTime())) return esc(d)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`
}

export interface CesResult {
  html: string
  warnings: string[]
  empty: boolean
}

export function buildCes(
  job: Job,
  items: JobStockItem[],
  stocks: Stock[],
  cesSpecs: CesSpec[]
): CesResult {
  // Prefer what was actually consumed at install; fall back to assigned.
  const jobItems = items.filter((i) => i.job_id === job.id)
  const consumed = jobItems.filter((i) => i.status === 'consumed')
  const use = consumed.length > 0 ? consumed : jobItems.filter((i) => i.status === 'assigned')

  const specById = new Map(cesSpecs.map((c) => [c.stock_id, c]))
  const groups: Record<'battery' | 'inverter' | 'panel', { c: CesSpec; qty: number }[]> = {
    battery: [],
    inverter: [],
    panel: [],
  }
  const unknown: string[] = []
  const verify = new Set<string>()

  for (const it of use) {
    const c = specById.get(it.stock_id)
    const stockName = stocks.find((s) => s.id === it.stock_id)?.name ?? `stock #${it.stock_id}`
    if (!c) {
      unknown.push(stockName)
      continue
    }
    if (c.category === 'other') continue
    if (!c.verified) verify.add(c.model)
    groups[c.category].push({ c, qty: it.qty })
  }

  let totalW = 0
  for (const p of groups.panel) totalW += (p.c.watts ?? 0) * p.qty
  const totalKw = Math.round(totalW / 10) / 100

  const HDR = '#D9D9D9'
  const tdC = 'padding:4px 8px;border:1px solid #999;text-align:center;vertical-align:middle'
  const th = `${tdC};background:${HDR};font-weight:bold`
  const E = `<td style="${tdC}"></td>`
  const EH = `<td style="${th}"></td>`
  let rows = ''

  if (groups.battery.length) {
    rows += `<tr><td style="${th}">Battery system manufacture</td><td style="${th}">Battery Model</td><td style="${th}">nominal capacity kW</td><td style="${th}">Nominal storage capacity kWh</td><td style="${th}">Number of battery systems</td></tr>`
    for (const b of groups.battery) {
      rows += `<tr><td style="${tdC}">${esc(b.c.manufacturer)}</td><td style="${tdC}">${esc(b.c.model)}</td><td style="${tdC}">${b.c.kw ?? ''}</td><td style="${tdC}">${b.c.kwh != null ? Math.round(b.c.kwh * b.qty * 100) / 100 : ''}</td><td style="${tdC}">${b.qty}</td></tr>`
    }
  }
  if (groups.inverter.length) {
    rows += `<tr><td style="${th}">Inverter Manufacturer</td><td style="${th}">Inverter Model</td><td style="${th}">inverter capacity kVa</td><td style="${th}">Number of inverters installed</td>${EH}</tr>`
    for (const v of groups.inverter) {
      rows += `<tr><td style="${tdC}">${esc(v.c.manufacturer)}</td><td style="${tdC}">${esc(v.c.model)}</td><td style="${tdC}">${v.c.kva ?? ''}</td><td style="${tdC}">${v.qty}</td>${E}</tr>`
    }
  }
  if (groups.panel.length) {
    rows += `<tr><td style="${th}">Solar panels manufacture</td><td style="${th}">Panels model</td><td style="${th}">Capacity W</td><td style="${th}">Number of panels</td>${EH}</tr>`
    for (const p of groups.panel) {
      rows += `<tr><td style="${tdC}">${esc(p.c.manufacturer)}</td><td style="${tdC}">${esc(p.c.model)}</td><td style="${tdC}">${p.c.watts ?? ''}</td><td style="${tdC}">${p.qty}</td>${E}</tr>`
    }
  }
  const locLines: string[] = []
  if (job.name) locLines.push(job.name)
  if (job.location) locLines.push(job.location)
  if (job.email) locLines.push('Email: ' + job.email)
  locLines.push('Phone:' + (job.phone ? ' ' + job.phone : ''))
  rows += `<tr><td style="${th}">install location</td><td style="${th}">Total rated capacity kW</td><td style="${th}">Installation date</td>${EH}${EH}</tr>`
  rows += `<tr><td style="${tdC};text-align:left;vertical-align:top">${locLines.map(esc).join('<br>')}</td><td style="${tdC}">${groups.panel.length ? totalKw : ''}</td><td style="${tdC}">${fmtCesDate(job.install_date || job.date_booked)}</td>${E}${E}</tr>`

  const empty = !groups.battery.length && !groups.inverter.length && !groups.panel.length
  const warnings: string[] = []
  if (empty) {
    warnings.push(
      'No matching stock on this job yet — assign the inverter, battery and panels first, then re-open this.'
    )
  } else {
    if (!groups.panel.length)
      warnings.push('No solar panels on this job’s stock, so the panel block and total kW are blank.')
    if (!groups.inverter.length) warnings.push('No inverter on this job’s stock.')
    if (!groups.battery.length) warnings.push('No battery on this job’s stock.')
  }
  if (unknown.length)
    warnings.push(
      `Not in the CES catalogue (skipped): ${unknown.join(', ')}. Add specs on the Stock page.`
    )
  if (verify.size)
    warnings.push(
      `⚠ Verify these model strings / standards against your CEC listing before sending: ${[...verify].join('; ')}.`
    )

  return {
    html: `<table style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000">${rows}</table>`,
    warnings,
    empty,
  }
}

/** Purchase-order print HTML — derived output only, nothing persisted
 * (same as the old printSupplierPO/printJobPO family). */
export function buildPoHtml(
  title: string,
  ref: string,
  supplierName: string | null,
  lines: { name: string; qty: number }[]
): string {
  const rows = lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 10px;border:1px solid #ccc">${esc(l.name)}</td><td style="padding:6px 10px;border:1px solid #ccc;text-align:center">${l.qty}</td></tr>`
    )
    .join('')
  return `<!doctype html><html><head><title>${esc(title)} — ${esc(ref)}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;padding:30px">
<h2 style="margin:0 0 4px">100UP Solar — Purchase Order</h2>
<div style="color:#555;margin-bottom:18px">${esc(ref)} · ${new Date().toLocaleDateString('en-AU')}${supplierName ? ' · Supplier: ' + esc(supplierName) : ''}</div>
<table style="border-collapse:collapse;min-width:420px">
<tr><th style="padding:6px 10px;border:1px solid #ccc;background:#eee;text-align:left">Item</th><th style="padding:6px 10px;border:1px solid #ccc;background:#eee">Qty</th></tr>
${rows}</table>
<p style="color:#777;margin-top:24px;font-size:12px">Generated by 100UP CRM — print or save as PDF.</p>
<script>window.print()</script></body></html>`
}

export function openPrintWindow(html: string) {
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}
