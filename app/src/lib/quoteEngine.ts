/**
 * priceSystem() — the quoting engine.
 *
 * Replaces the five near-identical cost functions in 100UP_suite_V46.html
 * (costForWithConfig, costForGroundWithConfig, costFor3phWithConfig,
 * costFor3phWithConfigGround, plus the costFor* wrappers). There are no brand
 * branches here: V46 repeats `isSig = brand === 'Sigenergy'` five times, and
 * everything that depended on it is now a row in system_config_components.
 *
 * The arithmetic is a faithful port — the Phase B parity gate
 * (docs/phase-b-parity-gate.md) requires this to reproduce V46 to the cent,
 * excluding the documented divergences. Two deliberate differences:
 *
 *   1. Line items sum EXACTLY to base cost. V46 prints the inverter row
 *      inclusive of gateway/mounting/PDU and then lists those again, so its
 *      itemisation overshoots (bug #6). Totals were always right.
 *   2. Battery capacity comes from usable_kwh, never the nominal kwh column.
 *      Sizing on nominal would inflate every Sigenergy bank by ~14%.
 */
import { JULY_SOLAR_W_PER_KW } from './solarJuly'
import type { Tables } from '../types/database.types'

type Stock = Tables<'stocks'>
type Phase = 'single' | 'three'

export interface EngineSettings {
  pricing: { margin: number; gst: number }
  rebates: { solar_stc_per_kw: number; solar_stc_price: number; battery_stc_price: number }
  tiers: { from_kwh: number; to_kwh: number | null; stc_per_kwh: number }[]
  sizing: {
    solar_oversize_percent: number
    solar_oversize_3ph_percent: number
    max_batteries_per_inverter: number
    min_inverters: number
  }
  fixedCosts: { label: string; amount: number }[]
  panels: { stock_id: number | null; install_cost_per_w: number; roof_frame_per_panel: number }
  groundMount: { labour_per_panel: number; machinery_fixed: number; ballpark_frame_per_panel: number }
  loadProfile: number[]
}

export interface ConfigBundle {
  id: number
  label: string
  standby_w: number
  inverters: { stock_id: number; oversize_percent: number | null; max_batteries: number | null }[]
  batteries: { stock_id: number; is_default: boolean }[]
  components: {
    stock_id: number
    rule: string
    qty: number
    divisor: number
    phase_scope: 'single' | 'three' | 'na'
  }[]
}

export interface QuoteInput {
  phase: Phase
  roofPanels: number
  gmPanels: number
  batteryUnits: number
  batteryStockId?: number
  /** null = auto-select the tier; a stock_id pins one. */
  pinnedInverterId?: number | null
  /** Per-quote floor, for redundancy. V46's "dual" is exactly this — it only
   *  ever passed minInv = 2 (design doc D2). */
  minInverters?: number
}

export interface CostLine {
  label: string
  qty: number
  unitCost: number
  total: number
  stockId?: number
}

export interface QuoteResult {
  configLabel: string
  panelCount: number
  solarKw: number
  invCount: number
  invKw: number
  inverterStockId: number
  batteryUnits: number
  batteryKwh: number
  lines: CostLine[]
  baseCost: number
  marginDollar: number
  basePlusMargin: number
  gstDollar: number
  afterMarginGst: number
  solarStcs: number
  batteryStcs: number
  solarRebate: number
  batteryRebate: number
  rebate: number
  finalPrice: number
}

const ceil = Math.ceil

/** Hourly load from the 24-value relative-weight profile, normalised by sum. */
function hourlyLoadKwh(dailyKwh: number, hour: number, profile: number[]): number {
  const sum = profile.reduce((s, x) => s + x, 0) || 1
  return dailyKwh * (profile[hour] / sum)
}

/** July hourly battery simulation — the worst month, so surviving it is the
 *  proof the system works year-round. Faithful port of V46's simulate(). */
