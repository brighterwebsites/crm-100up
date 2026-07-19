export function fmtDate(d: string | null | undefined): string {
  if (!d) return ''
  const dt = new Date(d + (d.length === 10 ? 'T00:00:00' : ''))
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtMoney(v: number | null | undefined): string {
  if (!v) return '$0'
  return v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })
}

export function todayISO(): string {
  return new Date().toLocaleDateString('en-CA') // YYYY-MM-DD local
}
