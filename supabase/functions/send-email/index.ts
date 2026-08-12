import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireAdmin } from '../_shared/admin.ts'

// CyberPanel Email Delivery (CyberPersons) — platform.cyberpersons.com,
// not hosting SMTP. Port of the WP Email_Delivery / send_mail_payload
// contract so failure modes match what Vanessa already knows from SCOS.
const CYBERPERSONS_SEND_URL = 'https://platform.cyberpersons.com/email/v1/send'

interface EmailConfig {
  from_address?: string
  reply_to?: string
  enabled?: boolean
}

type ScreenType = 'customer' | 'job' | 'purchase_order' | 'test'

interface SendBody {
  to?: string
  subject?: string
  html?: string
  text?: string
  cc?: string
  /** Optional CRM log metadata — the body is never stored. */
  log?: {
    customer_id?: number | null
    job_id?: number | null
    purchase_order_id?: number | null
    screen_type?: ScreenType
  }
}

/** Split on comma or semicolon; trim; drop empties; de-dupe case-insensitively. */
function parseAddressList(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,;]/)) {
    const addr = part.trim()
    if (!addr) continue
    const key = addr.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(addr)
  }
  return out
}

/**
 * CyberPersons documents a single `to` and a single `cc`, so a multi-recipient
 * email cannot go out as one request.
 *
 * First To address stays the primary To; every remaining To joins the CC list.
 * The first CC rides along on that request, and any CC beyond it becomes its
 * own send of the same body. Recipients past the second therefore do not see
 * each other on the header — acceptable for transactional mail, and the
 * alternative is silently dropping them.
 */
function resolveRecipients(toRaw: string, ccRaw?: string) {
  const toList = parseAddressList(toRaw)
  const ccList = parseAddressList(ccRaw)
  if (toList.length === 0) {
    return { error: 'to address is required' as const }
  }

  const primaryTo = toList[0]
  // Extras from To first, then explicit CC.
  const ccMerged = parseAddressList([...toList.slice(1), ...ccList].join(', '))

  const sends: { to: string; cc?: string }[] = [
    { to: primaryTo, ...(ccMerged[0] ? { cc: ccMerged[0] } : {}) },
  ]
  for (const extra of ccMerged.slice(1)) {
    sends.push({ to: extra })
  }

  return {
    sends,
    /** What lands on email_sends — the full resolved lists, no body. */
    logTo: primaryTo,
    logCc: ccMerged.join(', '),
  }
}

async function sendOne(
  secret: string,
  from: string,
  replyTo: string | undefined,
  subject: string,
  html: string | undefined,
  text: string | undefined,
  to: string,
  cc?: string,
): Promise<{ ok: true; message_id: string | null; status: string | null } | { ok: false; error: string }> {
  const payload: Record<string, unknown> = {
    from,
    to,
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
    ...(cc ? { cc } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
  }

  let sendRes: Response
  try {
    sendRes = await fetch(CYBERPERSONS_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error contacting CyberPersons' }
  }

  let sendJson: {
    success?: boolean
    data?: { message_id?: string; status?: string }
    message?: string
    error?: string
  }
  try {
    sendJson = await sendRes.json()
  } catch {
    sendJson = {}
  }

  if (!sendRes.ok || sendJson.success === false) {
    return {
      ok: false,
      error: sendJson.message ?? sendJson.error ?? `CyberPersons returned HTTP ${sendRes.status}`,
    }
  }

  return {
    ok: true,
    message_id: sendJson.data?.message_id ?? null,
    status: sendJson.data?.status ?? null,
  }
}

/**
 * Every attempt is logged, failures included — a send that went nowhere is
 * exactly the one you want a record of. Log failure is never fatal: the mail
 * has already left, and turning a bookkeeping error into a 500 would tell the
 * caller nothing was sent when something was.
 */
async function logSend(
  service: SupabaseClient,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await service.from('email_sends').insert(row)
  if (error) console.error('email_sends insert failed:', error.message)
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

  let body: SendBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.to || !body.subject || (!body.html && !body.text)) {
    return jsonResponse({ error: 'to, subject, and html (or text) are required' }, 400)
  }

  const resolved = resolveRecipients(body.to, body.cc)
  if ('error' in resolved) {
    return jsonResponse({ error: resolved.error }, 400)
  }

  const { data: row, error } = await admin.service
    .from('integrations')
    .select('secret, config')
    .eq('provider', 'email')
    .maybeSingle()
  if (error) return jsonResponse({ error: error.message }, 500)

  const config = (row?.config ?? {}) as EmailConfig
  if (!row?.secret) {
    return jsonResponse(
      { error: 'Email is not configured yet — add a CyberPersons API key in Settings → Integrations.' },
      503,
    )
  }
  if (config.enabled === false) {
    return jsonResponse({ error: 'Email delivery is disabled in Settings → Integrations.' }, 503)
  }
  if (!config.from_address) {
    return jsonResponse({ error: 'No "from" address configured in Settings → Integrations.' }, 503)
  }

  // Shared across the success and failure log paths. Absent metadata means a
  // Settings test send, which is still worth a dated row proving the key works.
  const logBase = {
    customer_id: body.log?.customer_id ?? null,
    job_id: body.log?.job_id ?? null,
    purchase_order_id: body.log?.purchase_order_id ?? null,
    screen_type: body.log?.screen_type ?? (body.log ? 'customer' : 'test'),
    to_address: resolved.logTo,
    cc_address: resolved.logCc,
    subject: body.subject,
  }

  const messageIds: string[] = []
  let lastStatus: string | null = null

  for (const send of resolved.sends) {
    const res = await sendOne(
      row.secret,
      config.from_address,
      config.reply_to,
      body.subject,
      body.html,
      body.text,
      send.to,
      send.cc,
    )

    if (!res.ok) {
      // A fan-out can fail partway. Say so rather than logging a bare failure,
      // because the earlier recipients did receive it and a resend would
      // double up on them.
      const partial = messageIds.length > 0
        ? ` (${messageIds.length} of ${resolved.sends.length} recipient sends had already succeeded)`
        : ''
      await logSend(admin.service, {
        ...logBase,
        status: 'failed',
        provider_message_id: messageIds[0] ?? null,
        error_message: `${res.error}${partial}`,
      })
      return jsonResponse({ ok: false, error: res.error }, 502)
    }

    if (res.message_id) messageIds.push(res.message_id)
    lastStatus = res.status
  }

  const messageId = messageIds[0] ?? null

  await logSend(admin.service, {
    ...logBase,
    status: 'sent',
    provider_status: lastStatus,
    provider_message_id: messageId,
  })

  return jsonResponse({
    ok: true,
    message_id: messageId,
    message_ids: messageIds,
    status: lastStatus,
  })
})
