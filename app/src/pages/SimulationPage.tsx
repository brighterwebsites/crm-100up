/**
 * SimulationPage — the July worst-case battery trace.
 *
 * The evidence behind a quote: 31 days of Ballarat July, hour by hour, showing
 * whether the battery ever runs flat. simulate() was already ported for auto
 * battery sizing; this exposes the working rather than just the verdict.
 *
 * Two inherited defects are deliberately NOT reproduced:
 *   #1  V46 used `Number(value) || default`, so typing 0 silently reverted to
 *       a hardcoded default and the table showed a scenario other than the one
 *       on screen. Every input here uses an explicit empty check.
 *   #2  V46's quick-fills mixed live battery figures with hardcoded panel
 *       counts and unit combinations. They are rows now (simulation_presets).
 *
 * Known and unresolved: bug #10 — a large enough battery "passes" by coasting
 * down from full within one month, even when the array cannot sustain the
 * load. The header calls that out when production is below consumption.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2, Zap } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useData, loadProfileArray } from '../lib/data'
import { supabase } from '../lib/supabaseClient'
import { JULY_SOLAR_W_PER_KW, JULY_DAILY_KWH_PER_KW } from '../lib/solarJuly'
import type { Tables } from '../types/database.types'

type Preset = Tables<'simulation_presets'>
const DAYS = 31

/** Zero reads as an absence, not a measurement — "0.0" in every cell of a
 *  night-time row buries the figures that matter. */
const n1 = (v: number) => (Math.abs(v) < 0.05 ? '–' : v.toFixed(1))
const n2 = (v: number) => (Math.abs(v) < 0.005 ? '–' : v.toFixed(2))

