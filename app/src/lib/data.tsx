import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './auth'
import type { Tables } from '../types/database.types'

export type Job = Tables<'jobs'>
export type Customer = Tables<'customers'>
export type InstallationRequest = Tables<'installation_requests'>
export type Stock = Tables<'stocks'>
export type Manufacturer = Tables<'manufacturers'>
export type Supplier = Tables<'suppliers'>
export type PurchaseOrder = Tables<'purchase_orders'>
export type PurchaseOrderItem = Tables<'purchase_order_items'>
export type JobStockItem = Tables<'job_stock_items'>
export type Profile = Tables<'profiles'>
export type Assumptions = Tables<'assumptions'>

/** The 24-hour relative-weight load shape lives in assumptions.load_profile
 * as jsonb — parse defensively since Postgres returns it untyped `Json`. */
export function loadProfileArray(a: Assumptions | null | undefined): number[] {
  const p = a?.load_profile
  if (Array.isArray(p) && p.length === 24 && p.every((x) => typeof x === 'number')) {
    return p as number[]
  }
  return DEFAULT_LOAD_PROFILE
}

export const DEFAULT_LOAD_PROFILE: number[] = [
  2, 1.5, 1.5, 1.5, 2, 3, 5, 7, 6.5, 5, 3.5, 3, 3.5, 3, 3, 3, 4, 6, 8, 8, 6.5, 5, 3.5, 2.5,
]

/** A job row with its customer eagerly joined. Available throughout the app
 * wherever customer contact details are needed alongside job pipeline state. */
export interface JobWithCustomer extends Job {
  customer: Customer
}

interface DataState {
  jobs: Job[]
  manufacturers: Manufacturer[]
  customers: Customer[]
  installationRequests: InstallationRequest[]
  stocks: Stock[]
  suppliers: Supplier[]
  purchaseOrders: PurchaseOrder[]
  purchaseOrderItems: PurchaseOrderItem[]
  items: JobStockItem[]
  profiles: Profile[]
  assumptions: Assumptions | null
  loading: boolean
  refresh: () => Promise<void>
}

const DataContext = createContext<DataState>({
  jobs: [],
  manufacturers: [],
  customers: [],
  installationRequests: [],
  stocks: [],
  suppliers: [],
  purchaseOrders: [],
  purchaseOrderItems: [],
  items: [],
  profiles: [],
  assumptions: null,
  loading: true,
  refresh: async () => {},
})

export function DataProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [state, setState] = useState<Omit<DataState, 'refresh'>>({
    jobs: [],
    manufacturers: [],
    customers: [],
    installationRequests: [],
    stocks: [],
    suppliers: [],
    purchaseOrders: [],
    purchaseOrderItems: [],
    items: [],
    profiles: [],
    assumptions: null,
    loading: true,
  })
  const timer = useRef<ReturnType<typeof setTimeout>>(null)

  const refresh = useCallback(async () => {
    // RLS scopes every query: admins see everything, installers see
    // their jobs plus the shared reference tables.
    const [jobs, customers, installationRequests, stocks, manufacturers, suppliers, purchaseOrders, purchaseOrderItems, items, profiles, assumptions] =
      await Promise.all([
        supabase.from('jobs').select('*').order('id', { ascending: false }),
        supabase.from('customers').select('*').order('name'),
        supabase.from('installation_requests').select('*'),
        supabase.from('stocks').select('*').order('name'),
        supabase.from('manufacturers').select('*').order('brand'),
        supabase.from('suppliers').select('*').order('name'),
        supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
        supabase.from('purchase_order_items').select('*'),
        supabase.from('job_stock_items').select('*'),
        supabase.from('profiles').select('*'),
        supabase.from('assumptions').select('*').eq('id', 1).maybeSingle(),
      ])
    setState({
      jobs: jobs.data ?? [],
      customers: customers.data ?? [],
      installationRequests: installationRequests.data ?? [],
      stocks: stocks.data ?? [],
      manufacturers: manufacturers.data ?? [],
      suppliers: suppliers.data ?? [],
      purchaseOrders: purchaseOrders.data ?? [],
      purchaseOrderItems: purchaseOrderItems.data ?? [],
      items: items.data ?? [],
      profiles: profiles.data ?? [],
      assumptions: assumptions.data ?? null,
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

/** CEC-listed legal entity name for a product — this is what a CES
 * submission must carry, not the trading/brand name. Empty string when the
 * product has no manufacturer linked (e.g. generic ground-mount hardware). */
export function legalNameFor(
  stock: { manufacturer_id: number | null } | undefined,
  manufacturers: Manufacturer[]
): string {
  if (!stock?.manufacturer_id) return ''
  return manufacturers.find((m) => m.id === stock.manufacturer_id)?.legal_name ?? ''
}

/** Trading name, for grouping and display. */
export function brandFor(
  stock: { manufacturer_id: number | null } | undefined,
  manufacturers: Manufacturer[]
): string {
  if (!stock?.manufacturer_id) return ''
  return manufacturers.find((m) => m.id === stock.manufacturer_id)?.brand ?? ''
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
