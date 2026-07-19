import { AuthProvider, useAuth } from './lib/auth'
import Login from './pages/Login'
import Shell from './pages/Shell'

function Gate() {
  const { session, loading } = useAuth()
  if (loading) {
    return <div className="login-wrap">Loading…</div>
  }
  if (!session) {
    return <Login />
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
