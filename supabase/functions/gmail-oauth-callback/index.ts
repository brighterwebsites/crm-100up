import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Google redirects the browser here after consent. It sends no Authorization
 * header, so this function must run with verify_jwt = false (see
 * supabase/config.toml). The signed-in user is instead recovered from the
 * `state` parameter minted by gmail-oauth-start.
 *
 * Unlike BW-CRM, the 100UP app has no URL router — the page is React state and
 * always boots to Pipeline. So the return trip lands on the app root with a
 * query string, and Shell reads it on mount to open Settings and report the
 * outcome. Redirecting to /settings here would just show the pipeline board
 * with no indication of whether the connection worked.
 */
function appRedirect(params: Record<string, string>) {
  const base = (Deno.env.get('CRM_APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '')
  return Response.redirect(`${base}/?${new URLSearchParams(params).toString()}`, 302)
}

/** Mailbox address, purely so Settings can show which account is connected. */
async function getGmailAddress(accessToken: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return ''
  const json = (await res.json()) as { emailAddress?: string }
  return json.emailAddress ?? ''
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const stateRaw = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')

  if (oauthError) return appRedirect({ gmail: 'error', message: oauthError })
  if (!code || !stateRaw) return appRedirect({ gmail: 'error', message: 'missing_code' })

  let state: { uid?: string; ts?: number }
  try {
    state = JSON.parse(atob(stateRaw))
  } catch {
    return appRedirect({ gmail: 'error', message: 'invalid_state' })
  }
  if (!state.ts || Date.now() - state.ts > 15 * 60 * 1000) {
    return appRedirect({ gmail: 'error', message: 'expired_state' })
  }

  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')
  const redirectUri = Deno.env.get('GMAIL_OAUTH_REDIRECT_URI')
  if (!clientId || !clientSecret || !redirectUri) {
    return appRedirect({ gmail: 'error', message: 'oauth_not_configured' })
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string
    refresh_token?: string
    error?: string
    error_description?: string
  }

  // The refresh token is the credential worth keeping — access tokens last an
  // hour. No refresh token means the grant would die overnight, so treat it as
  // a failure rather than storing something that half works.
  if (!tokenRes.ok || !tokenJson.refresh_token) {
    return appRedirect({
      gmail: 'error',
      message: tokenJson.error_description ?? tokenJson.error ?? 'token_exchange_failed',
    })
  }

  let mailbox = ''
  if (tokenJson.access_token) {
    try {
      mailbox = await getGmailAddress(tokenJson.access_token)
    } catch {
      // Non-fatal — Settings will just say "unknown mailbox".
    }
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { error: saveErr } = await service.from('integrations').upsert(
    {
      provider: 'gmail',
      secret: tokenJson.refresh_token,
      secret_last4: tokenJson.refresh_token.slice(-4),
      // history_id is the incremental sync cursor, left null until a poller
      // exists to advance it.
      config: { mailbox, last_polled_at: null, history_id: null },
      updated_at: new Date().toISOString(),
      updated_by: state.uid ?? null,
    },
    { onConflict: 'provider' },
  )

  if (saveErr) return appRedirect({ gmail: 'error', message: saveErr.message })

  return appRedirect({ gmail: 'connected' })
})
