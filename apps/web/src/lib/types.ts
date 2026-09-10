// Types mirroring docs/ADMIN_API.md

export type Role = 'owner' | 'admin' | 'viewer';

export interface Admin {
  id: string;
  email: string;
  role: Role;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  disabled?: boolean;
  createdAt: string;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface UsedLimit {
  used: number;
  limit: number;
}

export interface Session {
  id: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export interface Overview {
  kpis: {
    requests: number;
    errors: number;
    errorRate: number;
    cacheHitRate: number;
    p95LatencyMs: number;
    avgLatencyMs: number;
    activeKeys: number;
    clients: number;
    submits: number;
    links: number;
    streams?: number;
  };
  upstream: Array<{
    id: string;
    label: string;
    status: UpstreamStatus;
    plan: number | string | null;
    planName: string | null;
    premiumExpiresAt: string | null;
    lastVerifiedAt?: string | null;
    lastError?: string | null;
    budgets: {
      perMinute: UsedLimit;
      uncachedPerHour: UsedLimit;
      usenetPerHour: UsedLimit;
      webdlPerHour: UsedLimit;
    };
  }>;
  series: {
    hourly: Array<{ t: string; ok: number; error: number; cached: number }>;
    topKeys: Array<{ keyId: string; name: string; clientName: string; count: number }>;
    topRoutes: Array<{ route: string; count: number }>;
    errorCodes: Array<{ code: string; count: number }>;
  };
  alerts: { unread: number };
}

export type AlertSeverity = 'info' | 'warning' | 'critical';
export interface Alert {
  id: string;
  severity: AlertSeverity;
  type: string;
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
  snoozedUntil?: string | null;
  meta?: Record<string, unknown>;
}

export type UpstreamStatus = 'active' | 'degraded' | 'disabled';
export interface UpstreamLimits {
  perMinute: number;
  createUncachedPerHour: number;
  createUsenetPerHour: number;
  createWebdlPerHour: number;
}
export interface Upstream {
  id: string;
  label: string;
  fingerprint: string;
  status: UpstreamStatus;
  plan: number | string | null;
  planName: string | null;
  emailMasked: string | null;
  premiumExpiresAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  weight: number;
  limits: UpstreamLimits;
  webhookConfigured: boolean;
  keysCount: number;
  createdAt: string;
}
export interface UpstreamDetails {
  account: Upstream;
  me: Record<string, unknown>;
  stats: { general?: Record<string, unknown>; bandwidth?: Array<Record<string, unknown>> } | null;
  notifications: Array<{ id?: string | number; title?: string; message?: string; created_at?: string; [k: string]: unknown }>;
}

export type ClientStatus = 'active' | 'suspended';
export interface Client {
  id: string;
  name: string;
  contactEmail: string | null;
  notes: string | null;
  status: ClientStatus;
  defaultPolicyId: string | null;
  keysCount: number;
  requests30d: number;
  createdAt: string;
}
export interface ClientDetail {
  client: Client;
  keys: ApiKey[];
  usage: { month: { requests: number; creates: number }; daily: Array<{ d: string; requests: number; errors: number }> };
}

export type KeyStatus = 'active' | 'suspended' | 'revoked';
export interface ApiKey {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
  prefix: string;
  last4: string;
  mode?: 'live' | 'test';
  scopes: string[];
  policyId: string;
  policyName: string;
  upstreamAccountId: string;
  upstreamLabel: string;
  allowedIps: string[];
  allowedOrigins: string[];
  expiresAt: string | null;
  status: KeyStatus;
  revokedAt?: string | null;
  /** While set (and in the future) the previous secret is still accepted after a rotation. */
  graceUntil?: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  requests30d: number;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}
export interface KeyDetail {
  key: ApiKey;
  usage: {
    month: { requests: number; creates: number; quotaRequests: number; quotaCreates: number };
    today: { requests: number; errors: number };
    daily: Array<{ d: string; requests: number; errors: number; cacheHits: number; submits?: number; links?: number }>;
  };
  buckets: {
    perMinute: UsedLimit & { resetAt?: string | null };
    perHour: UsedLimit & { resetAt?: string | null };
    perDay: UsedLimit & { resetAt?: string | null };
    createUncachedPerHour: UsedLimit & { resetAt?: string | null };
    createPerHour: UsedLimit & { resetAt?: string | null };
  };
}
export interface KeyInput {
  name: string;
  clientId?: string;
  scopes: string[];
  policyId: string | null;
  upstreamAccountId: string | null;
  allowedIps?: string[];
  allowedOrigins?: string[];
  expiresAt?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface Policy {
  id: string;
  name: string;
  description: string | null;
  limits: { perMinute: number; perHour: number; perDay: number; createUncachedPerHour: number; createPerHour: number };
  quotas: { monthlyRequests: number; monthlyCreates: number };
  features: {
    allowPermalinks: boolean;
    allowStreaming: boolean;
    allowUploads: boolean;
    allowSettingsWrite: boolean;
    allowBypassCache: boolean;
    allowWebhooks: boolean;
  };
  cacheTtlOverrides: Record<string, number>;
  keysCount: number;
  isDefault: boolean;
  createdAt?: string;
}
export type PolicyInput = Omit<Policy, 'id' | 'keysCount' | 'isDefault' | 'createdAt'>;

export interface ScopeMeta {
  items: Array<{ scope: string; group: string; description: string; default: boolean }>;
  presets: Record<string, string[]>;
}
export interface RouteMeta {
  method: string;
  path: string;
  scope: string;
  group: string;
  cacheTtl: number;
  blocked: boolean;
  limiter: string;
}

export type Surface = 'compat' | 'v1' | 'permalink' | 'stream';
export interface RequestLog {
  id: string;
  ts: string;
  requestId: string;
  keyId: string | null;
  keyName: string | null;
  clientId: string | null;
  clientName: string | null;
  upstreamAccountId: string | null;
  method: string;
  route: string;
  path: string;
  query: string | Record<string, unknown> | null;
  status: number;
  upstreamStatus: number | null;
  torboxError: string | null;
  success: boolean;
  latencyMs: number;
  upstreamLatencyMs: number | null;
  cacheHit: boolean;
  ip: string;
  userAgent: string;
  reqBytes: number;
  resBytes: number;
  surface: Surface;
}
export interface LogFilters {
  from?: string;
  to?: string;
  keyId?: string;
  clientId?: string;
  route?: string;
  status?: string;
  error?: string;
  cacheHit?: string;
  ip?: string;
  requestId?: string;
  surface?: string;
  q?: string;
}

export type ActivityKind = 'submit' | 'link' | 'stream' | 'control' | 'edit';
export type DownloadType = 'torrent' | 'usenet' | 'webdl';
export interface Activity {
  id: string;
  ts: string;
  kind: ActivityKind;
  keyId: string | null;
  keyName: string | null;
  clientId: string | null;
  clientName: string | null;
  upstreamAccountId: string | null;
  type: DownloadType | null;
  publicId: string | null;
  torboxId: number | string | null;
  hash: string | null;
  name: string | null;
  input?: { magnet?: string; url?: string; fileName?: string; fileSize?: number; nzbUrl?: string; password?: string } | null;
  output?: { cdnUrl?: string; fileId?: string | number; zip?: boolean; permalink?: string; hlsUrl?: string; expiresAt?: string } | null;
  action?: string | null;
  success: boolean;
  error: string | null;
  detail: string | Record<string, unknown> | null;
  ip: string | null;
}
export interface ActivityFilters {
  kind?: string;
  keyId?: string;
  clientId?: string;
  publicId?: string;
  type?: string;
  hash?: string;
  from?: string;
  to?: string;
  q?: string;
}

export interface UsageSeriesItem {
  key: string;
  label: string;
  requests: number;
  errors: number;
  cacheHits: number;
  submits: number;
  links: number;
}
export interface QuotaItem {
  keyId: string;
  keyName: string;
  clientName: string;
  monthRequests: number;
  quotaRequests: number;
  monthCreates: number;
  quotaCreates: number;
  pct: number;
}
export interface UpstreamUsage {
  series: Array<{ d: string; requests: number; uncachedCreates: number; usenetCreates: number; webdlCreates: number }>;
  caps: Record<string, number>;
}

export interface DownloadFile {
  id: number | string;
  name: string;
  shortName: string;
  size: number;
  mimetype: string | null;
  zipped: boolean;
}
export interface Download {
  publicId: string;
  type: DownloadType;
  torboxId: number | string;
  upstreamAccountId: string;
  name: string;
  hash: string | null;
  size: number;
  state: string;
  rawState: string;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  eta: number | null;
  seeds: number | null;
  peers: number | null;
  ratio: number | null;
  cached: boolean;
  active: boolean;
  downloadFinished: boolean;
  downloadPresent: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  files: DownloadFile[];
  tags: string[];
  createdByKeyId: string | null;
  createdByKeyName: string | null;
  /** Set when the item is known to the gateway index but no longer exists upstream. */
  missing?: boolean;
  upstreamLabel?: string;
}
export interface DownloadDetail {
  download: Download;
  index?: { firstSeenAt: string | null; lastSeenAt: string | null; deletedAt: string | null; createdByKeyName: string | null };
  history: Activity[];
}
export interface StreamInfo {
  hlsUrl: string;
  presignedToken: string | null;
  needsTranscoding: boolean | null;
  isTranscoding: boolean | null;
  metadata: unknown;
  name: string | null;
  mimetype: string | null;
}
export type DownloadAction = 'delete' | 'reannounce' | 'resume' | 'pause' | 'stop_seeding' | 'start';

export interface WebhookEndpoint {
  id: string;
  clientId: string;
  clientName: string;
  keyId: string | null;
  url: string;
  events: string[];
  active: boolean;
  failureCount: number;
  disabledReason: string | null;
  lastDeliveryAt: string | null;
  createdAt: string;
}
export interface WebhookDelivery {
  id: string;
  endpointId: string;
  event: string;
  status: 'pending' | 'delivered' | 'failed' | 'dead';
  attempts: number;
  nextAttemptAt: string | null;
  lastResponse: { status: number; body: string } | null;
  payload?: unknown;
  createdAt: string;
  deliveredAt: string | null;
}
export interface InboundWebhookStatus {
  byAccount: Array<{ accountId: string; label: string; configured: boolean; url: string; lastReceivedAt: string | null; received24h: number; parseFailures24h: number }>;
  recent: Array<{ id: string; ts: string; accountId: string; parsed: boolean; eventType: string | null; raw: unknown }>;
}

export interface GatewayEvent {
  id: string;
  ts: string;
  type: string;
  publicId: string | null;
  downloadName: string | null;
  upstreamAccountId: string | null;
  payload: unknown;
  source: 'webhook' | 'reconciler';
}

export interface CacheStats {
  entries: number;
  bytes: number;
  hitRate24h: number;
  byGroup: Array<{ group: string; entries: number; hits: number; misses: number }>;
}

export interface Settings {
  branding: { name: string; tagline: string; logoUrl: string; accentColor: string; supportEmail: string };
  homepage: { showPublicStats: boolean; sections: Record<string, boolean>; customIntro: string };
  cors: { allowedOrigins: string[] };
  maintenance: { enabled: boolean; message: string; readOnly: boolean };
  retention: { requestLogsDays: number; activityDays: number; eventsDays: number; webhookDeliveriesDays: number };
  privacy: { storeFullQuery: boolean; truncateIps: boolean };
  alerts: { webhookUrl: string; thresholds: { errorRatePct: number; budgetHeadroomPct: number; premiumExpiringDays: number; quotaPct: number } };
  docs: { public: boolean };
  /** Read-only: the homepage section ids the server knows about. */
  homepageSections?: string[];
}

export interface AuditEntry {
  id: string;
  ts: string;
  adminId: string;
  adminEmail: string;
  action: string;
  target: string | null;
  before: unknown;
  after: unknown;
  ip: string;
}

export interface PlaygroundRequest {
  keyId: string;
  method: string;
  path: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
}
export interface PlaygroundResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
  curl: string;
}

export interface SystemInfo {
  version: string;
  uptimeSec: number;
  node: string;
  env: string;
  publicBaseUrl?: string;
  upstreamBase?: string;
  memoryMb?: number;
  mongo: { ok: boolean; latencyMs?: number; error?: string; collections?: Array<{ name: string; count: number; storageBytes: number }> };
  jobs: Array<{ name: string; everySec?: number; lastRunAt: string | null; lastStatus: string | null; lastDurationMs: number | null; lastError?: string | null; lastResult?: unknown; nextDueAt: string | null; lockedBy: string | null }>;
  upstreamHealth: Array<{ accountId: string; label: string; ok: boolean; latencyMs: number; ts: string; detail?: string | null }>;
  inProcessJobs: boolean;
}

export interface PublicConfig {
  branding: Partial<Settings['branding']>;
  homepage: Partial<Settings['homepage']>;
  docsPublic: boolean;
  baseUrl: string;
  version: string;
}
export interface PublicStats {
  requestsTotal: number;
  downloadsCreated: number;
  uptimeSec: number;
}
export interface PublicStatus {
  success: boolean;
  data: { gateway: string; upstream: { ok: boolean; latencyMs: number; checkedAt: string }; budgetHeadroomPct: number };
}
