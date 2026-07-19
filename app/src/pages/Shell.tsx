import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { DataProvider, useData } from '../lib/data'
import JobsBoard from '../features/jobs/JobsBoard'
import JobDetail from '../features/jobs/JobDetail'
import StockPage from '../features/stock/StockPage'
import OrderList from '../features/stock/OrderList'
import SuppliersPage from '../features/suppliers/SuppliersPage'

type Tab = 'jobs' | 'stock' | 'orders' | 'suppliers'

export default function Shell() {
  return (
    <DataProvider>
      <ShellInner />
    </DataProvider>
  )
}

function ShellInner() {
  const { session, profile, isAdmin, signOut } = useAuth()
  const [tab, setTab] = useState<Tab>('jobs')
  const [orderJobId, setOrderJobId] = useState<number | null>(null)
  const { jobs, customers, stocks, suppliers, receipts, items, installationRequests } = useData()

  // Backup export — denormalises customers + installation_requests back to
  // the old app's flat JSON shape so the file stays importable by the old
  // HTML app if ever needed. Field names match the legacy camelCase keys.
  function exportJson() {
    const byJob = (jobId: number, status: string) =>
      items
        .filter((i) => i.job_id === jobId && i.status === status)
        .map((i) => ({
          stockId: i.stock_id,
          name: stocks.find((s) => s.id === i.stock_id)?.name ?? `stock #${i.stock_id}`,
          qty: i.qty,
          ...(i.notes ? { notes: i.notes } : {}),
        }))
    const data = {
      jobs: jobs.map((j) => {
        const cust = customers.find((c) => c.id === j.customer_id)
        const ir = installationRequests.find((r) => r.job_id === j.id)
        // Reconstruct the legacy job_order jsonb shape from installation_request
        const jobOrder = ir
          ? {
              ref: ir.job_order_ref,
              issued: ir.issued_date ?? '',
              vehicle: ir.vehicle,
              siteAccess: ir.site_access_notes,
              specialInstructions: ir.special_instructions,
              extraNotes: ir.additional_notes,
              customItems: ir.custom_items,
              savedAt: new Date(ir.updated_at).getTime(),
            }
          : undefined
        return {
          id: j.id,
          name: cust?.name ?? '',
          loc: j.location,
          system: j.system_description,
          value: j.value,
          email: cust?.email ?? '',
          phone: cust?.phone ?? '',
          contact: cust?.contact_method ?? 'Email',
          jobType: j.job_type,
          stage: j.stage,
          step: j.step,
          notes: j.notes,
          created: new Date(j.created_at).getTime(),
          stockItems: byJob(j.id, 'assigned'),
          stockConsumed: byJob(j.id, 'consumed'),
          pendingBom: byJob(j.id, 'pending').length ? byJob(j.id, 'pending') : null,
          jobOrder,
          dateBooked: j.planned_install_date ?? '',
          installStart: j.install_start_date ?? '',
          installDate: j.install_completion_date ?? '',
          cesSubmitted: j.ces_submitted ?? '',
          cesReceived: j.ces_received ?? '',
          rebateSubmitted: j.rebate_submitted ?? '',
          rebateReceived: j.rebate_received ?? '',
          fixesNeeded: j.fixes_needed,
        }
      }),
      stocks: stocks.map((s) => ({ id: s.id, name: s.name, qty: s.qty, ...(s.supplier_id ? { supplierId: s.supplier_id } : {}) })),
      suppliers: suppliers.map((sp) => ({ id: sp.id, name: sp.name, phone: sp.phone, email: sp.email, notes: sp.notes })),
      receipts: receipts.map((r) => ({
        id: r.id,
        date: r.occurred_at,
        supplier: suppliers.find((sp) => sp.id === r.supplier_id)?.name ?? '',
        invoiceRef: r.invoice_ref,
        itemCount: r.item_count,
        totalUnits: r.total_units,
      })),
      nextId: Math.max(0, ...jobs.map((j) => j.id)) + 1,
      stockNextId: Math.max(0, ...stocks.map((s) => s.id)) + 1,
      supplierNextId: Math.max(0, ...suppliers.map((sp) => sp.id)) + 1,
      receiptNextId: Math.max(0, ...receipts.map((r) => r.id)) + 1,
      exportedAt: new Date().toISOString(),
      version: 'stock-1.2',
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `100UP_stock-crm_${new Date().toLocaleDateString('en-CA')}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const orderJob = orderJobId != null ? jobs.find((j) => j.id === orderJobId) ?? null : null

  return (
    <div className="shell">
      <nav className="nav">
        <div className="nav-brand">
          100UP <span className="badge">CRM</span>
        </div>
        <div className="nav-tabs">
          <button className={`nav-tab ${tab === 'jobs' ? 'on' : ''}`} onClick={() => setTab('jobs')}>
            🗂 Jobs
          </button>
          {isAdmin && (
            <>
              <button className={`nav-tab ${tab === 'stock' ? 'on' : ''}`} onClick={() => setTab('stock')}>
                📦 Stock
              </button>
              <button className={`nav-tab ${tab === 'orders' ? 'on' : ''}`} onClick={() => setTab('orders')}>
                🛒 Order list
              </button>
              <button className={`nav-tab ${tab === 'suppliers' ? 'on' : ''}`} onClick={() => setTab('suppliers')}>
                🚚 Suppliers
              </button>
            </>
          )}
        </div>
        <div className="nav-right">
          {isAdmin && (
            <button className="btn btn-gray" onClick={exportJson} title="Download a JSON backup (old-app-compatible format)">
              ⬇ Backup
            </button>
          )}
          <span className="nav-user">
            {profile?.full_name || session?.user.email}
            <span className={`role-pill ${isAdmin ? 'role-admin' : 'role-installer'}`}>{profile?.role ?? '…'}</span>
          </span>
          <button className="btn btn-gray" onClick={signOut}>
            Sign out
          </button>
        </div>
      </nav>
      <main className="main">
        {tab === 'jobs' && <JobsBoard />}
        {tab === 'stock' && isAdmin && <StockPage />}
        {tab === 'orders' && isAdmin && <OrderList onOpenJob={setOrderJobId} />}
        {tab === 'suppliers' && isAdmin && <SuppliersPage />}
      </main>
      {orderJob && <JobDetail job={orderJob} onClose={() => setOrderJobId(null)} />}
    </div>
  )
}
