/**
 * Feedback desk — a floating button, a form, and one list.
 *
 * Fred is testing while the app is still being built, and feedback currently
 * arrives by phone and email where it gets lost. The whole value is that
 * reporting something costs one click from the screen where he noticed it,
 * and that he can see afterwards that it was picked up.
 *
 * Three decisions worth knowing:
 *
 *   The screen name is captured, not asked. "Where were you?" is the question
 *   people answer worst and the one that matters most for reproducing
 *   something.
 *
 *   One list, not an open list plus a history page. This will hold tens of
 *   items, not hundreds; a filter does the job that a second screen was going
 *   to do.
 *
 *   No screenshots. They would be the first Storage use in the project for a
 *   fraction of the value, and "the CRM does not hold files" is already a
 *   decision here (wishlist W1). Additive later if the text-only version
 *   proves thin.
 */
import { useEffect, useState } from 'react'
import { Bug, Lightbulb, MessageSquarePlus } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useData } from '../../lib/data'
import { supabase } from '../../lib/supabaseClient'
import { fmtAgo } from '../../lib/format'
import type { Tables } from '../../types/database.types'

type FeedbackItem = Tables<'feedback_items'>
type Kind = 'bug' | 'idea'
type Status = FeedbackItem['status']

const STATUS_LABEL: Record<Status, string> = {
  open: 'Open',
  started: 'Being worked on',
  done: 'Done',
  wont_do: 'Not doing',
}

/** Floating entry point. Bottom-right so it never fights the header's Backup
 *  and Sign out controls, and fixed so it is reachable from every screen. */
export function FeedbackButton({ screen }: { screen: string }) {
  const { isAdmin } = useAuth()
  const [open, setOpen] = useState(false)
  if (!isAdmin) return null
  return (
    <>
      <button
        className="feedback-fab"
        onClick={() => setOpen(true)}
        title="Report a problem or suggest something"
      >
        <MessageSquarePlus size={16} aria-hidden />
        <span>Feedback</span>
      </button>
      {open && <FeedbackPanel screen={screen} onClose={() => setOpen(false)} />}
    </>
  )
}

