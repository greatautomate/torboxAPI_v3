import type * as T from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export function qs(params?: Query): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

const ADMIN_BASE = '/admin/api';

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown, opts: { raw?: boolean; base?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['x-tbg-csrf'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch((opts.base ?? ADMIN_BASE) + path, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && !opts.raw) {
    if (onUnauthorized && !window.location.pathname.startsWith('/admin/login')) onUnauthorized();
  }
  let json: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (opts.raw) return json as T;
  const env = json as { ok?: boolean; data?: T; error?: string; message?: string } | null;
  if (!res.ok || !env || env.ok === false) {
    const code = env?.error ?? (res.status === 403 ? 'FORBIDDEN' : `HTTP_${res.status}`);
    const message = env?.message ?? (res.status === 403 ? 'Forbidden' : res.status === 401 ? 'Unauthorized' : `Request failed (${res.status})`);
    throw new ApiError(res.status, code, message);
  }
  return env.data as T;
}

export const http = {
  get: <T>(path: string, params?: Query) => request<T>('GET', path + qs(params)),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export const api = {
  auth: {
    login: (b: { email: string; password: string; totp?: string }) => http.post<{ admin: T.Admin }>('/auth/login', b),
    logout: () => http.post<unknown>('/auth/logout'),
    me: () => http.get<{ admin: T.Admin }>('/auth/me'),
    changePassword: (b: { currentPassword: string; newPassword: string }) => http.post<unknown>('/auth/change-password', b),
    totpSetup: () => http.post<{ secret: string; otpauthUrl: string }>('/auth/totp/setup'),
    totpEnable: (code: string) => http.post<unknown>('/auth/totp/enable', { code }),
    totpDisable: (code: string) => http.post<unknown>('/auth/totp/disable', { code }),
    sessions: () => http.get<{ items: T.Session[] }>('/auth/sessions'),
    revokeSession: (id: string) => http.del<unknown>(`/auth/sessions/${id}`),
  },
  overview: (hours: number) => http.get<T.Overview>('/overview', { hours }),
  alerts: {
    list: (p: Query) => http.get<T.ListResponse<T.Alert>>('/alerts', p),
    read: (id: string) => http.post<unknown>(`/alerts/${id}/read`),
    readAll: () => http.post<unknown>('/alerts/read-all'),
    snooze: (id: string, hours: number) => http.post<{ snoozedUntil: string }>(`/alerts/${id}/snooze`, { hours }),
    test: () => http.post<unknown>('/alerts/test'),
  },
  upstreams: {
    list: () => http.get<{ items: T.Upstream[] }>('/upstreams'),
    create: (b: { label: string; apiKey: string; limits?: Partial<T.UpstreamLimits> }) => http.post<T.Upstream>('/upstreams', b),
    update: (id: string, b: Partial<Pick<T.Upstream, 'label' | 'status' | 'weight'>> & { limits?: Partial<T.UpstreamLimits> }) =>
      http.patch<T.Upstream>(`/upstreams/${id}`, b),
    verify: (id: string) => http.post<T.Upstream>(`/upstreams/${id}/verify`),
    rotate: (id: string, apiKey: string) => http.post<T.Upstream>(`/upstreams/${id}/rotate`, { apiKey }),
    remove: (id: string) => http.del<unknown>(`/upstreams/${id}`),
    details: (id: string) => http.get<T.UpstreamDetails>(`/upstreams/${id}/details`),
    webhook: (id: string, enabled: boolean) => http.post<unknown>(`/upstreams/${id}/webhook`, { enabled }),
    testNotification: (id: string) => http.post<unknown>(`/upstreams/${id}/test-notification`),
    clearNotifications: (id: string) => http.post<unknown>(`/upstreams/${id}/clear-notifications`),
  },
  clients: {
    list: (p: Query) => http.get<T.ListResponse<T.Client>>('/clients', p),
    create: (b: { name: string; contactEmail?: string; notes?: string; defaultPolicyId?: string | null }) => http.post<T.Client>('/clients', b),
    update: (id: string, b: Partial<{ name: string; contactEmail: string; notes: string; defaultPolicyId: string | null; status: T.ClientStatus }>) =>
      http.patch<T.Client>(`/clients/${id}`, b),
    remove: (id: string) => http.del<unknown>(`/clients/${id}`),
    get: (id: string) => http.get<T.ClientDetail>(`/clients/${id}`),
    resetUsage: (id: string) => http.post<{ keys: number }>(`/clients/${id}/reset-usage`),
  },
  keys: {
    list: (p: Query) => http.get<T.ListResponse<T.ApiKey>>('/keys', p),
    create: (b: T.KeyInput) => http.post<{ key: T.ApiKey; secret: string }>('/keys', b),
    get: (id: string) => http.get<T.KeyDetail>(`/keys/${id}`),
    update: (id: string, b: Partial<T.KeyInput>) => http.patch<T.ApiKey>(`/keys/${id}`, b),
    rotate: (id: string, graceMinutes?: number) => http.post<{ secret: string }>(`/keys/${id}/rotate`, graceMinutes ? { graceMinutes } : {}),
    action: (id: string, action: 'suspend' | 'resume' | 'revoke' | 'reset-usage' | 'reset-limits') => http.post<unknown>(`/keys/${id}/${action}`),
  },
  policies: {
    list: () => http.get<{ items: T.Policy[] }>('/policies'),
    create: (b: T.PolicyInput) => http.post<T.Policy>('/policies', b),
    update: (id: string, b: Partial<T.PolicyInput>) => http.patch<T.Policy>(`/policies/${id}`, b),
    remove: (id: string) => http.del<unknown>(`/policies/${id}`),
    makeDefault: (id: string) => http.post<unknown>(`/policies/${id}/make-default`),
  },
  meta: {
    scopes: () => http.get<T.ScopeMeta>('/meta/scopes'),
    routes: () => http.get<{ items: T.RouteMeta[] }>('/meta/routes'),
  },
  logs: {
    list: (p: Query) => http.get<T.ListResponse<T.RequestLog>>('/logs', p),
    get: (id: string) => http.get<T.RequestLog>(`/logs/${id}`),
    count: (p: Query) => http.get<{ count: number }>('/logs/count', p),
    clear: (b: { all?: boolean; keyId?: string; clientId?: string; from?: string; to?: string }) => http.del<{ deleted: number }>('/logs', b),
    exportUrl: (p: Query, format: 'csv' | 'json') => `${ADMIN_BASE}/logs/export${qs({ ...p, format })}`,
  },
  activity: {
    list: (p: Query) => http.get<T.ListResponse<T.Activity>>('/activity', p),
    count: (p: Query) => http.get<{ count: number }>('/activity/count', p),
    clear: (b: { all?: boolean; kind?: string; keyId?: string; clientId?: string; from?: string; to?: string }) => http.del<{ deleted: number }>('/activity', b),
    exportUrl: (p: Query, format: 'csv' | 'json') => `${ADMIN_BASE}/activity/export${qs({ ...p, format })}`,
  },
  analytics: {
    usage: (p: Query) => http.get<{ series: T.UsageSeriesItem[] }>('/analytics/usage', p),
    quotas: () => http.get<{ items: T.QuotaItem[] }>('/analytics/quotas'),
    upstream: (p: Query) => http.get<T.UpstreamUsage>('/analytics/upstream', p),
  },
  downloads: {
    list: (p: Query) => http.get<T.ListResponse<T.Download>>('/downloads', p),
    get: (publicId: string) => http.get<T.DownloadDetail>(`/downloads/${publicId}`),
    stream: (publicId: string, b: { fileId?: number; audio?: number; subtitle?: number; resolution?: number }) => http.post<T.StreamInfo>(`/downloads/${publicId}/stream`, b),
    action: (publicId: string, action: T.DownloadAction) => http.post<unknown>(`/downloads/${publicId}/action`, { action }),
    link: (publicId: string, b: { fileId?: number | string; zip?: boolean }) => http.post<{ url: string }>(`/downloads/${publicId}/link`, b),
    bulkDelete: (b: { upstreamId: string; olderThanDays?: number; createdByKeyId?: string; state?: string }) =>
      http.post<{ deleted: number }>('/downloads/bulk-delete', b),
  },
  webhooks: {
    list: () => http.get<{ items: T.WebhookEndpoint[] }>('/webhooks'),
    create: (b: { clientId: string; keyId?: string; url: string; events: string[] }) => http.post<{ endpoint: T.WebhookEndpoint; secret: string }>('/webhooks', b),
    update: (id: string, b: Partial<{ url: string; events: string[]; active: boolean; keyId: string | null }>) => http.patch<T.WebhookEndpoint>(`/webhooks/${id}`, b),
    remove: (id: string) => http.del<unknown>(`/webhooks/${id}`),
    test: (id: string) => http.post<unknown>(`/webhooks/${id}/test`),
    rotateSecret: (id: string) => http.post<{ secret: string }>(`/webhooks/${id}/rotate-secret`),
    deliveries: (p: Query) => http.get<T.ListResponse<T.WebhookDelivery>>('/webhooks/deliveries', p),
    redeliver: (id: string) => http.post<unknown>(`/webhooks/deliveries/${id}/redeliver`),
    clearDeliveries: (b: { all?: boolean; endpointId?: string; status?: string; from?: string; to?: string }) => http.del<{ deleted: number }>('/webhooks/deliveries', b),
    inbound: () => http.get<T.InboundWebhookStatus>('/webhooks/inbound'),
  },
  events: {
    list: (p: Query) => http.get<T.ListResponse<T.GatewayEvent>>('/events', p),
    clear: (b: { all?: boolean; from?: string; to?: string; type?: string }) => http.del<{ deleted: number }>('/events', b),
    exportUrl: (p: Query, format: 'csv' | 'json') => `${ADMIN_BASE}/events/export${qs({ ...p, format })}`,
  },
  cache: {
    stats: () => http.get<T.CacheStats>('/cache/stats'),
    purge: (b: { group?: string; upstreamId?: string }) => http.del<{ deleted: number }>('/cache', b),
  },
  settings: {
    get: () => http.get<T.Settings>('/settings'),
    patch: (b: Partial<T.Settings>) => http.patch<T.Settings>('/settings', b),
  },
  admins: {
    list: () => http.get<{ items: T.Admin[] }>('/admins'),
    create: (b: { email: string; password: string; role: T.Role }) => http.post<T.Admin>('/admins', b),
    update: (id: string, b: { role?: T.Role; disabled?: boolean }) => http.patch<T.Admin>(`/admins/${id}`, b),
    remove: (id: string) => http.del<unknown>(`/admins/${id}`),
    resetTotp: (id: string) => http.post<unknown>(`/admins/${id}/reset-totp`),
    resetPassword: (id: string, password: string) => http.post<unknown>(`/admins/${id}/reset-password`, { password }),
  },
  audit: { list: (p: Query) => http.get<T.ListResponse<T.AuditEntry>>('/audit', p) },
  playground: (b: T.PlaygroundRequest) => http.post<T.PlaygroundResponse>('/playground', b),
  system: {
    get: () => http.get<T.SystemInfo>('/system'),
    runJob: (name: string) => http.post<unknown>(`/system/jobs/${encodeURIComponent(name)}/run`),
  },
  public: {
    config: () => request<T.PublicConfig>('GET', '/public/config', undefined, { base: '' }),
    stats: () => request<T.PublicStats>('GET', '/public/stats', undefined, { base: '' }),
    status: () => request<T.PublicStatus>('GET', '/api/v1/status', undefined, { base: '', raw: true }),
  },
};
