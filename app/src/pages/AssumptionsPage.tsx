/**
 * AssumptionsPage — the business settings that drive quoting.
 *
 * Replaces the V46 Assumptions table's 45 hand-maintained numbers. Two thirds
 * of those were equipment costs and specs; those now live on products (Stock
 * page) and are deliberately NOT editable here — one number, one place. What
 * remains is genuinely global: pricing, rebates, sizing limits, fixed site
 * costs and install rates.
 *
 * This is the screen that removes the reason to open 100UP_suite_V46.html to
 * change a price, and with it the risk that the old file and the database
 * disagree (2026-07-29 status doc §5).
 *
 * Settings are fetched here rather than in DataContext: they change rarely and
 * only this page reads them today. When the calculator lands it will need them
 * too — that is the point to promote them into shared state, not before.
 */
import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Wrench } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useData } from '../lib/data'
import { supabase } from '../lib/supabaseClient'
import type { Tables, TablesUpdate } from '../types/database.types'

type Pricing = Tables<'pricing_settings'>
type Rebates = Tables<'rebate_settings'>
type Tier = Tables<'battery_rebate_tiers'>
type Sizing = Tables<'sizing_rules'>
type FixedCost = Tables<'fixed_site_costs'>
type Panels = Tables<'panel_settings'>
type GroundMount = Tables<'ground_mount_settings'>
type Mfr = Tables<'manufacturers'>

