import { useEffect, useState } from 'react'
import {
  Clock, ClipboardList, FlaskConical, House, LayoutGrid, Menu, Package,
  Pickaxe, Plug, ReceiptText, Ruler, Settings, ShoppingCart, SlidersHorizontal,
  Truck, Users, Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { DataProvider } from '../lib/data'
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
import { FeedbackButton } from '../features/feedback/FeedbackDesk'
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
      {/* One strip, its own grid row. Each banner renders null when it has
          nothing to say, so the row usually collapses to zero height. */}
      <div className="app-banners">
        <ModeBanner />
        <UpdateBanner />
        <MaintenanceBanner />
      </div>
      <header className="app-header">
        <div className="header-left">
          <button className="sidebar-toggle-btn" onClick={() => setSidebarOpen(!sidebarOpen)} title="Toggle sidebar">
            <Menu size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <span className="nav-brand">100UP <span className="badge">CRM</span></span>
        </div>
        <div className="header-right">
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

      {/* Fixed, so it is reachable from every screen, and handed the current
          page so the report carries where he was without asking him. */}
      <FeedbackButton screen={page} />
    </div>
  )
}
