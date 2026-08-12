/**
 * Reading supplier invoices and delivery dockets.
 *
 * Split out of _shared/ai.ts, which stays generic: aiComplete() knows how to
 * talk to Anthropic, and this module knows what a supplier document is.
 *
 * The division of labour matters and is the same one used throughout this
 * feature — the MODEL READS, ARITHMETIC DECIDES. Anthropic extracts figures
 * off a scan. Nothing it says about GST, totals or completeness is taken on
 * trust: reconcile() checks the numbers against each other, and where they do
 * not agree it says so rather than picking an answer.
 */

/** Model for reading supplier documents. Overridable in Settings. */
export function invoiceModel(config: { invoice_model?: string } | null | undefined): string {
  // Extraction runs against scans and phone photos where a misread line item
  // becomes a wrong stock count and a wrong cost. Deliberately not the cheap
  // text model — a whole invoice costs a fraction of a cent either way.
  return config?.invoice_model || 'claude-sonnet-5'
}

export interface ExtractedLine {
  name: string
  /** Delivered/received quantity — what to actually receive into stock. */
  qty: number
  /** What the DOCUMENT says was ordered, where it prints both. A cross-check
   *  against our own PO, not a substitute for it. */
  qty_ordered: number | null
  /** Unit price exactly as printed. GST basis is resolved separately. */
  unit_cost: number | null
  /** Only set where the document itemises GST per line. */
  gst_applicable: boolean | null
}

export interface ExtractedDocument {
  doc_type: 'docket' | 'invoice' | 'both'
  supplier: string | null
  supplier_ref: string | null
  doc_date: string | null
  /** 100UP's own PO number where the supplier printed it. Seeds PO matching. */
  po_ref: string | null
  claimed_line_count: number | null
  claimed_total_units: number | null
  subtotal_ex_gst: number | null
  gst_amount: number | null
  total_inc_gst: number | null
  freight_ex_gst: number | null
  other_charges_ex_gst: number | null
  lines: ExtractedLine[]
}

export const INVOICE_EXTRACT_PROMPT = `You read supplier invoices and delivery/goods-received dockets for an Australian solar installation business and return structured JSON.

Return ONLY a JSON object, no prose and no markdown fence, with exactly these keys:

  "doc_type"            "docket" if it is a delivery docket or packing slip with no prices,
                        "invoice" if it is a tax invoice or bill,
                        "both" if one document serves as each
  "supplier"            the SUPPLYING company's name as printed, or null
  "supplier_ref"        their invoice or docket number, or null
  "doc_date"            the document's date, ISO "YYYY-MM-DD", or null
  "po_ref"              the CUSTOMER's purchase order number if the document quotes one
                        (often labelled "Your order", "Customer PO", "Order ref"), or null
  "claimed_line_count"  the number of line items the document itself states, if printed, else null
  "claimed_total_units" the total quantity the document itself states, if printed, else null
  "subtotal_ex_gst"     the printed subtotal before GST, or null
  "gst_amount"          the printed GST/tax amount, or null
  "total_inc_gst"       the printed grand total including GST, or null
  "freight_ex_gst"      freight/delivery/cartage charged, excluding GST. 0 if none appears
  "other_charges_ex_gst" any other non-product charge (handling, surcharge, pallet).
                        0 if none appears
  "lines"               array of line objects, described below

Each entry in "lines":
  "name"            the product description as printed, including model or part number
  "qty"             the quantity actually SUPPLIED on this document
  "qty_ordered"     the ordered quantity where the document prints ordered and
                    delivered separately, else null
  "unit_cost"       the price for ONE unit exactly as printed. If only a line
                    total is shown, divide it by qty. null if no price appears
  "gst_applicable"  true/false ONLY where the document shows GST per line item.
                    null when GST is shown once at the bottom instead

Rules:
- One entry per physical product line actually supplied.
- Do not tidy, expand, correct or translate "name" — it is matched against an
  existing stock list downstream, so the printed form is what is useful.
- Where ordered and delivered quantities differ, "qty" is the DELIVERED figure.
- EXCLUDE freight, delivery, surcharges, GST and tax lines, rounding, discounts,
  payments and totals from "lines". Those are not stock. Freight goes in its own
  field; a freight line treated as a product corrupts stock on hand.
- Exclude any line with a zero or absent quantity.
- Report prices EXACTLY as printed. Do not add or remove GST yourself — whether
  the printed line prices include it is worked out separately from the totals.

If the document is unreadable, or is not an invoice or delivery docket, return
the same object with nulls and an empty "lines" array.

Never invent a value. null is the correct answer when the document does not say.`

// ── coercion ──────────────────────────────────────────────────────────────

