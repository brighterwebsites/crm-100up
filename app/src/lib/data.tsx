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
export type PipelineStep = Tables<'pipeline_steps'>
export type JobStepDate = Tables<'job_step_dates'>
export type StockTake = Tables<'stock_takes'>
export type StockTakeLine = Tables<'stock_take_lines'>
export type AppNotice = Tables<'app_notice'>

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
  /** Live pipeline_steps rows, ordered. The source of truth for who may set
   * each step and where its date lives; lib/pipeline.ts only mirrors names. */
  pipelineSteps: PipelineStep[]
  stepDates: JobStepDate[]
  /** Admin-only by RLS; empty for installers. */
  stockTakes: StockTake[]
  stockTakeLines: StockTakeLine[]
  /** Manual "work in progress" banner. Realtime-published, so switching it
   *  on reaches an open tab without a refresh. */
  notice: AppNotice | null
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
  pipelineSteps: [],
  stepDates: [],
  stockTakes: [],
  stockTakeLines: [],
  notice: null,
  loading: true,
  refresh: async () => {},
})

/** `stocks_visible` types every column nullable — Postgres cannot prove
 *  non-nullness through a view — but the view returns the real value for
 *  every identity and spec column and a literal 0 for the redacted ones. This
 *  restores the Stock shape so callers need no installer-specific branch.
 *  The zeros are the point: an installer's UI shows part names and never a
 *  cost. See migration 20260920110001 and docs/bugs.md #14. */
function redactedStocks(rows: Tables<'stocks_visible'>[]): Stock[] {
  return rows.map((r) => ({
    id: r.id ?? 0,
    name: r.name ?? '',
    model: r.model ?? '',
    category: r.category ?? 'other',
    product_type: r.product_type ?? 'other',
    phase: r.phase ?? 'na',
    active: r.active ?? true,
    verified: r.verified ?? false,
    manufacturer_id: r.manufacturer_id,
    kw: r.kw, kva: r.kva, kwh: r.kwh, usable_kwh: r.usable_kwh, watts: r.watts,
    qty: 0, last_cost: 0, last_landed_cost: 0, planning_cost: 0,
    planning_cost_updated_at: null,
    preferred_supplier_id: null,
  }))
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { session, isAdmin } = useAuth()
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
    pipelineSteps: [],
    stepDates: [],
    stockTakes: [],
    stockTakeLines: [],
    notice: null,
    loading: true,
  })
  const timer = useRef<ReturnType<typeof setTimeout>>(null)

  const refresh = useCallback(async () => {
    // RLS scopes every query: admins see everything, installers see
    // their jobs plus the shared reference tables.
    //
    // Since 20260920110001 the cost and procurement tables are admin-only, so
    // for an installer most of these return an empty array rather than data
    // they should never have had (docs/bugs.md #14). That is the fix working,
    // not a failure — the screens that would use them are admin-only too.
    //
    // `stocks` is the exception, because an installer still needs the NAMES of
    // the parts on their job. They read `stocks_visible`, which carries the
    // same columns with every cost redacted to 0 and rows limited to their own
    // jobs' allocations.
    const [jobs, customers, installationRequests, stocks, manufacturers, suppliers, purchaseOrders, purchaseOrderItems, items, profiles, assumptions, pipelineSteps, stepDates, stockTakes, stockTakeLines, notice] =
      await Promise.all([
        supabase.from('jobs').select('*').order('id', { ascending: false }),
        supabase.from('customers').select('*').order('name'),
        supabase.from('installation_requests').select('*'),
        isAdmin
          ? supabase.from('stocks').select('*').order('name')
          : supabase.from('stocks_visible').select('*').order('name'),
        supabase.from('manufacturers').select('*').order('brand'),
        supabase.from('suppliers').select('*').order('name'),
        supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
        supabase.from('purchase_order_items').select('*'),
        supabase.from('job_stock_items').select('*'),
        supabase.from('profiles').select('*'),
        supabase.from('assumptions').select('*').eq('id', 1).maybeSingle(),
        supabase.from('pipeline_steps').select('*').order('ordinal'),
        supabase.from('job_step_dates').select('*'),
        supabase.from('stock_takes').select('*').order('id', { ascending: false }),
        supabase.from('stock_take_lines').select('*'),
        supabase.from('app_notice').select('*').eq('id', 1).maybeSingle(),
      ])
    setState({
      jobs: jobs.data ?? [],
      customers: customers.data ?? [],
      installationRequests: installationRequests.data ?? [],
      stocks: isAdmin
        ? ((stocks.data ?? []) as Stock[])
        : redactedStocks(stocks.data ?? []),
      manufacturers: manufacturers.data ?? [],
      suppliers: suppliers.data ?? [],
      purchaseOrders: purchaseOrders.data ?? [],
      purchaseOrderItems: purchaseOrderItems.data ?? [],
      items: items.data ?? [],
      profiles: profiles.data ?? [],
      assumptions: assumptions.data ?? null,
      pipelineSteps: pipelineSteps.data ?? [],
      stepDates: stepDates.data ?? [],
      stockTakes: stockTakes.data ?? [],
      stockTakeLines: stockTakeLines.data ?? [],
      notice: notice.data ?? null,
      loading: false,
    })
  }, [isAdmin])

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
