// Verifies the GST-basis reconciliation in supabase/functions/_shared/invoice.ts.
//
// Worth a standing test because getting this wrong is silent and expensive:
// deciding "ex-GST" when the printed line prices actually include it puts every
// captured cost 10% too high (or too low the other way), and nothing downstream
// would flag it — the receipt saves, the numbers look plausible, and last_cost
// is quietly wrong on every item from that supplier.
//
// The module has no imports, so it runs straight under tsx despite living in
// the Deno function tree:  npx tsx scripts/invoice-reconcile-check.ts
import { normaliseExtraction, reconcile } from '../../supabase/functions/_shared/invoice'

let failures = 0

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}

const line = (name: string, qty: number, unit_cost: number | null, extra = {}) =>
  ({ name, qty, unit_cost, ...extra })

// 1. Plain ex-GST invoice: lines add to the subtotal, GST is 10% on top.
//    2x100 + 5x50 = 450, +10% = 495.
check('ex-GST, no freight',
  reconcile(normaliseExtraction({
    lines: [line('Panel', 2, 100), line('Rail', 5, 50)],
    subtotal_ex_gst: 450, gst_amount: 45, total_inc_gst: 495,
  })).price_basis, 'ex_gst')

// 2. Freight INSIDE the ex-GST subtotal — the common Australian layout.
//    Goods 450 + freight 60 = 510 subtotal. Lines alone are 450, so a naive
//    comparison against the subtotal fails and the basis would read 'unknown'.
check('ex-GST, freight inside subtotal',
  reconcile(normaliseExtraction({
    lines: [line('Panel', 2, 100), line('Rail', 5, 50)],
    freight_ex_gst: 60, subtotal_ex_gst: 510, gst_amount: 51, total_inc_gst: 561,
  })).price_basis, 'ex_gst')

// 3. GST-inclusive line prices. 2x110 + 5x55 = 495 = the grand total.
check('inc-GST lines',
  reconcile(normaliseExtraction({
    lines: [line('Panel', 2, 110), line('Rail', 5, 55)],
    subtotal_ex_gst: 450, gst_amount: 45, total_inc_gst: 495,
  })).price_basis, 'inc_gst')

// 4. Per-line GST breakdown means the printed price is already ex-GST,
//    whatever the totals say.
check('per-line GST breakdown -> mixed',
  reconcile(normaliseExtraction({
    lines: [line('Panel', 2, 100, { gst_applicable: true }), line('Book', 1, 30, { gst_applicable: false })],
    subtotal_ex_gst: 230, gst_amount: 20, total_inc_gst: 250,
  })).price_basis, 'mixed')

// 5. Delivery docket: quantities but no prices. Nothing to resolve, and the
//    RPC only insists on a basis when there are prices to normalise.
check('docket with no prices -> unknown',
  reconcile(normaliseExtraction({
    lines: [line('Panel', 2, null), line('Rail', 5, null)],
  })).price_basis, 'unknown')

// 6. Figures that agree with nothing. Must refuse rather than pick one.
const nonsense = reconcile(normaliseExtraction({
  lines: [line('Panel', 2, 100)],
  subtotal_ex_gst: 999, gst_amount: 99.9, total_inc_gst: 1098.9,
}))
check('nothing reconciles -> unknown', nonsense.price_basis, 'unknown')
check('nothing reconciles -> warns', nonsense.warnings.length > 0, true)

// 7. Rounding tolerance. Suppliers round per line; 450.02 against 450 is the
//    same invoice, not a mismatch.
check('rounding within tolerance',
  reconcile(normaliseExtraction({
    lines: [line('Panel', 3, 150.006)],
    subtotal_ex_gst: 450, gst_amount: 45, total_inc_gst: 495,
  })).price_basis, 'ex_gst')

// 8. The truncated-scan check: the document says 5 lines, 3 were read.
const short = reconcile(normaliseExtraction({
  lines: [line('A', 1, 10), line('B', 1, 10), line('C', 1, 10)],
  claimed_line_count: 5, subtotal_ex_gst: 30, gst_amount: 3, total_inc_gst: 33,
}))
check('claimed line count mismatch warns',
  short.warnings.some((w) => w.includes('5 line items')), true)

// 9. GST that is not 10% of the subtotal — misread, or partly GST-free.
check('GST not 10% of subtotal warns',
  reconcile(normaliseExtraction({
    lines: [line('Panel', 2, 100)],
    subtotal_ex_gst: 200, gst_amount: 5, total_inc_gst: 205,
  })).warnings.some((w) => w.includes('10%')), true)

// 10. Freight and non-product lines must never become stock.
check('freight excluded from lines is not invented',
  normaliseExtraction({ lines: [line('Panel', 2, 100)], freight_ex_gst: 60 }).lines.length, 1)

// 11. Zero and unnamed lines are dropped rather than shown as rows to delete.
check('zero-qty and unnamed lines dropped',
  normaliseExtraction({ lines: [line('Panel', 0, 100), line('', 5, 10), line('Rail', 5, 50)] }).lines.length, 1)

// 12. Currency strings off the page coerce to numbers.
check('currency strings coerce',
  normaliseExtraction({ lines: [{ name: 'Panel', qty: '2', unit_cost: '$1,234.56' }] }).lines[0].unit_cost,
  1234.56)

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
