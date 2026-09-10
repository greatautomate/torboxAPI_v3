import type { Config } from './config.js';
import type { Database } from './db.js';
import type { TorboxClient } from './torbox/client.js';
import type { SettingsService } from './services/settings.js';
import type { KeyService, ApiKey, Policy, Client } from './services/keys.js';
import type { RateLimiter } from './services/rateLimiter.js';
import type { CacheService } from './services/cache.js';
import type { UpstreamService, UpstreamAccount } from './services/upstreams.js';
import type { LogService } from './services/logging.js';
import type { AuditService, AlertService } from './services/audit.js';
import type { DownloadService } from './services/downloads.js';
import type { WebhookService } from './services/webhooks.js';

export type Services = {
  cfg: Config; db: Database; torbox: TorboxClient; settings: SettingsService; keys: KeyService; limiter: RateLimiter; cache: CacheService;
  upstreams: UpstreamService; logs: LogService; audit: AuditService; alerts: AlertService; downloads: DownloadService; webhooks: WebhookService;
  startedAt: number;
};
export type ConsumerCtx = { key: ApiKey; policy: Policy; client: Client; upstream: UpstreamAccount; upstreamKey: string; ip: string };
export type AdminCtx = { id: string; email: string; role: 'owner' | 'admin' | 'viewer'; sessionId: string; mustChangePassword: boolean; totpEnabled: boolean };

declare module 'fastify' {
  interface FastifyInstance { svc: Services }
  interface FastifyRequest { consumer?: ConsumerCtx; admin?: AdminCtx; startedAt: number; cacheHit: boolean; upstreamMs: number | null; upstreamStatus: number | null; torboxError: string | null; surface: 'compat' | 'v1' | 'permalink' | 'stream' | 'public'; skipLog?: boolean }
}
