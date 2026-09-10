import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectId } from 'mongodb';
import { loadConfig, type Config } from './config.js';
import { COLLECTIONS, Database } from './db.js';
import { TorboxClient } from './torbox/client.js';
import { SettingsService } from './services/settings.js';
import { KeyService } from './services/keys.js';
import { RateLimiter } from './services/rateLimiter.js';
import { CacheService } from './services/cache.js';
import { UpstreamService } from './services/upstreams.js';
import { LogService, redactQuery, truncateIp } from './services/logging.js';
import { AlertService, AuditService } from './services/audit.js';
import { DownloadService } from './services/downloads.js';
import { WebhookService } from './services/webhooks.js';
import type { Services } from './context.js';
import { registerConsumerAuth, clientIp } from './plugins/consumerAuth.js';
import { registerAdminAuth, type AdminDoc } from './plugins/adminAuth.js';
import { hashPassword } from './crypto.js';
import { fail } from './shared/errors.js';
import compatRoutes from './routes/compat/index.js';
import v1Routes from './routes/v1/index.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin/index.js';
import { JobRunner } from './jobs/index.js';
import { buildOpenApi } from './openapi/build.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function buildServices(cfg: Config = loadConfig()): Promise<Services> {
  const db = await new Database(cfg).connect();
  const torbox = new TorboxClient(cfg.TORBOX_API_BASE, cfg.UPSTREAM_TIMEOUT_MS, `torbox-gateway/${cfg.version} (+${cfg.publicBaseUrl})`);
  const settings = new SettingsService(db);
  const keys = new KeyService(db); const limiter = new RateLimiter(db); const cache = new CacheService(db);
  const upstreams = new UpstreamService(db, cfg, torbox); const logs = new LogService(db);
  const audit = new AuditService(db); const alerts = new AlertService(db, async () => (await settings.get()).alerts.webhookUrl);
  const downloads = new DownloadService(db, cfg, torbox, cache, upstreams, logs);
  const webhooks = new WebhookService(db, cfg, downloads, upstreams, logs);
  return { cfg, db, torbox, settings, keys, limiter, cache, upstreams, logs, audit, alerts, downloads, webhooks, startedAt: Date.now() };
}

/** First-boot bootstrap: default policy, owner admin, upstream account from env, default client. Idempotent. */
export async function bootstrap(svc: Services, log: { info: (o: any, m?: string) => void; warn: (o: any, m?: string) => void }) {
  const settings = await svc.settings.get(true);
  await svc.db.ensureIndexes(settings.retention);
  await svc.keys.ensureDefaultPolicy();
  const admins = svc.db.col<AdminDoc>(COLLECTIONS.admins);
  if ((await admins.countDocuments()) === 0) {
    if (svc.cfg.ADMIN_BOOTSTRAP_EMAIL && svc.cfg.ADMIN_BOOTSTRAP_PASSWORD) {
      const now = new Date();
      await admins.insertOne({ _id: new ObjectId(), email: svc.cfg.ADMIN_BOOTSTRAP_EMAIL.toLowerCase(), passwordHash: hashPassword(svc.cfg.ADMIN_BOOTSTRAP_PASSWORD), role: 'owner', totpSecretEnc: null, totpEnabled: false, mustChangePassword: true, disabled: false, lastLoginAt: null, createdAt: now, updatedAt: now });
      log.info({ email: svc.cfg.ADMIN_BOOTSTRAP_EMAIL }, 'bootstrap: owner admin created (password change required on first login)');
    } else log.warn({}, 'bootstrap: no admins exist and ADMIN_BOOTSTRAP_EMAIL/PASSWORD are not set — the dashboard cannot be used');
  }
  if (svc.cfg.TORBOX_API_KEY && (await svc.upstreams.list()).length === 0) {
    try { const a = await svc.upstreams.create('Primary TorBox account', svc.cfg.TORBOX_API_KEY); log.info({ label: a.label, plan: a.plan }, 'bootstrap: upstream TorBox account registered from TORBOX_API_KEY (you may now remove the env var)'); }
    catch (e: any) { log.warn({ err: e?.message }, 'bootstrap: could not register TORBOX_API_KEY'); await svc.alerts.raise({ severity: 'critical', type: 'upstream.bootstrap', title: 'TORBOX_API_KEY was rejected', message: String(e?.message), dedupeKey: 'upstream.bootstrap' }); }
  }
  if ((await svc.keys.clients().countDocuments()) === 0) { const now = new Date(); await svc.keys.clients().insertOne({ _id: new ObjectId(), name: 'Default client', contactEmail: '', notes: 'Created automatically on first boot', status: 'active', defaultPolicyId: null, createdAt: now, updatedAt: now }); }
}

