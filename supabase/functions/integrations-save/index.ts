import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireAdmin } from '../_shared/admin.ts'

// Kept in step with the provider CHECK on public.integrations. Widening one
// without the other gets you a 400 here or a constraint violation there.
const KNOWN_PROVIDERS = ['email', 'anthropic', 'gmail']

interface SaveBody {
  provider?: string
  config?: Record<string, unknown>
  secret?: string
  clear_secret?: boolean
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

  let body: SaveBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const provider = body.provider
  if (!provider || !KNOWN_PROVIDERS.includes(provider)) {
    return jsonResponse({ error: `provider must be one of: ${KNOWN_PROVIDERS.join(', ')}` }, 400)
  }

  const { data: existing } = await admin.service
    .from('integrations')
    .select('secret, secret_last4')
    .eq('provider', provider)
    .maybeSingle()

  const nextSecret = body.clear_secret ? null : body.secret ?? existing?.secret ?? null
  const nextLast4 = body.clear_secret ? '' : body.secret ? body.secret.slice(-4) : existing?.secret_last4 ?? ''

  const { error } = await admin.service.from('integrations').upsert(
    {
      provider,
      config: body.config ?? {},
      secret: nextSecret,
      secret_last4: nextLast4,
      updated_at: new Date().toISOString(),
      updated_by: admin.userId,
    },
    { onConflict: 'provider' },
  )
  if (error) return jsonResponse({ error: error.message }, 500)

  return jsonResponse({ ok: true })
})
