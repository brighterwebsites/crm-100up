import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
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

interface SendBody {
  to?: string
  subject?: string
  html?: string
  text?: string
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

  const { data: row, error } = await admin.service
    .schema('private')
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

  const payload: Record<string, unknown> = {
    from: config.from_address,
    to: body.to,
    subject: body.subject,
    ...(body.html ? { html: body.html } : {}),
    ...(body.text ? { text: body.text } : {}),
    ...(config.reply_to ? { reply_to: config.reply_to } : {}),
  }

  let sendRes: Response
  try {
    sendRes = await fetch(CYBERPERSONS_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${row.secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Network error contacting CyberPersons' }, 502)
  }

  let sendJson: { success?: boolean; data?: { message_id?: string; status?: string }; message?: string; error?: string }
  try {
    sendJson = await sendRes.json()
  } catch {
    sendJson = {}
  }

  if (!sendRes.ok || sendJson.success === false) {
    const message = sendJson.message ?? sendJson.error ?? `CyberPersons returned HTTP ${sendRes.status}`
    return jsonResponse({ ok: false, error: message }, 502)
  }

  return jsonResponse({
    ok: true,
    message_id: sendJson.data?.message_id ?? null,
    status: sendJson.data?.status ?? null,
  })
})
