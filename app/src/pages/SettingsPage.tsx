import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import {
  getAiUsageThisMonth,
  getIntegrationStatus,
  saveIntegration,
  sendTestEmail,
  startGmailOAuth,
  type AiUsageSummary,
  type AnthropicIntegrationConfig,
  type EmailIntegrationConfig,
  type GmailIntegrationConfig,
  type IntegrationStatus,
} from '../lib/integrations'

/** Outcome of a Gmail OAuth round trip, handed down by Shell from the URL. */
export interface GmailReturn {
  ok: boolean
  message?: string
}

/** Shared busy/error/message plumbing — all three cards do the same dance. */
function useCardState() {
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

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

  return { busy, msg, err, setMsg, setErr, run }
}

function Notices({ err, msg }: { err: string | null; msg: string | null }) {
  return (
    <>
      {err && <div className="login-error" style={{ marginBottom: 8 }}>{err}</div>}
      {msg && <div className="login-ok" style={{ marginBottom: 8 }}>{msg}</div>}
    </>
  )
}

// ── Email ────────────────────────────────────────────────────────────────

function EmailCard() {
  const { session } = useAuth()
  const [status, setStatus] = useState<IntegrationStatus<EmailIntegrationConfig> | null>(null)
  const [loading, setLoading] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [fromAddress, setFromAddress] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [testTo, setTestTo] = useState('')
  const { busy, msg, err, setMsg, setErr, run } = useCardState()

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    try {
      const s = await getIntegrationStatus<EmailIntegrationConfig>('email')
      setStatus(s)
      setFromAddress(s.config.from_address ?? '')
      setReplyTo(s.config.reply_to ?? '')
      setEnabled(s.config.enabled !== false)
      setTestTo((prev) => prev || session?.user.email || '')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load the email integration')
    } finally {
      setLoading(false)
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
        html: '<p>This is a test email from 100UP CRM Settings → Integrations.</p>',
      })
      setMsg(res.message_id ? `Sent (message id: ${res.message_id})` : 'Sent')
    })

  return (
    <div className="card settings-card">
      <div className="card-title">Email — CyberPanel Email Delivery</div>
      <p className="settings-hint" style={{ marginTop: 0 }}>
        Sends via platform.cyberpersons.com (CyberPersons Email Delivery — separate from CyberPanel
        hosting SMTP). Requires a verified sending domain and an API key with <code>can_send</code>.
      </p>
      <Notices err={err} msg={msg} />
      {loading ? (
        <p className="mutedtext">Loading…</p>
      ) : (
        <>
          <div className="form-grid">
            <label>
              API key{status?.configured && <span className="mutedtext"> (saved, ending ••••{status.secret_last4})</span>}
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
              <input placeholder="noreply@100up.com.au" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} />
            </label>
            <label>
              Reply-to (optional)
              <input placeholder="fred@100up.com.au" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 'auto' }} />
              Enabled
            </label>
          </div>
          <div className="settings-actions">
            {status?.configured && (
              <button className="btn btn-gray" disabled={Boolean(busy)} onClick={() => void clearKey()}>
                Clear key
              </button>
            )}
            <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void save()}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
          </div>

          <div className="settings-sub">Send test email</div>
          <div className="row">
            <input placeholder="you@example.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn-gray" disabled={Boolean(busy) || !status?.configured} onClick={() => void sendTest()}>
              {busy === 'test' ? 'Sending…' : 'Send test'}
            </button>
          </div>
          <span className="settings-hint">
            {status?.configured
              ? 'Logged to the email history, so a failure leaves a dated record too.'
              : 'Save an API key first.'}
          </span>
        </>
      )}
    </div>
  )
}

// ── Anthropic ────────────────────────────────────────────────────────────

