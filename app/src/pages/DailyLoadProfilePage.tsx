import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { useData, DEFAULT_LOAD_PROFILE, loadProfileArray } from '../lib/data'
import { supabase } from '../lib/supabaseClient'

const HOURS = Array.from({ length: 24 }, (_, h) => h)

export default function DailyLoadProfilePage() {
  const { isAdmin } = useAuth()
  const { assumptions, refresh } = useData()

  const [profile, setProfile] = useState<number[]>(loadProfileArray(assumptions))
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const [saved, setSaved]     = useState(false)

  useEffect(() => {
    setProfile(loadProfileArray(assumptions))
  }, [assumptions])

  const dirty = JSON.stringify(profile) !== JSON.stringify(loadProfileArray(assumptions))

  function setHour(h: number, v: number) {
    const next = [...profile]
    next[h] = Number.isFinite(v) && v >= 0 ? v : 0
    setProfile(next)
  }

  function reset() {
    setProfile([...DEFAULT_LOAD_PROFILE])
  }

  function flatten() {
    setProfile(new Array(24).fill(1))
  }

  async function save() {
    if (!assumptions) return
    setSaving(true)
    setErr(null)
    const { error } = await supabase
      .from('assumptions')
      .update({ load_profile: profile })
      .eq('id', 1)
      .eq('version', assumptions.version)
    setSaving(false)
    if (error) {
      setErr(error.message.includes('0 rows') ? 'Changed elsewhere — refreshing.' : error.message)
      await refresh()
      return
    }
    await refresh()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const sum = profile.reduce((s, x) => s + x, 0) || 1
  const pct = profile.map((v) => (v / sum) * 100)
  const nightPct = shareFor(profile, sum, (h) => h >= 16 || h < 8)
  const mornPct  = shareFor(profile, sum, (h) => h >= 6 && h < 10)
  const evePct   = shareFor(profile, sum, (h) => h >= 17 && h < 22)

  return (
    <div className="page-scroll">
      <div className="card" style={{ maxWidth: 900 }}>
        <div className="card-title" style={{ fontSize: 15 }}>⏱️ Daily Load Profile</div>
        <div className="card-sub" style={{ marginBottom: 14, color: 'var(--muted)', fontSize: 12 }}>
          How the daily load is spread across 24 hours. Values are <strong>relative weights</strong> (auto-normalised —
          they don't need to total 100). The Simulation engine uses this exact shape. Default is a twin-peak
          residential curve: morning peak ~7–8am, larger evening peak ~6–7pm.
        </div>

        {err   && <div className="login-error" style={{ marginBottom: 10 }}>{err}</div>}
        {saved && <div className="login-ok"    style={{ marginBottom: 10 }}>✓ Saved!</div>}

        <LoadProfileChart pct={pct} />

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)', margin: '12px 0 16px' }}>
          <span>Night share (16:00–08:00): <strong style={{ color: 'var(--ink)' }}>{nightPct.toFixed(0)}%</strong></span>
          <span>Morning peak (06–10): <strong style={{ color: 'var(--ink)' }}>{mornPct.toFixed(0)}%</strong></span>
          <span>Evening peak (17–22): <strong style={{ color: 'var(--ink)' }}>{evePct.toFixed(0)}%</strong></span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gap: 6 }}>
          {HOURS.map((h) => (
            <div key={h} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <label style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace', textAlign: 'center' }}>
                {String(h).padStart(2, '0')}h
              </label>
              <input
                type="number"
                min={0}
                step={0.1}
                value={profile[h]}
                disabled={!isAdmin}
                onChange={(e) => setHour(h, Number(e.target.value))}
                style={{
                  width: '100%',
                  textAlign: 'center',
                  padding: '5px 4px',
                  fontSize: 11,
                  border: '1.5px solid var(--line)',
                  borderRadius: 6,
                  fontFamily: 'inherit',
                }}
              />
            </div>
          ))}
        </div>

        {isAdmin && (
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-gray" onClick={reset} title="Restore the default twin-peak curve">↺ Reset load profile</button>
            <button className="btn btn-gray" onClick={flatten} title="Set every hour equal (flat load)">▬ Flatten</button>
            <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
              {saving ? 'Saving…' : '💾 Save'}
            </button>
            {dirty && <span className="mutedtext">Unsaved changes</span>}
          </div>
        )}

        <div className="alert alert-info" style={{ marginTop: 16, fontSize: 11, background: '#eef0f3', color: 'var(--muted)', borderRadius: 6, padding: '8px 10px' }}>
          This shape is shared by every calculator in Quote Designer — editing it here changes the Simulation results
          and any tool that derives hourly load from Assumptions.
        </div>
      </div>
    </div>
  )
}

function shareFor(profile: number[], sum: number, match: (h: number) => boolean): number {
  let total = 0
  for (let h = 0; h < 24; h++) if (match(h)) total += profile[h]
  return (total / sum) * 100
}

function LoadProfileChart({ pct }: { pct: number[] }) {
  const W = 720, H = 150, PL = 38, PR = 12, PT = 10, PB = 24
  const cw = W - PL - PR, ch = H - PT - PB
  const maxPct = Math.max(...pct, 1)
  const barW = (cw / 24) * 0.72
  const xCenter = (h: number) => PL + ((h + 0.5) / 24) * cw

  const bars = pct.map((p, h) => {
    const bh = (p / maxPct) * ch
    const x = xCenter(h) - barW / 2
    const y = PT + ch - bh
    const isMorn = h >= 6 && h < 10
    const isEve  = h >= 17 && h < 22
    const col = isEve ? 'var(--primary)' : isMorn ? '#d99a1f' : '#dde1e7'
    const opacity = isMorn || isEve ? 0.9 : 0.6
    return <rect key={h} x={x} y={y} width={barW} height={bh} rx={1.5} fill={col} opacity={opacity} />
  })

  const labels = [0, 3, 6, 9, 12, 15, 18, 21, 23].map((h) => (
    <text key={h} x={xCenter(h)} y={H - 8} textAnchor="middle" fontSize={9} fill="var(--muted)" fontFamily="monospace">
      {String(h).padStart(2, '0')}
    </text>
  ))

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
        <line x1={PL} y1={PT} x2={W - PR} y2={PT} stroke="var(--line)" strokeWidth={1} opacity={0.4} />
        <text x={PL - 4} y={PT + 3} textAnchor="end" fontSize={9} fill="var(--muted)" fontFamily="monospace">
          {maxPct.toFixed(1)}
        </text>
        <line x1={PL} y1={PT + ch} x2={W - PR} y2={PT + ch} stroke="var(--line)" strokeWidth={1} />
        {bars}
        {labels}
        <text x={9} y={PT + ch / 2} textAnchor="middle" fontSize={9} fill="var(--muted)" fontFamily="monospace" transform={`rotate(-90,9,${PT + ch / 2})`}>
          % / hour
        </text>
        <text x={PL + 8} y={PT + 10} fontSize={9} fill="#d99a1f" fontFamily="monospace">▌morning</text>
        <text x={PL + 78} y={PT + 10} fontSize={9} fill="var(--primary)" fontFamily="monospace">▌evening</text>
      </svg>
    </div>
  )
}