/** Invoices are full of currency-formatted strings; the model is asked for
 *  numbers but reads "$1,234.56" off the page. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

export function normaliseExtraction(raw: unknown): ExtractedDocument {
  const o = (raw ?? {}) as Record<string, unknown>
  const rawLines = Array.isArray(o.lines) ? o.lines : []

  const lines: ExtractedLine[] = []
  for (const entry of rawLines) {
    const l = (entry ?? {}) as Record<string, unknown>
    const name = str(l.name)
    const qty = num(l.qty)
    // A line with no name or no positive quantity cannot be received against
    // stock. Dropped here rather than shown as a row Fred has to delete.
    if (!name || qty === null || qty <= 0) continue
    lines.push({
      name,
      qty,
      qty_ordered: num(l.qty_ordered),
      unit_cost: num(l.unit_cost),
      gst_applicable: bool(l.gst_applicable),
    })
  }

  const docType = str(o.doc_type)
  const date = str(o.doc_date)

  return {
    doc_type: docType === 'docket' || docType === 'both' ? docType : 'invoice',
    supplier: str(o.supplier),
    supplier_ref: str(o.supplier_ref),
    // Anything not a plain ISO date is dropped rather than guessed at — a
    // wrong receipt date is worse than an empty one the UI defaults to today.
    doc_date: date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null,
    po_ref: str(o.po_ref),
    claimed_line_count: num(o.claimed_line_count),
    claimed_total_units: num(o.claimed_total_units),
    subtotal_ex_gst: num(o.subtotal_ex_gst),
    gst_amount: num(o.gst_amount),
    total_inc_gst: num(o.total_inc_gst),
    freight_ex_gst: num(o.freight_ex_gst) ?? 0,
    other_charges_ex_gst: num(o.other_charges_ex_gst) ?? 0,
    lines,
  }
}

// ── reconciliation ────────────────────────────────────────────────────────

export const GST_RATE = 0.10

export type PriceBasis = 'ex_gst' | 'inc_gst' | 'mixed' | 'unknown'

export interface Reconciliation {
  price_basis: PriceBasis
  /** Which arithmetic test settled it — shown to the user, not just logged. */
  matched_on: string | null
  line_total: number
  /** Non-fatal warnings worth putting in front of someone before they commit. */
  warnings: string[]
}

/** Invoices round per line. Half a percent, floored at fifty cents. */
function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * 0.005)
}

/**
 * Works out whether the printed line prices include GST, by checking the lines
 * against the document's own totals — never by asking the model, which would
 * be guessing, and never by assuming, which is a silent 10% error in a cost.
 *
 * Freight is the wrinkle: some suppliers put it inside the ex-GST subtotal and
 * some list it after, so both readings are tried before giving up.
 */
export function reconcile(doc: ExtractedDocument): Reconciliation {
  const warnings: string[] = []
  const priced = doc.lines.filter((l) => l.unit_cost !== null)
  const lineTotal = priced.reduce((sum, l) => sum + l.qty * (l.unit_cost as number), 0)

  // Completeness checks. These are about the extraction, not about GST, and
  // are the cheapest way to catch a page that did not scan.
  if (doc.claimed_line_count !== null && doc.claimed_line_count !== doc.lines.length) {
    warnings.push(
      `The document states ${doc.claimed_line_count} line items but ${doc.lines.length} were read. A page may be missing.`,
    )
  }
  if (doc.claimed_total_units !== null) {
    const units = doc.lines.reduce((s, l) => s + l.qty, 0)
    if (!close(units, doc.claimed_total_units)) {
      warnings.push(
        `The document states ${doc.claimed_total_units} units but ${units} were read.`,
      )
    }
  }
  if (doc.lines.length > priced.length && priced.length > 0) {
    warnings.push(`${doc.lines.length - priced.length} of ${doc.lines.length} lines have no price.`)
  }

  // Internal consistency of the printed totals, independent of the lines.
  if (doc.subtotal_ex_gst !== null && doc.gst_amount !== null) {
    if (!close(doc.subtotal_ex_gst * GST_RATE, doc.gst_amount)) {
      warnings.push(
        'GST is not 10% of the printed subtotal — the document may be partly GST-free, or a figure was misread.',
      )
    }
  }

  // No prices at all: a delivery docket. Nothing to resolve, and the RPC only
  // insists on a basis when there are prices to normalise.
  if (priced.length === 0) {
    return { price_basis: 'unknown', matched_on: null, line_total: 0, warnings }
  }

  // Per-line GST breakdown means the printed line price is already ex-GST.
  if (doc.lines.some((l) => l.gst_applicable !== null)) {
    return {
      price_basis: 'mixed',
      matched_on: 'per-line GST breakdown on the document',
      line_total: lineTotal,
      warnings,
    }
  }

  const charges = (doc.freight_ex_gst ?? 0) + (doc.other_charges_ex_gst ?? 0)
  const sub = doc.subtotal_ex_gst
  const total = doc.total_inc_gst

  // Ordered by how conclusive each test is, not by convenience.
  const tests: { basis: PriceBasis; target: number | null; label: string }[] = [
    { basis: 'ex_gst', target: sub === null ? null : sub - charges, label: 'lines match the subtotal less freight' },
    { basis: 'ex_gst', target: sub, label: 'lines match the ex-GST subtotal' },
    { basis: 'inc_gst', target: total === null ? null : total - charges * (1 + GST_RATE), label: 'lines match the total less freight' },
    { basis: 'inc_gst', target: total, label: 'lines match the GST-inclusive total' },
  ]

  for (const t of tests) {
    if (t.target !== null && close(lineTotal, t.target)) {
      return { price_basis: t.basis, matched_on: t.label, line_total: lineTotal, warnings }
    }
  }

  warnings.push(
    'The line prices do not add up to any printed total, so whether they include GST could not be determined. Check the figures before saving.',
  )
  return { price_basis: 'unknown', matched_on: null, line_total: lineTotal, warnings }
}
