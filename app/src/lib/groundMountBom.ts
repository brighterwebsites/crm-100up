/**
 * Ground Mount BOM — port of V46's calcGmBom (line 3985).
 *
 * Pure geometry: panel width, row length and array count decide every
 * quantity. The formulas are a faithful port, including their quirks, and the
 * derived constants (2700mm post spacing, 300mm overhang, 5800mm rail) come
 * from Fred's original Excel.
 *
 * **What changed: where the money comes from.** V46 kept unit costs in a
 * localStorage blob keyed by part code (`GM_DEFAULT_COSTS`, line 3920) —
 * invisible to stock control, unorderable, uncountable, and lost with the
 * browser profile. Those 20 parts are now real `stocks` rows
 * (`product_type = 'gm_component'`, `model` carrying the part code, seeded by
 * `20260811120001`), so a ground-mount BOM prices off the same catalogue as
 * everything else and the parts can be ordered and counted.
 *
 * Quantities and weights stay here, in code. They are geometry and product
 * spec, not inventory: no quantity of a brace arm is ever "the" quantity, it
 * depends on the array you are building.
 */

const SPACING = 2700
const OVERHANG = 300
const RAIL_LEN = 5800

export interface GmInput {
  /** Panel width in mm, along the row. */
  panelWidth: number
  /** Panel frame thickness, mm. Selects the end clamp: 35 or 30. */
  panelThick: 30 | 35
  /** Watts per panel — for the total-power KPI only, never a quantity. */
  panelPower: number
  panelsPerRow: number
  numArrays: number
}

export interface GmBomRow {
  code: string
  desc: string
  sku: string
  /** L&H order code. '—' where the part is not orderable from them. */
  lh: string
  perArray: number
  qty: number
  weightEach: number
  weightTotal: number
  unitCost: number
  lineCost: number
  /** The catalogue row this priced off, when one matched on `model`. */
  stockId?: number
}

export interface GmBomResult {
  rows: GmBomRow[]
  arrayLength: number
  realisedSpacing: number
  totalPanels: number
  totalPowerKw: number
  totalWeightKg: number
  totalCost: number
  costPerPanel: number
  /** Part codes with no matching `gm_component` stock row. Priced at 0, and
   *  said out loud rather than silently dropped — the failure mode that makes
   *  the quote→stock regex so dangerous elsewhere. */
  unmatched: string[]
}

/** Part table. `perArray` is filled per calculation; these are the fixed
 *  attributes V46 carried inline in its `bomRows` literal. */
type PartSpec = { code: string; desc: string; sku: string; lh: string; wt: number }

const PARTS: Record<string, PartSpec> = {
  m12x25:       { code: '100-0119',    desc: 'M12x25mm Nickel Zinc',               sku: 'RDRGM-NZ-M12X25',     lh: '6134717417', wt: 0.042 },
  m12x90:       { code: '100-0120',    desc: 'M12x90mm Nickel Zinc',               sku: 'RDRGM-NZ-M12X90',     lh: '6134717418', wt: 0.100 },
  m12x110:      { code: '100-0121',    desc: 'M12x110mm Nickel Zinc',              sku: 'RDRGM-NZ-M12X90',     lh: '6134717418', wt: 0.110 },
  m12Nut:       { code: '101-0036',    desc: 'M12 Nut Nickel Zinc',                sku: 'RDRGM-NZ-M12-NUT',    lh: '6134717414', wt: 0.020 },
  rubberCap:    { code: '102-0022',    desc: 'Rubber Cap for ground screw',        sku: 'RDRGM-RUBBER-GS',     lh: '6134717420', wt: 0.024 },
  m12Washer:    { code: '104-0028',    desc: 'M12 Washer, Nickel Zinc',            sku: 'RDRGM-NZ-M12-WASHER', lh: '6134717415', wt: 0.012 },
  groundScrews: { code: '110-0002-16', desc: 'Ground screw, 1.6m, Std Thread',     sku: 'RDRGM-GS-1.6M',       lh: '6134717410', wt: 8.350 },
  hdgScrews:    { code: '100-0131',    desc: 'HDG Screws for ground screw',        sku: '—',                   lh: '—',          wt: 0 },
  frontPost:    { code: '153-0003',    desc: 'Front Post 849mm',                   sku: 'RDRGM-FRONTPOST',     lh: '6134717409', wt: 2.970 },
  backPost:     { code: '154-0005',    desc: 'Back Post 2119mm',                   sku: 'RDRGM-BACKPOST',      lh: '6134717405', wt: 7.400 },
  rails:        { code: '155-0020',    desc: 'C Purlin Rail 100x50x1.5mm, 5800mm', sku: 'RDRGM-CPURLIN',       lh: '6134717407', wt: 14.860 },
  joiners:      { code: '158-0014',    desc: 'Joiner Plate',                       sku: 'RDRGM-JOINER',        lh: '6134717411', wt: 0.670 },
  braceArm:     { code: '159-0003',    desc: 'Brace Arm, 1398mm',                  sku: 'RDRGM-BRACE',         lh: '6134717406', wt: 2.780 },
  uTruss:       { code: '161-0005',    desc: 'U Truss 1.5mm, 4020mm, 20-25-30°',   sku: 'RDRGM-UTRUSS',        lh: '6134717422', wt: 12.800 },
  midClamp:     { code: '301-0027',    desc: 'Mid Clamp with earthing',            sku: 'RDRGM-MIDCLAMP/G',    lh: '6134717412', wt: 0.110 },
  endClamp35:   { code: '302-0059',    desc: 'End Clamp with Earthing, 35mm',      sku: 'RDRGM-ENDCLAMP',      lh: '6134717408', wt: 0.115 },
  endClamp30:   { code: '302-0058',    desc: 'End Clamp with Earthing, 30mm',      sku: 'RDRGM-ENDCLAMP',      lh: '6134717408', wt: 0.115 },
  braceSlv:     { code: '312-0002',    desc: 'Brace Arm Sleeve',                   sku: 'RDRGM-SLEEVE',        lh: '6134717421', wt: 0.215 },
  spacer:       { code: '375-0001',    desc: 'Spacer',                             sku: 'RDRGM-SPACER',        lh: '6134819228', wt: 0.100 },
  railClamp:    { code: '376-0001',    desc: 'Rail Clamp',                         sku: 'RDRGM-RAILCLMAP',     lh: '6134717419', wt: 0.105 },
}

