import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireAdmin } from '../_shared/admin.ts'

// Read-only for now: enough to list threads and download bodies when the sync
// lands. Widening the scope later forces every user through consent again, so
// it is worth not asking for more than is used.
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // Connecting a mailbox writes a shared credential, so this is admin-only —
  // not merely "any signed-in user", which is all BW-CRM checks here.
  const admin = await requireAdmin(req)
  if (!admin.ok) return jsonResponse({ error: admin.error }, admin.status)

  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
  const redirectUri = Deno.env.get('GMAIL_OAUTH_REDIRECT_URI')
  if (!clientId || !redirectUri) {
    return jsonResponse(
      {
        error:
          'Gmail OAuth is not configured — set GOOGLE_OAUTH_CLIENT_ID and GMAIL_OAUTH_REDIRECT_URI as Edge Function secrets.',
      },
      503,
    )
  }

  // The callback cannot verify a JWT (Google does not send one), so state
  // carries who started the flow plus when, and the callback rejects anything
  // older than 15 minutes.
  const state = btoa(JSON.stringify({ uid: admin.userId, ts: Date.now() }))

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    // Both are required to be handed a refresh token: offline access asks for
    // one, and Google only re-issues it on an explicit consent prompt. Without
    // prompt=consent a re-connect returns an access token alone and the stored
    // credential silently expires an hour later.
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  return jsonResponse({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` })
})
