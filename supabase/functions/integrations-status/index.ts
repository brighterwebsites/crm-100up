import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireAdmin } from '../_shared/admin.ts'

const KNOWN_PROVIDERS = ['email']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const admin = await requireAdmin(req)
  if (!admin.ok) return jsonResponse({ error: admin.error }, admin.status)

  let body: { provider?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const provider = body.provider
  if (!provider || !KNOWN_PROVIDERS.includes(provider)) {
    return jsonResponse({ error: `provider must be one of: ${KNOWN_PROVIDERS.join(', ')}` }, 400)
  }

  const { data, error } = await admin.service
    .schema('private')
    .from('integrations')
    .select('config, secret_last4, secret')
    .eq('provider', provider)
    .maybeSingle()
  if (error) return jsonResponse({ error: error.message }, 500)

  return jsonResponse({
    provider,
    configured: Boolean(data?.secret),
    secret_last4: data?.secret_last4 ?? '',
    config: data?.config ?? {},
  })
})
