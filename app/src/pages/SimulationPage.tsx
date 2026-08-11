/**
 * SimulationPage — the July worst-case battery trace.
 *
 * This is the evidence behind a quote: 31 days of Ballarat July, hour by hour,
 * showing the battery never runs flat. The engine (simulate()) was already
 * ported for auto battery sizing — this exposes the detail rather than just
 * the pass/fail.
 *
 * Bug #1 from docs/bugs.md is deliberately not reinstated: V46 used
 * `Number(value) || default`, so typing 0 into a field silently reverted to
 * the hardcoded default and the table quietly showed a different scenario than
 * the one on screen. Every input here uses an explicit empty check, and 0 is a
 * legitimate value.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useData, loadProfileArray } from '../lib/data'
import { supabase } from '../lib/supabaseClient'
import { simulate } from '../lib/quoteEngine'
import { JULY_SOLAR_W_PER_KW } from '../lib/solarJuly'

interface DayRow {
  day: number
  solar: number
  load: number
  endSoc: number
  minSoc: number
  unmet: number
}

export default function SimulationPage() {
  const { stocks, assumptions } = useData()
  const [panelW, setPanelW] = useState(475)
  const [panels, setPanels] = useState(36)
  const [batteryKwh, setBatteryKwh] = useState(27)
  const [dailyKwh, setDailyKwh] = useState(20)
  const [standbyW, setStandbyW] = useState(150)
  const [showHours, setShowHours] = useState<number | null>(null)

  const profile = useMemo(() => loadProfileArray(assumptions), [assumptions])

  // Seed panel wattage from the configured panel product rather than a literal.
  const loadPanel = useCallback(async () => {
    const { data } = await supabase.from('panel_settings').select('stock_id').eq('id', 1).maybeSingle()
    const p = stocks.find((s) => s.id === data?.stock_id)
    if (p?.watts) setPanelW(p.watts)
  }, [stocks])
  useEffect(() => { loadPanel() }, [loadPanel])

  const solarKw = (panels * panelW) / 1000

  const summary = useMemo(
    () => simulate(solarKw, batteryKwh, dailyKwh, standbyW, profile),
    [solarKw, batteryKwh, dailyKwh, standbyW, profile]
  )

  /** Re-walks the same arithmetic simulate() uses, retaining per-hour state so
   *  the tables can show the working. Kept separate from simulate() so the
   *  engine stays lean — this runs only when the page is open. */
  const trace = useMemo(() => {
    const sum = profile.reduce((s, x) => s + x, 0) || 1
    const standbyPerHour = standbyW / 1000
    let soc = batteryKwh
    const hours: { i: number; day: number; hour: number; prod: number; load: number; soc: number }[] = []
    const days: DayRow[] = []
    let dSolar = 0, dLoad = 0, dMin = batteryKwh, dUnmet = 0

    for (let i = 0; i < JULY_SOLAR_W_PER_KW.length; i++) {
      const hour = i % 24
      const prod = (solarKw * JULY_SOLAR_W_PER_KW[i]) / 1000
      const load = dailyKwh * (profile[hour] / sum) + standbyPerHour
      soc += prod - load
      if (soc > batteryKwh) soc = batteryKwh
      if (soc < 0) { dUnmet += -soc; soc = 0 }
      dSolar += prod; dLoad += load
      if (soc < dMin) dMin = soc
      hours.push({ i, day: Math.floor(i / 24) + 1, hour, prod, load, soc })
      if (hour === 23) {
        days.push({
          day: Math.floor(i / 24) + 1,
          solar: dSolar, load: dLoad, endSoc: soc, minSoc: dMin, unmet: dUnmet,
        })
        dSolar = 0; dLoad = 0; dMin = batteryKwh; dUnmet = 0
      }
    }
    return { hours, days }
  }, [solarKw, batteryKwh, dailyKwh, standbyW, profile])

  const worst = useMemo(
    () => trace.days.reduce((w, d) => (d.minSoc < w.minSoc ? d : w), trace.days[0]),
    [trace.days]
  )

  return (
    <div>
      <div className="calc-badges">
        <span className="calc-badge">July worst-case &middot; Ballarat VIC</span>
        <span className="calc-badge">31 days &middot; hourly</span>
        <span className={`calc-badge ${summary.passes ? 'badge-pass' : 'badge-fail'}`}>
          {summary.passes ? 'Survives July' : 'Does not survive July'}
        </span>
      </div>

      <div className="card settings-card" style={{ marginBottom: 14 }}>
        <div className="card-title">Scenario</div>
        <div className="calc-inputs">
          <F label="Daily load kWh">
            <input className="jdp-input num" type="number" step="0.5" value={dailyKwh}
              onChange={(e) => setDailyKwh(e.target.value === '' ? 0 : Number(e.target.value))} />
          </F>
          <F label="Panels">
            <input className="jdp-input num" type="number" value={panels}
              onChange={(e) => setPanels(e.target.value === '' ? 0 : Number(e.target.value))} />
          </F>
          <F label="Panel watts">
            <input className="jdp-input num" type="number" value={panelW}
              onChange={(e) => setPanelW(e.target.value === '' ? 0 : Number(e.target.value))} />
          </F>
          <F label="Battery kWh usable">
            <input className="jdp-input num" type="number" step="0.1" value={batteryKwh}
              onChange={(e) => setBatteryKwh(e.target.value === '' ? 0 : Number(e.target.value))} />
          </F>
          <F label="Standby draw W" hint="Parasitic, drawn every hour of every day">
            <input className="jdp-input num" type="number" value={standbyW}
              onChange={(e) => setStandbyW(e.target.value === '' ? 0 : Number(e.target.value))} />
          </F>
        </div>
      </div>

      <div className="sim-kpis">
        <Kpi label="Solar array" value={`${solarKw.toFixed(2)} kW`} />
        <Kpi label="Lowest state of charge" value={`${summary.minSoc.toFixed(2)} kWh`}
             tone={summary.minSoc <= 0 ? 'bad' : 'good'} />
        <Kpi label="Unmet load" value={`${summary.unmet.toFixed(2)} kWh`}
             tone={summary.unmet > 0 ? 'bad' : 'good'} />
        <Kpi label="Spilled (array full)" value={`${summary.spilled.toFixed(0)} kWh`} />
        <Kpi label="Worst day" value={worst ? `Day ${worst.day}` : '—'} />
      </div>

      <div className="card settings-card">
        <div className="card-title">Daily summary</div>
        <div className="mutedtext" style={{ fontSize: 11, marginBottom: 8 }}>
          Click a day to see its 24 hours. The battery starts full on day 1 and
          carries over — a run of dull days is what catches a system out, not
          any single one.
        </div>
        <table className="table calc-breakdown">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Day</th>
              <th className="num">Solar kWh</th>
              <th className="num">Load kWh</th>
              <th className="num">Min SOC</th>
              <th className="num">End SOC</th>
              <th className="num">Unmet</th>
            </tr>
          </thead>
          <tbody>
            {trace.days.map((d) => (
              <tr key={d.day}
                  className={d.unmet > 0 ? 'sim-row-fail' : undefined}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setShowHours(showHours === d.day ? null : d.day)}>
                <td style={{ textAlign: 'left' }}>
                  Day {d.day}{worst && d.day === worst.day ? ' — worst' : ''}
                </td>
                <td className="num">{d.solar.toFixed(1)}</td>
                <td className="num">{d.load.toFixed(1)}</td>
                <td className="num">{d.minSoc.toFixed(1)}</td>
                <td className="num">{d.endSoc.toFixed(1)}</td>
                <td className="num">{d.unmet > 0 ? d.unmet.toFixed(2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showHours != null && (
        <div className="card settings-card" style={{ marginTop: 14 }}>
          <div className="card-title">Day {showHours} — hourly</div>
          <table className="table calc-breakdown">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Hour</th>
                <th className="num">Solar kWh</th>
                <th className="num">Load kWh</th>
                <th className="num">SOC kWh</th>
              </tr>
            </thead>
            <tbody>
              {trace.hours.filter((h) => h.day === showHours).map((h) => (
                <tr key={h.i} className={h.soc <= 0 ? 'sim-row-fail' : undefined}>
                  <td style={{ textAlign: 'left' }}>{String(h.hour).padStart(2, '0')}:00</td>
                  <td className="num">{h.prod.toFixed(2)}</td>
                  <td className="num">{h.load.toFixed(2)}</td>
                  <td className="num">{h.soc.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`sim-kpi${tone ? ` sim-kpi-${tone}` : ''}`}>
      <div className="sim-kpi-label">{label}</div>
      <div className="sim-kpi-value num">{value}</div>
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
