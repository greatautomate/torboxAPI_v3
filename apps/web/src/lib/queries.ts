import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { api, ApiError, type Query } from './api';
import { useToast } from '../components/ui/Toast';
import type * as T from './types';

export const qk = {
  me: ['auth', 'me'] as const,
  sessions: ['auth', 'sessions'] as const,
  overview: (h: number) => ['overview', h] as const,
  alerts: (p: Query) => ['alerts', p] as const,
  upstreams: ['upstreams'] as const,
  upstreamDetails: (id: string) => ['upstreams', id, 'details'] as const,
  clients: (p: Query) => ['clients', p] as const,
  client: (id: string) => ['clients', id] as const,
  keys: (p: Query) => ['keys', p] as const,
  key: (id: string) => ['keys', id] as const,
  policies: ['policies'] as const,
  scopes: ['meta', 'scopes'] as const,
  routes: ['meta', 'routes'] as const,
  logs: (p: Query) => ['logs', p] as const,
  log: (id: string) => ['logs', id] as const,
  activity: (p: Query) => ['activity', p] as const,
  usage: (p: Query) => ['analytics', 'usage', p] as const,
  quotas: ['analytics', 'quotas'] as const,
  upstreamUsage: (p: Query) => ['analytics', 'upstream', p] as const,
  downloads: (p: Query) => ['downloads', p] as const,
  download: (id: string) => ['downloads', id] as const,
  webhooks: ['webhooks'] as const,
  deliveries: (p: Query) => ['webhooks', 'deliveries', p] as const,
  inbound: ['webhooks', 'inbound'] as const,
  events: (p: Query) => ['events', p] as const,
  cache: ['cache'] as const,
  settings: ['settings'] as const,
  admins: ['admins'] as const,
  audit: (p: Query) => ['audit', p] as const,
  system: ['system'] as const,
  publicConfig: ['public', 'config'] as const,
  publicStats: ['public', 'stats'] as const,
  publicStatus: ['public', 'status'] as const,
};

/** Mutation wrapper that toasts errors (and optional success), invalidates keys. */
export function useApiMutation<TData, TVars>(
  fn: (vars: TVars) => Promise<TData>,
  opts: {
    invalidate?: ReadonlyArray<readonly unknown[]>;
    success?: string | ((d: TData, v: TVars) => string | undefined);
    silent?: boolean;
  } & Omit<UseMutationOptions<TData, ApiError, TVars>, 'mutationFn'> = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  const { invalidate, success, silent, ...rest } = opts;
  return useMutation<TData, ApiError, TVars>({
    mutationFn: fn,
    ...rest,
    onSuccess: (d, v, ctx, mctx) => {
      invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k as unknown[] }));
      const msg = typeof success === 'function' ? success(d, v) : success;
      if (msg) toast.success(msg);
      rest.onSuccess?.(d, v, ctx, mctx);
    },
    onError: (e, v, ctx, mctx) => {
      if (!silent) toast.error(e.message || 'Request failed');
      rest.onError?.(e, v, ctx, mctx);
    },
  });
}

// ---- Auth
export const useMe = (enabled = true) =>
  useQuery({ queryKey: qk.me, queryFn: api.auth.me, enabled, retry: false, staleTime: 60_000 });
export const useSessions = (enabled = true) => useQuery({ queryKey: qk.sessions, queryFn: api.auth.sessions, enabled });

// ---- Overview & alerts
export const useOverview = (hours: number) =>
  useQuery({ queryKey: qk.overview(hours), queryFn: () => api.overview(hours), refetchInterval: 60_000 });
export const useAlerts = (p: Query) => useQuery({ queryKey: qk.alerts(p), queryFn: () => api.alerts.list(p) });
export const useUnreadAlerts = () =>
  useQuery({ queryKey: qk.alerts({ unread: 'true', limit: 1 }), queryFn: () => api.alerts.list({ unread: 'true', limit: 1 }), refetchInterval: 60_000 });

// ---- Upstreams
export const useUpstreams = () => useQuery({ queryKey: qk.upstreams, queryFn: api.upstreams.list });
export const useUpstreamDetails = (id: string | null) =>
  useQuery({ queryKey: qk.upstreamDetails(id ?? ''), queryFn: () => api.upstreams.details(id!), enabled: !!id });