export default function AssumptionsPage() {
  const { isAdmin } = useAuth()
  const { stocks } = useData()

  const [pricing, setPricing] = useState<Pricing | null>(null)
  const [rebates, setRebates] = useState<Rebates | null>(null)
  const [tiers, setTiers] = useState<Tier[]>([])
  const [sizing, setSizing] = useState<Sizing | null>(null)
  const [fixed, setFixed] = useState<FixedCost[]>([])
  const [panels, setPanels] = useState<Panels | null>(null)
  const [gm, setGm] = useState<GroundMount | null>(null)
  const [mfrs, setMfrs] = useState<Mfr[]>([])

  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [p, r, t, sz, f, pl, g, m] = await Promise.all([
      supabase.from('pricing_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('rebate_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('battery_rebate_tiers').select('*').order('sort_order'),
      supabase.from('sizing_rules').select('*').eq('id', 1).maybeSingle(),
      supabase.from('fixed_site_costs').select('*').order('sort_order'),
      supabase.from('panel_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('ground_mount_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('manufacturers').select('*').order('brand'),
    ])
    setPricing(p.data); setRebates(r.data); setTiers(t.data ?? [])
    setSizing(sz.data); setFixed(f.data ?? []); setPanels(pl.data); setGm(g.data)
    setMfrs(m.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function flash(msg: string) {
    setSaved(msg)
    setTimeout(() => setSaved(null), 2200)
  }

  /** The five singleton settings tables. Repeaters (tiers, fixed costs) save
   *  per-row and are handled inline. */
  type SettingsTable =
    | 'pricing_settings' | 'rebate_settings' | 'sizing_rules'
    | 'panel_settings' | 'ground_mount_settings'

  async function saveOne<T extends SettingsTable>(table: T, patch: TablesUpdate<T>, label: string) {
    setErr(null)
    // supabase-js resolves the row type from a LITERAL table name, so a
    // generic T leaves both .update() and .eq() unresolvable. Narrowing to one
    // concrete table confines the cast to these two lines; every call site is
    // still checked, because `patch` is typed TablesUpdate<T> on the way in
    // and all five tables share the `id = 1` singleton shape.
    type Concrete = 'pricing_settings'
    const { error } = await supabase
      .from(table as Concrete)
      .update(patch as TablesUpdate<Concrete>)
      .eq('id', 1)
    if (error) { setErr(error.message); return }
    await load()
    flash(`${label} saved`)
  }

  if (loading) return <div className="pipeline-page"><div className="placeholder">Loading settings…</div></div>

  const ro = !isAdmin

  return (
    <div className="pipeline-page">
      <div className="filter-row">
        <div>
          <div className="card-title" style={{ fontSize: 15 }}>Assumptions</div>
          <div className="mutedtext" style={{ fontSize: 12 }}>
            Business settings that drive quoting. Equipment costs and specs live on the{' '}
            <strong>Stock</strong> page — one number, one place.
          </div>
        </div>
      </div>

      {err && <div className="login-error" style={{ marginBottom: 10 }}>{err}</div>}
      {saved && <div className="login-ok" style={{ marginBottom: 10 }}>{saved}</div>}

      <div className="settings-grid">
        {/* ── Pricing ── */}
        <Card title="Pricing">
          {pricing && (
            <>
              <Num label="Margin %" hint="Applied to total cost, before GST and rebates"
                   value={pricing.margin * 100} disabled={ro}
                   onChange={(v) => setPricing({ ...pricing, margin: v / 100 })} />
              <Num label="GST %" hint="Applied after margin"
                   value={pricing.gst * 100} disabled={ro}
                   onChange={(v) => setPricing({ ...pricing, gst: v / 100 })} />
              <SaveRow disabled={ro} onClick={() => saveOne('pricing_settings',
                { margin: pricing.margin, gst: pricing.gst }, 'Pricing')} />
            </>
          )}
        </Card>

        {/* ── Sizing rules ── */}
        <Card title="Sizing rules">
          {sizing && (
            <>
              <Num label="Solar per inverter, single phase %" hint="200 = 2× inverter kW of DC solar"
                   value={sizing.solar_oversize_percent} disabled={ro}
                   onChange={(v) => setSizing({ ...sizing, solar_oversize_percent: v })} />
              <Num label="Solar per inverter, three phase %" hint="Separate limit — 160 is the three-phase rule"
                   value={sizing.solar_oversize_3ph_percent} disabled={ro}
                   onChange={(v) => setSizing({ ...sizing, solar_oversize_3ph_percent: v })} />
              <Num label="Max batteries per inverter" hint="Drives inverter count up when batteries exceed it"
                   value={sizing.max_batteries_per_inverter} disabled={ro}
                   onChange={(v) => setSizing({ ...sizing, max_batteries_per_inverter: v })} />
              <Num label="Minimum inverters" hint="Floor; a quote can override it for redundancy"
                   value={sizing.min_inverters} disabled={ro}
                   onChange={(v) => setSizing({ ...sizing, min_inverters: v })} />
              <SaveRow disabled={ro} onClick={() => saveOne('sizing_rules', {
                solar_oversize_percent: sizing.solar_oversize_percent,
                solar_oversize_3ph_percent: sizing.solar_oversize_3ph_percent,
                max_batteries_per_inverter: sizing.max_batteries_per_inverter,
                min_inverters: sizing.min_inverters,
              }, 'Sizing rules')} />
            </>
          )}
        </Card>

        {/* ── Rebates ── */}
        <Card title="Rebates">
          {rebates && (
            <>
              <Num label="Solar STCs per kW" value={rebates.solar_stc_per_kw} disabled={ro}
                   onChange={(v) => setRebates({ ...rebates, solar_stc_per_kw: v })} />
              <Num label="Solar STC price $" value={rebates.solar_stc_price} disabled={ro}
                   onChange={(v) => setRebates({ ...rebates, solar_stc_price: v })} />
              <Num label="Battery STC price $" value={rebates.battery_stc_price} disabled={ro}
                   onChange={(v) => setRebates({ ...rebates, battery_stc_price: v })} />
              <SaveRow disabled={ro} onClick={() => saveOne('rebate_settings', {
                solar_stc_per_kw: rebates.solar_stc_per_kw,
                solar_stc_price: rebates.solar_stc_price,
                battery_stc_price: rebates.battery_stc_price,
              }, 'Rebates')} />
            </>
          )}

          {/* Band boundaries are data, not code. They were hardcoded at
              14/28/50 kWh in the V46 engine, so a legislated change meant a
              code edit. */}
          <div className="settings-sub">Battery rebate tiers (STCs per kWh)</div>
          <table className="table settings-table">
            <thead><tr><th>From kWh</th><th>To kWh</th><th>STC / kWh</th><th /></tr></thead>
            <tbody>
              {tiers.map((t, i) => (
                <tr key={t.id}>
                  <td><input className="jdp-input num" type="number" step="0.1" disabled={ro} value={t.from_kwh}
                    onChange={(e) => setTiers(tiers.map((x, j) => j === i ? { ...x, from_kwh: Number(e.target.value) } : x))} /></td>
                  <td><input className="jdp-input num" type="number" step="0.1" disabled={ro} value={t.to_kwh ?? ''}
                    placeholder="no limit"
                    onChange={(e) => setTiers(tiers.map((x, j) => j === i ? { ...x, to_kwh: e.target.value === '' ? null : Number(e.target.value) } : x))} /></td>
                  <td><input className="jdp-input num" type="number" step="0.01" disabled={ro} value={t.stc_per_kwh}
                    onChange={(e) => setTiers(tiers.map((x, j) => j === i ? { ...x, stc_per_kwh: Number(e.target.value) } : x))} /></td>
                  <td>{!ro && (
                    <button className="icon-btn" title="Remove tier" onClick={async () => {
                      await supabase.from('battery_rebate_tiers').delete().eq('id', t.id); await load()
                    }}><Trash2 size={13} aria-hidden /></button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!ro && (
            <div className="settings-actions">
              <button className="btn btn-gray" onClick={async () => {
                const next = (tiers.at(-1)?.sort_order ?? 0) + 1
                await supabase.from('battery_rebate_tiers').insert({
                  from_kwh: tiers.at(-1)?.to_kwh ?? 0, to_kwh: null, stc_per_kwh: 0, sort_order: next,
                })
                await load()
              }}><Plus size={13} aria-hidden /> Add tier</button>
              <button className="btn btn-primary" onClick={async () => {
                setErr(null)
                for (const t of tiers) {
                  const { error } = await supabase.from('battery_rebate_tiers')
                    .update({ from_kwh: t.from_kwh, to_kwh: t.to_kwh, stc_per_kwh: t.stc_per_kwh }).eq('id', t.id)
                  if (error) { setErr(error.message); return }
                }
                await load(); flash('Tiers saved')
              }}>Save tiers</button>
            </div>
          )}
        </Card>

        {/* ── Fixed site costs ── */}
        <Card title="Fixed site costs">
          <div className="mutedtext" style={{ fontSize: 11, marginBottom: 8 }}>
            Charged once per job regardless of system size.
          </div>
          <table className="table settings-table">
            <thead><tr><th style={{ textAlign: 'left' }}>Label</th><th>Amount $</th><th /></tr></thead>
            <tbody>
              {fixed.map((f, i) => (
                <tr key={f.id}>
                  <td><input className="jdp-input" disabled={ro} value={f.label}
                    onChange={(e) => setFixed(fixed.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} /></td>
                  <td><input className="jdp-input num" type="number" step="0.01" disabled={ro} value={f.amount}
                    onChange={(e) => setFixed(fixed.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))} /></td>
                  <td>{!ro && (
                    <button className="icon-btn" title="Remove" onClick={async () => {
                      await supabase.from('fixed_site_costs').delete().eq('id', f.id); await load()
                    }}><Trash2 size={13} aria-hidden /></button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!ro && (
            <div className="settings-actions">
              <button className="btn btn-gray" onClick={async () => {
                await supabase.from('fixed_site_costs').insert({
                  label: 'New cost', amount: 0, sort_order: (fixed.at(-1)?.sort_order ?? 0) + 1,
                })
                await load()
              }}><Plus size={13} aria-hidden /> Add cost</button>
              <button className="btn btn-primary" onClick={async () => {
                setErr(null)
                for (const f of fixed) {
                  const { error } = await supabase.from('fixed_site_costs')
                    .update({ label: f.label, amount: f.amount }).eq('id', f.id)
                  if (error) { setErr(error.message); return }
                }
                await load(); flash('Fixed costs saved')
              }}>Save costs</button>
            </div>
          )}
        </Card>

        {/* ── Panels ── */}
        <Card title="Solar panels">
          {panels && (
            <>
              <div className="settings-field">
                <span className="jdp-label">Panel product</span>
                <select className="jdp-input" disabled={ro} value={panels.stock_id ?? ''}
                  onChange={(e) => setPanels({ ...panels, stock_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">—</option>
                  {stocks.filter((s) => s.product_type === 'panel' && s.active).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <span className="settings-hint">
                  Wattage, supply cost, manufacturer and model all come from this product.
                </span>
              </div>
              <Num label="Install cost $ per watt" hint="Ground-mounted panels are charged at half this"
                   value={panels.install_cost_per_w} step="0.01" disabled={ro}
                   onChange={(v) => setPanels({ ...panels, install_cost_per_w: v })} />
              <Num label="Roof frame $ per panel" value={panels.roof_frame_per_panel} disabled={ro}
                   onChange={(v) => setPanels({ ...panels, roof_frame_per_panel: v })} />
              <SaveRow disabled={ro} onClick={() => saveOne('panel_settings', {
                stock_id: panels.stock_id,
                install_cost_per_w: panels.install_cost_per_w,
                roof_frame_per_panel: panels.roof_frame_per_panel,
              }, 'Panel settings')} />
            </>
          )}
        </Card>

        {/* ── Manufacturers ──
            Editable here because these strings go onto CES submissions and two
            of them are currently unverified. One brand can hold several legal
            entities — Deye inverters and Deye batteries are separately listed
            CEC entities — so brand and legal name are distinct fields. */}
        <Card title="Manufacturers">
          <div className="mutedtext" style={{ fontSize: 11, marginBottom: 8 }}>
            The legal name is what a CES submission reports. Tick verified only
            once you have checked it against the CEC listing.
          </div>
          <table className="table settings-table">
            <thead><tr>
              <th style={{ textAlign: 'left' }}>Brand</th>
              <th style={{ textAlign: 'left' }}>CEC legal name</th>
              <th>Verified</th><th />
            </tr></thead>
            <tbody>
              {mfrs.map((m, i) => (
                <tr key={m.id}>
                  <td><input className="jdp-input" disabled={ro} value={m.brand}
                    onChange={(e) => setMfrs(mfrs.map((x, j) => j === i ? { ...x, brand: e.target.value } : x))} /></td>
                  <td><input className="jdp-input" disabled={ro} value={m.legal_name}
                    onChange={(e) => setMfrs(mfrs.map((x, j) => j === i ? { ...x, legal_name: e.target.value } : x))} /></td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" disabled={ro} checked={m.cec_verified}
                      onChange={(e) => setMfrs(mfrs.map((x, j) => j === i ? { ...x, cec_verified: e.target.checked } : x))} />
                  </td>
                  <td>{!ro && (
                    <button className="icon-btn" title="Remove" onClick={async () => {
                      setErr(null)
                      const { error } = await supabase.from('manufacturers').delete().eq('id', m.id)
                      // on delete restrict — a manufacturer with products cannot go.
                      if (error) { setErr('Still used by products — reassign them first.'); return }
                      await load()
                    }}><Trash2 size={13} aria-hidden /></button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!ro && (
            <div className="settings-actions">
              <button className="btn btn-gray" onClick={async () => {
                await supabase.from('manufacturers').insert({ brand: 'New brand', legal_name: '' })
                await load()
              }}><Plus size={13} aria-hidden /> Add manufacturer</button>
              <button className="btn btn-primary" onClick={async () => {
                setErr(null)
                for (const m of mfrs) {
                  const { error } = await supabase.from('manufacturers')
                    .update({ brand: m.brand, legal_name: m.legal_name, cec_verified: m.cec_verified })
                    .eq('id', m.id)
                  if (error) { setErr(error.message); return }
                }
                await load(); flash('Manufacturers saved')
              }}>Save manufacturers</button>
            </div>
          )}
        </Card>

        {/* ── System setup — not built yet ──
            Panels get a product selector above because there is one panel
            choice for the business: a singleton, so it belongs in settings.
            Inverters, batteries and components are per SYSTEM OPTION — each
            brand has its own tiers, and each component carries a quantity rule
            (gateway one per <=3 inverters, mounting kit one per inverter). That
            needs the system_configs tables, which is Phase B. Shown rather than
            omitted so the gap reads as sequencing, not an oversight. */}
        <Card title="System setup">
          <div className="settings-pending">
            <Wrench size={15} aria-hidden />
            <div>
              <strong>Edited on the Stock page, not here.</strong>
              <div className="settings-hint" style={{ marginTop: 4 }}>
                Inverters, batteries and add-on components (gateway, mounting
                kit, stack base) are <strong>already wired up and in use</strong> —
                the calculators price from them today. Their costs and specs live
                on the <strong>Stock</strong> page and are edited there.
                What is not built is a screen <em>here</em> for re-pointing which
                product fills which slot; that needs the full configurator and is
                scheduled after go-live.
              </div>
              <div className="settings-hint" style={{ marginTop: 6 }}>
                Standby draw moves here from the simulation settings at the same
                time.
              </div>
            </div>
          </div>
        </Card>

        {/* ── Ground mount ── */}
        <Card title="Ground mount">
          {gm && (
            <>
              <Num label="Labour $ per panel" value={gm.labour_per_panel} disabled={ro}
                   onChange={(v) => setGm({ ...gm, labour_per_panel: v })} />
              <Num label="Machinery, fixed $" hint="One-off plant cost when any ground mount is present"
                   value={gm.machinery_fixed} disabled={ro}
                   onChange={(v) => setGm({ ...gm, machinery_fixed: v })} />
              <Num label="Ballpark frame $ per panel"
                   hint="Estimate for quotes made before the array is sized. Once the Ground Mount BOM is built, real frame cost comes from the parts list."
                   value={gm.ballpark_frame_per_panel} disabled={ro}
                   onChange={(v) => setGm({ ...gm, ballpark_frame_per_panel: v })} />
              <SaveRow disabled={ro} onClick={() => saveOne('ground_mount_settings', {
                labour_per_panel: gm.labour_per_panel,
                machinery_fixed: gm.machinery_fixed,
                ballpark_frame_per_panel: gm.ballpark_frame_per_panel,
              }, 'Ground mount')} />
            </>
          )}
        </Card>
      </div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card settings-card">
      <div className="card-title">{title}</div>
      {children}
    </div>
  )
}

function SaveRow({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  if (disabled) return null
  return (
    <div className="settings-actions">
      <button className="btn btn-primary" onClick={onClick}>Save</button>
    </div>
  )
}

function Num({
  label, hint, value, onChange, disabled, step = '1',
}: {
  label: string; hint?: string; value: number
  onChange: (v: number) => void; disabled: boolean; step?: string
}) {
  return (
    <div className="settings-field">
      <span className="jdp-label">{label}</span>
      <input
        className="jdp-input num"
        type="number"
        step={step}
        disabled={disabled}
        value={value}
        // Number(e.target.value) not `|| fallback` — bug #1 in docs/bugs.md was
        // exactly this: `Number(v) || default` treats a typed 0 as falsy and
        // silently reverts it. A margin or rate of 0 is legitimate.
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
      {hint && <span className="settings-hint">{hint}</span>}
    </div>
  )
}
