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

/** Currency WITH cents. The quote breakdown needs these — the parity gate
 * tolerance is $0.00, so rounding to whole dollars for display would hide the
 * very differences it exists to catch. fmtMoney stays whole-dollar for lists
 * and cards where cents are noise. */
export function fmtMoneyExact(v: number | null | undefined): string {
  return (v ?? 0).toLocaleString('en-AU', {
    style: 'currency', currency: 'AUD',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
}

/** "12 minutes ago", "yesterday", "3 Sept". Short enough to sit in a table
 *  cell, and precise where precision matters — the difference between "4
 *  minutes ago" and "4 hours ago" is the whole question when you are asking
 *  whether someone is working right now. */
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'unknown'
  const mins = Math.floor((Date.now() - then) / 60_000)
  if (mins < 1) return 'just now'
  if (mins === 1) return '1 minute ago'
  if (mins < 60) return `${mins} minutes ago`
  const hrs = Math.floor(mins / 60)
  if (hrs === 1) return '1 hour ago'
  if (hrs < 24) return `${hrs} hours ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return fmtDate(iso)
}
