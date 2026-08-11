import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import type { Tables } from '../types/database.types'

export type Profile = Tables<'profiles'>

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  isAdmin: boolean
  /** True between a password-recovery link being opened and a new password
   * being set. A recovery link creates a real session, so without this the
   * user would simply land in the app with their old password unchanged —
   * which is exactly what happened before the SetPassword screen existed. */
  recovery: boolean
  clearRecovery: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  isAdmin: false,
  recovery: false,
  clearRecovery: () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // Fired once, when supabase-js consumes the recovery token from the URL
      // (detectSessionInUrl is on by default). Reloading afterwards does not
      // re-fire it, so a reload drops the user into the app normally — the
      // link is single-use, which is the intended behaviour.
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (!s) {
        setProfile(null)
        setRecovery(false)
        setLoading(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    setLoading(true)
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        if (!cancelled) {
          setProfile(data)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [session])

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        isAdmin: profile?.role === 'admin',
        recovery,
        clearRecovery: () => setRecovery(false),
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