// ---- Clients
export const useClients = (p: Query) => useQuery({ queryKey: qk.clients(p), queryFn: () => api.clients.list(p) });
export const useClient = (id: string) => useQuery({ queryKey: qk.client(id), queryFn: () => api.clients.get(id), enabled: !!id });
export const useAllClients = () => useQuery({ queryKey: qk.clients({ limit: 500 }), queryFn: () => api.clients.list({ limit: 500 }), staleTime: 60_000 });

// ---- Keys
export const useKeys = (p: Query) => useQuery({ queryKey: qk.keys(p), queryFn: () => api.keys.list(p) });
export const useKey = (id: string) => useQuery({ queryKey: qk.key(id), queryFn: () => api.keys.get(id), enabled: !!id });
export const useAllKeys = () => useQuery({ queryKey: qk.keys({ limit: 500 }), queryFn: () => api.keys.list({ limit: 500 }), staleTime: 60_000 });

// ---- Policies & meta
export const usePolicies = () => useQuery({ queryKey: qk.policies, queryFn: api.policies.list });
export const useScopes = () => useQuery({ queryKey: qk.scopes, queryFn: api.meta.scopes, staleTime: 5 * 60_000 });
export const useRoutes = () => useQuery({ queryKey: qk.routes, queryFn: api.meta.routes, staleTime: 5 * 60_000 });

// ---- Logs / activity
export const useLogs = (p: Query, opts: { refetchInterval?: number | false } = {}) =>
  useQuery({ queryKey: qk.logs(p), queryFn: () => api.logs.list(p), placeholderData: (prev) => prev, ...opts });
export const useLog = (id: string | null) => useQuery({ queryKey: qk.log(id ?? ''), queryFn: () => api.logs.get(id!), enabled: !!id });
export const useActivity = (p: Query) =>
  useQuery({ queryKey: qk.activity(p), queryFn: () => api.activity.list(p), placeholderData: (prev) => prev });

// ---- Analytics
export const useUsage = (p: Query) => useQuery({ queryKey: qk.usage(p), queryFn: () => api.analytics.usage(p) });
export const useQuotas = () => useQuery({ queryKey: qk.quotas, queryFn: api.analytics.quotas });
export const useUpstreamUsage = (p: Query) => useQuery({ queryKey: qk.upstreamUsage(p), queryFn: () => api.analytics.upstream(p) });

// ---- Downloads
export const useDownloads = (p: Query, live: boolean) =>
  useQuery({ queryKey: qk.downloads(p), queryFn: () => api.downloads.list(p), placeholderData: (prev) => prev, refetchInterval: live ? 5000 : false });
export const useDownload = (id: string | null, live = false) =>
  useQuery({ queryKey: qk.download(id ?? ''), queryFn: () => api.downloads.get(id!), enabled: !!id, refetchInterval: live ? 5000 : false });

// ---- Webhooks
export const useWebhooks = () => useQuery({ queryKey: qk.webhooks, queryFn: api.webhooks.list });
export const useDeliveries = (p: Query) => useQuery({ queryKey: qk.deliveries(p), queryFn: () => api.webhooks.deliveries(p), placeholderData: (prev) => prev });
export const useInbound = () => useQuery({ queryKey: qk.inbound, queryFn: api.webhooks.inbound });

// ---- Events / cache / settings / admins / audit / system
export const useEvents = (p: Query) => useQuery({ queryKey: qk.events(p), queryFn: () => api.events.list(p), placeholderData: (prev) => prev });
export const useCacheStats = () => useQuery({ queryKey: qk.cache, queryFn: api.cache.stats });
export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: api.settings.get });
export const useAdmins = () => useQuery({ queryKey: qk.admins, queryFn: api.admins.list });
export const useAudit = (p: Query) => useQuery({ queryKey: qk.audit(p), queryFn: () => api.audit.list(p), placeholderData: (prev) => prev });
export const useSystem = () => useQuery({ queryKey: qk.system, queryFn: api.system.get, refetchInterval: 30_000 });

// ---- Public
export const usePublicConfig = () => useQuery({ queryKey: qk.publicConfig, queryFn: api.public.config, retry: 1, staleTime: 5 * 60_000 });
export const usePublicStats = (enabled = true) => useQuery({ queryKey: qk.publicStats, queryFn: api.public.stats, retry: false, staleTime: 60_000, enabled });
export const usePublicStatus = () => useQuery({ queryKey: qk.publicStatus, queryFn: api.public.status, retry: false, refetchInterval: 30_000 });

export type { T };
