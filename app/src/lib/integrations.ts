import { supabase } from './supabaseClient'

async function invoke<T>(fn: string, body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) throw new Error(error.message)
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(String((data as { error: unknown }).error))
  }
  return data as T
}

export interface EmailIntegrationConfig {
  from_address?: string
  reply_to?: string
  enabled?: boolean
}

export interface IntegrationStatus<TConfig = EmailIntegrationConfig> {
  provider: string
  configured: boolean
  secret_last4: string
  config: TConfig
}

export function getIntegrationStatus(provider: 'email') {
  return invoke<IntegrationStatus>('integrations-status', { provider })
}

export function saveIntegration(params: {
  provider: 'email'
  config?: EmailIntegrationConfig
  secret?: string
  clear_secret?: boolean
}) {
  return invoke<{ ok: true }>('integrations-save', params)
}

export function sendTestEmail(params: { to: string; subject: string; html: string }) {
  return invoke<{ ok: boolean; message_id?: string | null; status?: string | null }>('send-email', params)
}
