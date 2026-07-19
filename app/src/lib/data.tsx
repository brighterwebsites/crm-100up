import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './auth'
import type { Tables } from '../types/database.types'

export type Job = Tables<'jobs'>
export type Customer = Tables<'customers'>
export type InstallationRequest = Tables<'installation_requests'>
export type Stock = Tables<'stocks'>
export type Supplier = Tables<'suppliers'>
export type Receipt = Tables<'receipts'>
export type JobStockItem = Tables<'job_stock_items'>
export type CesSpec = Tables<'stock_ces_specs'>
export type Profile = Tables<'profiles'>

/** A job row with its customer eagerly joined. Available throughout the app
 * wherever customer contact details are needed alongside job pipeline state. */
export interface JobWithCustomer extends Job {
  customer: Customer
}

interface DataState {
  jobs: Job[]
  customers: Customer[]
  installationRequests: InstallationRequest[]
  stocks: Stock[]
  suppliers: Supplier[]
  receipts: Receipt[]
  items: JobStockItem[]
  cesSpecs: CesSpec[]
  profiles: Profile[]
  loading: boolean
  refresh: () => Promise<void>
}

const DataContext = createContext<DataState>({
  jobs: [],
  customers: [],
  installationRequests: [],
  stocks: [],
  suppliers: [],
  receipts: [],
  items: [],
  cesSpecs: [],
  profiles: [],
  loading: true,
  refresh: async () => {},
})

export function DataProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [state, setState] = useState<Omit<DataState, 'refresh'>>({
    jobs: [],
    customers: [],
    installationRequests: [],
    stocks: [],
    suppliers: [],
    receipts: [],
    items: [],
    cesSpecs: [],
    profiles: [],
    loading: true,
  })
  const timer = useRef<ReturnType<typeof setTimeout>>(null)

  const refresh = useCallback(async () => {
    // RLS scopes every query: admins see everything, installers see
    // their jobs plus the shared reference tables.
    const [jobs, customers, installationRequests, stocks, suppliers, receipts, items, cesSpecs, profiles] =
      await Promise.all([
        supabase.from('jobs').select('*').order('id', { ascending: false }),
        supabase.from('customers').select('*').order('name'),
        supabase.from('installation_requests').select('*'),
        supabase.from('stocks').select('*').order('name'),
        supabase.from('suppliers').select('*').order('name'),
        supabase.from('receipts').select('*').order('occurred_at', { ascending: false }),
        supabase.from('job_stock_items').select('*'),
        supabase.from('stock_ces_specs').select('*'),
        supabase.from('profiles').select('*'),
      ])
    setState({
      jobs: jobs.data ?? [],
      customers: customers.data ?? [],
      installationRequests: installationRequests.data ?? [],
      stocks: stocks.data ?? [],
      suppliers: suppliers.data ?? [],
      receipts: receipts.data ?? [],
      items: items.data ?? [],
      cesSpecs: cesSpecs.data ?? [],
      profiles: profiles.data ?? [],
      loading: false,
    })
  }, [])

  useEffect(() => {
    if (!session) return
    refresh()
    // Realtime: any change to the operational tables triggers a debounced
    // full refresh — simple and correct at this data size (~tens of rows).
    const channel = supabase
      .channel('crm-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(refresh, 400)
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [session, refresh])

  return <DataContext.Provider value={{ ...state, refresh }}>{children}</DataContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useData() {
  return useContext(DataContext)
}

/** Resolve the customer for a given job from the in-memory cache. */
export function customerForJob(job: Job, customers: Customer[]): Customer | undefined {
  return customers.find((c) => c.id === job.customer_id)
}

/** Message shown when an optimistic-lock conflict (SQLSTATE 40001) comes back. */
export function isVersionConflict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)
  return msg.includes('version_conflict')
}
