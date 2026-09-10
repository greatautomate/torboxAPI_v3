import type { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { COLLECTIONS } from '../../db.js';
import { clientIp } from '../../plugins/consumerAuth.js';
import { EVENT_TYPES } from '../../services/webhooks.js';
import { DL_TYPES, type DlType } from '../../services/downloads.js';
import { PLAN_NAMES } from '../../torbox/client.js';
import { HOMEPAGE_SECTIONS } from '../../services/settings.js';
import { okr, pageParams, httpError } from './index.js';

const oid = (s: string) => { try { return new ObjectId(s); } catch { throw httpError(400, 'BAD_ID', 'Invalid id'); } };

export default async function opsRoutes(app: FastifyInstance) {
  const svc = app.svc;
  const audit = (req: any, action: string, target?: string, before?: any, after?: any) => svc.audit.record({ adminId: req.admin!.id, adminEmail: req.admin!.email, action, target, before, after, ip: clientIp(req) });
  const adminActor = (req: any) => ({ keyId: null, keyName: `admin:${req.admin!.email}`, clientId: null, clientName: 'admin', ip: clientIp(req), requestId: String(req.id) });

  // ---- overview ----
  app.get('/overview', { preHandler: app.requireAdmin() }, async (req) => {
    const hours = Math.min(24 * 30, Math.max(1, Number((req.query as any).hours) || 24)); const since = new Date(Date.now() - hours * 3600e3);
    const logs = svc.db.col<any>(COLLECTIONS.requestLogs);
    const [agg, hourly, topKeys, topRoutes, errorCodes, lat, activeKeys, clients, acts, accounts, unread] = await Promise.all([
      logs.aggregate([{ $match: { ts: { $gte: since } } }, { $group: { _id: null, n: { $sum: 1 }, err: { $sum: { $cond: ['$success', 0, 1] } }, hits: { $sum: { $cond: ['$cacheHit', 1, 0] } }, lat: { $avg: '$latencyMs' } } }]).toArray(),
      logs.aggregate([{ $match: { ts: { $gte: since } } }, { $group: { _id: { $dateTrunc: { date: '$ts', unit: hours > 72 ? 'day' : 'hour' } }, ok: { $sum: { $cond: ['$success', 1, 0] } }, error: { $sum: { $cond: ['$success', 0, 1] } }, cached: { $sum: { $cond: ['$cacheHit', 1, 0] } } } }, { $sort: { _id: 1 } }]).toArray(),
      logs.aggregate([{ $match: { ts: { $gte: since }, keyId: { $ne: null } } }, { $group: { _id: '$keyId', name: { $last: '$keyName' }, clientName: { $last: '$clientName' }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]).toArray(),
      logs.aggregate([{ $match: { ts: { $gte: since } } }, { $group: { _id: '$route', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]).toArray(),
      logs.aggregate([{ $match: { ts: { $gte: since }, torboxError: { $ne: null } } }, { $group: { _id: '$torboxError', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 12 }]).toArray(),
      logs.find({ ts: { $gte: since } }, { projection: { latencyMs: 1 } }).sort({ latencyMs: -1 }).limit(2000).toArray(),
      svc.keys.keys().countDocuments({ status: 'active' }), svc.keys.clients().countDocuments({}),
      svc.db.col<any>(COLLECTIONS.activity).aggregate([{ $match: { ts: { $gte: since }, success: true } }, { $group: { _id: '$kind', n: { $sum: 1 } } }]).toArray(),
      svc.upstreams.list(), svc.alerts.unreadCount(),
    ]);
    const a = agg[0]; const n = a?.n || 0; const p95 = lat.length ? lat[Math.floor(lat.length * 0.05)]?.latencyMs ?? 0 : 0;
    const upstream = await Promise.all(accounts.map(async (acc) => { const id = acc._id.toHexString(); const [m, u, us, w] = await Promise.all([svc.limiter.peek(`upstream:${id}`, 'minute', acc.limits.perMinute), svc.limiter.peek(`upstream:${id}:uncached`, 'hour', acc.limits.createUncachedPerHour), svc.limiter.peek(`upstream:${id}:usenet`, 'hour', acc.limits.createUsenetPerHour), svc.limiter.peek(`upstream:${id}:webdl`, 'hour', acc.limits.createWebdlPerHour)]); const b = (p: any) => ({ used: p.used, limit: p.limit }); return { id, label: acc.label, status: acc.status, plan: acc.plan, planName: acc.plan == null ? null : PLAN_NAMES[acc.plan], premiumExpiresAt: acc.premiumExpiresAt, lastVerifiedAt: acc.lastVerifiedAt, lastError: acc.lastError, budgets: { perMinute: b(m), uncachedPerHour: b(u), usenetPerHour: b(us), webdlPerHour: b(w) } }; }));
    return okr({ hours, kpis: { requests: n, errors: a?.err || 0, errorRate: n ? Math.round(((a?.err || 0) / n) * 1000) / 10 : 0, cacheHitRate: n ? Math.round(((a?.hits || 0) / n) * 1000) / 10 : 0, p95LatencyMs: Math.round(p95), avgLatencyMs: Math.round(a?.lat || 0), activeKeys, clients, submits: acts.find((x) => x._id === 'submit')?.n || 0, links: acts.find((x) => x._id === 'link')?.n || 0, streams: acts.find((x) => x._id === 'stream')?.n || 0 }, upstream, series: { hourly: hourly.map((h) => ({ t: h._id, ok: h.ok, error: h.error, cached: h.cached })), topKeys: topKeys.map((k) => ({ keyId: k._id?.toHexString?.(), name: k.name, clientName: k.clientName, count: k.count })), topRoutes: topRoutes.map((r) => ({ route: r._id, count: r.count })), errorCodes: errorCodes.map((e) => ({ code: e._id, count: e.count })) }, alerts: { unread } });
  });

  // ---- downloads (unified upstream view) ----
  app.get('/downloads', { preHandler: app.requireAdmin() }, async (req) => {
    const q = req.query as any; const { page, limit } = pageParams(q);
    const accounts = q.upstreamId ? [await svc.upstreams.get(oid(q.upstreamId))].filter(Boolean) : await svc.upstreams.list();
    const types = q.type ? String(q.type).split(',').filter((t): t is DlType => DL_TYPES.includes(t as DlType)) : DL_TYPES;
    let all: any[] = []; const errors: any = {};
    for (const acc of accounts) { if (!acc || acc.status === 'disabled') continue; const r = await svc.downloads.list(acc, { types, state: q.state, q: q.q, bypassCache: q.live === 'true', createdByKeyId: q.keyId, limit: 1000 }); all = all.concat(r.items.map((d) => ({ ...d, upstreamLabel: acc.label }))); Object.assign(errors, Object.fromEntries(Object.entries(r.errors).map(([k, v]) => [`${acc.label}:${k}`, v]))); }
    all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return okr({ items: all.slice((page - 1) * limit, page * limit), total: all.length, page, limit, errors });
  });
  app.get('/downloads/:publicId', { preHandler: app.requireAdmin() }, async (req) => {
    const idx = await svc.downloads.resolve((req.params as any).publicId); if (!idx) throw httpError(404, 'NOT_FOUND', 'Download not found');
    const acc = await svc.upstreams.get(idx.upstreamAccountId); const download = acc ? await svc.downloads.getOne(acc, idx, true) : null;
    const history = await svc.db.col<any>(COLLECTIONS.activity).find({ publicId: idx.publicId }).sort({ ts: -1 }).limit(500).toArray();
    return okr({ download: download || { publicId: idx.publicId, type: idx.type, torboxId: idx.torboxId, upstreamAccountId: idx.upstreamAccountId, name: idx.name, hash: idx.hash, size: 0, state: idx.deletedAt ? 'deleted' : 'unknown', rawState: idx.deletedAt ? 'deleted' : 'unknown', progress: 0, downloadSpeed: 0, uploadSpeed: 0, eta: null, seeds: null, peers: null, ratio: null, cached: false, active: false, downloadFinished: false, downloadPresent: false, expiresAt: null, createdAt: idx.firstSeenAt, updatedAt: idx.lastSeenAt, files: [], tags: [], missing: true, createdByKeyId: idx.createdByKeyId?.toHexString() ?? null, createdByKeyName: idx.createdByKeyName }, index: { firstSeenAt: idx.firstSeenAt, lastSeenAt: idx.lastSeenAt, deletedAt: idx.deletedAt ?? null, createdByKeyName: idx.createdByKeyName }, history: history.map((h) => ({ ...h, id: h._id.toHexString(), _id: undefined, keyId: h.keyId?.toHexString?.() ?? null, clientId: h.clientId?.toHexString?.() ?? null })) });
  });
  app.post('/downloads/:publicId/action', { preHandler: app.requireAdmin('admin') }, async (req, reply) => {
    const b = z.object({ action: z.enum(['delete', 'reannounce', 'resume', 'pause', 'stop_seeding']) }).parse(req.body || {});
    const idx = await svc.downloads.resolve((req.params as any).publicId); if (!idx) throw httpError(404, 'NOT_FOUND', 'Download not found'); const acc = await svc.upstreams.get(idx.upstreamAccountId); if (!acc) throw httpError(404, 'NOT_FOUND', 'Upstream not found');
    const r = await svc.downloads.control(acc, adminActor(req), idx, b.action); await audit(req, `downloads.${b.action}`, idx.publicId, null, { name: idx.name, success: r.success });
    return r.success ? okr({ detail: r.detail }) : reply.code(400).send({ ok: false, error: r.error, message: r.detail });
  });
  app.post('/downloads/:publicId/link', { preHandler: app.requireAdmin('admin') }, async (req, reply) => {
    const b = z.object({ fileId: z.number().int().min(0).optional(), zip: z.boolean().optional() }).parse(req.body || {});
    const idx = await svc.downloads.resolve((req.params as any).publicId); if (!idx) throw httpError(404, 'NOT_FOUND', 'Download not found'); const acc = await svc.upstreams.get(idx.upstreamAccountId); if (!acc) throw httpError(404, 'NOT_FOUND', 'Upstream not found');
    const r = await svc.downloads.requestLink(acc, adminActor(req), idx, { fileId: b.fileId, zip: b.zip, via: 'api' });
    return r.success ? okr({ url: r.data, expiresAt: new Date(Date.now() + 3 * 3600e3) }) : reply.code(400).send({ ok: false, error: r.error, message: r.detail });
  });
  app.post('/downloads/:publicId/stream', { preHandler: app.requireAdmin('admin') }, async (req, reply) => {
    const b = z.object({ fileId: z.number().int().min(0).optional(), audio: z.number().int().optional(), subtitle: z.number().int().optional(), resolution: z.number().int().optional() }).parse(req.body || {});
    const idx = await svc.downloads.resolve((req.params as any).publicId); if (!idx) throw httpError(404, 'NOT_FOUND', 'Download not found'); const acc = await svc.upstreams.get(idx.upstreamAccountId); if (!acc) throw httpError(404, 'NOT_FOUND', 'Upstream not found');
    const r = await svc.downloads.createStream(acc, adminActor(req), idx, { fileId: b.fileId, audio: b.audio, subtitle: b.subtitle, resolution: b.resolution });
    await audit(req, 'downloads.stream', idx.publicId, null, { fileId: b.fileId, success: r.success });
    if (!r.success || !r.data?.hls_url) return reply.code(r.error === 'PLAN_RESTRICTED_FEATURE' ? 402 : 400).send({ ok: false, error: r.error || 'UPSTREAM_ERROR', message: r.detail });
    const d = r.data; return okr({ hlsUrl: d.hls_url, presignedToken: d.presigned_token ?? null, needsTranscoding: d.needs_transcoding ?? null, isTranscoding: d.is_transcoding ?? null, metadata: d.metadata ?? null, name: d.name ?? idx.name, mimetype: d.mimetype ?? null });
  });
  app.post('/downloads/bulk-delete', { preHandler: app.requireAdmin('admin') }, async (req) => {
    const b = z.object({ upstreamId: z.string(), olderThanDays: z.number().int().min(0).optional(), createdByKeyId: z.string().optional(), state: z.string().optional(), type: z.enum(['torrent', 'usenet', 'webdl']).optional(), dryRun: z.boolean().optional() }).parse(req.body || {});
    const acc = await svc.upstreams.get(oid(b.upstreamId)); if (!acc) throw httpError(404, 'NOT_FOUND', 'Upstream not found');
    const r = await svc.downloads.list(acc, { types: b.type ? [b.type] : undefined, state: b.state, createdByKeyId: b.createdByKeyId, limit: 1000, bypassCache: true });
    const cutoff = b.olderThanDays != null ? Date.now() - b.olderThanDays * 86400e3 : null;
    const targets = r.items.filter((d) => cutoff == null || (d.createdAt && new Date(d.createdAt).getTime() < cutoff));
    if (b.dryRun) return okr({ matched: targets.length, items: targets.slice(0, 50).map((d) => ({ publicId: d.publicId, name: d.name, type: d.type, createdAt: d.createdAt })) });
    let deleted = 0; for (const d of targets) { const idx = await svc.downloads.resolve(d.publicId); if (!idx) continue; const rr = await svc.downloads.control(acc, adminActor(req), idx, 'delete'); if (rr.success) deleted++; }
    await audit(req, 'downloads.bulk_delete', acc._id.toHexString(), null, { ...b, deleted }); return okr({ deleted, matched: targets.length });
  });

  // ---- webhooks ----
  const epDto = async (e: any) => ({ id: e._id.toHexString(), clientId: e.clientId.toHexString(), clientName: (await svc.keys.clients().findOne({ _id: e.clientId }, { projection: { name: 1 } }))?.name || '(deleted)', keyId: e.keyId?.toHexString() ?? null, url: e.url, events: e.events, active: e.active, failureCount: e.failureCount, disabledReason: e.disabledReason, lastDeliveryAt: e.lastDeliveryAt, createdAt: e.createdAt });
  app.get('/webhooks', { preHandler: app.requireAdmin() }, async () => okr({ items: await Promise.all((await svc.webhooks.endpoints().find({}).sort({ createdAt: -1 }).toArray()).map(epDto)), eventTypes: EVENT_TYPES }));
  app.post('/webhooks', { preHandler: app.requireAdmin('admin') }, async (req, reply) => { const b = z.object({ clientId: z.string(), keyId: z.string().nullable().optional(), url: z.string().url(), events: z.array(z.string()).optional() }).parse(req.body || {}); const r = await svc.webhooks.createEndpoint({ ...b, events: b.events || ['*'] }); await audit(req, 'webhooks.create', r.endpoint._id.toHexString(), null, { url: b.url, events: b.events }); return reply.code(201).send(okr({ endpoint: await epDto(r.endpoint), secret: r.secret })); });
  app.patch('/webhooks/:id', { preHandler: app.requireAdmin('admin') }, async (req) => { const b = z.object({ url: z.string().url().optional(), events: z.array(z.string()).optional(), active: z.boolean().optional(), keyId: z.string().nullable().optional() }).parse(req.body || {}); const id = oid((req.params as any).id); const { keyId, ...rest } = b; const set: any = { ...rest, updatedAt: new Date() }; if (keyId !== undefined) set.keyId = keyId ? oid(keyId) : null; if (b.active) { set.failureCount = 0; set.disabledReason = null; } await svc.webhooks.endpoints().updateOne({ _id: id }, { $set: set }); await audit(req, 'webhooks.update', id.toHexString(), null, b); const e = await svc.webhooks.endpoints().findOne({ _id: id }); if (!e) throw httpError(404, 'NOT_FOUND', 'Webhook not found'); return okr(await epDto(e)); });
  app.delete('/webhooks/:id', { preHandler: app.requireAdmin('admin') }, async (req) => { const id = oid((req.params as any).id); await svc.webhooks.endpoints().deleteOne({ _id: id }); await svc.webhooks.deliveries().deleteMany({ endpointId: id }); await audit(req, 'webhooks.delete', id.toHexString()); return okr(null); });
  app.post('/webhooks/:id/test', { preHandler: app.requireAdmin('admin') }, async (req) => { const e = await svc.webhooks.endpoints().findOne({ _id: oid((req.params as any).id) }); if (!e) throw httpError(404, 'NOT_FOUND', 'Webhook not found'); return okr(await svc.webhooks.enqueueTest(e)); });
  app.post('/webhooks/:id/rotate-secret', { preHandler: app.requireAdmin('admin') }, async (req) => { const id = oid((req.params as any).id); const secret = await svc.webhooks.rotateSecret(id); await audit(req, 'webhooks.rotate_secret', id.toHexString()); return okr({ secret }); });
  app.get('/webhooks/deliveries', { preHandler: app.requireAdmin() }, async (req) => { const q = req.query as any; const { page, limit, skip } = pageParams(q); const f: any = {}; if (q.endpointId) f.endpointId = oid(q.endpointId); if (q.status) f.status = q.status; const [items, total] = await Promise.all([svc.webhooks.deliveries().find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(), svc.webhooks.deliveries().countDocuments(f)]); return okr({ items: items.map((d) => ({ id: d._id!.toHexString(), endpointId: d.endpointId.toHexString(), event: d.event, status: d.status, attempts: d.attempts, nextAttemptAt: d.nextAttemptAt, lastResponse: d.lastResponse, payload: d.payload, createdAt: d.createdAt, deliveredAt: d.deliveredAt })), total, page, limit }); });
  app.delete('/webhooks/deliveries', { preHandler: app.requireAdmin('admin') }, async (req, reply) => { const b = z.object({ all: z.boolean().optional(), endpointId: z.string().optional(), status: z.string().optional(), from: z.string().optional(), to: z.string().optional() }).parse(req.body || {}); const f: any = {}; if (!b.all) { if (b.endpointId) f.endpointId = oid(b.endpointId); if (b.status) f.status = b.status; const ts: any = {}; if (b.from) ts.$gte = new Date(b.from); if (b.to) ts.$lte = new Date(b.to); if (Object.keys(ts).length) f.createdAt = ts; if (!Object.keys(f).length) return reply.code(400).send({ ok: false, error: 'NO_FILTER', message: 'Pass all:true or at least one filter.' }); } const r = await svc.webhooks.deliveries().deleteMany(f); await audit(req, 'webhooks.clear_deliveries', undefined, null, { ...b, deleted: r.deletedCount }); return okr({ deleted: r.deletedCount }); });
  app.post('/webhooks/deliveries/:id/redeliver', { preHandler: app.requireAdmin('admin') }, async (req) => { const d = await svc.webhooks.deliveries().findOne({ _id: oid((req.params as any).id) }); if (!d) throw httpError(404, 'NOT_FOUND', 'Delivery not found'); return okr(await svc.webhooks.deliver({ ...d, attempts: Math.min(d.attempts, 3) })); });
  app.get('/webhooks/inbound', { preHandler: app.requireAdmin() }, async () => {
    const accounts = await svc.upstreams.list(); const since = new Date(Date.now() - 86400e3);
    const byAccount = await Promise.all(accounts.map(async (a) => { const id = a._id.toHexString(); const [last, received24h, parseFailures24h] = await Promise.all([svc.db.col<any>(COLLECTIONS.inboundHooks).findOne({ accountId: id }, { sort: { ts: -1 } }), svc.db.col(COLLECTIONS.inboundHooks).countDocuments({ accountId: id, ts: { $gte: since } }), svc.db.col(COLLECTIONS.inboundHooks).countDocuments({ accountId: id, ts: { $gte: since }, parsed: false })]); return { accountId: id, label: a.label, configured: a.webhookConfigured, url: `${svc.cfg.publicBaseUrl}/hooks/torbox/${id}/${svc.cfg.WEBHOOK_INBOUND_SECRET}`, lastReceivedAt: last?.ts || null, received24h, parseFailures24h }; }));
    const recent = await svc.db.col<any>(COLLECTIONS.inboundHooks).find({}).sort({ ts: -1 }).limit(25).toArray();
    return okr({ byAccount, recent: recent.map((r) => ({ id: r._id.toHexString(), ts: r.ts, accountId: r.accountId, parsed: r.parsed, eventType: r.eventType, raw: r.raw })) });
  });

  // ---- settings ----
  app.get('/settings', { preHandler: app.requireAdmin() }, async () => { const s = await svc.settings.get(true); return okr({ ...s, _id: undefined, homepageSections: HOMEPAGE_SECTIONS }); });
  app.patch('/settings', { preHandler: app.requireAdmin('admin') }, async (req) => {
    const b = z.object({
      branding: z.object({ name: z.string().max(60), tagline: z.string().max(160), logoUrl: z.string().max(500), accentColor: z.string().max(20), supportEmail: z.string().max(120) }).partial().optional(),
      homepage: z.object({ showPublicStats: z.boolean(), sections: z.record(z.boolean()), customIntro: z.string().max(4000) }).partial().optional(),
      cors: z.object({ allowedOrigins: z.array(z.string()) }).partial().optional(),
      maintenance: z.object({ enabled: z.boolean(), message: z.string().max(500), readOnly: z.boolean() }).partial().optional(),
      retention: z.object({ requestLogsDays: z.number().int().min(1).max(3650), activityDays: z.number().int().min(1).max(3650), eventsDays: z.number().int().min(1).max(3650), webhookDeliveriesDays: z.number().int().min(1).max(365) }).partial().optional(),
      privacy: z.object({ storeFullQuery: z.boolean(), truncateIps: z.boolean() }).partial().optional(),
      alerts: z.object({ webhookUrl: z.string().url().or(z.literal('')), thresholds: z.object({ errorRatePct: z.number().min(1).max(100), budgetHeadroomPct: z.number().min(1).max(100), premiumExpiringDays: z.number().min(1).max(90), quotaPct: z.number().min(1).max(100) }).partial() }).partial().optional(),
      docs: z.object({ public: z.boolean() }).partial().optional(),
    }).parse(req.body || {});
    if (b.retention && req.admin!.role !== 'owner') throw httpError(403, 'FORBIDDEN', 'Only owners can change retention.');
    const before = await svc.settings.get(true); const after = await svc.settings.update(b as any);
    if (b.retention) await svc.db.ensureIndexes(after.retention);
    await audit(req, 'settings.update', undefined, Object.fromEntries(Object.keys(b).map((k) => [k, (before as any)[k]])), b);
    return okr({ ...after, _id: undefined, homepageSections: HOMEPAGE_SECTIONS });
  });

  // ---- playground ----
  app.post('/playground', { preHandler: app.requireAdmin('admin') }, async (req, reply) => {
    const b = z.object({ keyId: z.string(), method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']), path: z.string().regex(/^\/(v1\/api|api\/v1)(\/|$)/, 'Path must start with /v1/api or /api/v1'), query: z.record(z.any()).optional(), headers: z.record(z.string()).optional(), body: z.any().optional() }).parse(req.body || {});
    const key = await svc.keys.keys().findOne({ _id: oid(b.keyId) }); if (!key) throw httpError(404, 'NOT_FOUND', 'Key not found');
    // The playground uses a short-lived secret: rotate is destructive, so instead we mint a temporary sibling secret valid for 2 minutes.
    const { generateApiKey } = await import('../../crypto.js'); const tmp = generateApiKey(key.mode);
    await svc.keys.keys().updateOne({ _id: key._id }, { $push: { previousSecrets: { hash: tmp.hash, validUntil: new Date(Date.now() + 120_000) } } as any });
    const url = new URL(b.path, svc.cfg.publicBaseUrl); for (const [k, v] of Object.entries(b.query || {})) if (v != null && v !== '') url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { authorization: `Bearer ${tmp.secret}`, accept: 'application/json', ...(b.headers || {}) };
    let body: string | undefined; if (b.body != null && b.method !== 'GET') { body = typeof b.body === 'string' ? b.body : JSON.stringify(b.body); headers['content-type'] = headers['content-type'] || 'application/json'; }
    const started = Date.now();
    const res = await app.inject({ method: b.method, url: url.pathname + url.search, headers, payload: body });
    const dur = Date.now() - started;
    await svc.keys.keys().updateOne({ _id: key._id }, { $pull: { previousSecrets: { hash: tmp.hash } } as any });
    let parsed: any = res.body; try { parsed = JSON.parse(res.body); } catch {}
    const curl = `curl -X ${b.method} '${svc.cfg.publicBaseUrl}${url.pathname}${url.search}' -H 'Authorization: Bearer <YOUR_KEY>'${body ? ` -H 'Content-Type: ${headers['content-type']}' -d '${body.replace(/'/g, "'\\''")}'` : ''}`;
    await audit(req, 'playground.request', key._id.toHexString(), null, { method: b.method, path: b.path, status: res.statusCode });
    return reply.send(okr({ status: res.statusCode, headers: res.headers, body: parsed, durationMs: dur, curl }));
  });

  // ---- system ----
  app.get('/system', { preHandler: app.requireAdmin() }, async () => {
    let mongo: any = { ok: false }; try { const latencyMs = await svc.db.ping(); const cols = await svc.db.db.listCollections().toArray(); const stats = await Promise.all(cols.map(async (c) => { const s = await svc.db.db.command({ collStats: c.name }).catch(() => null); return { name: c.name, count: s?.count ?? 0, storageBytes: s?.storageSize ?? 0 }; })); mongo = { ok: true, latencyMs, collections: stats.sort((a, b) => b.storageBytes - a.storageBytes) }; } catch (e: any) { mongo = { ok: false, error: e?.message }; }
    const health = await svc.db.col<any>(COLLECTIONS.upstreamHealth).aggregate([{ $sort: { ts: -1 } }, { $group: { _id: '$accountId', ok: { $first: '$ok' }, latencyMs: { $first: '$latencyMs' }, ts: { $first: '$ts' }, detail: { $first: '$detail' } } }]).toArray();
    const accounts = await svc.upstreams.list();
    return okr({ version: svc.cfg.version, uptimeSec: Math.round((Date.now() - svc.startedAt) / 1000), node: process.version, env: svc.cfg.NODE_ENV, publicBaseUrl: svc.cfg.publicBaseUrl, upstreamBase: svc.cfg.TORBOX_API_BASE, mongo, jobs: await (app as any).jobRunner.status(), inProcessJobs: svc.cfg.RUN_JOBS_IN_PROCESS, upstreamHealth: health.map((h) => ({ accountId: h._id, label: accounts.find((a) => a._id.toHexString() === h._id)?.label || h._id, ok: h.ok, latencyMs: h.latencyMs, ts: h.ts, detail: h.detail })), memoryMb: Math.round(process.memoryUsage().rss / 1048576) });
  });
  app.post('/system/jobs/:name/run', { preHandler: app.requireAdmin('admin') }, async (req) => { const r = await (app as any).jobRunner.runDue((req.params as any).name); await audit(req, 'system.run_job', (req.params as any).name); return okr(r); });
}
