/**
 * Ground Mount BOM — port of V46's §gmbom tab.
 *
 * The geometry lives in lib/groundMountBom.ts; this is the screen. Costs come
 * from the `gm_component` rows in the product catalogue rather than V46's
 * localStorage blob, so there is no per-part cost editor here: change a price
 * on the Stock page and every future BOM follows. That is the point of having
 * moved them into `stocks`.
 */
import { useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { useData } from '../lib/data'
import { calcGroundMountBom, gmOrderText } from '../lib/groundMountBom'
import { copyText } from '../lib/clipboard'
import { fmtMoney, fmtMoneyExact } from '../lib/format'

export default function GroundMountBomPage() {
  const { stocks } = useData()

  const [panelWidth, setPanelWidth] = useState(1134)
  const [panelThick, setPanelThick] = useState<30 | 35>(35)
  const [panelPower, setPanelPower] = useState(490)
  const [panelsPerRow, setPanelsPerRow] = useState(6)
  const [numArrays, setNumArrays] = useState(1)
  const [copied, setCopied] = useState(false)

  const result = useMemo(
    () => calcGroundMountBom(
      { panelWidth, panelThick, panelPower, panelsPerRow, numArrays },
      stocks,
    ),
    [panelWidth, panelThick, panelPower, panelsPerRow, numArrays, stocks],
  )

  async function copyOrder() {
    if (!result) return
    const ok = await copyText(gmOrderText(result))
    setCopied(ok)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div>
      <div className="card settings-card" style={{ marginBottom: 14 }}>
        <div className="card-title">Array geometry</div>
        <div className="calc-inputs">
          <Field label="Panel width (mm)">
            <input className="jdp-input num" type="number" min={1} value={panelWidth}
              onChange={(e) => setPanelWidth(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Field label="Panel thickness" hint="Selects the end clamp">
            <select className="jdp-input" value={panelThick}
              onChange={(e) => setPanelThick(Number(e.target.value) === 30 ? 30 : 35)}>
              <option value={35}>35 mm</option>
              <option value={30}>30 mm</option>
            </select>
          </Field>
          <Field label="Panel power (W)">
            <input className="jdp-input num" type="number" min={1} value={panelPower}
              onChange={(e) => setPanelPower(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Field label="Panels per row">
            <input className="jdp-input num" type="number" min={1} value={panelsPerRow}
              onChange={(e) => setPanelsPerRow(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Field label="Number of arrays">
            <input className="jdp-input num" type="number" min={1} value={numArrays}
              onChange={(e) => setNumArrays(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
        </div>
      </div>

      {!result && <div className="placeholder">Enter the array geometry to generate a BOM.</div>}

      {result && (
        <>
          <div className="calc-badges">
            <Kpi value={result.arrayLength.toFixed(0)} unit="mm" label="Array length" />
            <Kpi value={result.realisedSpacing.toFixed(0)} unit="mm" label="Realised spacing" />
            <Kpi value={String(result.totalPanels)} unit="panels" label="Total panels" />
            <Kpi value={result.totalPowerKw > 0 ? result.totalPowerKw.toFixed(2) : '—'} unit="kW" label="Total power" />
            <Kpi value={result.totalWeightKg.toFixed(1)} unit="kg" label="Total weight" />
            <Kpi value={fmtMoney(result.totalCost)} unit="" label="Total cost" />
          </div>

          {result.unmatched.length > 0 && (
            <div className="calc-warning">
              <strong>{result.unmatched.length} part(s) not in the catalogue</strong> — priced
              at $0 and the total is therefore low. Missing codes:{' '}
              {result.unmatched.join(', ')}. Add them on the Stock page as
              ground-mount components with the code in the Model field.
            </div>
          )}

          <div className="card settings-card">
            <div className="card-title">
              Bill of materials — {numArrays} array{numArrays === 1 ? '' : 's'}
            </div>
            <table className="table calc-breakdown">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Code</th>
                  <th style={{ textAlign: 'left' }}>Part</th>
                  <th style={{ textAlign: 'left' }}>L&amp;H</th>
                  <th className="num">Per array</th>
                  <th className="num">Qty</th>
                  <th className="num">kg</th>
                  <th className="num">Unit</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.code}>
                    <td style={{ textAlign: 'left' }} className="num">{r.code}</td>
                    <td style={{ textAlign: 'left' }}>
                      {r.desc}
                      {!r.stockId && r.lh !== '—' && <span className="short-pill">no stock item</span>}
                    </td>
                    <td style={{ textAlign: 'left' }} className="num">{r.lh}</td>
                    <td className="num">{r.perArray}</td>
                    <td className="num">{r.qty}</td>
                    <td className="num">{r.weightTotal.toFixed(1)}</td>
                    <td className="num">{r.unitCost > 0 ? fmtMoneyExact(r.unitCost) : '—'}</td>
                    <td className="num">{r.lineCost > 0 ? fmtMoneyExact(r.lineCost) : '—'}</td>
                  </tr>
                ))}
                <tr className="calc-final">
                  <td style={{ textAlign: 'left' }} colSpan={5}>Totals</td>
                  <td className="num">{result.totalWeightKg.toFixed(1)} kg</td>
                  <td />
                  <td className="num">{fmtMoneyExact(result.totalCost)}</td>
                </tr>
                <tr className="calc-subtotal">
                  <td style={{ textAlign: 'left' }} colSpan={7}>Cost per panel</td>
                  <td className="num">{fmtMoneyExact(result.costPerPanel)}</td>
                </tr>
              </tbody>
            </table>

            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-gray" onClick={copyOrder}>
                <Copy size={13} aria-hidden /> {copied ? 'Copied!' : 'Copy order list for L&H'}
              </button>
              <span className="mutedtext" style={{ fontSize: 11 }}>
                Orderable lines only — code, part, quantity. Paste straight into an order.
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <span className="calc-badge">
      <strong>{value}</strong>{unit ? ` ${unit}` : ''} · {label}
    </span>
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