export function calcGroundMountBom(
  input: GmInput,
  stocks: { id: number; model: string; planning_cost: number; product_type: string }[],
): GmBomResult | null {
  const { panelWidth, panelThick, panelPower, panelsPerRow, numArrays } = input
  if (!panelWidth || !panelsPerRow || !numArrays) return null

  const up = Math.ceil

  // Derived geometry. The 16mm is the gap between panels and the 90mm the
  // end allowance; both come straight from the Excel.
  const arrayLength = panelWidth * panelsPerRow + 16 * (panelsPerRow - 1) + 90
  const realisedSpacing = (arrayLength - OVERHANG * 2) / up((arrayLength - OVERHANG * 2) / SPACING)
  const railUnits = arrayLength / RAIL_LEN

  // Per-array quantities, in V46's own order of derivation — several parts
  // are defined in terms of the ground-screw count, so it comes first.
  const groundScrews = (up((arrayLength - OVERHANG * 2 - SPACING * 0.8 * 2) / SPACING) + 1 + 2) * 2
  const joiners = 4 * (up(arrayLength / 5775) - 1)
  const uTruss = groundScrews / 2
  const rails = up(railUnits) * 4
  const frontPost = groundScrews / 2
  const backPost = groundScrews / 2
  const braceArm = groundScrews
  const braceSlv = groundScrews
  const spacer = braceArm * 2
  const railClamp = uTruss * 4
  const midClamp = (panelsPerRow - 1) * 4
  const endClamp = 8
  const hdgScrews = groundScrews * 3
  const rubberCap = groundScrews
  const m12x110 = groundScrews
  const m12x90 = 4 * uTruss
  const m12x25 = 10 * joiners
  const m12Nut = m12x25 + m12x110 + m12x90
  const m12Washer = 2 * (m12x90 + m12x110 + m12x25) - joiners * 2

  const perArray: [PartSpec, number][] = [
    [PARTS.m12x25, m12x25],
    [PARTS.m12x90, m12x90],
    [PARTS.m12x110, m12x110],
    [PARTS.m12Nut, m12Nut],
    [PARTS.rubberCap, rubberCap],
    [PARTS.m12Washer, m12Washer],
    [PARTS.groundScrews, groundScrews],
    [PARTS.hdgScrews, hdgScrews],
    [PARTS.frontPost, frontPost],
    [PARTS.backPost, backPost],
    [PARTS.rails, rails],
    [PARTS.joiners, joiners],
    [PARTS.braceArm, braceArm],
    [PARTS.uTruss, uTruss],
    [PARTS.midClamp, midClamp],
    [panelThick === 35 ? PARTS.endClamp35 : PARTS.endClamp30, endClamp],
    [PARTS.braceSlv, braceSlv],
    [PARTS.spacer, spacer],
    [PARTS.railClamp, railClamp],
  ]

  // Price off the catalogue, matched on the part code in `stocks.model`.
  // An exact key, not a name regex — the ground-mount parts were seeded with
  // their codes precisely so this join is exact.
  const byCode = new Map(
    stocks.filter((s) => s.product_type === 'gm_component').map((s) => [s.model, s]),
  )

  const unmatched: string[] = []
  let totalWeightKg = 0
  let totalCost = 0

  const rows: GmBomRow[] = perArray.map(([part, per]) => {
    const qty = Math.round(per * numArrays * 10) / 10
    const stock = byCode.get(part.code)
    if (!stock && part.lh !== '—') unmatched.push(part.code)
    const unitCost = stock?.planning_cost ?? 0
    const weightTotal = part.wt * qty
    const lineCost = unitCost * qty
    totalWeightKg += weightTotal
    totalCost += lineCost
    return {
      code: part.code, desc: part.desc, sku: part.sku, lh: part.lh,
      perArray: per, qty,
      weightEach: part.wt, weightTotal,
      unitCost, lineCost,
      stockId: stock?.id,
    }
  })

  // Two rows per array — the frame carries a row at the front and one behind.
  const totalPanels = panelsPerRow * 2 * numArrays
  const totalPowerKw = (panelsPerRow * 2 * panelPower * numArrays) / 1000

  return {
    rows, arrayLength, realisedSpacing, totalPanels, totalPowerKw,
    totalWeightKg, totalCost,
    costPerPanel: totalPanels > 0 ? totalCost / totalPanels : 0,
    unmatched,
  }
}

/** Orderable lines only, for pasting into an order to L&H. Parts with no L&H
 *  code (the HDG screws) are deliberately left out — V46 filtered them from
 *  its CSV export for the same reason. */
export function gmOrderText(result: GmBomResult): string {
  return result.rows
    .filter((r) => r.lh && r.lh !== '—' && r.qty > 0)
    .map((r) => `${r.lh}\t${r.desc}\t${r.qty}`)
    .join('\n')
}
