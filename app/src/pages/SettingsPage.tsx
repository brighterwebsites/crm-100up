import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { getIntegrationStatus, saveIntegration, sendTestEmail } from '../lib/integrations'
import type { IntegrationStatus } from '../lib/integrations'

export default function SettingsPage() {
  const { session } = useAuth()
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [fromAddress, setFromAddress] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const s = await getIntegrationStatus('email')
      setStatus(s)
      setFromAddress(s.config.from_address ?? '')
      setReplyTo(s.config.reply_to ?? '')
      setEnabled(s.config.enabled !== false)
      setTestTo((prev) => prev || session?.user.email || '')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load integration status')
    } finally {
      setLoading(false)
    }
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label)
    setErr(null)
    setMsg(null)
    try {
      await fn()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const save = () =>
    run('save', async () => {
      await saveIntegration({
        provider: 'email',
        config: { from_address: fromAddress.trim(), reply_to: replyTo.trim(), enabled },
        ...(apiKey.trim() ? { secret: apiKey.trim() } : {}),
      })
      setApiKey('')
      await load()
      setMsg('Saved')
    })

  const clearKey = () =>
    run('clear', async () => {
      await saveIntegration({ provider: 'email', clear_secret: true })
      await load()
      setMsg('API key cleared')
    })

  const sendTest = () =>
    run('test', async () => {
      if (!testTo.trim()) throw new Error('Enter an address to send the test email to.')
      const res = await sendTestEmail({
        to: testTo.trim(),
        subject: '100UP CRM — test email',
        html: '<p>This is a test email from 100UP CRM Settings \u2192 Integrations.</p>',
      })
      setMsg(res.message_id ? `Sent (message id: ${res.message_id})` : 'Sent')
    })

  return (
    <div>
      <h2 style={{ margin: '0 0 16px' }}>Integrations</h2>
      {err && <div className="login-error">{err}</div>}
      {msg && <div className="login-ok">{msg}</div>}

      <div className="card" style={{ padding: 16, maxWidth: 560 }}>
        <div className="jdp-field jdp-full" style={{ marginBottom: 12 }}>
          <strong>Email — CyberPanel Email Delivery</strong>
          <span className="mutedtext" style={{ fontSize: 12 }}>
            Sends via platform.cyberpersons.com (CyberPersons Email Delivery — separate from CyberPanel hosting
            SMTP). Requires a verified sending domain and an API key with <code>can_send</code>.
          </span>
        </div>

        {loading ? (
          <p className="mutedtext">Loading…</p>
        ) : (
          <>
            <div className="form-grid">
              <label>
                API key {status?.configured && <span className="mutedtext">(saved, ending ••••{status.secret_last4})</span>}
                <input
                  type="password"
                  placeholder={status?.configured ? 'Leave blank to keep current key' : 'sk_live_…'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                From address (bare — no display name)
                <input
                  placeholder="noreply@brighterwebsites.com.au"
                  value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)}
                />
              </label>
              <label>
                Reply-to (optional)
                <input
                  placeholder="support@brighterwebsites.com.au"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                />
              </label>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, display: 'flex' }}>
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 'auto' }} />
                Enabled
              </label>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void save()}>
                {busy === 'save' ? 'Saving…' : 'Save'}
              </button>
              {status?.configured && (
                <button className="btn btn-gray" disabled={Boolean(busy)} onClick={() => void clearKey()}>
                  Clear key
                </button>
              )}
            </div>

            <div className="jdp-field jdp-full" style={{ marginTop: 16 }}>
              <span className="jdp-label">Send test email</span>
              <div className="row">
                <input
                  placeholder="you@example.com"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-gray" disabled={Boolean(busy) || !status?.configured} onClick={() => void sendTest()}>
                  {busy === 'test' ? 'Sending…' : 'Send test'}
                </button>
              </div>
              {!status?.configured && (
                <span className="mutedtext" style={{ fontSize: 11 }}>Save an API key first.</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