function FeedbackPanel({ screen, onClose }: { screen: string; onClose: () => void }) {
  const { profiles, refresh } = useData()
  const { session } = useAuth()
  const [items, setItems] = useState<FeedbackItem[] | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [kind, setKind] = useState<Kind>('bug')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = async () => {
    const { data, error } = await supabase
      .from('feedback_items')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) { setErr(error.message); return }
    setItems(data ?? [])
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [])

  const visible = (items ?? []).filter(
    (i) => showDone || (i.status !== 'done' && i.status !== 'wont_do'),
  )

  async function submit() {
    if (!title.trim()) { setErr('Give it a one-line title.'); return }
    setBusy(true); setErr(null)
    const { error } = await supabase.from('feedback_items').insert({
      kind, title: title.trim(), details: details.trim(), screen,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setTitle(''); setDetails('')
    await load()
    await refresh()
  }

  async function setStatus(item: FeedbackItem, status: Status) {
    const { error } = await supabase
      .from('feedback_items').update({ status }).eq('id', item.id)
    if (error) { setErr(error.message); return }
    await load()
  }

  async function setNote(item: FeedbackItem, admin_note: string) {
    const { error } = await supabase
      .from('feedback_items').update({ admin_note }).eq('id', item.id)
    if (error) { setErr(error.message); return }
    await load()
  }

  const who = (id: string | null) =>
    profiles.find((p) => p.id === id)?.full_name || 'someone'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal feedback-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong><MessageSquarePlus size={14} aria-hidden /> Feedback</strong>
          <button className="btn btn-gray" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
        </div>

        {err && <div className="login-error">{err}</div>}

        <div className="feedback-form">
          <div className="row" style={{ gap: 6 }}>
            <button
              className={`btn ${kind === 'bug' ? 'btn-primary' : 'btn-gray'}`}
              style={{ fontSize: 12, padding: '6px 12px' }}
              onClick={() => setKind('bug')}
            >
              <Bug size={13} aria-hidden /> Something's wrong
            </button>
            <button
              className={`btn ${kind === 'idea' ? 'btn-primary' : 'btn-gray'}`}
              style={{ fontSize: 12, padding: '6px 12px' }}
              onClick={() => setKind('idea')}
            >
              <Lightbulb size={13} aria-hidden /> An idea
            </button>
            <span className="mutedtext" style={{ fontSize: 11, marginLeft: 'auto' }}>
              on <strong>{screen}</strong>
            </span>
          </div>
          <input
            className="jdp-input"
            placeholder={kind === 'bug' ? 'What went wrong, in one line' : 'What would help, in one line'}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="jdp-input"
            rows={3}
            placeholder={kind === 'bug'
              ? 'What were you doing when it happened? What did you expect instead?'
              : 'What would you do with it?'}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
          <div className="row">
            <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Sending…' : 'Send it'}
            </button>
          </div>
        </div>

        <div className="modal-head" style={{ marginTop: 6 }}>
          <strong>Reported</strong>
          <label className="check-label" style={{ marginLeft: 'auto', fontSize: 12 }}>
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Show finished
          </label>
        </div>

        {items === null && <p className="mutedtext">Loading…</p>}
        {items !== null && visible.length === 0 && (
          <p className="mutedtext">Nothing open. Anything you report shows up here.</p>
        )}

        <div className="feedback-list">
          {visible.map((i) => (
            <FeedbackRow
              key={i.id}
              item={i}
              mine={i.created_by === session?.user.id}
              who={who(i.created_by)}
              onStatus={(s) => void setStatus(i, s)}
              onNote={(n) => void setNote(i, n)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function FeedbackRow({
  item, mine, who, onStatus, onNote,
}: {
  item: FeedbackItem
  mine: boolean
  who: string
  onStatus: (s: Status) => void
  onNote: (n: string) => void
}) {
  const [note, setNote] = useState(item.admin_note)
  const [editing, setEditing] = useState(false)
  return (
    <div className={`feedback-item feedback-${item.status}`}>
      <div className="feedback-item-head">
        {item.kind === 'bug'
          ? <Bug size={13} aria-hidden className="feedback-icon-bug" />
          : <Lightbulb size={13} aria-hidden className="feedback-icon-idea" />}
        <strong>{item.title}</strong>
        <span className={`stage-chip feedback-chip-${item.status}`}>{STATUS_LABEL[item.status]}</span>
      </div>
      {item.details && <div className="feedback-details">{item.details}</div>}
      <div className="feedback-meta">
        {mine ? 'you' : who} · {item.screen || 'unknown screen'} · {fmtAgo(item.created_at)}
      </div>

      {/* The reply is the loop-closer: Fred can see it was read and what
          happened, without an email. */}
      {item.admin_note && !editing && (
        <div className="feedback-note"><strong>Reply:</strong> {item.admin_note}</div>
      )}
      {editing && (
        <div className="row" style={{ marginTop: 6 }}>
          <input className="jdp-input" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Short reply — what you did, or why not" style={{ flex: 1 }} />
          <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 10px' }}
            onClick={() => { onNote(note); setEditing(false) }}>Save</button>
        </div>
      )}

      <div className="feedback-actions">
        {(['open', 'started', 'done', 'wont_do'] as const)
          .filter((s) => s !== item.status)
          .map((s) => (
            <button key={s} className="btn btn-gray" style={{ fontSize: 11, padding: '4px 9px' }}
              onClick={() => onStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        {!editing && (
          <button className="btn btn-gray" style={{ fontSize: 11, padding: '4px 9px' }}
            onClick={() => setEditing(true)}>
            {item.admin_note ? 'Edit reply' : 'Reply'}
          </button>
        )}
      </div>
    </div>
  )
}
