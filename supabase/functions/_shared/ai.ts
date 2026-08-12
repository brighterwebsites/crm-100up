import { type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/** Text jobs. Cheap and fast; overridable per call and in Settings. */
const DEFAULT_MODEL = 'claude-haiku-4-5'
const DEFAULT_MAX_TOKENS = 1024

/** Only the generic default lives here. Task-specific model choices belong to
 *  the task — see invoiceModel() in _shared/invoice.ts. */
interface AnthropicConfig {
  model?: string
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
