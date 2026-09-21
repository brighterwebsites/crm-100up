import { useEffect, useState } from 'react'
import {
  Clock, ClipboardList, Download, FlaskConical, House, LayoutGrid, Menu, Package,
  Pickaxe, Plug, ReceiptText, Ruler, Settings, ShoppingCart, SlidersHorizontal,
  Truck, Users, Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { DataProvider, useData } from '../lib/data'
import StockPage from '../features/stock/StockPage'
import OrderList from '../features/stock/OrderList'
import SuppliersPage from '../features/suppliers/SuppliersPage'
import PipelinePage from './PipelinePage'
import CustomerJobsPage from './CustomerJobsPage'
import CustomersPage from './CustomersPage'
import DailyLoadProfilePage from './DailyLoadProfilePage'
import PurchaseOrdersPage from './PurchaseOrdersPage'
import SettingsPage, { type GmailReturn } from './SettingsPage'
import AssumptionsPage from './AssumptionsPage'
import CalculatorPage from './CalculatorPage'
import QuickEstimatePage from './QuickEstimatePage'
import SimulationPage from './SimulationPage'
import { MaintenanceBanner, ModeBanner, UpdateBanner } from '../features/notice/Banners'
import GroundMountBomPage from './GroundMountBomPage'

type Page =
  | 'pipeline'
  | 'customer-jobs'
  | 'customers'
  | 'stock'
  | 'orders'
  | 'purchase-orders'
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
  const [gmailReturn, setGmailReturn] = useState<GmailReturn | undefined>()
  const { jobs, customers, stocks, suppliers, purchaseOrders, items, installationRequests } = useData()

  // Gmail OAuth return trip. The app has no router — `page` is state and always
  // starts on Pipeline — so the callback lands on the root with ?gmail=… and
  // this hands the outcome to Settings. Read once and stripped from the URL, so
  // a refresh does not re-announce a connection made ten minutes ago.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const outcome = params.get('gmail')
    if (!outcome) return
    setGmailReturn({ ok: outcome === 'connected', message: params.get('message') ?? undefined })
    setPage('settings')
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

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
          installerNotes: j.installer_notes,
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
        }
      }),
      stocks: stocks.map((s) => ({ id: s.id, name: s.name, qty: s.qty, ...(s.preferred_supplier_id ? { supplierId: s.preferred_supplier_id } : {}) })),
      suppliers: suppliers.map((sp) => ({ id: sp.id, name: sp.name, phone: sp.phone, email: sp.email, notes: sp.notes })),
      receipts: purchaseOrders.map((r) => ({
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
      receiptNextId: Math.max(0, ...purchaseOrders.map((r) => r.id)) + 1,
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

  function NavItem({ p, icon: Icon, label, sub }: { p: Page; icon: LucideIcon; label: string; sub?: boolean }) {
    return (
      <button
        className={`sidebar-item ${sub ? 'sidebar-subitem' : ''} ${page === p ? 'sidebar-item-on' : ''}`}
        onClick={() => setPage(p)}
        title={sidebarOpen ? undefined : label}
      >
        <span className="sidebar-icon">
          <Icon size={sub ? 15 : 17} strokeWidth={1.75} aria-hidden />
        </span>
        {sidebarOpen && <span className="sidebar-label">{label}</span>}
      </button>
    )
  }

  return (
    <div className="shell-layout">
      {/* ── Top header ── */}
      {/* Above the header, and above the sidebar, because both banners are
          about the whole app rather than the page you happen to be on. */}
      <ModeBanner />
      <UpdateBanner />
      <MaintenanceBanner />
      <header className="app-header">
        <div className="header-left">
          <button className="sidebar-toggle-btn" onClick={() => setSidebarOpen(!sidebarOpen)} title="Toggle sidebar">
            <Menu size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <span className="nav-brand">100UP <span className="badge">CRM</span></span>
        </div>
        <div className="header-right">
          {isAdmin && (
            <button className="btn btn-gray btn-icon" style={{ fontSize: 12 }} onClick={exportJson} title="Download JSON backup">
              <Download size={14} strokeWidth={2} aria-hidden /> Backup
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
                <NavItem p="pipeline"      icon={LayoutGrid}    label="Pipeline" />
                <NavItem p="customer-jobs" icon={ClipboardList} label="Customer Jobs" />
                <div className="sidebar-section">{sidebarOpen ? 'CRM' : '·'}</div>
                <NavItem p="customers"     icon={Users}         label="Customers" />
                <div className="sidebar-section">{sidebarOpen ? 'Inventory' : '·'}</div>
                <NavItem p="stock"         icon={Package}       label="Stock" />
                <NavItem p="orders"        icon={ShoppingCart}  label="Order List" />
                <NavItem p="purchase-orders" icon={ReceiptText} label="Purchase Orders" />
                <NavItem p="suppliers"     icon={Truck}         label="Suppliers" />
                <div className="sidebar-section">{sidebarOpen ? 'Quote Designer' : '·'}</div>
                <NavItem p="qd-quick-estimate" icon={House}     label="Quick Estimate" />
                <NavItem p="qd-system-calc"    icon={Ruler}     label="System Calculator" />
                <NavItem p="qd-3phase"         icon={Plug}      label="3 Phase System" />
                <NavItem p="qd-gm-bom"         icon={Pickaxe}   label="Ground Mount BOM" />
                <div className="sidebar-subheading">{sidebarOpen ? 'Tools' : ''}</div>
                <NavItem p="qd-assumptions"        icon={SlidersHorizontal} label="Assumptions" sub />
                <NavItem p="qd-simulation"         icon={FlaskConical}      label="Simulation" sub />
                <NavItem p="qd-daily-load-profile" icon={Clock}             label="Daily Load Profile" sub />
                <NavItem p="settings" icon={Settings} label="Settings" />
              </>
            ) : (
              /* Installer: only their assigned jobs */
              <NavItem p="customer-jobs" icon={Wrench} label="My Jobs" />
            )}
          </nav>
        </aside>

        <main className="app-main">
          {isAdmin && page === 'pipeline'      && <PipelinePage onOpenOrderList={() => setPage('orders')} />}
          {isAdmin && page === 'customer-jobs' && (
            <CustomerJobsPage initialJobId={orderJobId} key={orderJobId ?? 'cj'} />
          )}
          {isAdmin && page === 'customers'     && <CustomersPage />}
          {isAdmin && page === 'stock'         && <StockPage />}
          {isAdmin && page === 'orders'        && <OrderList onOpenJob={handleOpenJob} />}
          {isAdmin && page === 'purchase-orders' && <PurchaseOrdersPage />}
          {isAdmin && page === 'suppliers'     && <SuppliersPage />}
          {isAdmin && page === 'qd-quick-estimate' && <QuickEstimatePage />}
          {/* Same component, two tools. The keys matter: without them React
              reconciles these two positions as one CalculatorPage and keeps
              the single-phase state when you switch to 3 Phase. */}
          {isAdmin && page === 'qd-system-calc'    && <CalculatorPage key="calc-single" onOpenJob={handleOpenJob} phase="single" />}
          {isAdmin && page === 'qd-3phase'         && <CalculatorPage key="calc-three"  onOpenJob={handleOpenJob} phase="three" />}
          {isAdmin && page === 'qd-gm-bom'         && <GroundMountBomPage />}
          {isAdmin && page === 'qd-assumptions'    && <AssumptionsPage />}
          {isAdmin && page === 'qd-simulation'     && <SimulationPage />}
          {isAdmin && page === 'qd-daily-load-profile' && <DailyLoadProfilePage />}
          {isAdmin && page === 'settings'          && <SettingsPage gmailReturn={gmailReturn} />}
          {!isAdmin && (
            <CustomerJobsPage installerOnly />
          )}
        </main>
      </div>
    </div>
  )
}
