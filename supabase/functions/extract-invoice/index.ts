import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireAdmin } from '../_shared/admin.ts'
import { aiComplete } from '../_shared/ai.ts'
import {
  INVOICE_EXTRACT_PROMPT,
  invoiceModel,
  normaliseExtraction,
  reconcile,
} from '../_shared/invoice.ts'

/**
 * Reads a supplier invoice or delivery docket and returns everything the
 * goods receipt flow needs to propose a receipt: the document header, its
 * totals, freight, any PO reference the supplier quoted, and the product
 * lines.
 *
 * Reads only. Nothing is written, no stock moves, no receipt is created —
 * the output is a PROPOSAL for Fred to check, and receive_goods commits it
 * once he has. A misread here costs a correction, never a wrong stock count.
 *
 * The GST basis is settled by reconciling the lines against the document's own
 * totals rather than by asking the model, because "do these prices include
 * GST" answered wrongly is a silent 10% error in a cost figure.
 */

// Anthropic takes PDFs as documents and these three as images. HEIC is absent,
// which matters because it is the iPhone camera default.
const ACCEPTED = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

// Raw bytes before base64, which inflates by ~33%.
const MAX_BYTES = 10 * 1024 * 1024

interface ExtractBody {
  /** Base64, no data: URI prefix. */
  file_base64?: string
  mime_type?: string
  /** Only used as the ai_call_log input_ref, to trace a call to a document. */
  filename?: string
}

/** The prefill should make the reply bare JSON, but a fence occasionally
 *  survives and costs nothing to tolerate. */
function stripFence(s: string): string {
  const t = s.trim()
  if (!t.startsWith('```')) return t
  return t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
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
        'Extract the document header, totals, freight and product lines from this supplier document.',
      attachments: [{ media_type: mime, data: fileB64 }],
      systemPrompt: INVOICE_EXTRACT_PROMPT,
      model: invoiceModel(row?.config as { invoice_model?: string } | null),
      // A long docket runs to 40+ lines and now carries more fields each;
      // 1024 truncates mid-array.
      maxTokens: 8192,
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

  const document = normaliseExtraction(parsed)
  if (document.lines.length === 0) {
    return jsonResponse(
      {
        error:
          'No product lines were found. Check the document is an invoice or delivery docket and that the scan is legible.',
      },
      422,
    )
  }

  const reconciliation = reconcile(document)

  return jsonResponse({
    ok: true,
    document,
    reconciliation,
    model_used: result.model_used,
    tokens_used: result.tokens_used,
  })
})