export function simulate(
  solarKw: number,
  batteryKwh: number,
  dailyKwh: number,
  standbyW: number,
  profile: number[]
) {
  const standbyPerHour = (Number(standbyW) || 0) / 1000
  let soc = batteryKwh
  let minSoc = batteryKwh
  let unmet = 0
  let spilled = 0
  for (let i = 0; i < JULY_SOLAR_W_PER_KW.length; i++) {
    const production = (solarKw * JULY_SOLAR_W_PER_KW[i]) / 1000
    const load = hourlyLoadKwh(dailyKwh, i % 24, profile) + standbyPerHour
    soc += production - load
    if (soc > batteryKwh) { spilled += soc - batteryKwh; soc = batteryKwh }
    if (soc < 0) { unmet += -soc; soc = 0 }
    if (soc < minSoc) minSoc = soc
  }
  return { passes: unmet < 0.00001, unmet, minSoc, spilled }
}

/** Battery STCs, banded. Bands come from data now — they were hardcoded at
 *  14/28/50 kWh in V46, so a legislated change meant a code edit. */
export function batteryStcCount(kwh: number, tiers: EngineSettings['tiers']): number {
  let stc = 0
  for (const t of tiers) {
    const upper = t.to_kwh ?? Infinity
    const inBand = Math.min(kwh, upper) - t.from_kwh
    if (inBand > 0) stc += inBand * t.stc_per_kwh
  }
  return stc
}

/** Component quantity from its rule. This is what replaces
 *  `gatewayCount = ceil(invCount/3)` and friends. */
function componentQty(
  rule: string, qty: number, divisor: number,
  ctx: { invCount: number; batteryUnits: number; panelCount: number; solarKw: number }
): number {
  const d = Math.max(1, divisor)
  switch (rule) {
    case 'per_inverter':     return qty * ctx.invCount
    case 'per_n_inverters':  return qty * ceil(ctx.invCount / d)
    case 'per_battery':      return qty * ctx.batteryUnits
    case 'per_n_batteries':  return qty * ceil(ctx.batteryUnits / d)
    case 'per_panel':        return qty * ctx.panelCount
    case 'per_kw_solar':     return qty * ceil(ctx.solarKw / d)
    case 'per_system':
    default:                 return qty
  }
}

/** Round units up to a whole multiple of the FORCED floor, so batteries split
 *  evenly across redundant inverters. Deliberately measured against
 *  min_inverters, not the derived count — the latter is circular, since the
 *  count depends on the units (design doc D2). */
export function applyBatteryParity(units: number, minInverters: number): number {
  if (minInverters <= 1) return units
  return ceil(units / minInverters) * minInverters
}

