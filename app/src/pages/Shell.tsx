import { useAuth } from '../lib/auth'

// Phase 3 shell: proves auth + role wiring end-to-end. Phase 4 replaces
// the placeholder content with the real jobs board / installer job list.
export default function Shell() {
  const { session, profile, isAdmin, signOut } = useAuth()

  return (
    <div className="shell">
      <nav className="nav">
        <div className="nav-brand">
          100UP <span className="badge">CRM</span>
        </div>
        <div className="nav-right">
          <span className="nav-user">
            {profile?.full_name || session?.user.email}
            <span className={`role-pill ${isAdmin ? 'role-admin' : 'role-installer'}`}>
              {profile?.role ?? '…'}
            </span>
          </span>
          <button className="btn btn-gray" onClick={signOut}>
            Sign out
          </button>
        </div>
      </nav>
      <main className="main">
        {isAdmin ? (
          <div className="placeholder">
            <h2>Admin dashboard</h2>
            <p>
              Full pipeline board, stock, order list, suppliers and receipts land here in the
              next phase.
            </p>
          </div>
        ) : (
          <div className="placeholder">
            <h2>My jobs</h2>
            <p>Your assigned jobs land here in the next phase.</p>
          </div>
        )}
      </main>
    </div>
  )
}