export async function buildApp(svc: Services, opts: { serveStatic?: boolean; jobs?: boolean } = {}): Promise<FastifyInstance> {
  const cfg = svc.cfg;
  const app = Fastify({ logger: { level: cfg.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie'] }, trustProxy: cfg.TRUST_PROXY, bodyLimit: cfg.MAX_UPLOAD_MB * 1024 * 1024 + 1024 * 1024, genReqId: () => `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, disableRequestLogging: cfg.NODE_ENV === 'production' });
  app.decorate('svc', svc);
  app.decorateRequest('consumer', undefined); app.decorateRequest('admin', undefined);
  app.decorateRequest('startedAt', 0); app.decorateRequest('cacheHit', false); app.decorateRequest('upstreamMs', null); app.decorateRequest('upstreamStatus', null); app.decorateRequest('torboxError', null); app.decorateRequest('surface', 'public'); app.decorateRequest('skipLog', false);

  await app.register(cookie, { secret: cfg.SESSION_SECRET });
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(cors, {
    origin: async (origin: string | undefined) => { if (!origin) return true; const s = await svc.settings.get(); if (s.cors.allowedOrigins.includes('*') || s.cors.allowedOrigins.includes(origin) || origin === cfg.publicBaseUrl) return true; return true; /* per-key origin checks happen in consumer auth; browsers still need the header */ },
    credentials: false, exposedHeaders: ['x-tbg-request-id', 'x-tbg-cache', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after'], methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['authorization', 'content-type', 'x-api-key', 'x-tbg-csrf', 'accept'],
  });
  registerConsumerAuth(app); registerAdminAuth(app);

  app.addHook('onRequest', async (req) => { req.startedAt = Date.now(); });
  app.addHook('onResponse', async (req, reply) => {
    if (req.skipLog || !req.consumer || !['compat', 'v1', 'permalink', 'stream'].includes(req.surface)) return;
    const s = await svc.settings.get(); const c = req.consumer;
    const url = new URL(req.url, 'http://x');
    const route = (req.routeOptions?.url || url.pathname).replace(/^\/v1\/api\/\*$/, url.pathname);
    svc.logs.logRequest({ ts: new Date(req.startedAt), requestId: String(req.id), keyId: c.key._id, keyName: c.key.name, clientId: c.client._id, clientName: c.client.name, upstreamAccountId: c.upstream._id.toHexString(), method: req.method, route, path: url.pathname, query: redactQuery(url.searchParams, s.privacy.storeFullQuery), status: reply.statusCode, upstreamStatus: req.upstreamStatus, torboxError: req.torboxError, success: reply.statusCode < 400, latencyMs: Date.now() - req.startedAt, upstreamLatencyMs: req.upstreamMs, cacheHit: req.cacheHit, ip: truncateIp(c.ip, s.privacy.truncateIps), userAgent: String(req.headers['user-agent'] || '').slice(0, 200), reqBytes: Number(req.headers['content-length'] || 0), resBytes: Number(reply.getHeader('content-length') || 0), surface: req.surface as any }).catch(() => {});
  });
  app.setErrorHandler((err: any, req, reply) => {
    if (err?.validation || err?.name === 'ZodError') return reply.code(400).send(req.url.startsWith('/admin/api') ? { ok: false, error: 'VALIDATION', message: err.issues ? err.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ') : err.message } : fail('INVALID_OPTION', err.issues ? err.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ') : err.message));
    if (err?.statusCode === 413) return reply.code(413).send(fail('TOO_MUCH_DATA', `Request body too large (max ${cfg.MAX_UPLOAD_MB} MB).`));
    const status = err?.status || err?.statusCode || 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    if (req.url.startsWith('/admin/api')) return reply.code(status).send({ ok: false, error: err?.code || (status >= 500 ? 'INTERNAL' : 'ERROR'), message: status >= 500 && cfg.NODE_ENV === 'production' ? 'Internal error' : err?.message });
    return reply.code(status).send(fail(err?.code || (status >= 500 ? 'GATEWAY_ERROR' : 'ERROR'), status >= 500 && cfg.NODE_ENV === 'production' ? 'Internal gateway error' : err?.message, err?.data ?? null));
  });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/v1/')) return reply.code(404).send(fail('ENDPOINT_NOT_FOUND', `No route for ${req.method} ${req.url.split('?')[0]}`));
    if (req.url.startsWith('/admin/api')) return reply.code(404).send({ ok: false, error: 'NOT_FOUND', message: 'Unknown admin endpoint' });
    const dist = webDist(cfg);
    if (dist && req.method === 'GET') return reply.type('text/html').send(readFileSync(join(dist, 'index.html')));
    return reply.code(404).send({ ok: false, error: 'NOT_FOUND', message: 'Frontend build not found. Run `npm run build`.' });
  });

  await app.register(publicRoutes);
  await app.register(compatRoutes);
  await app.register(v1Routes);
  await app.register(adminRoutes, { prefix: '/admin/api' });
  await app.register(swagger, { mode: 'static', specification: { document: buildOpenApi(cfg.publicBaseUrl, 'TorBox Gateway', cfg.version) as any } } as any);
  await app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list', deepLinking: true, persistAuthorization: true } });

  const dist = webDist(cfg);
  if (dist && opts.serveStatic !== false) {
    await app.register(fastifyStatic, { root: dist, prefix: '/', wildcard: false, index: ['index.html'], maxAge: '1h', immutable: false, decorateReply: false, setHeaders: (res, path) => { if (/\/assets\//.test(path)) res.setHeader('cache-control', 'public, max-age=31536000, immutable'); } });
    app.log.info({ dist }, 'serving frontend');
  } else app.log.warn('frontend dist not found; homepage/admin UI unavailable');

  if (opts.jobs ?? cfg.RUN_JOBS_IN_PROCESS) { const runner = new JobRunner(svc); (app as any).jobRunner = runner; app.addHook('onReady', async () => runner.start()); app.addHook('onClose', async () => runner.stop()); }
  else (app as any).jobRunner = new JobRunner(svc);
  return app;
}

export function webDist(cfg: Config): string | null {
  const candidates = [cfg.WEB_DIST, resolve(here, '../../web/dist'), resolve(process.cwd(), 'apps/web/dist')].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(join(p, 'index.html'))) || null;
}
export { clientIp };