export function priceSystem(
  config: ConfigBundle,
  input: QuoteInput,
  stocks: Stock[],
  settings: EngineSettings
): QuoteResult | null {
  const byId = new Map(stocks.map((s) => [s.id, s]))
  const panel = input.roofPanels + input.gmPanels > 0 && settings.panels.stock_id
    ? byId.get(settings.panels.stock_id)
    : undefined
  if (!panel) return null

  const panelCount = input.roofPanels + input.gmPanels
  const panelW = panel.watts ?? 0
  const solarKw = (panelCount * panelW) / 1000

  const battery = byId.get(
    input.batteryStockId ?? config.batteries.find((b) => b.is_default)?.stock_id ?? -1
  )
  if (!battery) return null

  const minInv = Math.max(1, input.minInverters ?? settings.sizing.min_inverters)
  const units = applyBatteryParity(Math.max(0, input.batteryUnits), minInv)

  const globalOversize = input.phase === 'three'
    ? settings.sizing.solar_oversize_3ph_percent
    : settings.sizing.solar_oversize_percent

  // Candidate inverter tiers: this config's, matching the quote's phase.
  // Phase comes from the product, which is what makes an incompatible
  // selection structurally impossible rather than merely discouraged.
  const candidates = config.inverters
    .map((t) => ({ tier: t, s: byId.get(t.stock_id) }))
    .filter((c): c is { tier: typeof config.inverters[0]; s: Stock } =>
      !!c.s && c.s.active && c.s.phase === input.phase &&
      (input.pinnedInverterId == null || c.s.id === input.pinnedInverterId))
  if (!candidates.length) return null

  const evaluate = (tier: typeof config.inverters[0], inv: Stock) => {
    const invKw = inv.kw ?? 0
    const oversize = tier.oversize_percent ?? globalOversize
    const maxBatt = tier.max_batteries ?? settings.sizing.max_batteries_per_inverter
    const maxSolarPerInv = invKw * (oversize / 100)
    const invForSolar = Math.max(minInv, maxSolarPerInv > 0 ? ceil(solarKw / maxSolarPerInv) : minInv)
    const invForBatt = maxBatt > 0 ? ceil(units / maxBatt) : 0
    const invCount = Math.max(invForSolar, invForBatt)
    return { inv, invKw, invCount }
  }

  // Same ranking V46's _sig3phBest uses: fewest inverters, then lowest total
  // inverter spend, then largest kW on a tie.
  let best = null as ReturnType<typeof evaluate> | null
  for (const c of candidates) {
    const r = evaluate(c.tier, c.s)
    if (
      !best ||
      r.invCount < best.invCount ||
      (r.invCount === best.invCount &&
        r.invCount * r.inv.planning_cost < best.invCount * best.inv.planning_cost) ||
      (r.invCount === best.invCount &&
        r.invCount * r.inv.planning_cost === best.invCount * best.inv.planning_cost &&
        r.invKw > best.invKw)
    ) best = r
  }
  if (!best) return null
  const { inv, invKw, invCount } = best

  const lines: CostLine[] = []
  const push = (label: string, qty: number, unitCost: number, stockId?: number) =>
    lines.push({ label, qty, unitCost, total: qty * unitCost, stockId })

  // Panels. Ground-mounted panels install at half rate — they are at waist
  // height, not on a roof.
  push(`${panel.name} — supply`, panelCount, panel.planning_cost, panel.id)
  if (input.roofPanels > 0)
    push('Panel install — roof', input.roofPanels, panelW * settings.panels.install_cost_per_w)
  if (input.gmPanels > 0)
    push('Panel install — ground (50%)', input.gmPanels, panelW * settings.panels.install_cost_per_w * 0.5)
  if (input.roofPanels > 0)
    push('Roof frame', input.roofPanels, settings.panels.roof_frame_per_panel)

  push(inv.name, invCount, inv.planning_cost, inv.id)
  push(battery.name, units, battery.planning_cost, battery.id)

  const ctx = { invCount, batteryUnits: units, panelCount, solarKw }
  for (const comp of config.components) {
    if (comp.phase_scope !== 'na' && comp.phase_scope !== input.phase) continue
    const s = byId.get(comp.stock_id)
    if (!s || !s.active) continue
    const q = componentQty(comp.rule, comp.qty, comp.divisor, ctx)
    if (q > 0) push(s.name, q, s.planning_cost, s.id)
  }

  for (const f of settings.fixedCosts) push(f.label, 1, f.amount)

  if (input.gmPanels > 0) {
    push('Ground mount frame', input.gmPanels, settings.groundMount.ballpark_frame_per_panel)
    push('Ground mount labour', input.gmPanels, settings.groundMount.labour_per_panel)
    push('Machinery', 1, settings.groundMount.machinery_fixed)
  }

  // Base cost is the SUM OF THE LINES, never computed alongside them — that
  // divergence is precisely bug #6.
  const baseCost = lines.reduce((s, l) => s + l.total, 0)
  const marginDollar = baseCost * settings.pricing.margin
  const basePlusMargin = baseCost + marginDollar
  const gstDollar = basePlusMargin * settings.pricing.gst
  const afterMarginGst = basePlusMargin + gstDollar

  const batteryKwh = units * (battery.usable_kwh ?? 0)
  const solarStcs = solarKw * settings.rebates.solar_stc_per_kw
  const batteryStcs = batteryStcCount(batteryKwh, settings.tiers)
  const solarRebate = solarStcs * settings.rebates.solar_stc_price
  const batteryRebate = batteryStcs * settings.rebates.battery_stc_price
  const rebate = solarRebate + batteryRebate

  return {
    configLabel: config.label,
    panelCount, solarKw,
    invCount, invKw, inverterStockId: inv.id,
    batteryUnits: units, batteryKwh,
    lines, baseCost, marginDollar, basePlusMargin, gstDollar, afterMarginGst,
    solarStcs, batteryStcs, solarRebate, batteryRebate, rebate,
    finalPrice: Math.max(0, afterMarginGst - rebate),
  }
}

