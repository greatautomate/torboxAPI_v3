import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { PageLoader } from './components/ui/Spinner';
import { HomePage } from './pages/home/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { LoginPage } from './pages/admin/LoginPage';
import { ChangePasswordDialog } from './components/admin/UserDialogs';

const AdminShell = lazy(() => import('./components/admin/AdminShell').then((m) => ({ default: m.AdminShell })));
const OverviewPage = lazy(() => import('./pages/admin/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const AlertsPage = lazy(() => import('./pages/admin/AlertsPage').then((m) => ({ default: m.AlertsPage })));
const UpstreamsPage = lazy(() => import('./pages/admin/UpstreamsPage').then((m) => ({ default: m.UpstreamsPage })));
const ClientsPage = lazy(() => import('./pages/admin/ClientsPage').then((m) => ({ default: m.ClientsPage })));
const ClientDetailPage = lazy(() => import('./pages/admin/ClientsPage').then((m) => ({ default: m.ClientDetailPage })));
const KeysPage = lazy(() => import('./pages/admin/KeysPage').then((m) => ({ default: m.KeysPage })));
const KeyCreatePage = lazy(() => import('./pages/admin/KeysPage').then((m) => ({ default: m.KeyCreatePage })));
const KeyDetailPage = lazy(() => import('./pages/admin/KeysPage').then((m) => ({ default: m.KeyDetailPage })));
const PoliciesPage = lazy(() => import('./pages/admin/PoliciesPage').then((m) => ({ default: m.PoliciesPage })));
const LogsPage = lazy(() => import('./pages/admin/LogsPage').then((m) => ({ default: m.LogsPage })));
const ActivityPage = lazy(() => import('./pages/admin/ActivityPage').then((m) => ({ default: m.ActivityPage })));
const AnalyticsPage = lazy(() => import('./pages/admin/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const DownloadsPage = lazy(() => import('./pages/admin/DownloadsPage').then((m) => ({ default: m.DownloadsPage })));
const WebhooksPage = lazy(() => import('./pages/admin/WebhooksPage').then((m) => ({ default: m.WebhooksPage })));
const EventsPage = lazy(() => import('./pages/admin/EventsPage').then((m) => ({ default: m.EventsPage })));
const CachePage = lazy(() => import('./pages/admin/CachePage').then((m) => ({ default: m.CachePage })));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AdminsPage = lazy(() => import('./pages/admin/AdminsPage').then((m) => ({ default: m.AdminsPage })));
const AuditPage = lazy(() => import('./pages/admin/AuditPage').then((m) => ({ default: m.AuditPage })));
const PlaygroundPage = lazy(() => import('./pages/admin/PlaygroundPage').then((m) => ({ default: m.PlaygroundPage })));
const SystemPage = lazy(() => import('./pages/admin/SystemPage').then((m) => ({ default: m.SystemPage })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { admin, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoader />;
  if (!admin) return <Navigate to={`/admin/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return (
    <>
      {children}
      {admin.mustChangePassword && <ChangePasswordDialog open onClose={() => undefined} forced />}
    </>
  );
}

function AdminLayout() {
  return (
    <RequireAuth>
      <Suspense fallback={<PageLoader />}>
        <AdminShell>
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </AdminShell>
      </Suspense>
    </RequireAuth>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route
        path="/admin/*"
        element={
          <AuthProvider>
            <Routes>
              <Route path="login" element={<LoginPage />} />
              <Route element={<AdminLayout />}>
                <Route index element={<OverviewPage />} />
                <Route path="alerts" element={<AlertsPage />} />
                <Route path="upstreams" element={<UpstreamsPage />} />
                <Route path="clients" element={<ClientsPage />} />
                <Route path="clients/:id" element={<ClientDetailPage />} />
                <Route path="keys" element={<KeysPage />} />
                <Route path="keys/new" element={<KeyCreatePage />} />
                <Route path="keys/:id" element={<KeyDetailPage />} />
                <Route path="policies" element={<PoliciesPage />} />
                <Route path="logs" element={<LogsPage />} />
                <Route path="activity" element={<ActivityPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="downloads" element={<DownloadsPage />} />
                <Route path="webhooks" element={<WebhooksPage />} />
                <Route path="events" element={<EventsPage />} />
                <Route path="cache" element={<CachePage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="admins" element={<AdminsPage />} />
                <Route path="audit" element={<AuditPage />} />
                <Route path="playground" element={<PlaygroundPage />} />
                <Route path="system" element={<SystemPage />} />
                <Route path="*" element={<NotFoundPage home="/admin" />} />
              </Route>
            </Routes>
          </AuthProvider>
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
