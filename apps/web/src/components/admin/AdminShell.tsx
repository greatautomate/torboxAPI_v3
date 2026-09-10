import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronLeft, ChevronRight, Command, ExternalLink, KeyRound, LogOut, Menu as MenuIcon, Moon, MonitorSmartphone, Search, ShieldCheck, Sun, UserCircle2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { NAV, titleFor } from './nav';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/hooks/useTheme';
import { useLocalStorage } from '../../lib/hooks/useLocalStorage';
import { useUnreadAlerts } from '../../lib/queries';
import { Badge, Menu } from '../ui';
import { ChangePasswordDialog, SessionsDialog, TwoFactorDialog } from './UserDialogs';
import { CommandPalette } from './CommandPalette';

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <NavLink to="/admin" className="flex items-center gap-2.5 px-3 py-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-600 text-white" aria-hidden>
        <svg viewBox="0 0 32 32" className="h-5 w-5">
          <path d="M9 11h14M9 16h14M9 21h9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
        </svg>
      </span>
      {!collapsed && (
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-gray-900 dark:text-gray-100">TorBox Gateway</span>
          <span className="block text-[11px] text-gray-500 dark:text-gray-400">Admin</span>
        </span>
      )}
    </NavLink>
  );
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4 scrollbar-thin" aria-label="Main">
      {NAV.map((g, gi) => (
        <div key={gi}>
          {g.title && !collapsed && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{g.title}</p>}
          {g.title && collapsed && <div className="mx-3 my-2 border-t border-gray-200 dark:border-gray-800" />}
          <ul className="space-y-0.5">
            {g.items.map((it) => (
              <li key={it.to}>
                <NavLink
                  to={it.to}
                  end={it.end}
                  onClick={onNavigate}
                  title={collapsed ? it.label : undefined}
                  className={({ isActive }) =>
                    clsx(
                      'flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                      collapsed && 'justify-center px-0',
                      isActive
                        ? 'bg-accent-50 text-accent-700 dark:bg-accent-950/60 dark:text-accent-200'
                        : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
                    )
                  }
                >
                  <it.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                  {!collapsed && <span className="truncate">{it.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AdminShell({ children }: { children?: ReactNode }) {
  const [collapsed, setCollapsed] = useLocalStorage('tbg.sidebar.collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const { admin, logout } = useAuth();
  const { isDark, toggle } = useTheme();
  const unread = useUnreadAlerts();
  const unreadCount = unread.data?.total ?? 0;
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<null | 'password' | 'totp' | 'sessions'>(null);
  const [palette, setPalette] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const title = titleFor(loc.pathname);

  // Keyboard shortcuts: "/" focuses the header search (or opens the palette when it is hidden), ⌘K / Ctrl+K toggles the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const el = searchRef.current;
        if (el && el.offsetParent !== null) el.focus();
        else setPalette(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [loc.pathname]);
  useEffect(() => {
    document.title = `${title} · TorBox Gateway`;
  }, [title]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    nav(`/admin/logs?q=${encodeURIComponent(q.trim())}`);
    setQ('');
  };

  return (
    <div className="flex min-h-dvh bg-gray-50 dark:bg-gray-950">
      {/* Desktop sidebar */}
      <aside
        className={clsx(
          'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] lg:flex dark:border-gray-800 dark:bg-gray-900',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <Brand collapsed={collapsed} />
        <SidebarNav collapsed={collapsed} />
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-11 items-center justify-center gap-2 border-t border-gray-200 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          {!collapsed && 'Collapse'}
        </button>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-gray-900/50 animate-fade-in" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="relative flex h-full w-[min(18rem,85vw)] flex-col bg-white pt-[env(safe-area-inset-top)] shadow-xl dark:bg-gray-900">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-4 lg:px-6">
            <button type="button" onClick={() => setMobileOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 lg:hidden dark:text-gray-300 dark:hover:bg-gray-800" aria-label="Open navigation">
              <MenuIcon className="h-5 w-5" />
            </button>
            <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900 dark:text-gray-100 sm:text-lg">{title}</h1>
            <form onSubmit={submitSearch} role="search" className="hidden md:block">
              <label className="relative block">
                <span className="sr-only">Search request logs</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.currentTarget.blur(), setQ(''))} placeholder="Search logs…  ( / )" className="input min-h-[40px] w-56 pl-9 pr-9 lg:w-72" />
                <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-gray-200 px-1 text-[10px] text-gray-400 dark:border-gray-700" aria-hidden>/</kbd>
              </label>
            </form>
            <button type="button" onClick={() => setPalette(true)} className="flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800" aria-label="Open command palette (⌘K)" title="Command palette (⌘K / Ctrl+K)">
              <Command className="h-5 w-5" />
              <kbd className="hidden text-[11px] text-gray-400 md:inline">⌘K</kbd>
            </button>
            <NavLink to="/admin/alerts" className="relative flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800" aria-label={`Alerts${unreadCount ? `, ${unreadCount} unread` : ''}`}>
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && <span className="absolute right-2 top-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </NavLink>
            <button type="button" onClick={toggle} className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800" aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}>
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <Menu
              label="User menu"
              trigger={
                <button type="button" className="flex h-11 items-center gap-2 rounded-lg px-2 text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800">
                  <UserCircle2 className="h-6 w-6" aria-hidden />
                  <span className="hidden max-w-[160px] truncate text-sm sm:inline">{admin?.email}</span>
                  {admin && (
                    <Badge tone="accent" className="hidden sm:inline-flex">
                      {admin.role}
                    </Badge>
                  )}
                </button>
              }
              items={[
                { label: admin?.email ?? '', disabled: true },
                { divider: true, label: '' },
                { label: 'Change password', icon: <KeyRound className="h-4 w-4" />, onClick: () => setDialog('password') },
                { label: admin?.totpEnabled ? 'Two-factor (enabled)' : 'Enable two-factor', icon: <ShieldCheck className="h-4 w-4" />, onClick: () => setDialog('totp') },
                { label: 'Sessions', icon: <MonitorSmartphone className="h-4 w-4" />, onClick: () => setDialog('sessions') },
                { label: 'Open homepage', icon: <ExternalLink className="h-4 w-4" />, onClick: () => window.open('/', '_blank') },
                { divider: true, label: '' },
                { label: 'Log out', icon: <LogOut className="h-4 w-4" />, danger: true, onClick: () => void logout() },
              ]}
            />
          </div>
          <form onSubmit={submitSearch} role="search" className="px-3 pb-2 md:hidden">
            <label className="relative block">
              <span className="sr-only">Search request logs</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search logs…" className="input min-h-[40px] pl-9" />
            </label>
          </form>
        </header>
        <main className="min-w-0 flex-1 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-6 lg:px-6">{children ?? <Outlet />}</main>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <ChangePasswordDialog open={dialog === 'password'} onClose={() => setDialog(null)} />
      <TwoFactorDialog open={dialog === 'totp'} onClose={() => setDialog(null)} />
      <SessionsDialog open={dialog === 'sessions'} onClose={() => setDialog(null)} />
    </div>
  );
}