/** Smallest battery count that survives July, mirroring findMinUnitsWithFn.
 *  Returns the failing best-effort result when nothing in range passes, so the
 *  UI can say "generator required" rather than showing nothing. */
export function findMinUnits(
  config: ConfigBundle, input: Omit<QuoteInput, 'batteryUnits'>,
  stocks: Stock[], settings: EngineSettings,
  dailyKwh: number, startUnits: number, maxUnits: number
): { result: QuoteResult; units: number; passes: boolean } | null {
  const byId = new Map(stocks.map((s) => [s.id, s]))
  const battery = byId.get(
    input.batteryStockId ?? config.batteries.find((b) => b.is_default)?.stock_id ?? -1
  )
  const panel = settings.panels.stock_id ? byId.get(settings.panels.stock_id) : undefined
  if (!battery || !panel) return null

  const minInv = Math.max(1, input.minInverters ?? settings.sizing.min_inverters)
  const step = minInv > 1 ? minInv : 1
  const solarKw = ((input.roofPanels + input.gmPanels) * (panel.watts ?? 0)) / 1000

  let last: QuoteResult | null = null
  for (let u = applyBatteryParity(Math.max(1, startUnits), minInv); u <= maxUnits; u += step) {
    const sim = simulate(
      solarKw, u * (battery.usable_kwh ?? 0), dailyKwh, config.standby_w, settings.loadProfile
    )
    const result = priceSystem(config, { ...input, batteryUnits: u }, stocks, settings)
    if (!result) return null
    last = result
    if (sim.passes) return { result, units: u, passes: true }
  }
  return last ? { result: last, units: last.batteryUnits, passes: false } : null
}

/** Sweep panel counts and return the cheapest system that survives July.
 *
 * Mirrors V46's runCalc MODE A. Note what it does NOT do: V46 discarded the
 * inverter mode in optimise+ground (bug #8), silently ignoring both "force
 * large" and "dual" and quietly skipping battery parity with them. Here the
 * mode is an input to every path, so ground mount behaves like roof.
 */
export function optimisePanels(
  config: ConfigBundle,
  base: Omit<QuoteInput, 'batteryUnits' | 'roofPanels' | 'gmPanels'>,
  stocks: Stock[], settings: EngineSettings,
  opts: {
    dailyKwh: number; minPanels: number; maxPanels: number; step: number
    gmPanels: number; startUnits: number; maxUnits: number
  }
): { result: QuoteResult; passes: boolean } | null {
  let best: { result: QuoteResult; passes: boolean } | null = null
  let fallback: { result: QuoteResult; passes: boolean } | null = null

  for (let total = opts.minPanels; total <= opts.maxPanels; total += Math.max(1, opts.step)) {
    const gm = Math.min(opts.gmPanels, total)
    const found = findMinUnits(
      config,
      { ...base, roofPanels: total - gm, gmPanels: gm },
      stocks, settings, opts.dailyKwh, opts.startUnits, opts.maxUnits
    )
    if (!found) continue
    if (!found.passes) {
      // Keep the closest near-miss so the UI can show "generator required"
      // rather than an empty card.
      if (!fallback) fallback = { result: found.result, passes: false }
      continue
    }
    if (!best || found.result.finalPrice < best.result.finalPrice) {
      best = { result: found.result, passes: true }
    }
  }
  return best ?? fallback
}
