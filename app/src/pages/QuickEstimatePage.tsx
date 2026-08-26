/**
 * QuickEstimatePage — bedroom/occupant ballpark, ported from V46 §qe onto
 * the product-driven engine. Same "5 kWh base + 5 kWh/person" formula, same
 * fully-off-grid-vs-generator-assisted comparison, same Sigenergy/Deye price
 * range. Shares priceSystem/optimisePanels with CalculatorPage, so it is
 * NOT parity-verified until that page is (docs/phase-b-parity-gate.md).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { useData, loadProfileArray } from '../lib/data'
import { supabase } from '../lib/supabaseClient'
import { optimisePanels } from '../lib/quoteEngine'
import type { ConfigBundle, EngineSettings, QuoteResult } from '../lib/quoteEngine'
import { fmtMoney } from '../lib/format'
import { copyText } from '../lib/clipboard'

const BEDROOM_OPTIONS = [
  { bedrooms: 0, label: 'Studio' },
  { bedrooms: 1, label: '1 bed' },
  { bedrooms: 2, label: '2 bed' },
  { bedrooms: 3, label: '3 bed' },
  { bedrooms: 4, label: '4 bed' },
  { bedrooms: 5, label: '5 bed' },
  { bedrooms: 6, label: '6 bed' },
  { bedrooms: 7, label: '7 bed' },
  { bedrooms: 8, label: '8+ bed' },
]

// V46's qeOptimiserSearch range — kept identical rather than reusing
// CalculatorPage's narrower defaults (12-80), since this tool has no
// per-search inputs to widen the range if 80 comes up short.
const PANEL_MIN = 12
const PANEL_MAX = 120
const MAX_UNITS = 40

function qeLoad(occupants: number): number {
  return 5 + 5 * occupants
}

export default function QuickEstimatePage() {
  const { stocks, assumptions } = useData()

  const [configs, setConfigs] = useState<ConfigBundle[]>([])
  const [settings, setSettings] = useState<EngineSettings | null>(null)
  const [loading, setLoading] = useState(true)

  const [bedrooms, setBedrooms] = useState(2)
  const [genPct, setGenPct] = useState(25)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const [c, ci, cb, cc, p, r, t, sz, f, pl, g] = await Promise.all([
      supabase.from('system_configs').select('*').eq('active', true).order('sort_order'),
      supabase.from('system_config_inverters').select('*').order('sort_order'),
      supabase.from('system_config_batteries').select('*'),
      supabase.from('system_config_components').select('*').order('sort_order'),
      supabase.from('pricing_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('rebate_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('battery_rebate_tiers').select('*').order('sort_order'),
      supabase.from('sizing_rules').select('*').eq('id', 1).maybeSingle(),
      supabase.from('fixed_site_costs').select('*').eq('active', true).order('sort_order'),
      supabase.from('panel_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('ground_mount_settings').select('*').eq('id', 1).maybeSingle(),
    ])
    setConfigs((c.data ?? []).map((cfg) => ({
      id: cfg.id, label: cfg.label, standby_w: cfg.standby_w,
      inverters: (ci.data ?? []).filter((x) => x.config_id === cfg.id),
      batteries: (cb.data ?? []).filter((x) => x.config_id === cfg.id),
      components: (cc.data ?? []).filter((x) => x.config_id === cfg.id),
    })))
    if (p.data && r.data && sz.data && pl.data && g.data) {
      setSettings({
        pricing: p.data, rebates: r.data, tiers: t.data ?? [], sizing: sz.data,
        fixedCosts: f.data ?? [], panels: pl.data, groundMount: g.data,
        loadProfile: loadProfileArray(assumptions),
      })
    }
    setLoading(false)
  }, [assumptions])

  useEffect(() => { load() }, [load])

  const occupants = bedrooms + 1
  const daily = qeLoad(occupants)
  const genKwh = genPct > 0 ? Math.round(daily * (genPct / 100) * 10) / 10 : 0
  const solarDaily = Math.round((daily - genKwh) * 10) / 10

  const sigConfig = useMemo(() => configs.find((c) => c.label === 'Sigenergy'), [configs])
  const deyeConfig = useMemo(() => configs.find((c) => c.label === 'Deye'), [configs])

  // Cheapest system that actually survives July, or null. Unlike
  // CalculatorPage's optimise mode, a near-miss is never shown here — this
  // is a customer-facing ballpark with no room to explain the caveat.
  const bestFor = useCallback((config: ConfigBundle | undefined, dailyKwh: number): QuoteResult | null => {
    if (!config || !settings) return null
    const found = optimisePanels(
      config,
      { phase: 'single', forceSizeClass: null, minInverters: settings.sizing.min_inverters },
      stocks, settings,
      { dailyKwh, minPanels: PANEL_MIN, maxPanels: PANEL_MAX, step: 1, gmPanels: 0, startUnits: 1, maxUnits: MAX_UNITS }
    )
    return found && found.passes ? found.result : null
  }, [stocks, settings])

  const sigFull = useMemo(() => bestFor(sigConfig, daily), [bestFor, sigConfig, daily])
  const deyeFull = useMemo(() => bestFor(deyeConfig, daily), [bestFor, deyeConfig, daily])
  const sigGen = useMemo(
    () => (genPct > 0 ? bestFor(sigConfig, solarDaily) : null),
    [bestFor, sigConfig, solarDaily, genPct]
  )
  const deyeGen = useMemo(
    () => (genPct > 0 ? bestFor(deyeConfig, solarDaily) : null),
    [bestFor, deyeConfig, solarDaily, genPct]
  )

  async function handleCopy() {
    const text = buildQuoteText({
      sigFull, deyeFull, sigGen, deyeGen, daily, genPct, occupants, bedrooms,
    })
    const ok = await copyText(text)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  if (loading) return <div className="placeholder">Loading calculator…</div>
  if (!settings) return <div className="placeholder">Settings not configured — see Assumptions.</div>

  const bedLabel = bedrooms === 0 ? 'Studio' : `${bedrooms} ${bedrooms === 1 ? 'bedroom' : 'bedrooms'}`
  const hasResult = !!(sigFull || deyeFull)

  return (
    <div>
      <div className="calc-warning">
        <strong>[NOT PARITY-VERIFIED]</strong> Shares its pricing engine with
        the System Calculator, which has not yet been checked against the
        V46 calculator (docs/phase-b-parity-gate.md). Don't send this to a
        customer until that's signed off.
      </div>

      <div className="card settings-card" style={{ marginBottom: 14 }}>
        <div className="card-title">Household</div>
        <div className="calc-inputs">
          <Field label="Bedrooms">
            <select className="jdp-input" value={bedrooms}
              onChange={(e) => setBedrooms(Number(e.target.value))}>
              {BEDROOM_OPTIONS.map((o) => (
                <option key={o.bedrooms} value={o.bedrooms}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Generator covers" hint="0% = fully off-grid only">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={0} max={75} step={5} value={genPct}
                onChange={(e) => setGenPct(Number(e.target.value))} style={{ flex: 1 }} />
              <span className="num" style={{ width: 34, textAlign: 'right' }}>{genPct}%</span>
            </div>
          </Field>
        </div>
        <div className="mutedtext" style={{ marginTop: 10, fontSize: 12 }}>
          {bedLabel} → {occupants} {occupants === 1 ? 'person' : 'people'} · 5 kWh base + {occupants} &times; 5 kWh/person = <strong>{daily} kWh/day</strong>
        </div>
      </div>

      <div className="calc-badges">
        <span className="calc-badge">July worst-case · Ballarat VIC</span>
        <span className="calc-badge">Prices after rebates</span>
      </div>

      <div className="qe-compare">
        <ComparePanel
          title="Fully off-grid"
          modeNote={`${daily} kWh/day · no generator`}
          sig={sigFull} deye={deyeFull}
        />
        {genPct > 0 && (
          <ComparePanel
            title={`With generator (${genPct}%)`}
            modeNote={`${solarDaily} kWh/day solar+battery · ${genKwh} kWh/day generator`}
            sig={sigGen} deye={deyeGen}
            savingsAgainst={{ sig: sigFull, deye: deyeFull }}
          />
        )}
      </div>

      {hasResult && (
        <button className="btn btn-primary btn-icon" onClick={handleCopy}>
          <Copy size={14} strokeWidth={2} aria-hidden />
          {copied ? 'Copied to clipboard!' : 'Copy customer quote text'}
        </button>
      )}

      <p className="mutedtext" style={{ marginTop: 12, fontSize: 11 }}>
        Indicative pricing only — standard assumptions, minimum battery size
        that survives a July worst-case simulation. Actual pricing depends on
        site conditions, roof space, travel, and other site-specific factors.
      </p>
    </div>
  )
}

function ComparePanel({
  title, modeNote, sig, deye, savingsAgainst,
}: {
  title: string
  modeNote: string
  sig: QuoteResult | null
  deye: QuoteResult | null
  savingsAgainst?: { sig: QuoteResult | null; deye: QuoteResult | null }
}) {
  if (!sig && !deye) {
    return (
      <div className="card settings-card">
        <div className="card-title">{title}</div>
        <div className="mutedtext">No passing system found in range — try the full Calculator.</div>
      </div>
    )
  }

  const ref = sig ?? deye!
  const panels = sig && deye
    ? (sig.panelCount === deye.panelCount
        ? `${sig.panelCount} panels`
        : `${Math.min(sig.panelCount, deye.panelCount)}–${Math.max(sig.panelCount, deye.panelCount)} panels`)
    : `${ref.panelCount} panels`
  const solar = sig && deye
    ? (Math.abs(sig.solarKw - deye.solarKw) < 0.15
        ? `${ref.solarKw.toFixed(2)} kW`
        : `${Math.min(sig.solarKw, deye.solarKw).toFixed(2)}–${Math.max(sig.solarKw, deye.solarKw).toFixed(2)} kW`)
    : `${ref.solarKw.toFixed(2)} kW`
  const batt = sig && deye
    ? (Math.abs(sig.batteryKwh - deye.batteryKwh) < 0.5
        ? `${ref.batteryKwh.toFixed(2)} kWh`
        : `${Math.min(sig.batteryKwh, deye.batteryKwh).toFixed(2)}–${Math.max(sig.batteryKwh, deye.batteryKwh).toFixed(2)} kWh`)
    : `${ref.batteryKwh.toFixed(2)} kWh`

  const saveSig = savingsAgainst?.sig && sig ? savingsAgainst.sig.finalPrice - sig.finalPrice : 0
  const saveDeye = savingsAgainst?.deye && deye ? savingsAgainst.deye.finalPrice - deye.finalPrice : 0
  const save = Math.max(saveSig, saveDeye)

  return (
    <div className="card settings-card">
      <div className="card-title">
        {title}
        {save > 0 && <span className="calc-badge" style={{ marginLeft: 8 }}>Save up to {fmtMoney(save)}</span>}
      </div>
      <div className="mutedtext" style={{ fontSize: 11, marginBottom: 10 }}>{modeNote}</div>
      <div className="calc-inputs" style={{ marginBottom: 12 }}>
        <div className="settings-field">
          <span className="jdp-label">Solar array</span>
          <span className="num" style={{ fontWeight: 700 }}>{solar}</span>
          <span className="settings-hint">{panels}</span>
        </div>
        <div className="settings-field">
          <span className="jdp-label">Battery storage</span>
          <span className="num" style={{ fontWeight: 700 }}>{batt}</span>
          <span className="settings-hint">Usable capacity</span>
        </div>
      </div>
      <div className="qe-price-bar">
        {deye && (
          <div className="qe-price-cell">
            <div className="mutedtext" style={{ fontSize: 11 }}>Deye — budget</div>
            <div className="num calc-price" style={{ fontSize: 20 }}>{fmtMoney(deye.finalPrice)}</div>
            <div className="settings-hint">{deye.panelCount} panels · {deye.invCount} × {deye.invKw} kW inverter</div>
          </div>
        )}
        {sig && (
          <div className="qe-price-cell">
            <div className="mutedtext" style={{ fontSize: 11 }}>Sigenergy — premium</div>
            <div className="num calc-price" style={{ fontSize: 20 }}>{fmtMoney(sig.finalPrice)}</div>
            <div className="settings-hint">{sig.panelCount} panels · {sig.invCount} × {sig.invKw} kW inverter</div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-field">
      <span className="jdp-label">{label}</span>
      {children}
      {hint && <span className="settings-hint">{hint}</span>}
    </div>
  )
}

function buildQuoteText(args: {
  sigFull: QuoteResult | null
  deyeFull: QuoteResult | null
  sigGen: QuoteResult | null
  deyeGen: QuoteResult | null
  daily: number
  genPct: number
  occupants: number
  bedrooms: number
}): string {
  const { sigFull, deyeFull, sigGen, deyeGen, daily, genPct, occupants, bedrooms } = args
  const bedLabel = bedrooms === 0 ? 'Studio' : `${bedrooms} ${bedrooms === 1 ? 'bedroom' : 'bedrooms'}`
  const spec = (r: QuoteResult) =>
    `${r.panelCount} panels · ${r.solarKw.toFixed(2)} kW solar · ${r.batteryKwh.toFixed(2)} kWh battery`

  let t = `Hi,\n\nHere's a quick solar + battery system estimate for your ${bedLabel} `
  t += `(${occupants} ${occupants === 1 ? 'person' : 'people'}, approx. ${daily} kWh/day).\n\n`

  t += `OPTION 1 — Fully off-grid (no generator needed)\n`
  if (deyeFull) t += `  Deye (budget)       ${fmtMoney(deyeFull.finalPrice)}  ${spec(deyeFull)}\n`
  if (sigFull)  t += `  Sigenergy (premium) ${fmtMoney(sigFull.finalPrice)}  ${spec(sigFull)}\n`

  if (genPct > 0 && (sigGen || deyeGen)) {
    t += `\nOPTION 2 — Smaller system + generator (generator covers ${genPct}% of daily load — generator not included in price)\n`
    if (deyeGen) t += `  Deye (budget)       ${fmtMoney(deyeGen.finalPrice)}  ${spec(deyeGen)}\n`
    if (sigGen)  t += `  Sigenergy (premium) ${fmtMoney(sigGen.finalPrice)}  ${spec(sigGen)}\n`
    if (sigFull && sigGen) {
      const save = sigFull.finalPrice - sigGen.finalPrice
      if (save > 0) t += `  (Option 2 saves up to ${fmtMoney(save)} vs Option 1 with Sigenergy)\n`
    }
  }

  t += `\nAll prices include GST and are net of solar/battery rebates (STCs).`
  t += `\nSized to comfortably survive a July worst-case hourly simulation for Ballarat, VIC — the hardest solar month in the region.`
  t += `\n\nThis is an indicative estimate only. Final pricing depends on site conditions, roof space, travel, and other site-specific factors. Happy to walk through a detailed quote when you're ready.`
  t += `\n\nCheers,\n100UP Solar`
  return t
}
