import { type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/** Text jobs. Cheap and fast; overridable per call and in Settings. */
const DEFAULT_MODEL = 'claude-haiku-4-5'
const DEFAULT_MAX_TOKENS = 1024

interface AnthropicConfig {
  model?: string
  invoice_model?: string
}

/**
 * A file sent alongside the prompt. `data` is raw base64 with no data: URI
 * prefix — Anthropic rejects the prefix, and it is an easy thing to leave on
 * when the browser produced the string via FileReader.
 */
export interface AiAttachment {
  media_type: string
  data: string
}

interface AiCompleteParams {
  purpose: string
  input: string
  attachments?: AiAttachment[]
  context?: Record<string, unknown> & { input_ref?: string }
  systemPrompt?: string
  model?: string
  maxTokens?: number
  /**
   * Seeds the assistant's reply. Passing '{' is the reliable way to get JSON
   * out of a model that would otherwise open with "Here is the JSON:" — it
   * cannot preamble if the turn has already started. The prefill is not echoed
   * back by the API, so it is prepended to the returned text here.
   */
  assistantPrefill?: string
}

interface AiCompleteResult {
  output: string
  model_used: string
  tokens_used: number
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }

/** PDFs are `document` blocks; everything else we accept is an `image`. */
function toContentBlock(att: AiAttachment): ContentBlock {
  const kind = att.media_type === 'application/pdf' ? 'document' : 'image'
  return { type: kind, source: { type: 'base64', media_type: att.media_type, data: att.data } }
}

/**
 * Single entry point for every AI job in the 100UP CRM.
 *
 * - Reads the Anthropic key from `integrations` (provider = 'anthropic').
 * - Calls the Messages API by raw fetch, matching the no-SDK convention the
 *   other Edge Functions use.
 * - Logs each call to `ai_call_log`. The prompt input is never stored: for
 *   invoice extraction that input is a supplier document, which belongs in the
 *   receipt trail rather than duplicated into a log table.
 *
 * Deciding *when* to call this is the caller's job. This only transforms.
 */
export async function aiComplete(
  service: SupabaseClient,
  params: AiCompleteParams,
): Promise<AiCompleteResult> {
  const { purpose, input, attachments, context, systemPrompt, assistantPrefill } = params

  const { data: row, error: rowErr } = await service
    .from('integrations')
    .select('secret, config')
    .eq('provider', 'anthropic')
    .maybeSingle()

  if (rowErr) throw new Error(`ai_complete: integrations lookup failed — ${rowErr.message}`)
  if (!row?.secret) {
    throw new Error('AI is not configured yet — add an Anthropic API key in Settings → Integrations.')
  }

  const config = (row.config ?? {}) as AnthropicConfig
  const model = params.model ?? config.model ?? DEFAULT_MODEL
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS

  // Attachments lead: a model reads the instruction better when it already has
  // the document in front of it.
  const content: ContentBlock[] = [
    ...(attachments ?? []).map(toContentBlock),
    { type: 'text', text: input },
  ]

  const messages: { role: 'user' | 'assistant'; content: ContentBlock[] | string }[] = [
    { role: 'user', content },
  ]
  if (assistantPrefill) {
    messages.push({ role: 'assistant', content: assistantPrefill })
  }

  const body = {
    model,
    max_tokens: maxTokens,
    system:
      systemPrompt ??
      'You are an assistant for a solar installation CRM. Be concise and direct. Return plain text only, no markdown or formatting.',
    messages,
  }

  let res: Response
  try {
    res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': row.secret,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new Error(
      `ai_complete: network error calling Anthropic — ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error?.message ?? JSON.stringify(j)
    } catch {
      detail = `HTTP ${res.status}`
    }
    throw new Error(`ai_complete: Anthropic returned an error — ${detail}`)
  }

  interface AnthropicResponse {
    content: { type: string; text: string }[]
    model: string
    stop_reason: string | null
    usage: { input_tokens: number; output_tokens: number }
  }
  const json = (await res.json()) as AnthropicResponse

  const raw = json.content.find((c) => c.type === 'text')?.text ?? ''
  const output = ((assistantPrefill ?? '') + raw).trim()
  const tokensIn = json.usage?.input_tokens ?? 0
  const tokensOut = json.usage?.output_tokens ?? 0
  const modelUsed = json.model ?? model

  const { error: logErr } = await service.from('ai_call_log').insert({
    purpose,
    input_ref: context?.input_ref ?? null,
    output,
    model_used: modelUsed,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
  })
  if (logErr) {
    // The call succeeded and was billed. Losing the log row is a bookkeeping
    // problem, not a reason to fail the caller.
    console.error('ai_call_log insert failed:', logErr.message)
  }

  // Hitting the ceiling truncates mid-JSON, which downstream parses as
  // malformed rather than incomplete. Say which it actually was.
  if (json.stop_reason === 'max_tokens') {
    throw new Error(
      `ai_complete: response hit the ${maxTokens}-token ceiling and was cut off. ` +
        'For a long invoice, split it or raise maxTokens.',
    )
  }

  return { output, model_used: modelUsed, tokens_used: tokensIn + tokensOut }
}

/** Model for reading supplier invoices. Overridable in Settings. */
export function invoiceModel(config: { invoice_model?: string } | null | undefined): string {
  // Extraction runs against scans and photos where a misread line item becomes
  // a wrong stock count, so this deliberately does not default to the cheap
  // text model. A whole invoice costs a fraction of a cent either way.
  return config?.invoice_model || 'claude-sonnet-5'
}

export const INVOICE_EXTRACT_PROMPT = `You read supplier invoices and delivery/goods-received dockets for a solar installation business and return structured JSON.

Return ONLY a JSON object, no prose and no markdown fence, with exactly these keys:
  "supplier"    — the supplying company's name as printed, or null
  "invoiceRef"  — the invoice or docket number, or null
  "invoiceDate" — ISO date "YYYY-MM-DD", or null
  "lines"       — array of {"name": string, "qty": number, "unitCost": number|null}

Rules for "lines":
- One entry per physical product line actually supplied.
- "name" is the product description as printed, including model or part number. Do not tidy, expand or translate it — it is matched against an existing stock list downstream.
- "qty" is the quantity supplied on this document. If a line shows ordered and delivered quantities that differ, use the DELIVERED quantity.
- "unitCost" is the ex-GST price for ONE unit. If only a line total is shown, divide it by qty. If no price appears at all, use null.
- Exclude freight, delivery, surcharges, GST/tax lines, rounding, discounts and totals. Those are not stock.
- Exclude any line with a zero or absent quantity.

If the document is unreadable or is not an invoice or docket, return {"supplier":null,"invoiceRef":null,"invoiceDate":null,"lines":[]}.

Never invent a value. A null is correct when the document does not say.`
