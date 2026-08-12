import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireAdmin } from '../_shared/admin.ts'
import { aiComplete, INVOICE_EXTRACT_PROMPT, invoiceModel } from '../_shared/ai.ts'

/**
 * Reads a supplier invoice or goods-received docket and returns the same shape
 * the Receive Stock modal already parses by hand:
 *
 *   { supplier, invoiceRef, invoiceDate, lines: [{ name, qty, unitCost }] }
 *
 * That contract is deliberate. It replaces only the *input* step — previously
 * "upload the PDF to a Claude chat and paste the JSON back" — and leaves the
 * review, stock matching and atomic receive_stock commit untouched. Nothing is
 * written to stock here: this function only reads a document and proposes
 * lines, which Fred then confirms.
 */

// Anthropic accepts PDFs as documents and these three as images. HEIC is not
// on the list, which matters because it is the iPhone camera default — the
// client-side check gives a clearer message than a 400 from the API.
const ACCEPTED = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
])

// Raw bytes before base64. The encoding adds ~33%, so this is ~13.3 MB on the
// wire — comfortably inside the Edge Function request limit while still
// accepting a multi-page scan.
const MAX_BYTES = 10 * 1024 * 1024

interface ExtractBody {
  /** Base64 with no data: URI prefix. */
  file_base64?: string
  mime_type?: string
  /** Only used as the ai_call_log input_ref, for tracing a call to a document. */
  filename?: string
}

interface InvoiceLine {
  name: string
  qty: number
  unitCost: number | null
}

interface ParsedInvoice {
  supplier: string | null
  invoiceRef: string | null
  invoiceDate: string | null
  lines: InvoiceLine[]
}

/**
 * The prefill means the reply should already be bare JSON, but a fence still
 * shows up occasionally and costs nothing to survive.
 */
function stripFence(s: string): string {
  const t = s.trim()
  if (!t.startsWith('```')) return t
  return t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
}

function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    // Tolerate "1,234.56" and "$88.00" — the model is told to send numbers,
    // but it is reading a document full of currency-formatted strings.
    const n = Number(v.replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function normalise(raw: unknown): ParsedInvoice {
  const o = (raw ?? {}) as Record<string, unknown>
  const linesIn = Array.isArray(o.lines) ? o.lines : []

  const lines: InvoiceLine[] = []
  for (const l of linesIn) {
    const line = (l ?? {}) as Record<string, unknown>
    const name = typeof line.name === 'string' ? line.name.trim() : ''
    const qty = coerceNumber(line.qty)
    // A line with no name or no positive quantity cannot be received against
    // stock, so drop it here rather than showing Fred a row he must delete.
    if (!name || qty === null || qty <= 0) continue
    lines.push({ name, qty, unitCost: coerceNumber(line.unitCost) })
  }

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const date = str(o.invoiceDate)

  return {
    supplier: str(o.supplier),
    invoiceRef: str(o.invoiceRef),
    // The modal only accepts YYYY-MM-DD; anything else is dropped so it falls
    // back to today rather than silently setting a wrong receipt date.
    invoiceDate: date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null,
    lines,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const admin = await requireAdmin(req)
  if (!admin.ok) return jsonResponse({ error: admin.error }, admin.status)

  let body: ExtractBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { file_base64: fileB64, mime_type: mime } = body
  if (!fileB64 || !mime) {
    return jsonResponse({ error: 'file_base64 and mime_type are required' }, 400)
  }
  if (!ACCEPTED.has(mime)) {
    return jsonResponse(
      { error: `Unsupported file type "${mime}". Upload a PDF, JPEG, PNG or WebP.` },
      400,
    )
  }
  // base64 encodes 3 bytes per 4 characters.
  if ((fileB64.length * 3) / 4 > MAX_BYTES) {
    return jsonResponse({ error: 'File is larger than 10 MB. Split it or photograph fewer pages.' }, 413)
  }

  const { data: row } = await admin.service
    .from('integrations')
    .select('config')
    .eq('provider', 'anthropic')
    .maybeSingle()

  let result
  try {
    result = await aiComplete(admin.service, {
      purpose: 'invoice_extract',
      input:
        'Extract the supplier, invoice reference, invoice date and product lines from this document.',
      attachments: [{ media_type: mime, data: fileB64 }],
      systemPrompt: INVOICE_EXTRACT_PROMPT,
      model: invoiceModel(row?.config as { invoice_model?: string } | null),
      // A long docket can run to 40+ line items; 1024 truncates mid-array.
      maxTokens: 4096,
      assistantPrefill: '{',
      context: { input_ref: body.filename ?? null },
    })
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Extraction failed' }, 502)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(result.output))
  } catch {
    return jsonResponse(
      {
        error:
          'The model did not return usable JSON. Try again, or paste the JSON manually using the other tab.',
      },
      502,
    )
  }

  const invoice = normalise(parsed)
  if (invoice.lines.length === 0) {
    return jsonResponse(
      {
        error:
          'No product lines were found. Check the document is an invoice or delivery docket and that the scan is legible.',
      },
      422,
    )
  }

  return jsonResponse({
    ok: true,
    invoice,
    model_used: result.model_used,
    tokens_used: result.tokens_used,
  })
})