function AnthropicCard() {
  const [status, setStatus] = useState<IntegrationStatus<AnthropicIntegrationConfig> | null>(null)
  const [loading, setLoading] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [invoiceModel, setInvoiceModel] = useState('')
  const { busy, msg, err, setMsg, setErr, run } = useCardState()

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    try {
      const s = await getIntegrationStatus<AnthropicIntegrationConfig>('anthropic')
      setStatus(s)
      setModel(s.config.model ?? 'claude-haiku-4-5')
      setInvoiceModel(s.config.invoice_model ?? 'claude-sonnet-5')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load the Anthropic integration')
    } finally {
      setLoading(false)
    }
  }

  const save = () =>
    run('save', async () => {
      await saveIntegration({
        provider: 'anthropic',
        config: {
          model: model.trim() || 'claude-haiku-4-5',
          invoice_model: invoiceModel.trim() || 'claude-sonnet-5',
        },
        ...(apiKey.trim() ? { secret: apiKey.trim() } : {}),
      })
      setApiKey('')
      await load()
      setMsg('Saved')
    })

  const clearKey = () =>
    run('clear', async () => {
      await saveIntegration({ provider: 'anthropic', clear_secret: true })
      await load()
      setMsg('API key cleared')
    })

  return (
    <div className="card settings-card">
      <div className="card-title">AI — Anthropic (Claude)</div>
      <p className="settings-hint" style={{ marginTop: 0 }}>
        Reads supplier invoices on the Receive Stock screen. Needs an API key from{' '}
        <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>{' '}
        — billed to that account, not through this CRM.
      </p>
      <Notices err={err} msg={msg} />
      {loading ? (
        <p className="mutedtext">Loading…</p>
      ) : (
        <>
          <div className="form-grid">
            <label>
              API key{status?.configured && <span className="mutedtext"> (saved, ending ••••{status.secret_last4})</span>}
              <input
                type="password"
                placeholder={status?.configured ? 'Leave blank to keep current key' : 'sk-ant-…'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              Text model
              <input placeholder="claude-haiku-4-5" value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <label>
              Invoice reading model
              <input placeholder="claude-sonnet-5" value={invoiceModel} onChange={(e) => setInvoiceModel(e.target.value)} />
            </label>
          </div>
          <span className="settings-hint">
            Two models on purpose. Reading a scanned invoice wrong becomes a wrong stock count, which
            costs more than the fraction of a cent saved by using the cheap model for it.
          </span>
          <div className="settings-actions">
            {status?.configured && (
              <button className="btn btn-gray" disabled={Boolean(busy)} onClick={() => void clearKey()}>
                Clear key
              </button>
            )}
            <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void save()}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Gmail ────────────────────────────────────────────────────────────────

function GmailCard({ gmailReturn }: { gmailReturn?: GmailReturn }) {
  const [status, setStatus] = useState<IntegrationStatus<GmailIntegrationConfig> | null>(null)
  const [loading, setLoading] = useState(true)
  const { busy, msg, err, setMsg, setErr, run } = useCardState()

  useEffect(() => { void load() }, [])

  // Surface the OAuth round trip once, on the card that caused it.
  useEffect(() => {
    if (!gmailReturn) return
    if (gmailReturn.ok) setMsg('Gmail connected')
    else setErr(`Gmail connection failed: ${gmailReturn.message ?? 'unknown error'}`)
  }, [gmailReturn, setMsg, setErr])

  async function load() {
    setLoading(true)
    try {
      setStatus(await getIntegrationStatus<GmailIntegrationConfig>('gmail'))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load the Gmail integration')
    } finally {
      setLoading(false)
    }
  }

  const connect = () =>
    run('connect', async () => {
      // Full navigation, not a popup — Google will not render in an iframe.
      window.location.href = await startGmailOAuth()
    })

  const disconnect = () =>
    run('disconnect', async () => {
      await saveIntegration({ provider: 'gmail', clear_secret: true, config: {} })
      await load()
      setMsg('Gmail disconnected')
    })

  return (
    <div className="card settings-card">
      <div className="card-title">Gmail — customer email</div>
      <p className="settings-hint" style={{ marginTop: 0 }}>
        Connects the mailbox with read-only access. Nothing is synced yet — this stores the
        connection so the customer email history can be built on top of it.
      </p>
      <Notices err={err} msg={msg} />
      {loading ? (
        <p className="mutedtext">Loading…</p>
      ) : status?.configured ? (
        <>
          <p className="mutedtext" style={{ margin: '0 0 4px' }}>
            Connected: <strong>{status.config.mailbox || 'unknown mailbox'}</strong>
          </p>
          <span className="settings-hint">
            Read-only scope. Disconnecting revokes nothing at Google&rsquo;s end — remove the app
            under your Google account permissions as well if that is what you want.
          </span>
          <div className="settings-actions">
            <button className="btn btn-gray" disabled={Boolean(busy)} onClick={() => void disconnect()}>
              {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </>
      ) : (
        <div className="settings-actions">
          <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void connect()}>
            {busy === 'connect' ? 'Redirecting…' : 'Connect Gmail'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── AI usage ─────────────────────────────────────────────────────────────

function AiUsageCard() {
  const [usage, setUsage] = useState<AiUsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setUsage(await getAiUsageThisMonth())
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not load AI usage')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const monthLabel = new Date().toLocaleString('en-AU', { month: 'long', year: 'numeric' })

  return (
    <div className="card settings-card">
      <div className="card-title">AI usage — {monthLabel}</div>
      <p className="settings-hint" style={{ marginTop: 0 }}>
        Estimated from Anthropic list pricing and the tokens each call reported. Indicative only —
        the invoice from Anthropic is the real number. Resets each calendar month.
      </p>
      {err && <div className="login-error">{err}</div>}
      {loading ? (
        <p className="mutedtext">Loading…</p>
      ) : !usage || usage.totalCalls === 0 ? (
        <p className="mutedtext">No AI calls this month.</p>
      ) : (
        <>
          <div className="row" style={{ gap: 24, marginBottom: 10 }}>
            <Stat label="calls" value={String(usage.totalCalls)} />
            <Stat label="tokens" value={(usage.totalTokensIn + usage.totalTokensOut).toLocaleString('en-AU')} />
            <Stat label="est. cost" value={`$${usage.estimatedCostUsd.toFixed(4)} USD`} />
          </div>
          {usage.hasUnpricedModel && (
            <span className="settings-hint">
              One or more calls used a model missing from the pricing table, and were costed at the
              Haiku rate. Treat the total as a floor.
            </span>
          )}
          <table className="table settings-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Purpose</th>
                <th className="num">Calls</th>
                <th className="num">Tokens</th>
                <th className="num">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {usage.byPurpose.map((p) => (
                <tr key={p.purpose}>
                  <td style={{ textAlign: 'left' }}><code>{p.purpose}</code></td>
                  <td className="num">{p.calls}</td>
                  <td className="num">{(p.tokensIn + p.tokensOut).toLocaleString('en-AU')}</td>
                  <td className="num">${p.costUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 18, fontWeight: 800 }}>{value}</span>
      <span className="mutedtext" style={{ fontSize: 11 }}>{label}</span>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function SettingsPage({ gmailReturn }: { gmailReturn?: GmailReturn }) {
  return (
    <div>
      <h2 style={{ margin: '0 0 16px' }}>Settings</h2>
      <div className="settings-stack">
        <EmailCard />
        <AnthropicCard />
        <GmailCard gmailReturn={gmailReturn} />
        <AiUsageCard />
      </div>
    </div>
  )
}
