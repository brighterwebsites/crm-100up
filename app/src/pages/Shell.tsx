import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { DataProvider, useData } from '../lib/data'
import StockPage from '../features/stock/StockPage'
import OrderList from '../features/stock/OrderList'
import SuppliersPage from '../features/suppliers/SuppliersPage'
import PipelinePage from './PipelinePage'
import CustomerJobsPage from './CustomerJobsPage'
import CustomersPage from './CustomersPage'
import StubPage from './StubPage'
import DailyLoadProfilePage from './DailyLoadProfilePage'

type Page =
  | 'pipeline'
  | 'customer-jobs'
  | 'customers'
  | 'stock'
  | 'orders'
  | 'suppliers'
  | 'qd-quick-estimate'
  | 'qd-system-calc'
  | 'qd-3phase'
  | 'qd-gm-bom'
  | 'qd-assumptions'
  | 'qd-simulation'
  | 'qd-daily-load-profile'
  | 'settings'

export default function Shell() {
  return (
    <DataProvider>
      <ShellInner />
    </DataProvider>
  )
}

function ShellInner() {
  const { session, profile, isAdmin, signOut } = useAuth()
  const [page, setPage]               = useState<Page>('pipeline')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [orderJobId, setOrderJobId]   = useState<number | null>(null)
  const { jobs, customers, stocks, suppliers, receipts, items, installationRequests } = useData()

  // Backup export — denormalises customers + installation_requests back to
  // the old app's flat JSON shape so the file stays importable if ever needed.
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

  // When OrderList wants to open a job, jump to Customer Jobs page with it selected
  function handleOpenJob(id: number) {
    setOrderJobId(id)
    setPage('customer-jobs')
  }

  function NavItem({ p, icon, label, sub }: { p: Page; icon: string; label: string; sub?: boolean }) {
    return (
      <button
        className={`sidebar-item ${sub ? 'sidebar-subitem' : ''} ${page === p ? 'sidebar-item-on' : ''}`}
        onClick={() => setPage(p)}
        title={sidebarOpen ? undefined : label}
      >
        <span className="sidebar-icon">{icon}</span>
        {sidebarOpen && <span className="sidebar-label">{label}</span>}
      </button>
    )
  }

  return (
    <div className="shell-layout">
      {/* ── Top header ── */}
      <header className="app-header">
        <div className="header-left">
          <button className="sidebar-toggle-btn" onClick={() => setSidebarOpen(!sidebarOpen)} title="Toggle sidebar">
            ☰
          </button>
          <span className="nav-brand">100UP <span className="badge">CRM</span></span>
        </div>
        <div className="header-right">
          {isAdmin && (
            <button className="btn btn-gray" style={{ fontSize: 12 }} onClick={exportJson} title="Download JSON backup">
              ⬇ Backup
            </button>
          )}
          <span className="nav-user">
            {profile?.full_name || session?.user.email}
            <span className={`role-pill ${isAdmin ? 'role-admin' : 'role-installer'}`}>{profile?.role ?? '…'}</span>
          </span>
          <button className="btn btn-gray" style={{ fontSize: 12 }} onClick={signOut}>Sign out</button>
        </div>
      </header>

      {/* ── Sidebar + main ── */}
      <div style={{ display: 'contents' }}>
        <aside className={`sidebar${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
          <nav className="sidebar-nav">
            {isAdmin ? (
              <>
                <NavItem p="pipeline"      icon="◉"  label="Pipeline" />
                <NavItem p="customer-jobs" icon="📋" label="Customer Jobs" />
                <div className="sidebar-section">{sidebarOpen ? 'CRM' : '·'}</div>
                <NavItem p="customers"     icon="👥" label="Customers" />
                <div className="sidebar-section">{sidebarOpen ? 'Inventory' : '·'}</div>
                <NavItem p="stock"         icon="📦" label="Stock" />
                <NavItem p="orders"        icon="🛒" label="Order List" />
                <NavItem p="suppliers"     icon="🚚" label="Suppliers" />
                <div className="sidebar-section">{sidebarOpen ? 'Quote Designer' : '·'}</div>
                <NavItem p="qd-quick-estimate" icon="🏠" label="Quick Estimate" />
                <NavItem p="qd-system-calc"    icon="📐" label="System Calculator" />
                <NavItem p="qd-3phase"         icon="🔌" label="3 Phase System" />
                <NavItem p="qd-gm-bom"         icon="⛏️" label="Ground Mount BOM" />
                <div className="sidebar-subheading">{sidebarOpen ? 'Tools' : ''}</div>
                <NavItem p="qd-assumptions"        icon="⚙️" label="Assumptions" sub />
                <NavItem p="qd-simulation"         icon="🔬" label="Simulation" sub />
                <NavItem p="qd-daily-load-profile" icon="⏱️" label="Daily Load Profile" sub />
                <NavItem p="settings" icon="🔧" label="Settings" />
              </>
            ) : (
              /* Installer: only their assigned jobs */
              <NavItem p="customer-jobs" icon="🔧" label="My Jobs" />
            )}
          </nav>
        </aside>

        <main className="app-main">
          {isAdmin && page === 'pipeline'      && <PipelinePage />}
          {isAdmin && page === 'customer-jobs' && (
            <CustomerJobsPage initialJobId={orderJobId} key={orderJobId ?? 'cj'} />
          )}
          {isAdmin && page === 'customers'     && <CustomersPage />}
          {isAdmin && page === 'stock'         && <StockPage />}
          {isAdmin && page === 'orders'        && <OrderList onOpenJob={handleOpenJob} />}
          {isAdmin && page === 'suppliers'     && <SuppliersPage />}
          {isAdmin && page === 'qd-quick-estimate' && <StubPage icon="🏠" title="Quick Estimate" note="Bedroom/occupant-based system sizing — not ported yet." />}
          {isAdmin && page === 'qd-system-calc'    && <StubPage icon="📐" title="System Calculator" note="Full panel + battery + inverter quoting calculator — not ported yet." />}
          {isAdmin && page === 'qd-3phase'         && <StubPage icon="🔌" title="3 Phase System" note="Three-phase system sizing tool — not ported yet." />}
          {isAdmin && page === 'qd-gm-bom'         && <StubPage icon="⛏️" title="Ground Mount BOM" note="Ground mount bill-of-materials generator — not ported yet." />}
          {isAdmin && page === 'qd-assumptions'    && <StubPage icon="⚙️" title="Assumptions" note="Full editable assumptions table — not ported yet. Daily Load Profile below already reads/writes the live assumptions data." />}
          {isAdmin && page === 'qd-simulation'     && <StubPage icon="🔬" title="Simulation" note="July hourly SOC trace engine — not ported yet." />}
          {isAdmin && page === 'qd-daily-load-profile' && <DailyLoadProfilePage />}
          {isAdmin && page === 'settings'          && <StubPage icon="🔧" title="Settings" />}
          {!isAdmin && (
            <CustomerJobsPage installerOnly />
          )}
        </main>
      </div>
    </div>
  )
}