export default function SimulationPage() {
  const { isAdmin } = useAuth()
  const { stocks, assumptions } = useData()

  const [panelW, setPanelW] = useState(475)
  const [panels, setPanels] = useState(36)
  const [batteryKwh, setBatteryKwh] = useState(27)
  const [dailyKwh, setDailyKwh] = useState(20)
  const [standbyW, setStandbyW] = useState(150)
  const [openDay, setOpenDay] = useState<number | null>(null)

  const [presets, setPresets] = useState<Preset[]>([])
  const [editing, setEditing] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const profile = useMemo(() => loadProfileArray(assumptions), [assumptions])

  const load = useCallback(async () => {
    const [pr, ps] = await Promise.all([
      supabase.from('simulation_presets').select('*').order('sort_order'),
      supabase.from('panel_settings').select('stock_id').eq('id', 1).maybeSingle(),
    ])
    setPresets(pr.data ?? [])
    const p = stocks.find((s) => s.id === ps.data?.stock_id)
    if (p?.watts) setPanelW(p.watts)
  }, [stocks])
  useEffect(() => { load() }, [load])

  const inverterOptions = useMemo(
    () => stocks.filter((s) => s.product_type === 'inverter' && s.active),
    [stocks]
  )

  /** Applying a preset resolves the battery and standby figures from the
   *  catalogue rather than carrying copies — the fix for bug #2. */
  async function applyPreset(p: Preset) {
    setPanels(p.panel_count)
    const inv = stocks.find((s) => s.id === p.inverter_stock_id)
    let usable = 0
    if (inv) {
      const { data: link } = await supabase
        .from('system_config_inverters').select('config_id').eq('stock_id', inv.id).maybeSingle()
      if (link) {
        const [{ data: cfg }, { data: bat }] = await Promise.all([
          supabase.from('system_configs').select('standby_w').eq('id', link.config_id).maybeSingle(),
          supabase.from('system_config_batteries').select('stock_id')
            .eq('config_id', link.config_id).eq('is_default', true).maybeSingle(),
        ])
        if (cfg) setStandbyW(cfg.standby_w * p.inverter_count)
        const b = stocks.find((s) => s.id === bat?.stock_id)
        usable = b?.usable_kwh ?? 0
      }
    }
    if (usable > 0) setBatteryKwh(Math.round(usable * p.battery_units * 100) / 100)
  }

  const solarKw = (panels * panelW) / 1000

  const sim = useMemo(() => {
    const sum = profile.reduce((s, x) => s + x, 0) || 1
    const standbyPerHour = standbyW / 1000
    let soc = batteryKwh
    let minSocAll = batteryKwh
    const hours: { i: number; day: number; hour: number; prod: number; load: number; soc: number }[] = []
    const days: {
      day: number; solar: number; load: number; net: number
      spilled: number; unmet: number; minSoc: number; endSoc: number
    }[] = []
    let dSolar = 0, dLoad = 0, dSpill = 0, dUnmet = 0, dMin = batteryKwh

    for (let i = 0; i < JULY_SOLAR_W_PER_KW.length; i++) {
      const hour = i % 24
      const prod = (solarKw * JULY_SOLAR_W_PER_KW[i]) / 1000
      const load = dailyKwh * (profile[hour] / sum) + standbyPerHour
      soc += prod - load
      if (soc > batteryKwh) { dSpill += soc - batteryKwh; soc = batteryKwh }
      if (soc < 0) { dUnmet += -soc; soc = 0 }
      dSolar += prod; dLoad += load
      if (soc < dMin) dMin = soc
      if (soc < minSocAll) minSocAll = soc
      hours.push({ i, day: Math.floor(i / 24) + 1, hour, prod, load, soc })
      if (hour === 23) {
        days.push({
          day: Math.floor(i / 24) + 1, solar: dSolar, load: dLoad, net: dSolar - dLoad,
          spilled: dSpill, unmet: dUnmet, minSoc: dMin, endSoc: soc,
        })
        dSolar = 0; dLoad = 0; dSpill = 0; dUnmet = 0; dMin = batteryKwh
      }
    }
    const totals = days.reduce((t, d) => ({
      solar: t.solar + d.solar, load: t.load + d.load, net: t.net + d.net,
      spilled: t.spilled + d.spilled, unmet: t.unmet + d.unmet,
    }), { solar: 0, load: 0, net: 0, spilled: 0, unmet: 0 })

    // Worst day = the largest single-day deficit. Deliberately NOT the lowest
    // state of charge: min SOC is cumulative, so it identifies when the
    // battery came closest to empty, which is usually the end of a dull RUN
    // rather than the hardest day in it. Both are shown — they answer
    // different questions and neither should be hidden behind the other.
    const worst = days.reduce((w, d) => (d.net < w.net ? d : w), days[0])
    const lowest = days.reduce((w, d) => (d.minSoc < w.minSoc ? d : w), days[0])

    return { hours, days, totals, worst, lowest, minSocAll, standbyTotal: standbyW / 1000 * 24 * DAYS }
  }, [solarKw, batteryKwh, dailyKwh, standbyW, profile])

  const survives = sim.totals.unmet < 0.00001
  const avgProduction = solarKw * JULY_DAILY_KWH_PER_KW
  const avgConsumption = dailyKwh + (standbyW / 1000) * 24
  const unsustainable = avgProduction < avgConsumption

  async function savePresets() {
    setErr(null)
    for (const p of presets) {
      const { error } = await supabase.from('simulation_presets').update({
        label: p.label, inverter_stock_id: p.inverter_stock_id,
        inverter_count: p.inverter_count, battery_units: p.battery_units,
        panel_count: p.panel_count,
      }).eq('id', p.id)
      if (error) { setErr(error.message); return }
    }
    await load()
  }

  return (
    <div>
      <div className="calc-badges">
        <span className="calc-badge">July worst-case · Ballarat VIC</span>
        <span className="calc-badge">{DAYS} days · hourly</span>
        <span className={`calc-badge ${survives ? 'badge-pass' : 'badge-fail'}`}>
          {survives ? 'No generator required' : 'Generator required'}
        </span>
      </div>

      {unsustainable && (
        <div className="calc-warning">
          <strong>Array cannot sustain this load.</strong> July averages{' '}
          {avgProduction.toFixed(1)} kWh/day against {avgConsumption.toFixed(1)} kWh/day of
          load and standby. A pass here would only mean the battery lasted the month
          from a full start — no battery size makes this configuration self-sufficient.
        </div>
      )}

      {/* ── Quick-fills ── */}
      <div className="card settings-card" style={{ marginBottom: 14 }}>
        <div className="sim-quick-head">
          <div className="card-title" style={{ margin: 0 }}>Quick-fills</div>
          {isAdmin && (
            <button className="btn-link" onClick={() => setEditing(!editing)}>
              {editing ? 'Done' : 'Edit'}
            </button>
          )}
        </div>
        {err && <div className="login-error" style={{ marginBottom: 8 }}>{err}</div>}

        {!editing ? (
          <div className="sim-quick-row">
            {presets.map((p) => (
              <button key={p.id} className="btn btn-gray sim-quick-btn" onClick={() => applyPreset(p)}>
                <Zap size={13} aria-hidden /> {p.label}
                <span className="sim-quick-sub">{p.panel_count} panels</span>
              </button>
            ))}
            {!presets.length && <span className="mutedtext">No quick-fills yet.</span>}
          </div>
        ) : (
          <>
            <table className="table calc-breakdown">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Label</th>
                  <th style={{ textAlign: 'left' }}>Inverter</th>
                  <th className="num">Inv count</th>
                  <th className="num">Battery units</th>
                  <th className="num">Panels</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {presets.map((p, i) => {
                  const set = (patch: Partial<Preset>) =>
                    setPresets(presets.map((x, j) => (j === i ? { ...x, ...patch } : x)))
                  return (
                    <tr key={p.id}>
                      <td><input className="jdp-input" value={p.label}
                        onChange={(e) => set({ label: e.target.value })} /></td>
                      <td>
                        <select className="jdp-input" value={p.inverter_stock_id ?? ''}
                          onChange={(e) => set({ inverter_stock_id: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">—</option>
                          {inverterOptions.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </td>
                      <td><input className="jdp-input num" type="number" min={1} value={p.inverter_count}
                        onChange={(e) => set({ inverter_count: Math.max(1, Number(e.target.value) || 1) })} /></td>
                      <td><input className="jdp-input num" type="number" min={1} value={p.battery_units}
                        onChange={(e) => set({ battery_units: Math.max(1, Number(e.target.value) || 1) })} /></td>
                      <td><input className="jdp-input num" type="number" min={0} value={p.panel_count}
                        onChange={(e) => set({ panel_count: e.target.value === '' ? 0 : Number(e.target.value) })} /></td>
                      <td>
                        <button className="icon-btn" title="Remove" onClick={async () => {
                          await supabase.from('simulation_presets').delete().eq('id', p.id); await load()
                        }}><Trash2 size={13} aria-hidden /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="settings-actions">
              <button className="btn btn-gray" disabled={presets.length >= 6} onClick={async () => {
                setErr(null)
                const { error } = await supabase.from('simulation_presets').insert({
                  label: 'New scenario', inverter_count: 1, battery_units: 3, panel_count: 30,
                  sort_order: (presets.at(-1)?.sort_order ?? 0) + 1,
                })
                if (error) { setErr(error.message); return }
                await load()
              }}>
                <Plus size={13} aria-hidden /> Add {presets.length >= 6 && '(max 6)'}
              </button>
              <button className="btn btn-primary" onClick={savePresets}>Save quick-fills</button>
            </div>
          </>
        )}
      </div>

      {/* ── Scenario inputs ── */}
      <div className="card settings-card" style={{ marginBottom: 14 }}>
        <div className="card-title">Scenario</div>
        <div className="calc-inputs">
          <F label="Daily load kWh"><NumIn v={dailyKwh} set={setDailyKwh} step="0.5" /></F>
          <F label="Panels"><NumIn v={panels} set={setPanels} /></F>
          <F label="Panel watts"><NumIn v={panelW} set={setPanelW} /></F>
          <F label="Battery kWh usable"><NumIn v={batteryKwh} set={setBatteryKwh} step="0.1" /></F>
          <F label="Standby draw W" hint="Parasitic, every hour of every day">
            <NumIn v={standbyW} set={setStandbyW} />
          </F>
        </div>
      </div>

      {/* ── Section 1: verdict ── */}
      <div className="sim-kpis">
        <Kpi tone={survives ? 'good' : 'bad'} label="Outcome"
             value={survives ? 'No generator' : 'Generator required'} />
        <Kpi tone={survives ? undefined : 'bad'} label="Worst day"
             value={sim.worst ? `Day ${sim.worst.day}` : '–'}
             sub={sim.worst ? `net ${n1(sim.worst.net)} kWh` : undefined} />
        <Kpi tone={sim.totals.unmet > 0 ? 'bad' : undefined} label="Shortfall"
             value={`${n2(sim.totals.unmet)} kWh`} />
      </div>

      {/* ── Section 2: system, then results — same order as the table ── */}
      <div className="sim-kpis">
        <Kpi group={1} label="Solar array" value={`${solarKw.toFixed(2)} kW`} />
        <Kpi group={1} label="Battery capacity" value={`${batteryKwh.toFixed(1)} kWh`} />
        <Kpi group={2} label="Total solar" value={`${n1(sim.totals.solar)} kWh`} />
        <Kpi group={2} label="Total load" value={`${n1(sim.totals.load)} kWh`}
             sub={`${(sim.totals.load / DAYS).toFixed(1)} kWh/day`} />
        <Kpi group={2} label="Standby total" value={`${n1(sim.standbyTotal)} kWh`} />
        <Kpi group={2} label="Total unmet" value={`${n2(sim.totals.unmet)} kWh`} />
        <Kpi group={2} label="Total spilled" value={`${n1(sim.totals.spilled)} kWh`} />
        <Kpi group={2} label="Min SOC" value={`${n2(sim.minSocAll)} kWh`}
             sub={sim.lowest ? `day ${sim.lowest.day}` : undefined} />
      </div>

      {/* ── Daily table — column order matches the tiles above ── */}
      <div className="card settings-card">
        <div className="card-title">Daily detail</div>
        <div className="mutedtext" style={{ fontSize: 11, marginBottom: 8 }}>
          Click a day for its 24 hours. The battery starts full and carries over,
          so a run of dull days is what catches a system out, not any single one.
        </div>
        <div className="sim-scroll">
        <table className="table calc-breakdown sim-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Day</th>
              <th className="num">Solar gen</th>
              <th className="num">Load</th>
              <th className="num">Net</th>
              <th className="num">Spilled</th>
              <th className="num">Unmet</th>
              <th className="num">Min SOC</th>
              <th className="num">End SOC</th>
              <th style={{ textAlign: 'left' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {sim.days.map((d) => (
              <Fragment key={d.day}>
              <tr className={`sim-day-row${d.unmet > 0 ? ' sim-row-fail' : ''}${openDay === d.day ? ' sim-day-open' : ''}`}
                  onClick={() => setOpenDay(openDay === d.day ? null : d.day)}>
                <td style={{ textAlign: 'left' }}>
                  {openDay === d.day
                    ? <ChevronDown size={12} aria-hidden />
                    : <ChevronRight size={12} aria-hidden />}
                  {' '}Day {d.day}
                  {sim.worst && d.day === sim.worst.day && <span className="sim-tag">worst</span>}
                </td>
                <td className="num">{n1(d.solar)}</td>
                <td className="num">{n1(d.load)}</td>
                <td className="num">{n1(d.net)}</td>
                <td className="num">{n1(d.spilled)}</td>
                <td className="num">{n2(d.unmet)}</td>
                <td className="num">{n2(d.minSoc)}</td>
                <td className="num">{n2(d.endSoc)}</td>
                <td style={{ textAlign: 'left' }}>{d.unmet > 0 ? 'Shortfall' : 'OK'}</td>
              </tr>
              {openDay === d.day && (
                <tr className="sim-hours-row">
                  <td colSpan={9}>
                    <div className="sim-hours">
                      <table className="table sim-hours-table">
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left' }}>Hour</th>
                            <th className="num">Solar gen</th>
                            <th className="num">Load</th>
                            <th className="num">Net</th>
                            <th className="num">SOC</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sim.hours.filter((h) => h.day === d.day).map((h) => (
                            <tr key={h.i} className={h.soc <= 0 ? 'sim-row-fail' : undefined}>
                              <td style={{ textAlign: 'left' }}>{String(h.hour).padStart(2, '0')}:00</td>
                              <td className="num">{n2(h.prod)}</td>
                              <td className="num">{n2(h.load)}</td>
                              <td className="num">{n2(h.prod - h.load)}</td>
                              <td className="num">{n2(h.soc)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="calc-subtotal">
              <td style={{ textAlign: 'left' }}>Totals</td>
              <td className="num">{n1(sim.totals.solar)}</td>
              <td className="num">{n1(sim.totals.load)}</td>
              <td className="num">{n1(sim.totals.net)}</td>
              <td className="num">{n1(sim.totals.spilled)}</td>
              <td className="num">{n2(sim.totals.unmet)}</td>
              <td className="num">{n2(sim.minSocAll)}</td>
              <td className="num">–</td>
              <td style={{ textAlign: 'left' }}>{survives ? 'OK' : 'Shortfall'}</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>

    </div>
  )
}

function NumIn({ v, set, step = '1' }: { v: number; set: (n: number) => void; step?: string }) {
  return (
    <input className="jdp-input num" type="number" step={step} value={v}
      // Explicit empty check, never `Number(x) || default` — bug #1.
      onChange={(e) => set(e.target.value === '' ? 0 : Number(e.target.value))} />
  )
}

function Kpi({ label, value, sub, tone, group }: {
  label: string; value: string; sub?: string
  tone?: 'good' | 'bad'; group?: 1 | 2
}) {
  return (
    <div className={`sim-kpi${tone ? ` sim-kpi-${tone}` : ''}${group ? ` sim-kpi-g${group}` : ''}`}>
      <div className="sim-kpi-label">{label}</div>
      <div className="sim-kpi-value num">{value}</div>
      {sub && <div className="sim-kpi-sub">{sub}</div>}
    </div>
  )
}

function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-field">
      <span className="jdp-label">{label}</span>
      {children}
      {hint && <span className="settings-hint">{hint}</span>}
    </div>
  )
}
