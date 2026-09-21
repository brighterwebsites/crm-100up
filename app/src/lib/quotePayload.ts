/**
 * The calculator → CRM quote handoff.
 *
 * V46 builds this payload at line 2717 (`buildQuotePayload`) and copies it to
 * the clipboard; the CRM pastes it into "Link quote". The rebuilt Calculator
 * had the engine and the CRM had the receiver, but the button joining them was
 * never ported — so this module is the join, shared by both ends.
 *
 * **v2 carries `stockId`.** V46 could only emit part *names*, generated from
 * templates, which `normalizePart()` then had to fuzzy-match back against
 * `stocks.name` — the central failure in the quote → stock path, because a
 * miss is silent (`docs/design/quote-configurator-design.md`). The rebuilt engine
 * already knows which stock row each cost line IS: `CostLine.stockId`. Passing
 * it through removes the round trip for anything quoted in the new app.
 *
 * The name still travels, for two reasons: a v1 payload pasted from V46 has
 * nothing else to match on, and a human reading the JSON should be able to
 * tell what it is.
 */
import type { QuoteResult } from './quoteEngine'
import type { Tables } from '../types/database.types'

type Stock = Tables<'stocks'>

export interface QuoteBomLine {
  name: string
  qty: number
  cat?: string
  mapNeeded?: boolean
  /** v2 only. When present this IS the stock row — no name matching needed. */
  stockId?: number
}

export interface QuotePayload {
  v: number
  type: string
  brand?: string
  phase?: 'single' | 'three'
  panelCount?: number
  solarKw?: number
  batteryKwh?: number
  units?: number
  invKw?: number
  invCount?: number
  groundMount?: boolean
  roofPanels?: number
  gmPanels?: number
  price?: number
  system?: string
  bom?: QuoteBomLine[]
  createdAt?: number
}

export const QUOTE_TYPE = '100up-quote'

/** One-line system description, the field the job's `system_description` gets.
 *  Same shape as the headline under the price on the Calculator, so what Fred
 *  reads on screen is what lands on the job. */
export function systemText(r: QuoteResult): string {
  return (
    `${r.configLabel} — ${r.panelCount} panels (${r.solarKw.toFixed(2)} kW) · ` +
    `${r.invCount} × ${r.invKw} kW inverter · ` +
    `${r.batteryUnits} × battery (${r.batteryKwh.toFixed(2)} kWh usable)`
  )
}

/** Physical parts only. Labour, frames, machinery and fixed site costs are
 *  real money but they are not stock, and they carry no `stockId` — which is
 *  exactly how we tell them apart, rather than by matching on the label. */
export function buildQuotePayload(
  r: QuoteResult,
  stocks: Stock[],
  opts: { phase: 'single' | 'three'; roofPanels: number; gmPanels: number },
): QuotePayload {
  const byId = new Map(stocks.map((s) => [s.id, s]))
  const bom: QuoteBomLine[] = r.lines
    .filter((l) => l.stockId != null)
    .map((l) => ({
      // Prefer the catalogue name over the line label: the panel line reads
      // "<name> — supply", which is right on a cost breakdown and wrong as a
      // part name.
      name: byId.get(l.stockId!)?.name ?? l.label,
      qty: l.qty,
      stockId: l.stockId,
    }))

  return {
    v: 2,
    type: QUOTE_TYPE,
    brand: r.configLabel,
    phase: opts.phase,
    panelCount: r.panelCount,
    solarKw: Math.round(r.solarKw * 100) / 100,
    batteryKwh: r.batteryKwh,
    units: r.batteryUnits,
    invKw: r.invKw,
    invCount: r.invCount,
    groundMount: opts.gmPanels > 0,
    roofPanels: opts.roofPanels,
    gmPanels: opts.gmPanels,
    price: r.finalPrice,
    system: systemText(r),
    bom,
    createdAt: Date.now(),
  }
}
