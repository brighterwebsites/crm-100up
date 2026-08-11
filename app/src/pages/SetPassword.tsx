import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabaseClient'

/** Shown after a password-recovery link is opened.
 *
 * The recovery link creates a real session, so the app must intercept here
 * rather than letting the user through — otherwise they land signed in with
 * their old password still active and no way to change it, which is what the
 * app did before this screen existed (docs/bugs.md, A2 in the Phase A plan).
 *
 * Supabase's own minimum is 6 characters; 8 is enforced here deliberately. */
const MIN_LENGTH = 8

export default function SetPassword() {
  const { session, clearRecovery, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }

    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)

    if (error) {
      setError(error.message)
      return
    }
    // Session stays valid, so dropping the recovery flag lands them straight
    // in the app rather than making them sign in again with the new password.
    clearRecovery()
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          100UP <span className="badge">CRM</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
          <KeyRound size={16} aria-hidden />
          Set a new password
        </div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
          {session?.user.email
            ? `Choose a new password for ${session.user.email}.`
            : 'Choose a new password.'}
        </p>

        <label>
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            autoFocus
            required
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            required
          />
        </label>

        {error && <div className="login-error">{error}</div>}

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Set password'}
        </button>
        {/* Escape hatch — without it, anyone who opens a recovery link by
            accident is stuck on this screen with no way back. */}
        <button className="btn-link" type="button" onClick={signOut}>
          Cancel and sign out
        </button>
      </form>
    </div>
  )
}
