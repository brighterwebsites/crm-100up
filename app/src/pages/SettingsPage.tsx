import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { useData } from '../lib/data'
import { supabase } from '../lib/supabaseClient'
import { fmtAgo } from '../lib/format'
import type { Tables } from '../types/database.types'
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
type JobEventRow = Tables<'job_events'>
interface UserActivity {
  id: string
  full_name: string
  role: string
  last_sign_in_at: string | null
  created_at: string
}

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
  const [testMode, setTestMode] = useState(true)
  const [testRedirect, setTestRedirect] = useState('')
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
      // Mirrors the Edge Function: anything but an explicit false is ON.
      setTestMode(s.config.test_mode !== false)
      setTestRedirect(s.config.test_redirect_to ?? '')
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
        config: {
          from_address: fromAddress.trim(), reply_to: replyTo.trim(), enabled,
          test_mode: testMode, test_redirect_to: testRedirect.trim(),
        },
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
      setMsg(
        res.test_mode
          ? `Sent to the test inbox (${res.redirected_to}) — intended for ${res.intended_to}. Nothing reached a customer.`
          : res.message_id ? `Sent for real (message id: ${res.message_id})` : 'Sent for real',
      )
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

          {/* Test mode. Loud on purpose: the two failure modes are believing
              a customer got an email when they didn't, and believing they
              didn't when they did. Both are worse than an ugly banner. */}
          <div className={testMode ? 'calc-warning' : 'cost-drift'} style={{ marginTop: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} style={{ width: 'auto' }} />
              {testMode ? 'TEST MODE — no email reaches a real recipient' : 'LIVE — emails go to real customers, suppliers and installers'}
            </label>
            {testMode ? (
              <>
                <p style={{ margin: '8px 0 6px' }}>
                  Every recipient is rewritten to the address below. The real To and Cc are kept in
                  the subject, in a banner on the message, and in the email history — so you can
                  check who it <em>would</em> have gone to.
                </p>
                <input
                  placeholder="support+crmtest@brighterwebsites.com.au"
                  value={testRedirect}
                  onChange={(e) => setTestRedirect(e.target.value)}
                  style={{ width: '100%', maxWidth: 380 }}
                />
              </>
            ) : (
              <p style={{ margin: '8px 0 0' }}>
                Turn this back on before any further testing. Real sending should only be on once
                Fred is running the business from here.
              </p>
            )}
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

// ── Maintenance notice ───────────────────────────────────────────────────

/**
 * The manual half of the two-banner scheme (features/notice/Banners.tsx).
 *
 * The automatic half needs no control at all: the app compares its build id
 * against /version.json and offers a reload when this tab is behind. That
 * covers "a deploy happened". It cannot cover "I am mid-change right now,
 * expect wobble", which is a judgement, so this is the switch for that.
 *
 * Every duration sets an expiry. A banner that must be turned off by hand is
 * one that stays up for three weeks and stops being read — and it would mean
 * coming back to a dev session just to clear it, which was the thing to
 * avoid.
 */
function MaintenanceCard() {
  const { notice, refresh } = useData()
  const [message, setMessage] = useState('')
  const [hours, setHours] = useState(2)
  const { busy, msg, err, setMsg, run } = useCardState()

  useEffect(() => { setMessage(notice?.message ?? '') }, [notice?.message])

  const liveUntil = notice?.until ? new Date(notice.until) : null
  const isLive = Boolean(notice?.active && (!liveUntil || liveUntil.getTime() > Date.now()))

  const setNotice = (active: boolean) =>
    run('save', async () => {
      const { error } = await supabase
        .from('app_notice')
        .update({
          active,
          message: message.trim(),
          until: active ? new Date(Date.now() + hours * 3600_000).toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1)
      if (error) throw new Error(error.message)
      await refresh()
      setMsg(active ? `Banner is up for the next ${hours} hour${hours === 1 ? '' : 's'}.` : 'Banner cleared.')
    })

  return (
    <div className="card settings-card">
      <div className="card-title">Work-in-progress banner</div>
      <p className="settings-hint" style={{ marginTop: 0 }}>
        Shows a notice to everyone signed in, straight away — no reload needed. Use it when
        you are actively changing things. A deploy on its own needs nothing here: the app
        spots its own new version and offers Fred a Reload button.
      </p>
      <Notices err={err} msg={msg} />

      {isLive && (
        <div className="calc-warning" style={{ marginBottom: 12 }}>
          <strong>Banner is showing now.</strong>{' '}
          {liveUntil ? `It clears itself at ${liveUntil.toLocaleTimeString()}.` : 'No expiry set.'}
        </div>
      )}

      <div className="form-grid">
        <label>
          Message
          <input
            placeholder="Updates in progress — some things may briefly not work."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <label>
          Clear after
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            <option value={1}>1 hour</option>
            <option value={2}>2 hours</option>
            <option value={4}>4 hours</option>
            <option value={8}>8 hours</option>
          </select>
        </label>
      </div>
      <div className="settings-actions">
        {isLive && (
          <button className="btn btn-gray" disabled={Boolean(busy)} onClick={() => void setNotice(false)}>
            Take it down
          </button>
        )}
        <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void setNotice(true)}>
          {busy === 'save' ? 'Saving…' : isLive ? 'Update / extend' : 'Show the banner'}
        </button>
      </div>
    </div>
  )
}

// ── Who is using it ──────────────────────────────────────────────────────

const EVENT_LABEL: Record<string, string> = {
  stage_advanced: 'advanced',
  stage_moved_back: 'moved back',
  booking_rescheduled: 'rescheduled the install for',
  step_date_changed: 'changed a date on',
}

/**
 * Two questions, two sources, because neither answers the other.
 *
 * `auth.users.last_sign_in_at` (via the admin-only user_activity() function —
 * PostgREST cannot serve the auth schema) covers someone who logged in and
 * only looked around, which is most of early testing. It is NOT liveness: a
 * session lasts days, so "this morning" is equally consistent with using it
 * now and closing the laptop at nine.
 *
 * `job_events` covers what was actually changed, with an actor and a
 * timestamp on every stage move, reschedule and date edit. Together they are
 * close enough to "is Fred in there, and what has he touched".
 */
function ActivityCard() {
  const { jobs, customers, profiles } = useData()
  const [users, setUsers] = useState<UserActivity[]>([])
  const [events, setEvents] = useState<JobEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [u, e] = await Promise.all([
        supabase.rpc('user_activity'),
        supabase.from('job_events').select('*').order('created_at', { ascending: false }).limit(25),
      ])
      if (u.error) throw new Error(u.error.message)
      if (e.error) throw new Error(e.error.message)
      setUsers((u.data ?? []) as UserActivity[])
      setEvents((e.data ?? []) as JobEventRow[])
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load activity')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  // `actor` has no foreign key to profiles, so the join happens here.
  const nameOf = (id: string | null) =>
    profiles.find((p) => p.id === id)?.full_name || (id ? 'someone' : 'the system')
  const jobLabel = (jobId: number) => {
    const job = jobs.find((j) => j.id === jobId)
    const cust = job && customers.find((c) => c.id === job.customer_id)
    return cust?.name ? `${cust.name} (#${jobId})` : `job #${jobId}`
  }

  return (
    <div className="card settings-card">
      <div className="card-title">Who is using the CRM</div>
      <p className="settings-hint" style={{ marginTop: 0 }}>
        Sign-in times and recent changes. A sign-in lasts for days, so the time below is the
        last time someone entered their password — not proof they are looking at it now. The
        changes underneath are the better signal.
      </p>
      <Notices err={err} msg={null} />
      {loading ? (
        <p className="mutedtext">Loading…</p>
      ) : (
        <>
          <table className="table" style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Person</th>
                <th style={{ textAlign: 'left' }}>Role</th>
                <th style={{ textAlign: 'left' }}>Last signed in</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={{ textAlign: 'left' }}>{u.full_name || '(no name set)'}</td>
                  <td style={{ textAlign: 'left' }}>{u.role}</td>
                  <td style={{ textAlign: 'left' }}>{fmtAgo(u.last_sign_in_at)}</td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={3} className="mutedtext">No users.</td></tr>
              )}
            </tbody>
          </table>

          <div className="settings-sub">Recent changes</div>
          {events.length === 0 && <p className="mutedtext">Nothing yet.</p>}
          {events.map((ev) => (
            <div key={ev.id} className="stock-line">
              <span>
                <strong>{nameOf(ev.actor)}</strong>{' '}
                {EVENT_LABEL[ev.event_type] ?? ev.event_type.replace(/_/g, ' ')}{' '}
                {jobLabel(ev.job_id)}
              </span>
              <span className="mutedtext">{fmtAgo(ev.created_at)}</span>
            </div>
          ))}
          <div className="settings-actions">
            <button className="btn btn-gray" onClick={() => void load()}>Refresh</button>
          </div>
        </>
      )}
    </div>
  )
}

export default function SettingsPage({ gmailReturn }: { gmailReturn?: GmailReturn }) {
  return (
    <div>
      <h2 style={{ margin: '0 0 16px' }}>Settings</h2>
      <div className="settings-stack">
        <ActivityCard />
        <MaintenanceCard />
        <EmailCard />
        <AnthropicCard />
        <GmailCard gmailReturn={gmailReturn} />
        <AiUsageCard />
      </div>
    </div>
  )
}
