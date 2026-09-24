import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'

const Login = lazy(() => import('@/pages/Login'))
const ChangePassword = lazy(() => import('@/pages/ChangePassword'))
const SignContract = lazy(() => import('@/pages/SignContract'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Frontdesk = lazy(() => import('@/pages/Frontdesk'))
const Tenants = lazy(() => import('@/pages/Tenants'))
const TenantDetail = lazy(() => import('@/pages/TenantDetail'))
const Rooms = lazy(() => import('@/pages/Rooms'))
const Properties = lazy(() => import('@/pages/Properties'))
const PropertyDetail = lazy(() => import('@/pages/PropertyDetail'))
const Chat = lazy(() => import('@/pages/Chat'))
const Expenses = lazy(() => import('@/pages/Expenses'))
const Reports = lazy(() => import('@/pages/Reports'))
const ReportDetail = lazy(() => import('@/pages/ReportDetail'))
const Notifications = lazy(() => import('@/pages/Notifications'))
const Settings = lazy(() => import('@/pages/Settings'))
const Users = lazy(() => import('@/pages/Users'))
const Trash = lazy(() => import('@/pages/Trash'))
const Activity = lazy(() => import('@/pages/Activity'))
const Approvals = lazy(() => import('@/pages/Approvals'))
const NotFound = lazy(() => import('@/pages/NotFound'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/change-password" element={<ChangePassword />} />
          {/* Public: the tenant opens this from WhatsApp, no account needed. */}
          <Route path="/sign/:token" element={<SignContract />} />

          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/frontdesk" element={<Frontdesk />} />
            <Route path="/tenants" element={<Tenants />} />
            <Route path="/tenants/:id" element={<TenantDetail />} />
            <Route path="/rooms" element={<Rooms />} />
            <Route path="/properties" element={<Properties />} />
            <Route path="/properties/:id" element={<PropertyDetail />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports/:slug" element={<ReportDetail />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/users" element={<Users />} />
            <Route path="/trash" element={<Trash />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/approvals" element={<Approvals />} />
          </Route>

          <Route path="/404" element={<NotFound />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
