import type { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { COLLECTIONS } from '../../db.js';
import { SCOPES, SCOPE_PRESETS } from '../../shared/scopes.js';
import { ROUTE_TABLE } from '../../torbox/routeTable.js';
import { DEFAULT_POLICY, type ApiKey, type Client, type Policy } from '../../services/keys.js';
import { clientIp } from '../../plugins/consumerAuth.js';
import { okr, pageParams, httpError } from './index.js';

const oid = (s: string) => { try { return new ObjectId(s); } catch { throw httpError(400, 'BAD_ID', 'Invalid id'); } };
const limitsSchema = z.object({ perMinute: z.number().int().min(0), perHour: z.number().int().min(0), perDay: z.number().int().min(0), createUncachedPerHour: z.number().int().min(0), createPerHour: z.number().int().min(0) });
const quotasSchema = z.object({ monthlyRequests: z.number().int().min(0), monthlyCreates: z.number().int().min(0) });
const featuresSchema = z.object({ allowPermalinks: z.boolean(), allowStreaming: z.boolean(), allowUploads: z.boolean(), allowSettingsWrite: z.boolean(), allowBypassCache: z.boolean(), allowWebhooks: z.boolean() });

export default async function resourceRoutes(app: FastifyInstance) {
  const svc = app.svc;
  const audit = (req: any, action: string, target?: string, before?: any, after?: any) => svc.audit.record({ adminId: req.admin!.id, adminEmail: req.admin!.email, action, target, before, after, ip: clientIp(req) });
  const requests30d = async (match: any) => { const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10); const rows = await svc.db.col<any>(COLLECTIONS.usageDaily).aggregate([{ $match: { ...match, d: { $gte: since } } }, { $group: { _id: match.keyId ? '$keyId' : '$clientId', n: { $sum: '$requests' } } }]).toArray(); return new Map(rows.map((r) => [String(r._id), r.n])); };

  // ---- meta ----
  app.get('/meta/scopes', { preHandler: app.requireAdmin() }, async () => okr({ items: SCOPES, presets: SCOPE_PRESETS }));
  app.get('/meta/routes', { preHandler: app.requireAdmin() }, async () => okr({ items: ROUTE_TABLE.map((r) => ({ method: r.method, path: r.path, group: r.group, summary: r.summary, scope: r.scope, cacheTtl: r.cacheTtl, blocked: r.blocked, blockedReason: r.blockedReason, limiter: r.limiter, tokenInQuery: r.tokenInQuery })) }));

  // ---- upstream accounts ----
  const keysCountBy = async (field: 'upstreamAccountId' | 'clientId' | 'policyId') => new Map((await svc.keys.keys().aggregate([{ $match: { status: { $ne: 'revoked' } } }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]).toArray()).map((r: any) => [String(r._id), r.n]));
  app.get('/upstreams', { preHandler: app.requireAdmin() }, async () => { const counts = await keysCountBy('upstreamAccountId'); return okr({ items: (await svc.upstreams.list()).map((a) => svc.upstreams.toDto(a, counts.get(a._id.toHexString()) || 0)) }); });
  app.post('/upstreams', { preHandler: app.requireAdmin('owner') }, async (req, reply) => {
    const b = z.object({ label: z.string().min(1).max(80), apiKey: z.string().min(10), limits: z.object({ perMinute: z.number().int().min(1).max(300), createUncachedPerHour: z.number().int().min(0).max(60), createUsenetPerHour: z.number().int().min(0).max(60), createWebdlPerHour: z.number().int().min(0).max(60) }).partial().optional() }).parse(req.body || {});
    try { const a = await svc.upstreams.create(b.label, b.apiKey, b.limits); await audit(req, 'upstreams.create', a._id.toHexString(), null, { label: b.label, plan: a.plan }); return reply.code(201).send(okr(svc.upstreams.toDto(a))); }
    catch (e: any) { return reply.code(e.status || 400).send({ ok: false, error: e.code || 'UPSTREAM_REJECTED', message: e.message }); }
  });
  app.patch('/upstreams/:id', { preHandler: app.requireAdmin('owner') }, async (req) => {
    const b = z.object({ label: z.string().min(1).max(80).optional(), status: z.enum(['active', 'disabled']).optional(), weight: z.number().int().min(0).max(100).optional(), limits: z.object({ perMinute: z.number().int().min(1).max(300), createUncachedPerHour: z.number().int().min(0).max(60), createUsenetPerHour: z.number().int().min(0).max(60), createWebdlPerHour: z.number().int().min(0).max(60) }).partial().optional() }).parse(req.body || {});
    const id = oid((req.params as any).id); const before = await svc.upstreams.get(id); if (!before) throw httpError(404, 'NOT_FOUND', 'Upstream not found');
    const set: any = { updatedAt: new Date() }; if (b.label) set.label = b.label; if (b.status) set.status = b.status; if (b.weight != null) set.weight = b.weight; if (b.limits) set.limits = { ...before.limits, ...b.limits };
    await svc.db.col(COLLECTIONS.upstreams).updateOne({ _id: id }, { $set: set }); await audit(req, 'upstreams.update', id.toHexString(), { label: before.label, status: before.status, limits: before.limits }, b);
    return okr(svc.upstreams.toDto((await svc.upstreams.get(id))!));
  });
  app.post('/upstreams/:id/verify', { preHandler: app.requireAdmin('admin') }, async (req) => { const a = await svc.upstreams.get(oid((req.params as any).id)); if (!a) throw httpError(404, 'NOT_FOUND', 'Upstream not found'); const r = await svc.upstreams.verify(a); return okr({ ...svc.upstreams.toDto((await svc.upstreams.get(a._id))!), verify: r }); });
  app.post('/upstreams/:id/rotate', { preHandler: app.requireAdmin('owner') }, async (req, reply) => { const b = z.object({ apiKey: z.string().min(10) }).parse(req.body || {}); try { const a = await svc.upstreams.rotate((req.params as any).id, b.apiKey); await audit(req, 'upstreams.rotate', (req.params as any).id); return okr(svc.upstreams.toDto(a!)); } catch (e: any) { return reply.code(e.status || 400).send({ ok: false, error: e.code || 'UPSTREAM_REJECTED', message: e.message }); } });
  app.delete('/upstreams/:id', { preHandler: app.requireAdmin('owner') }, async (req, reply) => { const id = oid((req.params as any).id); if (await svc.keys.keys().countDocuments({ upstreamAccountId: id, status: { $ne: 'revoked' } })) return reply.code(409).send({ ok: false, error: 'HAS_KEYS', message: 'Revoke or re-assign the keys pinned to this account first.' }); await svc.db.col(COLLECTIONS.upstreams).deleteOne({ _id: id }); await audit(req, 'upstreams.delete', id.toHexString()); return okr(null); });
  app.get('/upstreams/:id/details', { preHandler: app.requireAdmin() }, async (req) => {
    const a = await svc.upstreams.get(oid((req.params as any).id)); if (!a) throw httpError(404, 'NOT_FOUND', 'Upstream not found');
    const key = svc.upstreams.decryptKey(a);
    const [me, stats, notifs] = await Promise.all([svc.torbox.call<any>(key, 'GET', '/v1/api/user/me', { query: { settings: 'true' } }), svc.torbox.call<any>(key, 'GET', '/v1/api/user/stats', { query: { general: 'true', bandwidth: 'true', bandwidth_grouping: 'day' } }), svc.torbox.call<any>(key, 'GET', '/v1/api/notifications/mynotifications')]);
    const { redactMe } = await import('../../services/upstreams.js');
    const meData = me.success ? redactMe(me.data) : null;
    if (meData && me.data?.settings) { const s = { ...me.data.settings }; for (const k of ['mega_password', 'pixeldrain_api_key', 'onefichier_api_key', 'gofile_api_key', 'mega_email']) if (s[k]) s[k] = '***'; (meData as any).settings = s; }
    return okr({ account: svc.upstreams.toDto(a), me: meData, meError: me.success ? null : `${me.error}: ${me.detail}`, stats: stats.success ? stats.data : null, notifications: notifs.success ? notifs.data : [], webhookUrl: `${svc.cfg.publicBaseUrl}/hooks/torbox/${a._id.toHexString()}/${svc.cfg.WEBHOOK_INBOUND_SECRET}` });
  });
  app.post('/upstreams/:id/webhook', { preHandler: app.requireAdmin('owner') }, async (req, reply) => {
    const b = z.object({ enabled: z.boolean() }).parse(req.body || {}); const a = await svc.upstreams.get(oid((req.params as any).id)); if (!a) throw httpError(404, 'NOT_FOUND', 'Upstream not found');
    const url = `${svc.cfg.publicBaseUrl}/hooks/torbox/${a._id.toHexString()}/${svc.cfg.WEBHOOK_INBOUND_SECRET}`;
    const r = await svc.torbox.call<any>(svc.upstreams.decryptKey(a), 'PUT', '/v1/api/user/settings/editsettings', { json: b.enabled ? { webhook_notifications: true, webhook_url: url } : { webhook_notifications: false } });
    if (!r.success) return reply.code(502).send({ ok: false, error: r.error || 'UPSTREAM_ERROR', message: r.detail });
    await svc.db.col(COLLECTIONS.upstreams).updateOne({ _id: a._id }, { $set: { webhookConfigured: b.enabled } }); await audit(req, 'upstreams.webhook', a._id.toHexString(), null, { enabled: b.enabled });
    return okr({ enabled: b.enabled, url });
  });
  app.post('/upstreams/:id/test-notification', { preHandler: app.requireAdmin('admin') }, async (req, reply) => { const a = await svc.upstreams.get(oid((req.params as any).id)); if (!a) throw httpError(404, 'NOT_FOUND', 'Upstream not found'); const r = await svc.torbox.call<any>(svc.upstreams.decryptKey(a), 'POST', '/v1/api/notifications/test'); return r.success ? okr({ detail: r.detail }) : reply.code(502).send({ ok: false, error: r.error, message: r.detail }); });
  app.post('/upstreams/:id/clear-notifications', { preHandler: app.requireAdmin('admin') }, async (req, reply) => { const a = await svc.upstreams.get(oid((req.params as any).id)); if (!a) throw httpError(404, 'NOT_FOUND', 'Upstream not found'); const r = await svc.torbox.call<any>(svc.upstreams.decryptKey(a), 'POST', '/v1/api/notifications/clear'); return r.success ? okr(null) : reply.code(502).send({ ok: false, error: r.error, message: r.detail }); });

  // ---- clients ----
  const clientDto = (c: Client, keysCount = 0, r30 = 0) => ({ id: c._id.toHexString(), name: c.name, contactEmail: c.contactEmail, notes: c.notes, status: c.status, defaultPolicyId: c.defaultPolicyId?.toHexString() ?? null, keysCount, requests30d: r30, createdAt: c.createdAt });
  app.get('/clients', { preHandler: app.requireAdmin() }, async (req) => {
    const { page, limit, skip } = pageParams(req.query); const q = (req.query as any).q; const f: any = q ? { name: { $regex: q, $options: 'i' } } : {};
    const [items, total, counts, r30] = await Promise.all([svc.keys.clients().find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(), svc.keys.clients().countDocuments(f), keysCountBy('clientId'), requests30d({ clientId: { $exists: true } })]);
    return okr({ items: items.map((c) => clientDto(c, counts.get(c._id.toHexString()) || 0, r30.get(c._id.toHexString()) || 0)), total, page, limit });
  });
  app.post('/clients', { preHandler: app.requireAdmin('admin') }, async (req, reply) => {
    const b = z.object({ name: z.string().min(1).max(120), contactEmail: z.string().email().or(z.literal('')).optional(), notes: z.string().max(2000).optional(), defaultPolicyId: z.string().nullable().optional() }).parse(req.body || {});
    const now = new Date(); const doc: Client = { _id: new ObjectId(), name: b.name, contactEmail: b.contactEmail || '', notes: b.notes || '', status: 'active', defaultPolicyId: b.defaultPolicyId ? oid(b.defaultPolicyId) : null, createdAt: now, updatedAt: now };
    await svc.keys.clients().insertOne(doc); await audit(req, 'clients.create', doc._id.toHexString(), null, b); return reply.code(201).send(okr(clientDto(doc)));
  });
  app.get('/clients/:id', { preHandler: app.requireAdmin() }, async (req) => {
    const id = oid((req.params as any).id); const c = await svc.keys.clients().findOne({ _id: id }); if (!c) throw httpError(404, 'NOT_FOUND', 'Client not found');
    const keys = await svc.keys.keys().find({ clientId: id }).sort({ createdAt: -1 }).toArray();
    const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
    const daily = await svc.db.col<any>(COLLECTIONS.usageDaily).aggregate([{ $match: { clientId: id, d: { $gte: since } } }, { $group: { _id: '$d', requests: { $sum: '$requests' }, errors: { $sum: '$errors' } } }, { $sort: { _id: 1 } }]).toArray();
    const ym = new Date().toISOString().slice(0, 7); const month = await svc.db.col<any>(COLLECTIONS.quotaCounters).aggregate([{ $match: { keyId: { $in: keys.map((k) => k._id) }, ym } }, { $group: { _id: null, requests: { $sum: '$requests' }, creates: { $sum: '$creates' } } }]).toArray();
    return okr({ client: clientDto(c, keys.filter((k) => k.status !== 'revoked').length), keys: await Promise.all(keys.map((k) => keyDto(k))), usage: { month: { requests: month[0]?.requests || 0, creates: month[0]?.creates || 0 }, daily: daily.map((d) => ({ d: d._id, requests: d.requests, errors: d.errors })) } });
  });
  app.patch('/clients/:id', { preHandler: app.requireAdmin('admin') }, async (req) => {
    const b = z.object({ name: z.string().min(1).max(120).optional(), contactEmail: z.string().email().or(z.literal('')).optional(), notes: z.string().max(2000).optional(), status: z.enum(['active', 'suspended']).optional(), defaultPolicyId: z.string().nullable().optional() }).parse(req.body || {});
    const id = oid((req.params as any).id); const before = await svc.keys.clients().findOne({ _id: id }); if (!before) throw httpError(404, 'NOT_FOUND', 'Client not found');
    const set: any = { ...b, updatedAt: new Date() }; if ('defaultPolicyId' in b) set.defaultPolicyId = b.defaultPolicyId ? oid(b.defaultPolicyId) : null;
    await svc.keys.clients().updateOne({ _id: id }, { $set: set }); await audit(req, 'clients.update', id.toHexString(), { name: before.name, status: before.status }, b);
    return okr(clientDto((await svc.keys.clients().findOne({ _id: id }))!));
  });
  app.post('/clients/:id/reset-usage', { preHandler: app.requireAdmin('admin') }, async (req) => { const id = oid((req.params as any).id); const keys = await svc.keys.keys().find({ clientId: id }, { projection: { _id: 1 } }).toArray(); for (const k of keys) await svc.logs.resetUsage(k._id); await audit(req, 'clients.reset_usage', id.toHexString(), null, { keys: keys.length }); return okr({ keys: keys.length }); });
  app.delete('/clients/:id', { preHandler: app.requireAdmin('admin') }, async (req) => { const id = oid((req.params as any).id); await svc.keys.keys().updateMany({ clientId: id, status: { $ne: 'revoked' } }, { $set: { status: 'revoked', revokedAt: new Date(), updatedAt: new Date() } }); await svc.keys.clients().deleteOne({ _id: id }); await audit(req, 'clients.delete', id.toHexString()); return okr(null); });

  // ---- keys ----
  const keyDto = async (k: ApiKey, extra: { clientName?: string; policyName?: string; upstreamLabel?: string; r30?: number } = {}) => {
    const [client, policy, up] = await Promise.all([extra.clientName ? null : svc.keys.clients().findOne({ _id: k.clientId }, { projection: { name: 1 } }), extra.policyName ? null : svc.keys.policies().findOne({ _id: k.policyId }, { projection: { name: 1 } }), extra.upstreamLabel ? null : svc.db.col<any>(COLLECTIONS.upstreams).findOne({ _id: k.upstreamAccountId }, { projection: { label: 1 } })]);
    return { id: k._id.toHexString(), clientId: k.clientId.toHexString(), clientName: extra.clientName ?? client?.name ?? '(deleted)', name: k.name, prefix: k.prefix, last4: k.last4, mode: k.mode, scopes: k.scopes, policyId: k.policyId.toHexString(), policyName: extra.policyName ?? policy?.name ?? '(deleted)', upstreamAccountId: k.upstreamAccountId.toHexString(), upstreamLabel: extra.upstreamLabel ?? up?.label ?? '(deleted)', allowedIps: k.allowedIps, allowedOrigins: k.allowedOrigins, expiresAt: k.expiresAt, status: k.status, revokedAt: k.revokedAt, lastUsedAt: k.lastUsedAt, lastUsedIp: k.lastUsedIp, requests30d: extra.r30 ?? 0, createdAt: k.createdAt, metadata: k.metadata, graceUntil: k.previousSecrets?.find((p) => p.validUntil > new Date())?.validUntil ?? null };
  };
  app.get('/keys', { preHandler: app.requireAdmin() }, async (req) => {
    const q = req.query as any; const { page, limit, skip } = pageParams(q); const f: any = {};
    if (q.clientId) f.clientId = oid(q.clientId); if (q.status) f.status = q.status; if (q.upstreamId) f.upstreamAccountId = oid(q.upstreamId); if (q.policyId) f.policyId = oid(q.policyId);
    if (q.q) f.$or = [{ name: { $regex: q.q, $options: 'i' } }, { prefix: { $regex: q.q, $options: 'i' } }];
    const [items, total, clients, policies, ups, r30] = await Promise.all([svc.keys.keys().find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(), svc.keys.keys().countDocuments(f), svc.keys.clients().find({}, { projection: { name: 1 } }).toArray(), svc.keys.policies().find({}, { projection: { name: 1 } }).toArray(), svc.db.col<any>(COLLECTIONS.upstreams).find({}, { projection: { label: 1 } }).toArray(), requests30d({ keyId: { $exists: true } })]);
    const cm = new Map(clients.map((c) => [c._id.toHexString(), c.name])), pm = new Map(policies.map((p) => [p._id.toHexString(), p.name])), um = new Map(ups.map((u) => [u._id.toHexString(), u.label]));
    return okr({ items: await Promise.all(items.map((k) => keyDto(k, { clientName: cm.get(k.clientId.toHexString()) || '(deleted)', policyName: pm.get(k.policyId.toHexString()) || '(deleted)', upstreamLabel: um.get(k.upstreamAccountId.toHexString()) || '(deleted)', r30: r30.get(k._id.toHexString()) || 0 }))), total, page, limit });
  });
  const keyBody = z.object({ name: z.string().min(1).max(120), clientId: z.string(), scopes: z.array(z.string()).default([]), policyId: z.string().nullable().optional(), upstreamAccountId: z.string().nullable().optional(), allowedIps: z.array(z.string()).optional(), allowedOrigins: z.array(z.string()).optional(), expiresAt: z.string().nullable().optional(), metadata: z.record(z.unknown()).nullable().optional(), mode: z.enum(['live', 'test']).optional() });
  app.post('/keys', { preHandler: app.requireAdmin('admin') }, async (req, reply) => {
    const b = keyBody.parse(req.body || {});
    const client = await svc.keys.clients().findOne({ _id: oid(b.clientId) }); if (!client) throw httpError(404, 'NOT_FOUND', 'Client not found');
    // null/omitted upstream → the active default account (weighted); null/omitted policy → client default, then gateway default.
    const upstreamAccountId = b.upstreamAccountId || (await svc.upstreams.getActiveDefault())?._id.toHexString();
    if (!upstreamAccountId) throw httpError(400, 'NO_UPSTREAM', 'Add an active upstream TorBox account before creating keys.');
    if (!(await svc.upstreams.get(oid(upstreamAccountId)))) throw httpError(404, 'NOT_FOUND', 'Upstream account not found');
    const policyId = b.policyId || client.defaultPolicyId?.toHexString() || undefined;
    const r = await svc.keys.create({ ...b, metadata: b.metadata ?? undefined, policyId, upstreamAccountId, createdBy: req.admin!.email });
    await audit(req, 'keys.create', r.key._id.toHexString(), null, { name: b.name, scopes: b.scopes, clientId: b.clientId });
    return reply.code(201).send(okr({ key: await keyDto(r.key), secret: r.secret }));
  });
  app.get('/keys/:id', { preHandler: app.requireAdmin() }, async (req) => {
    const id = oid((req.params as any).id); const k = await svc.keys.keys().findOne({ _id: id }); if (!k) throw httpError(404, 'NOT_FOUND', 'Key not found');
    const policy = (await svc.keys.policies().findOne({ _id: k.policyId })) || ({ ...DEFAULT_POLICY } as any); const kid = id.toHexString();
    const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10); const today = new Date().toISOString().slice(0, 10);
    const daily = await svc.db.col<any>(COLLECTIONS.usageDaily).find({ keyId: id, d: { $gte: since } }).sort({ d: 1 }).toArray();
    const month = await svc.logs.monthlyUsage(id); const t = daily.find((d) => d.d === today);
    const peek = (s: string, w: any, l: number) => svc.limiter.peek(s, w, l);
    const [pm, ph, pd, pu, pc] = await Promise.all([peek(`key:${kid}`, 'minute', policy.limits.perMinute), peek(`key:${kid}`, 'hour', policy.limits.perHour), peek(`key:${kid}`, 'day', policy.limits.perDay), peek(`key:${kid}:uncached`, 'hour', policy.limits.createUncachedPerHour), peek(`key:${kid}:create`, 'hour', policy.limits.createPerHour)]);
    const b = (p: any) => ({ used: p.used, limit: p.limit, resetAt: p.resetAt });
    return okr({ key: await keyDto(k), usage: { month: { ...month, quotaRequests: policy.quotas.monthlyRequests, quotaCreates: policy.quotas.monthlyCreates }, today: { requests: t?.requests || 0, errors: t?.errors || 0 }, daily: daily.map((d) => ({ d: d.d, requests: d.requests || 0, errors: d.errors || 0, cacheHits: d.cacheHits || 0, submits: d.submits || 0, links: d.links || 0 })) }, buckets: { perMinute: b(pm), perHour: b(ph), perDay: b(pd), createUncachedPerHour: b(pu), createPerHour: b(pc) } });
  });
  app.patch('/keys/:id', { preHandler: app.requireAdmin('admin') }, async (req) => {
    const b = keyBody.omit({ clientId: true, mode: true }).partial().parse(req.body || {}); const id = oid((req.params as any).id);
    const before = await svc.keys.keys().findOne({ _id: id }); if (!before) throw httpError(404, 'NOT_FOUND', 'Key not found');
    const set: any = { updatedAt: new Date() };
    if (b.name) set.name = b.name; if (b.scopes) set.scopes = svc.keys.validateScopes(b.scopes); if (b.policyId) set.policyId = oid(b.policyId); else if (b.policyId === null) set.policyId = (await svc.keys.ensureDefaultPolicy())._id; if (b.upstreamAccountId) set.upstreamAccountId = oid(b.upstreamAccountId);
    if (b.allowedIps) set.allowedIps = b.allowedIps.map((s) => s.trim()).filter(Boolean); if (b.allowedOrigins) set.allowedOrigins = b.allowedOrigins.map((s) => s.trim()).filter(Boolean); if ('expiresAt' in b) set.expiresAt = b.expiresAt ? new Date(b.expiresAt) : null; if (b.metadata !== undefined) set.metadata = b.metadata ?? {};
    await svc.keys.keys().updateOne({ _id: id }, { $set: set }); await audit(req, 'keys.update', id.toHexString(), { name: before.name, scopes: before.scopes, policyId: before.policyId, expiresAt: before.expiresAt }, b);
    return okr(await keyDto((await svc.keys.keys().findOne({ _id: id }))!));
  });
  app.post('/keys/:id/rotate', { preHandler: app.requireAdmin('admin') }, async (req) => { const b = z.object({ graceMinutes: z.number().int().min(0).max(10080).optional() }).parse(req.body || {}); const r = await svc.keys.rotate((req.params as any).id, b.graceMinutes ?? 0); await audit(req, 'keys.rotate', (req.params as any).id, null, { graceMinutes: b.graceMinutes ?? 0 }); return okr({ secret: r.secret }); });
  for (const [action, set] of [['suspend', { status: 'suspended' }], ['resume', { status: 'active' }], ['revoke', { status: 'revoked', revokedAt: new Date() }]] as const) {
    app.post(`/keys/:id/${action}`, { preHandler: app.requireAdmin('admin') }, async (req, reply) => {
      const id = oid((req.params as any).id); const k = await svc.keys.keys().findOne({ _id: id }); if (!k) throw httpError(404, 'NOT_FOUND', 'Key not found');
      if (k.status === 'revoked') return reply.code(409).send({ ok: false, error: 'REVOKED', message: 'Revoked keys cannot be changed.' });
      await svc.keys.keys().updateOne({ _id: id }, { $set: { ...set, updatedAt: new Date(), ...(action === 'revoke' ? { revokedAt: new Date() } : {}) } }); await audit(req, `keys.${action}`, id.toHexString(), { status: k.status }, set);
      return okr(await keyDto((await svc.keys.keys().findOne({ _id: id }))!));
    });
  }
  app.post('/keys/:id/reset-usage', { preHandler: app.requireAdmin('admin') }, async (req) => { const id = oid((req.params as any).id); await svc.logs.resetUsage(id); await audit(req, 'keys.reset_usage', id.toHexString()); return okr(null); });
  app.post('/keys/:id/reset-limits', { preHandler: app.requireAdmin('admin') }, async (req) => { const id = oid((req.params as any).id); await svc.limiter.reset(`key:${id.toHexString()}`); await audit(req, 'keys.reset_limits', id.toHexString()); return okr(null); });

  // ---- policies ----
  const policyDto = (p: Policy, keysCount = 0) => ({ id: p._id.toHexString(), name: p.name, description: p.description, limits: p.limits, quotas: p.quotas, features: p.features, cacheTtlOverrides: p.cacheTtlOverrides || {}, isDefault: p.isDefault, keysCount, createdAt: p.createdAt });
  app.get('/policies', { preHandler: app.requireAdmin() }, async () => { await svc.keys.ensureDefaultPolicy(); const counts = await keysCountBy('policyId'); return okr({ items: (await svc.keys.policies().find({}).sort({ isDefault: -1, name: 1 }).toArray()).map((p) => policyDto(p, counts.get(p._id.toHexString()) || 0)) }); });
  const policyBody = z.object({ name: z.string().min(1).max(80), description: z.string().max(500).optional(), limits: limitsSchema, quotas: quotasSchema, features: featuresSchema, cacheTtlOverrides: z.record(z.number().int().min(0).max(86400)).optional() });
  app.post('/policies', { preHandler: app.requireAdmin('admin') }, async (req, reply) => { const b = policyBody.parse(req.body || {}); const now = new Date(); const doc: Policy = { _id: new ObjectId(), name: b.name, description: b.description || '', limits: b.limits, quotas: b.quotas, features: b.features, cacheTtlOverrides: b.cacheTtlOverrides || {}, isDefault: false, createdAt: now, updatedAt: now }; try { await svc.keys.policies().insertOne(doc); } catch { return reply.code(409).send({ ok: false, error: 'DUPLICATE', message: 'A policy with this name exists.' }); } await audit(req, 'policies.create', doc._id.toHexString(), null, b); return reply.code(201).send(okr(policyDto(doc))); });
  app.patch('/policies/:id', { preHandler: app.requireAdmin('admin') }, async (req) => { const b = policyBody.partial().parse(req.body || {}); const id = oid((req.params as any).id); const before = await svc.keys.policies().findOne({ _id: id }); if (!before) throw httpError(404, 'NOT_FOUND', 'Policy not found'); await svc.keys.policies().updateOne({ _id: id }, { $set: { ...b, updatedAt: new Date() } }); await audit(req, 'policies.update', id.toHexString(), { limits: before.limits, quotas: before.quotas, features: before.features }, b); return okr(policyDto((await svc.keys.policies().findOne({ _id: id }))!)); });
  app.delete('/policies/:id', { preHandler: app.requireAdmin('admin') }, async (req, reply) => { const id = oid((req.params as any).id); const p = await svc.keys.policies().findOne({ _id: id }); if (!p) throw httpError(404, 'NOT_FOUND', 'Policy not found'); if (p.isDefault) return reply.code(409).send({ ok: false, error: 'IS_DEFAULT', message: 'Make another policy the default first.' }); if (await svc.keys.keys().countDocuments({ policyId: id, status: { $ne: 'revoked' } })) return reply.code(409).send({ ok: false, error: 'IN_USE', message: 'Keys still use this policy.' }); await svc.keys.policies().deleteOne({ _id: id }); await audit(req, 'policies.delete', id.toHexString()); return okr(null); });
  app.post('/policies/:id/make-default', { preHandler: app.requireAdmin('admin') }, async (req) => { const id = oid((req.params as any).id); await svc.keys.policies().updateMany({}, { $set: { isDefault: false } }); await svc.keys.policies().updateOne({ _id: id }, { $set: { isDefault: true } }); await audit(req, 'policies.make_default', id.toHexString()); return okr(null); });
}
