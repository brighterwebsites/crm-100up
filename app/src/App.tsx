import { AuthProvider, useAuth } from './lib/auth'
import Login from './pages/Login'
import SetPassword from './pages/SetPassword'
import Shell from './pages/Shell'

function Gate() {
  const { session, loading, recovery } = useAuth()
  if (loading) {
    return <div className="login-wrap">Loading…</div>
  }
  if (!session) {
    return <Login />
  }
  // Checked before Shell on purpose: a recovery link produces a valid session,
  // so without this the user would be let straight into the app with their old
  // password unchanged and no way to set a new one.
  if (recovery) {
    return <SetPassword />
  }
  return <Shell />
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
