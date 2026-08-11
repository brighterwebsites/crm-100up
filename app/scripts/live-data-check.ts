/**
 * Runs the engine against the REAL database, not fixtures.
 *
 * parity-check.ts uses hand-built product rows, which is right for pinning
 * arithmetic — but it let a serious bug hide: every inverter had kw = null in
 * the database while the fixtures had it filled in, so the engine would have
 * collapsed every system to one inverter and the test would still have passed.
 *
 * A fixture can lie about the data. This cannot.
 *
 * Run: npx tsx scripts/live-data-check.ts   (needs app/.env.local)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { priceSystem } from '../src/lib/quoteEngine'
import type { ConfigBundle, EngineSettings } from '../src/lib/quoteEngine'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    })
)

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)

const problems: string[] = []
const note = (ok: boolean, msg: string) => {
  console.log(ok ? `  ok    ${msg}` : `  FAIL  ${msg}`)
  if (!ok) problems.push(msg)
}

async function main() {
  const [stocksQ, cfgQ, invQ, batQ, compQ, pQ, rQ, tQ, szQ, fQ, plQ, gQ, aQ] = await Promise.all([
    supabase.from('stocks').select('*'),
    supabase.from('system_configs').select('*').eq('active', true).order('sort_order'),
    supabase.from('system_config_inverters').select('*'),
    supabase.from('system_config_batteries').select('*'),
    supabase.from('system_config_components').select('*'),
    supabase.from('pricing_settings').select('*').eq('id', 1).single(),
    supabase.from('rebate_settings').select('*').eq('id', 1).single(),
    supabase.from('battery_rebate_tiers').select('*').order('sort_order'),
    supabase.from('sizing_rules').select('*').eq('id', 1).single(),
    supabase.from('fixed_site_costs').select('*').eq('active', true),
    supabase.from('panel_settings').select('*').eq('id', 1).single(),
    supabase.from('ground_mount_settings').select('*').eq('id', 1).single(),
    supabase.from('assumptions').select('*').eq('id', 1).single(),
  ])

  const stocks = stocksQ.data ?? []

  // RLS scopes every table to `authenticated`. With only the publishable key
  // and no session, every query comes back EMPTY rather than erroring — which
  // would render each check below as a confident, meaningless failure. Refuse
  // to report anything in that state.
  if (stocksQ.error || stocks.length === 0) {
    console.error(
      '\nCannot read the database — every query returned empty.\n' +
      'RLS requires an authenticated session and this script only has the\n' +
      'publishable key. Set PARITY_EMAIL and PARITY_PASSWORD in app/.env.local\n' +
      'to sign in, or run these checks through an admin SQL connection.\n' +
      (stocksQ.error ? `\nQuery error: ${stocksQ.error.message}\n` : '')
    )
    process.exit(2)
  }

  console.log('\n== Catalogue completeness ==')
  const inverters = stocks.filter((s) => s.product_type === 'inverter')
  const batteries = stocks.filter((s) => s.product_type === 'battery')
  note(inverters.length > 0 && inverters.every((s) => s.kw != null),
    `every inverter has kw (${inverters.filter((s) => s.kw == null).length} missing)`)
  note(batteries.length > 0 && batteries.every((s) => s.usable_kwh != null),
    `every battery has usable_kwh (${batteries.filter((s) => s.usable_kwh == null).length} missing)`)
  note(stocks.filter((s) => ['inverter', 'battery', 'panel', 'gateway', 'mounting', 'bms'].includes(s.product_type))
    .every((s) => s.planning_cost > 0), 'every quotable product has a planning cost')
  note(!!plQ.data?.stock_id, 'a panel product is selected in settings')
  const panel = stocks.find((s) => s.id === plQ.data?.stock_id)
  note(!!panel?.watts, 'the panel product has a wattage')

  const settings: EngineSettings = {
    pricing: pQ.data!, rebates: rQ.data!, tiers: tQ.data ?? [], sizing: szQ.data!,
    fixedCosts: fQ.data ?? [], panels: plQ.data!, groundMount: gQ.data!,
    loadProfile: (aQ.data?.load_profile as number[]) ?? [],
  }
  note(settings.tiers.length > 0, 'battery rebate tiers exist')
  note(settings.fixedCosts.length > 0, 'fixed site costs exist')
  note(settings.loadProfile.length === 24, 'load profile has 24 hourly weights')

  console.log('\n== Engine against live data ==')
  const configs: ConfigBundle[] = (cfgQ.data ?? []).map((c) => ({
    id: c.id, label: c.label, standby_w: c.standby_w,
    inverters: (invQ.data ?? []).filter((x) => x.config_id === c.id),
    batteries: (batQ.data ?? []).filter((x) => x.config_id === c.id),
    components: (compQ.data ?? []).filter((x) => x.config_id === c.id),
  }))
  note(configs.length >= 2, `at least two system options to compare (${configs.length})`)

  for (const cfg of configs) {
    // 36 panels = 17.1 kW: too much for one 8kW inverter at 200% oversize, so
    // a correct engine must return 2 small or 1 large. Getting 1 small back is
    // the signature of the kw-null bug.
    const r = priceSystem(cfg,
      { phase: 'single', roofPanels: 36, gmPanels: 0, batteryUnits: 3 }, stocks, settings)
    if (!r) { note(false, `${cfg.label}: engine returned nothing`); continue }
    const capacity = r.invCount * r.invKw * (settings.sizing.solar_oversize_percent / 100)
    note(capacity >= r.solarKw - 0.001,
      `${cfg.label}: ${r.invCount} x ${r.invKw}kW covers ${r.solarKw.toFixed(1)}kW solar ` +
      `(capacity ${capacity.toFixed(1)}kW) — $${r.finalPrice.toFixed(2)}`)
    const sum = r.lines.reduce((s, l) => s + l.total, 0)
    note(Math.abs(sum - r.baseCost) < 0.005, `${cfg.label}: line items sum to base cost`)
  }

  console.log(problems.length ? `\n${problems.length} PROBLEM(S)` : '\nALL LIVE CHECKS PASS')
  process.exit(problems.length ? 1 : 0)
}

main()
