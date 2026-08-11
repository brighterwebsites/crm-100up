// Scenario 1 of docs/phase-b-parity-gate.md, computed by the new engine and
// compared against V46's arithmetic worked through by hand from the same data.
import { priceSystem } from '../src/lib/quoteEngine'
import type { ConfigBundle, EngineSettings } from '../src/lib/quoteEngine'

const S = (o: Record<string, unknown>) => o as never // test fixtures, not DB rows

const stocks = [
  S({ id: 25, name: 'Solar panel 475W', product_type: 'panel', phase: 'na', active: true, planning_cost: 143, watts: 475, kw: null, kwh: null, usable_kwh: null }),
  S({ id: 5,  name: 'SigenStor EC 8.0 SP',  product_type: 'inverter', phase: 'single', active: true, planning_cost: 2500, kw: 8,  watts: null, kwh: null, usable_kwh: null }),
  S({ id: 1,  name: 'SigenStor EC 12.0 SP', product_type: 'inverter', phase: 'single', active: true, planning_cost: 2700, kw: 12, watts: null, kwh: null, usable_kwh: null }),
  S({ id: 13, name: 'SigenStor BAT 10.0', product_type: 'battery', phase: 'na', active: true, planning_cost: 2600, kwh: 10.24, usable_kwh: 9, kw: 10, watts: null }),
  S({ id: 26, name: 'Sigen Gateway HomePro SP-F AU', product_type: 'gateway', phase: 'single', active: true, planning_cost: 1700, kw: null, kwh: null, watts: null, usable_kwh: null }),
  S({ id: 18, name: 'SigenStor mounting kit', product_type: 'mounting', phase: 'na', active: true, planning_cost: 250, kw: null, kwh: null, watts: null, usable_kwh: null }),
]

const config: ConfigBundle = {
  id: 1, label: 'Sigenergy', standby_w: 150,
  inverters: [
    { stock_id: 5, oversize_percent: null, max_batteries: null },
    { stock_id: 1, oversize_percent: null, max_batteries: null },
  ],
  batteries: [{ stock_id: 13, is_default: true }],
  components: [
    { stock_id: 26, rule: 'per_n_inverters', qty: 1, divisor: 3, phase_scope: 'single' },
    { stock_id: 18, rule: 'per_inverter',    qty: 1, divisor: 1, phase_scope: 'na' },
  ],
}

const settings: EngineSettings = {
  pricing: { margin: 0.30, gst: 0.10 },
  rebates: { solar_stc_per_kw: 6.8, solar_stc_price: 38, battery_stc_price: 38 },
  tiers: [
    { from_kwh: 0,  to_kwh: 14, stc_per_kwh: 6.8 },
    { from_kwh: 14, to_kwh: 28, stc_per_kwh: 4.08 },
    { from_kwh: 28, to_kwh: 50, stc_per_kwh: 1 },
  ],
  sizing: { solar_oversize_percent: 200, solar_oversize_3ph_percent: 160, max_batteries_per_inverter: 6, min_inverters: 1 },
  fixedCosts: [
    { label: 'Small parts', amount: 1000 }, { label: 'Installer sign off', amount: 1500 },
    { label: 'CES', amount: 500 }, { label: 'Fixed labour', amount: 2000 },
  ],
  panels: { stock_id: 25, install_cost_per_w: 0.35, roof_frame_per_panel: 50 },
  groundMount: { labour_per_panel: 150, machinery_fixed: 1000, ballpark_frame_per_panel: 150 },
  loadProfile: [2,1.5,1.5,1.5,2,3,5,7,6.5,5,3.5,3,3.5,3,3,3,4,6,8,8,6.5,5,3.5,2.5],
}

const r = priceSystem(config, { phase: 'single', roofPanels: 36, gmPanels: 0, batteryUnits: 3 }, stocks, settings)!

// V46, worked by hand from the same inputs:
const v46 = {
  invCount: 1, invKw: 12, batteryKwh: 27,
  baseCost: 12933 + 5000 + 7800 + (2700 + 1700 + 250),
  solarStcs: 17.1 * 6.8,
  batteryStcs: 14 * 6.8 + 13 * 4.08,
}
const v46base = v46.baseCost
const v46margin = v46base * 0.3
const v46gst = (v46base + v46margin) * 0.1
const v46rebate = v46.solarStcs * 38 + v46.batteryStcs * 38
const v46final = v46base + v46margin + v46gst - v46rebate

const rows: [string, number, number][] = [
  ['inverter count', r.invCount, v46.invCount],
  ['inverter kW',    r.invKw,    v46.invKw],
  ['battery kWh',    r.batteryKwh, v46.batteryKwh],
  ['base cost',      r.baseCost, v46base],
  ['margin',         r.marginDollar, v46margin],
  ['GST',            r.gstDollar, v46gst],
  ['solar STCs',     r.solarStcs, v46.solarStcs],
  ['battery STCs',   r.batteryStcs, v46.batteryStcs],
  ['rebate',         r.rebate, v46rebate],
  ['FINAL PRICE',    r.finalPrice, v46final],
]
let fail = 0
console.log('field'.padEnd(16), 'new'.padStart(13), 'V46'.padStart(13), '  diff')
for (const [k, a, b] of rows) {
  const d = Math.abs(a - b)
  if (d > 0.005) fail++
  console.log(k.padEnd(16), a.toFixed(2).padStart(13), b.toFixed(2).padStart(13), d > 0.005 ? `  MISMATCH ${d.toFixed(4)}` : '  ok')
}
const lineSum = r.lines.reduce((s, l) => s + l.total, 0)
console.log('\nline items sum to base cost:', Math.abs(lineSum - r.baseCost) < 0.005 ? 'yes (bug #6 fixed)' : 'NO')
console.log('\n' + (fail ? `${fail} MISMATCH(ES)` : 'SCENARIO 1 PARITY: PASS'))
