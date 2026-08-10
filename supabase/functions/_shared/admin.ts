import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

type AdminOk = { ok: true; userId: string; service: SupabaseClient }
type AdminErr = { ok: false; error: string; status: number }

/**
 * Verifies the caller's JWT (via the anon-key client) and checks their
 * `profiles.role` is 'admin' (via the service-role client, bypassing RLS).
 * Returns a ready-to-use service-role client on success so callers don't
 * need to construct their own.
 */
export async function requireAdmin(req: Request): Promise<AdminOk | AdminErr> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return { ok: false, error: 'Unauthorized', status: 401 }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser()
  if (userErr || !user) return { ok: false, error: 'Unauthorized', status: 401 }

  const service = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )
  const { data: profile, error: profileErr } = await service
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profileErr || profile?.role !== 'admin') {
    return { ok: false, error: 'Admin only', status: 403 }
  }

  return { ok: true, userId: user.id, service }
}
