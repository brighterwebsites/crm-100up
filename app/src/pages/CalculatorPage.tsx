/**
 * CalculatorPage — single-phase system quoting, rebuilt on the product
 * catalogue. Phase C step 5.
 *
 * Parity: ACCEPTED BY OWNER, 2026-09-20. Fred signed the engine off in
 * practice — "within the parameters tested and how Fred plans to use it, it
 * works fine" — rather than buying the ten-scenario run in
 * docs/phase-b-parity-gate.md. The known divergences are listed there; the
 * material one (bug #8) is fixed here and caused no historical underpricing.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useData, loadProfileArray } from '../lib/data'
import { supabase } from '../lib/supabaseClient'
import { findMinUnits, optimisePanels, priceSystem } from '../lib/quoteEngine'
import type { ConfigBundle, CostGroup, EngineSettings, QuoteResult } from '../lib/quoteEngine'
import { buildQuotePayload } from '../lib/quotePayload'
import { copyText } from '../lib/clipboard'
import { assignQuoteBom, createJob, updateJob } from '../features/jobs/actions'
import { fmtMoney, fmtMoneyExact } from '../lib/format'

export default function CalculatorPage({ onOpenJob }: { onOpenJob?: (id: number) => void }) {
  const { stocks, assumptions } = useData()

  const [configs, setConfigs] = useState<ConfigBundle[]>([])
  const [settings, setSettings] = useState<EngineSettings | null>(null)
  const [loading, setLoading] = useState(true)

  // Inputs — defaults chosen to match gate scenario 1.
  const [dailyKwh, setDailyKwh] = useState(20)
  const [panels, setPanels] = useState(36)
  const [gmPanels, setGmPanels] = useState(0)
  const [panelMode, setPanelMode] = useState<'fixed' | 'optimise'>('fixed')
  const [minPanels, setMinPanels] = useState(12)
  const [maxPanels, setMaxPanels] = useState(80)
  const [panelStep, setPanelStep] = useState(1)
  const [mount, setMount] = useState<'roof' | 'ground'>('roof')
  const [autoBattery, setAutoBattery] = useState(true)
  const [manualUnits, setManualUnits] = useState(3)
  const [startUnits, setStartUnits] = useState(1)
  const [maxUnits, setMaxUnits] = useState(40)
  // V46 offered auto / force-large / dual-8kW. "Dual" only ever meant a
  // minimum of 2 inverters (design doc D2), so it decomposes into a pinned
  // tier plus a floor -- a strict superset of the three old modes.
  const [forceSizeClass, setForceSizeClass] =
    useState<'small' | 'medium' | 'large' | null>(null)
  const [minInverters, setMinInverters] = useState(1)

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

  const results = useMemo(() => {
    if (!settings) return []
    const gm = mount === 'ground' ? gmPanels : 0
    return configs.map((cfg) => {
      const common = { phase: 'single' as const, minInverters, forceSizeClass }

      if (panelMode === 'optimise') {
        const r = optimisePanels(cfg, common, stocks, settings, {
          dailyKwh, minPanels, maxPanels, step: panelStep,
          gmPanels: gm, startUnits, maxUnits,
        })
        return { cfg, result: r?.result ?? null, passes: r?.passes ?? false }
      }

      const base = { ...common, roofPanels: Math.max(0, panels - gm), gmPanels: gm }
      if (autoBattery) {
        const r = findMinUnits(cfg, base, stocks, settings, dailyKwh, startUnits, maxUnits)
        return { cfg, result: r?.result ?? null, passes: r?.passes ?? false }
      }
      return {
        cfg,
        result: priceSystem(cfg, { ...base, batteryUnits: manualUnits }, stocks, settings),
        passes: true,
      }
    })
  }, [configs, settings, stocks, panels, gmPanels, mount, panelMode, minPanels, maxPanels,
      panelStep, autoBattery, manualUnits, startUnits, maxUnits, dailyKwh, minInverters,
      forceSizeClass])

  /** Size classes present on this phase, labelled with what each brand
   *  actually resolves to — so "larger" reads as "12 / 10 kW", the wording
   *  Fred already knows from V46. */
  const sizeOptions = useMemo(() => {
    const byId = new Map(stocks.map((s) => [s.id, s]))
    const out: { key: 'small' | 'medium' | 'large'; label: string }[] = []
    for (const key of ['small', 'medium', 'large'] as const) {
      const kws = configs
        .flatMap((c) => c.inverters.filter((i) => i.size_class === key))
        .map((i) => byId.get(i.stock_id))
        .filter((s) => s && s.phase === 'single')
        .map((s) => s!.kw)
      if (!kws.length) continue
      const uniq = [...new Set(kws)].sort((a, b) => (a ?? 0) - (b ?? 0))
      out.push({ key, label: `Force ${key} (${uniq.join(' / ')} kW)` })
    }
    return out
  }, [configs, stocks])

  if (loading) return <div className="placeholder">Loading calculator…</div>
  if (!settings) return <div className="placeholder">Settings not configured — see Assumptions.</div>

  return (
    <div>
      <div className="card settings-card" style={{ marginBottom: 14 }}>
        <div className="card-title">System inputs</div>
        <div className="calc-inputs">
          <Field label="Daily load kWh">
            <input className="jdp-input num" type="number" step="0.5" min={1} value={dailyKwh}
              onChange={(e) => setDailyKwh(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Field label="Panels">
            <select className="jdp-input" value={panelMode}
              onChange={(e) => setPanelMode(e.target.value as 'fixed' | 'optimise')}>
              <option value="fixed">Fixed count</option>
              <option value="optimise">Optimise range</option>
            </select>
          </Field>
          {panelMode === 'fixed' ? (
            <Field label="Total panels">
              <input className="jdp-input num" type="number" min={1} value={panels}
                onChange={(e) => setPanels(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
          ) : (
            <>
              <Field label="Min panels">
                <input className="jdp-input num" type="number" min={1} value={minPanels}
                  onChange={(e) => setMinPanels(Math.max(1, Number(e.target.value) || 1))} />
              </Field>
              <Field label="Max panels">
                <input className="jdp-input num" type="number" min={1} value={maxPanels}
                  onChange={(e) => setMaxPanels(Math.max(1, Number(e.target.value) || 1))} />
              </Field>
              <Field label="Panel step">
                <input className="jdp-input num" type="number" min={1} value={panelStep}
                  onChange={(e) => setPanelStep(Math.max(1, Number(e.target.value) || 1))} />
              </Field>
            </>
          )}
          <Field label="Mount">
            <select className="jdp-input" value={mount}
              onChange={(e) => setMount(e.target.value as 'roof' | 'ground')}>
              <option value="roof">Roof only</option>
              <option value="ground">Roof + ground</option>
            </select>
          </Field>
          {mount === 'ground' && (
            <Field
              label="Ground-mounted panels"
              hint={panelMode === 'optimise' ? 'Held fixed; the sweep varies the roof count' : undefined}
            >
              <input className="jdp-input num" type="number" min={0} value={gmPanels}
                onChange={(e) => setGmPanels(Math.max(0, Number(e.target.value) || 0))} />
            </Field>
          )}
          <Field
            label="Inverter"
            hint="Forces a size class, not a product, so both brands stay comparable. V46's Dual 8kW = force small with a minimum of 2."
          >
            <select className="jdp-input" value={forceSizeClass ?? ''}
              onChange={(e) => setForceSizeClass(
                (e.target.value || null) as 'small' | 'medium' | 'large' | null)}>
              <option value="">Auto -- fewest, then cheapest</option>
              {sizeOptions.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Minimum inverters" hint="2 forces redundancy — V46's &quot;dual&quot;">
            <input className="jdp-input num" type="number" min={1} value={minInverters}
              onChange={(e) => setMinInverters(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Field label="Battery sizing">
            <select className="jdp-input" value={autoBattery ? 'auto' : 'manual'}
              onChange={(e) => setAutoBattery(e.target.value === 'auto')}>
              <option value="auto">Auto — smallest that survives July</option>
              <option value="manual">Manual</option>
            </select>
          </Field>
          {!autoBattery ? (
            <Field label="Battery units">
              <input className="jdp-input num" type="number" min={1} value={manualUnits}
                onChange={(e) => setManualUnits(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
          ) : (
            <>
              <Field label="Start units">
                <input className="jdp-input num" type="number" min={1} value={startUnits}
                  onChange={(e) => setStartUnits(Math.max(1, Number(e.target.value) || 1))} />
              </Field>
              <Field label="Max units">
                <input className="jdp-input num" type="number" min={1} value={maxUnits}
                  onChange={(e) => setMaxUnits(Math.max(1, Number(e.target.value) || 1))} />
              </Field>
            </>
          )}
        </div>
      </div>

      <div className="calc-badges">
        <span className="calc-badge">Auto-run</span>
        <span className="calc-badge">{configs.map((c) => c.label).join(' & ') || 'No configs'}</span>
        <span className="calc-badge">July worst-case &middot; Ballarat VIC</span>
      </div>

      <div className="calc-results">
        {results.map(({ cfg, result, passes }) => (
          <div key={cfg.id} className="card settings-card">
            <div className="card-title">{cfg.label}</div>
            {!result && <div className="mutedtext">No valid configuration for these inputs.</div>}
            {result && (
              <>
                {!passes && (
                  <div className="cost-drift" style={{ marginBottom: 10 }}>
                    Does not survive July at this panel count — generator required,
                    or add panels.
                  </div>
                )}
                <div className="calc-headline">
                  <div className="num calc-price">{fmtMoney(result.finalPrice)}</div>
                  <div className="mutedtext" style={{ fontSize: 11 }}>
                    {result.panelCount} panels · {result.solarKw.toFixed(2)} kW ·{' '}
                    {result.invCount} × {result.invKw} kW inverter ·{' '}
                    {result.batteryUnits} × battery = {result.batteryKwh.toFixed(2)} kWh usable
                  </div>
                </div>
                <Breakdown r={result} />
                <SendToCrm
                  r={result}
                  stocks={stocks}
                  roofPanels={Math.max(0, panels - (mount === 'ground' ? gmPanels : 0))}
                  gmPanels={mount === 'ground' ? gmPanels : 0}
                  onOpenJob={onOpenJob}
                />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** The calculator → CRM handoff, the half V46 had and the rebuild didn't.
 *
 *  Two routes, because they answer different moments. **Copy** reproduces
 *  V46's clipboard flow for a customer who already has a job — paste it into
 *  Link quote. **Create job** is the shorter path for a fresh enquiry: it
 *  makes the customer and the job and lands the BOM on it in one step, which
 *  is the trip Fred asked about ("how that transfers into customers/jobs").
 *
 *  A new job has no booking date, so its parts land as `pending` and
 *  auto-assign when the install is booked. That is the existing rule, not a
 *  special case for this screen. */
function SendToCrm({
  r, stocks, roofPanels, gmPanels, onOpenJob,
}: {
  r: QuoteResult
  stocks: { id: number; name: string }[]
  roofPanels: number
  gmPanels: number
  onOpenJob?: (id: number) => void
}) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [newJobId, setNewJobId] = useState<number | null>(null)

  const payload = () =>
    buildQuotePayload(r, stocks as Parameters<typeof buildQuotePayload>[1], {
      phase: 'single', roofPanels, gmPanels,
    })

  async function copy() {
    setErr(null)
    const ok = await copyText(JSON.stringify(payload()))
    setMsg(ok
      ? 'Quote copied — open the customer in the CRM and click "Link quote".'
      : 'Could not reach the clipboard.')
  }

  async function create() {
    setErr(null); setBusy(true)
    try {
      const q = payload()
      const byId = new Map(stocks.map((s) => [s.id, s]))
      const job = await createJob(name)
      const unmatched = await assignQuoteBom(
        job.id,
        null,
        (q.bom ?? []).map((l) => ({
          qty: l.qty,
          stock: l.stockId != null ? byId.get(l.stockId) ?? null : null,
          name: l.name,
        })),
      )
      await updateJob(job, { system_description: q.system ?? '', value: q.price ?? 0 })
      setNewJobId(job.id)
      setNaming(false)
      setMsg(
        `Job #${job.id} created for ${name.trim() || 'New customer'} — parts will assign when the install is booked.` +
        (unmatched.length ? ` ${unmatched.length} line(s) had no stock item: ${unmatched.join(', ')}` : '')
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
      <button className="btn btn-gray" onClick={copy}>Copy quote for CRM</button>
      {!naming ? (
        <button className="btn btn-primary" onClick={() => { setNaming(true); setMsg(null) }}>
          Create job from this quote
        </button>
      ) : (
        <>
          <input
            className="jdp-input"
            style={{ maxWidth: 200 }}
            placeholder="Customer name…"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) create() }}
          />
          <button className="btn btn-primary" disabled={busy} onClick={create}>
            {busy ? 'Creating…' : 'Create'}
          </button>
          <button className="btn btn-gray" disabled={busy} onClick={() => setNaming(false)}>
            Cancel
          </button>
        </>
      )}
      {newJobId != null && onOpenJob && (
        <button className="btn btn-gray" onClick={() => onOpenJob(newJobId)}>Open job</button>
      )}
      {msg && <span className="mutedtext" style={{ fontSize: 11 }}>{msg}</span>}
      {err && <span className="login-error">{err}</span>}
    </div>
  )
}

/** Sectioned, with a subtotal per block.
 *
 *  Every line still comes from the same array the base cost is summed from, so
 *  the itemisation cannot disagree with the total (the structural fix for bug
 *  #6, where V46 printed the mounting kit twice). Grouping is on top of that,
 *  for a different reason: one flat column of a dozen figures hides a wrong
 *  number, and subtotals give you somewhere to notice it.
 *
 *  Quantity and unit price get their own columns rather than being packed into
 *  "3 × $2,500", so the numbers line up and can be scanned down. */
function Breakdown({ r }: { r: QuoteResult }) {
  const groups: { key: CostGroup; title: string; subtotal: string }[] = [
    { key: 'panels', title: 'Solar panels', subtotal: 'Total panels' },
    { key: 'system', title: 'System & install', subtotal: 'Total system & install' },
    { key: 'ground', title: 'Ground mount', subtotal: 'Total ground mount' },
  ]
  return (
    <table className="table calc-breakdown">
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>Item</th>
          <th className="num">Qty</th>
          <th className="num">Unit</th>
          <th className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {groups.map(({ key, title, subtotal }) => {
          const lines = r.lines.filter((l) => l.group === key)
          if (!lines.length) return null
          const sum = lines.reduce((s, l) => s + l.total, 0)
          return (
            <Fragment key={key}>
              <tr className="calc-section"><td colSpan={4}>{title}</td></tr>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td style={{ textAlign: 'left' }}>{l.label}</td>
                  <td className="num">{l.qty}</td>
                  <td className="num">{fmtMoneyExact(l.unitCost)}</td>
                  <td className="num">{fmtMoneyExact(l.total)}</td>
                </tr>
              ))}
              <tr className="calc-subtotal">
                <td style={{ textAlign: 'left' }}>{subtotal}</td>
                <td /><td />
                <td className="num">{fmtMoneyExact(sum)}</td>
              </tr>
            </Fragment>
          )
        })}

        <tr className="calc-section"><td colSpan={4}>Cost</td></tr>
        <Row label="Base cost" value={fmtMoneyExact(r.baseCost)} bold />
        <Row label="Margin" value={fmtMoneyExact(r.marginDollar)} />
        <Row label="Before GST" value={fmtMoneyExact(r.basePlusMargin)} />
        <Row label="GST" value={fmtMoneyExact(r.gstDollar)} />
        <Row label="Before rebates" value={fmtMoneyExact(r.afterMarginGst)} bold />

        <tr className="calc-section"><td colSpan={4}>Rebates</td></tr>
        <Row label={`Solar (${r.solarStcs.toFixed(1)} STCs)`} value={`-${fmtMoneyExact(r.solarRebate)}`} />
        <Row label={`Battery (${r.batteryStcs.toFixed(1)} STCs)`} value={`-${fmtMoneyExact(r.batteryRebate)}`} />
        <tr className="calc-final">
          <td style={{ textAlign: 'left' }}>Final customer price</td>
          <td /><td />
          <td className="num">{fmtMoneyExact(r.finalPrice)}</td>
        </tr>
      </tbody>
    </table>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <tr className={bold ? 'calc-subtotal' : undefined}>
      <td style={{ textAlign: 'left' }}>{label}</td>
      <td /><td />
      <td className="num">{value}</td>
    </tr>
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
