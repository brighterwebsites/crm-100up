// Faithful port of normalizePart() from 100UP_suite_V46.html (line 4725):
// maps free-text part names (from supplier invoices / calculator quotes)
// to canonical stock names so lines match existing stock items.

export interface NormalizedPart {
  key: string
  name: string | null
}

export function normalizePart(raw: string | null | undefined): NormalizedPart {
  const clean = (raw || '').toLowerCase().replace(/[()_·]/g, ' ').replace(/\s+/g, ' ').trim()
  let m: RegExpMatchArray | null
  const isSig = /\bsig(en|enstor)?\b/.test(clean) || /sigen|sigenstor/.test(clean)

  // Sigenergy battery: BAT x.0 (the "BAT n.0" naming is Sigenergy-specific)
  if ((isSig || /\bbat(?:tery)?\s*[0-9]/.test(clean)) && (m = clean.match(/bat(?:tery)?\s*([0-9]+(?:\.[0-9])?)/))) {
    const n = Math.round(parseFloat(m[1]))
    return { key: 'sig-bat-' + n, name: 'SigenStor BAT ' + n + '.0' }
  }
  // Sigenergy energy controller: EC x SP/TP
  if (isSig) {
    if ((m = clean.match(/ec\s*([0-9]+(?:\.[0-9])?)\s*(sp|tp)?/))) {
      const n = Math.round(parseFloat(m[1]))
      const ph = m[2] === 'tp' ? 'TP' : m[2] === 'sp' ? 'SP' : n >= 15 ? 'TP' : 'SP'
      return { key: 'sig-ec-' + n + '-' + ph.toLowerCase(), name: 'SigenStor EC ' + n + '.0 ' + ph }
    }
    if (/invert|controller/.test(clean) && (m = clean.match(/([0-9]+(?:\.[0-9])?)\s*kw/))) {
      const n = Math.round(parseFloat(m[1]))
      const ph = n >= 15 ? 'TP' : 'SP'
      return { key: 'sig-ec-' + n + '-' + ph.toLowerCase(), name: 'SigenStor EC ' + n + '.0 ' + ph }
    }
    if (/mount|kit/.test(clean)) return { key: 'sig-mount', name: 'SigenStor mounting kit' }
  }
  // Sigen gateway (with or without 'sigen')
  if (/gateway/.test(clean)) {
    const three = /three|3\s*ph|3ph|\btp\b|\bc60\b/.test(clean)
    return three
      ? { key: 'sig-gw-3p', name: 'Sigen Gateway C60 AU' }
      : { key: 'sig-gw-1p', name: 'Sigen Gateway HomePro SP-F AU' }
  }
  // Deye
  if (/deye/.test(clean)) {
    if (/pdu/.test(clean)) return { key: 'deye-pdu', name: 'Deye AI-W5.1-PDU3' }
    if (/base/.test(clean)) return { key: 'deye-base', name: 'Deye AI-W5.1-Base' }
    if ((m = clean.match(/([0-9]+)\s*p\s*([13])/))) {
      const kw = m[1]
      const ph = m[2]
      return { key: 'deye-inv-' + kw + 'p' + ph, name: 'Deye AI-W5.1-' + kw + 'P' + ph + '-AU-B' }
    }
    if (/invert/.test(clean) && (m = clean.match(/([0-9]+)\s*kw/))) {
      const kw = m[1]
      const ph = kw === '8' ? '1' : '3'
      return { key: 'deye-inv-' + kw + 'p' + ph, name: 'Deye AI-W5.1-' + kw + 'P' + ph + '-AU-B' }
    }
    if (/w5\.?1\s*-?\s*b\b/.test(clean) || /batter/.test(clean) || /5\.1\s*-?b\b/.test(clean)) {
      return { key: 'deye-bat', name: 'Deye AI-W5.1-B' }
    }
  }
  // Solar panels: generic name by wattage only — brand is CES metadata,
  // not stock identity (Fred's rule).
  if ((m = clean.match(/([0-9]{3})\s*w?\b/)) && /(jinko|jinco|trina|risen|longi|panel|solar)/.test(clean)) {
    return { key: 'panel-' + m[1], name: 'Solar panel ' + m[1] + 'W' }
  }
  return { key: 'raw:' + clean, name: null }
}

/** Match a free-text part name to an existing stock item by canonical key,
 * falling back to case-insensitive exact name match. */
export function matchStock<T extends { id: number; name: string }>(
  name: string,
  stocks: T[]
): T | null {
  const { key } = normalizePart(name)
  for (const s of stocks) {
    if (normalizePart(s.name).key === key) return s
  }
  const lower = name.toLowerCase().trim()
  return stocks.find((s) => s.name.toLowerCase().trim() === lower) ?? null
}
