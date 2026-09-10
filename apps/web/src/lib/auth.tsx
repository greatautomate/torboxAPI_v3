import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, setUnauthorizedHandler } from './api';
import { qk, useMe } from './queries';
import type { Admin, Role } from './types';

interface AuthCtx {
  admin: Admin | null;
  loading: boolean;
  role: Role | null;
  can: (min: Role) => boolean;
  isOwner: boolean;
  canWrite: boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);
const rank: Record<Role, number> = { viewer: 0, admin: 1, owner: 2 };

export function AuthProvider({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const isLogin = loc.pathname.startsWith('/admin/login');
  const me = useMe(!isLogin);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(qk.me, null);
      qc.clear();
      const next = window.location.pathname + window.location.search;
      nav(`/admin/login${next.startsWith('/admin') && next !== '/admin' ? `?next=${encodeURIComponent(next)}` : ''}`, { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [nav, qc]);

  const admin = me.data?.admin ?? null;
  const role = admin?.role ?? null;
  const can = useCallback((min: Role) => !!role && rank[role] >= rank[min], [role]);
  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      qc.clear();
      nav('/admin/login', { replace: true });
    }
  }, [nav, qc]);

  const value = useMemo<AuthCtx>(
    () => ({
      admin,
      loading: me.isLoading,
      role,
      can,
      isOwner: role === 'owner',
      canWrite: can('admin'),
      refresh: () => qc.invalidateQueries({ queryKey: qk.me }),
      logout,
    }),
    [admin, me.isLoading, role, can, logout, qc],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
