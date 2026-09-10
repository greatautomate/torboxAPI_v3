import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fail } from '../shared/errors.js';
import { hasScope } from '../shared/scopes.js';
import { ipAllowed } from '../services/keys.js';
import type { LimiterClass } from '../torbox/routeTable.js';
import type { ConsumerCtx } from '../context.js';

export type AuthOpts = { scope: string | string[] | null; allowQueryToken?: boolean; skipMaintenance?: boolean };
export type LimitOpts = { limiter: LimiterClass; uncached?: boolean; isCreate?: boolean };

export function clientIp(req: FastifyRequest): string {
  const xf = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return (xf || req.ip || '').replace(/^::ffff:/, '');
}
export function extractToken(req: FastifyRequest, allowQuery: boolean): string | null {
  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const x = req.headers['x-api-key'];
  if (typeof x === 'string' && x) return x.trim();
  if (allowQuery) { const q = req.query as Record<string, any>; const t = q?.token ?? q?.api_key; if (typeof t === 'string' && t) return t; }
  return null;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Authenticate a gateway key; on failure sends the TorBox-style error envelope and returns null. */
    authenticateConsumer(req: FastifyRequest, reply: FastifyReply, opts: AuthOpts): Promise<ConsumerCtx | null>;
    /** Consume per-key, quota and global upstream budgets; sends 429 and returns false when exceeded. */
    consumeLimits(req: FastifyRequest, reply: FastifyReply, opts: LimitOpts): Promise<boolean>;
  }
}

export function registerConsumerAuth(app: FastifyInstance) {
  const svc = app.svc;

  app.decorate('authenticateConsumer', async function (req: FastifyRequest, reply: FastifyReply, opts: AuthOpts): Promise<ConsumerCtx | null> {
    const settings = await svc.settings.get();
    if (settings.maintenance.enabled && !opts.skipMaintenance) { reply.code(503).header('retry-after', '120').send(fail('MAINTENANCE', settings.maintenance.message)); return null; }
    const token = extractToken(req, !!opts.allowQueryToken);
    if (!token) { reply.code(403).send(fail('NO_AUTH', 'Please provide a valid gateway API key (Authorization: Bearer tbg_...).')); return null; }
    const auth = await svc.keys.authenticate(token);
    if ('error' in auth) { reply.code(403).send(fail(auth.error, auth.detail)); return null; }
    const ip = clientIp(req);
    if (!ipAllowed(ip, auth.key.allowedIps)) { reply.code(403).send(fail('IP_NOT_ALLOWED', 'This gateway API key cannot be used from your IP address.')); return null; }
    if (!hasScope(auth.key.scopes, opts.scope)) { reply.code(403).send(fail('SCOPE_DENIED', `This key lacks the required scope: ${Array.isArray(opts.scope) ? opts.scope.join(' or ') : opts.scope}.`, { required: opts.scope, granted: auth.key.scopes })); return null; }
    const upstream = await svc.upstreams.get(auth.key.upstreamAccountId);
    if (!upstream || upstream.status === 'disabled') { reply.code(503).send(fail('UPSTREAM_DISABLED', 'The upstream TorBox account for this key is disabled. Contact the operator.')); return null; }
    const ctx: ConsumerCtx = { key: auth.key, policy: auth.policy, client: auth.client, upstream, upstreamKey: svc.upstreams.decryptKey(upstream), ip };
    req.consumer = ctx;
    svc.keys.touch(auth.key._id, ip);
    return ctx;
  });

  app.decorate('consumeLimits', async function (req: FastifyRequest, reply: FastifyReply, opts: LimitOpts): Promise<boolean> {
    const c = req.consumer!; const keyId = c.key._id.toHexString(); const acc = c.upstream._id.toHexString();
    const L = c.policy.limits; const U = c.upstream.limits;
    const items = [
      { subject: `key:${keyId}`, window: 'minute' as const, limit: L.perMinute, name: 'perMinute' },
      { subject: `key:${keyId}`, window: 'hour' as const, limit: L.perHour, name: 'perHour' },
      { subject: `key:${keyId}`, window: 'day' as const, limit: L.perDay, name: 'perDay' },
      { subject: `upstream:${acc}`, window: 'minute' as const, limit: U.perMinute, name: 'upstreamPerMinute' },
    ];
    const isCreate = opts.isCreate || ['createTorrent', 'createUsenet', 'createWebdl'].includes(opts.limiter);
    if (isCreate) {
      items.push({ subject: `key:${keyId}:create`, window: 'hour', limit: L.createPerHour, name: 'createPerHour' });
      if (opts.limiter === 'createTorrent' && opts.uncached) { items.push({ subject: `key:${keyId}:uncached`, window: 'hour', limit: L.createUncachedPerHour, name: 'createUncachedPerHour' }); items.push({ subject: `upstream:${acc}:uncached`, window: 'hour', limit: U.createUncachedPerHour, name: 'upstreamUncachedPerHour' }); }
      if (opts.limiter === 'createUsenet') items.push({ subject: `upstream:${acc}:usenet`, window: 'hour', limit: U.createUsenetPerHour, name: 'upstreamUsenetPerHour' });
      if (opts.limiter === 'createWebdl') items.push({ subject: `upstream:${acc}:webdl`, window: 'hour', limit: U.createWebdlPerHour, name: 'upstreamWebdlPerHour' });
    }
    if (opts.limiter === 'testNotification') items.push({ subject: `upstream:${acc}:testnotif`, window: 'minute', limit: 1, name: 'testNotificationPerMinute' });
    // monthly quotas
    const Q = c.policy.quotas;
    if (Q.monthlyRequests > 0 || (isCreate && Q.monthlyCreates > 0)) {
      const u = await svc.logs.monthlyUsage(c.key._id);
      if (Q.monthlyRequests > 0 && u.requests >= Q.monthlyRequests) { reply.code(429).send(fail('QUOTA_EXCEEDED', `Monthly request quota of ${Q.monthlyRequests} exhausted for this key.`, { scope: 'quota', used: u.requests, limit: Q.monthlyRequests })); return false; }
      if (isCreate && Q.monthlyCreates > 0 && u.creates >= Q.monthlyCreates) { reply.code(429).send(fail('QUOTA_EXCEEDED', `Monthly create quota of ${Q.monthlyCreates} exhausted for this key.`, { scope: 'quota', used: u.creates, limit: Q.monthlyCreates })); return false; }
    }
    const r = await svc.limiter.consumeAll(items);
    const minute = r.checks.find((x) => x.name === 'perMinute');
    if (minute && minute.limit > 0) reply.header('x-ratelimit-limit', String(minute.limit)).header('x-ratelimit-remaining', String(Math.max(0, minute.limit - minute.used))).header('x-ratelimit-reset', String(Math.ceil(minute.resetAt.getTime() / 1000)));
    if (!r.ok) {
      const f = r.failed; const retry = Math.max(1, Math.ceil((f.resetAt.getTime() - Date.now()) / 1000));
      const scope = f.name.startsWith('upstream') ? 'global' : 'key';
      reply.code(429).header('retry-after', String(retry)).send(fail('RATE_LIMIT', `${scope === 'global' ? 'The shared upstream budget' : 'This key\'s rate limit'} (${f.name}: ${f.limit}/${f.window}) is exhausted. Retry in ${retry}s.`, { scope, limit: f.name, resetAt: f.resetAt.toISOString() }));
      return false;
    }
    return true;
  });
}
