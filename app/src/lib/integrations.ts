import { supabase } from './supabaseClient'

async function invoke<T>(fn: string, body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) throw new Error(error.message)
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(String((data as { error: unknown }).error))
  }
  return data as T
}

// ── Providers ────────────────────────────────────────────────────────────
// Kept in step with KNOWN_PROVIDERS in the integrations-save / -status Edge
// Functions and the CHECK on public.integrations.

export type IntegrationProvider = 'email' | 'anthropic' | 'gmail'

export interface EmailIntegrationConfig {
  from_address?: string
  reply_to?: string
  enabled?: boolean
}

export interface AnthropicIntegrationConfig {
  /** Text jobs. */
  model?: string
  /** Reading supplier invoices — worth a stronger model than the text default. */
  invoice_model?: string
}

export interface GmailIntegrationConfig {
  mailbox?: string
  /** Incremental sync cursor. Null until a poller exists to advance it. */
  history_id?: string | null
  last_polled_at?: string | null
}

export type IntegrationConfig =
  | EmailIntegrationConfig
  | AnthropicIntegrationConfig
  | GmailIntegrationConfig

export interface IntegrationStatus<TConfig = IntegrationConfig> {
  provider: string
  configured: boolean
  secret_last4: string
  config: TConfig
}

export function getIntegrationStatus<TConfig = IntegrationConfig>(provider: IntegrationProvider) {
  return invoke<IntegrationStatus<TConfig>>('integrations-status', { provider })
}

export function saveIntegration(params: {
  provider: IntegrationProvider
  config?: Record<string, unknown>
  secret?: string
  clear_secret?: boolean
}) {
  return invoke<{ ok: true }>('integrations-save', params)
}

// ── Email ────────────────────────────────────────────────────────────────

export type EmailScreenType = 'customer' | 'job' | 'purchase_order' | 'test'

interface SendResult {
  ok: boolean
  message_id?: string | null
  message_ids?: string[]
  status?: string | null
}

export function sendTestEmail(params: { to: string; subject: string; html: string }) {
  return invoke<SendResult>('send-email', params)
}

export function sendEmail(params: {
  to: string
  subject: string
  html: string
  cc?: string
  log?: {
    customer_id?: number | null
    job_id?: number | null
    purchase_order_id?: number | null
    screen_type?: EmailScreenType
  }
}) {
  return invoke<SendResult>('send-email', params)
}

// ── Invoice extraction ───────────────────────────────────────────────────

export interface ExtractedLine {
  name: string
  /** Delivered quantity — what to receive into stock. */
  qty: number
  /** What the document says was ordered, where it prints both. */
  qty_ordered: number | null
  /** Exactly as printed. Whether it includes GST is `reconciliation.price_basis`. */
  unit_cost: number | null
  gst_applicable: boolean | null
}

export interface ExtractedDocument {
  doc_type: 'docket' | 'invoice' | 'both'
  supplier: string | null
  supplier_ref: string | null
  doc_date: string | null
  /** 100UP's own PO number where the supplier quoted it. Seeds PO matching. */
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

export interface Reconciliation {
  price_basis: 'ex_gst' | 'inc_gst' | 'mixed' | 'unknown'
  /** Which arithmetic test settled the GST basis — worth showing, not just logging. */
  matched_on: string | null
  line_total: number
  /** Non-fatal, but put them in front of someone before they commit. */
  warnings: string[]
}

export interface ExtractionResult {
  document: ExtractedDocument
  reconciliation: Reconciliation
}

/** Files Anthropic will accept. HEIC is not among them — see fileToBase64. */
export const INVOICE_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'
export const INVOICE_MAX_BYTES = 10 * 1024 * 1024

/**
 * FileReader hands back a data: URI; Anthropic wants the payload alone and
 * rejects the prefix, so it is stripped here rather than in the Edge Function
 * where the mistake would be a round trip away from the code that made it.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

/** Receiving against a PO: what was ordered, passed to the reader as a hint
 * for resolving product names. Never a source of quantities; see poHintText
 * in supabase/functions/_shared/invoice.ts. */
export interface PoHint {
  po_ref: string
  lines: { name: string; qty_ordered: number; qty_outstanding: number }[]
}

export async function extractInvoice(file: File, poHint?: PoHint): Promise<ExtractionResult> {
  if (file.size > INVOICE_MAX_BYTES) {
    throw new Error('File is larger than 10 MB. Split it or photograph fewer pages.')
  }
  const res = await invoke<{ ok: true } & ExtractionResult>('extract-invoice', {
    file_base64: await fileToBase64(file),
    mime_type: file.type,
    filename: file.name,
    ...(poHint ? { po_hint: poHint } : {}),
  })
  return { document: res.document, reconciliation: res.reconciliation }
}

// ── AI usage ─────────────────────────────────────────────────────────────

/** Anthropic list pricing, USD per million tokens. Used for the Settings estimate. */
export const AI_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-sonnet-5': { input: 3.0, output: 15.0 },
  'claude-opus-5': { input: 5.0, output: 25.0 },
}

export function getModelCost(model: string, tokensIn: number, tokensOut: number): number {
  const rates = AI_MODEL_PRICING[model] ?? AI_MODEL_PRICING['claude-haiku-4-5']
  return (tokensIn / 1_000_000) * rates.input + (tokensOut / 1_000_000) * rates.output
}

export interface AiUsageSummary {
  totalCalls: number
  totalTokensIn: number
  totalTokensOut: number
  estimatedCostUsd: number
  /** True when a logged model is missing from the pricing table above. */
  hasUnpricedModel: boolean
  byPurpose: { purpose: string; calls: number; tokensIn: number; tokensOut: number; costUsd: number }[]
}

export async function getAiUsageThisMonth(): Promise<AiUsageSummary> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const { data, error } = await supabase
    .from('ai_call_log')
    .select('purpose, model_used, tokens_in, tokens_out')
    .gte('created_at', monthStart)

  if (error) throw new Error(error.message)
  const rows = data ?? []

  const byPurpose = new Map<string, { calls: number; tokensIn: number; tokensOut: number; costUsd: number }>()
  let totalCostUsd = 0
  let totalTokensIn = 0
  let totalTokensOut = 0
  let hasUnpricedModel = false

  for (const row of rows) {
    if (!AI_MODEL_PRICING[row.model_used]) hasUnpricedModel = true
    const cost = getModelCost(row.model_used, row.tokens_in, row.tokens_out)
    totalCostUsd += cost
    totalTokensIn += row.tokens_in
    totalTokensOut += row.tokens_out
    const p = byPurpose.get(row.purpose) ?? { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 }
    p.calls++
    p.tokensIn += row.tokens_in
    p.tokensOut += row.tokens_out
    p.costUsd += cost
    byPurpose.set(row.purpose, p)
  }

  return {
    totalCalls: rows.length,
    totalTokensIn,
    totalTokensOut,
    estimatedCostUsd: totalCostUsd,
    hasUnpricedModel,
    byPurpose: [...byPurpose.entries()]
      .map(([purpose, v]) => ({ purpose, ...v }))
      .sort((a, b) => b.costUsd - a.costUsd),
  }
}

// ── Gmail ────────────────────────────────────────────────────────────────

/**
 * Returns Google's consent URL. The caller navigates to it — Google will not
 * render inside an iframe or a fetch.
 */
export async function startGmailOAuth(): Promise<string> {
  const res = await invoke<{ url?: string }>('gmail-oauth-start')
  if (!res.url) throw new Error('No OAuth URL returned')
  return res.url
}
