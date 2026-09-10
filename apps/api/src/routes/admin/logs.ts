import type { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { COLLECTIONS } from '../../db.js';
import { clientIp } from '../../plugins/consumerAuth.js';
import { okr, pageParams, dateRange, httpError } from './index.js';

const toCsv = (rows: any[]) => { if (!rows.length) return ''; const cols: string[] = Array.from(rows.reduce((s: Set<string>, r: any) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set<string>())); const esc = (v: any) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'); };
const strip = (d: any) => { const { _id, ...rest } = d; return { id: _id?.toHexString?.() ?? String(_id), ...rest, keyId: rest.keyId?.toHexString?.() ?? rest.keyId ?? null, clientId: rest.clientId?.toHexString?.() ?? rest.clientId ?? null }; };

export default async function logRoutes(app: FastifyInstance) {
  const svc = app.svc;
  const audit = (req: any, action: string, target?: string, before?: any, after?: any) => svc.audit.record({ adminId: req.admin!.id, adminEmail: req.admin!.email, action, target, before, after, ip: clientIp(req) });

  // ---- request logs ----
  const logFilter = (q: any) => {
    const f: any = {}; const ts = dateRange(q); if (ts) f.ts = ts;
    if (q.keyId) f.keyId = new ObjectId(q.keyId); if (q.clientId) f.clientId = new ObjectId(q.clientId); if (q.upstreamId) f.upstreamAccountId = q.upstreamId;
    if (q.route) f.route = { $regex: q.route, $options: 'i' }; if (q.status) { const st = String(q.status).trim(); const m = /^([1-5])xx$/i.exec(st); if (m) f.status = { $gte: Number(m[1]) * 100, $lt: Number(m[1]) * 100 + 100 }; else if (st.includes(',')) f.status = { $in: st.split(',').map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)) }; else if (!Number.isNaN(Number(st))) f.status = Number(st); } if (q.error) f.torboxError = q.error; if (q.cacheHit != null && q.cacheHit !== '') f.cacheHit = q.cacheHit === 'true'; if (q.ip) f.ip = q.ip; if (q.requestId) f.requestId = q.requestId; if (q.surface) f.surface = q.surface; if (q.success != null && q.success !== '') f.success = q.success === 'true';
    if (q.q) f.$or = [{ path: { $regex: q.q, $options: 'i' } }, { query: { $regex: q.q, $options: 'i' } }, { keyName: { $regex: q.q, $options: 'i' } }, { clientName: { $regex: q.q, $options: 'i' } }, { torboxError: { $regex: q.q, $options: 'i' } }, { requestId: q.q }];
    return f;
  };
  app.get('/logs', { preHandler: app.requireAdmin() }, async (req) => { const { page, limit, skip } = pageParams(req.query); const f = logFilter(req.query); const [items, total] = await Promise.all([svc.db.col<any>(COLLECTIONS.requestLogs).find(f).sort({ ts: -1 }).skip(skip).limit(limit).toArray(), svc.db.col(COLLECTIONS.requestLogs).countDocuments(f)]); return okr({ items: items.map(strip), total, page, limit }); });
  app.get('/logs/count', { preHandler: app.requireAdmin() }, async (req) => okr({ count: await svc.db.col(COLLECTIONS.requestLogs).countDocuments(logFilter(req.query)) }));
  app.get('/logs/export', { preHandler: app.requireAdmin() }, async (req, reply) => { const q = req.query as any; const rows = (await svc.db.col<any>(COLLECTIONS.requestLogs).find(logFilter(q)).sort({ ts: -1 }).limit(50000).toArray()).map(strip); const name = `request-logs-${new Date().toISOString().slice(0, 10)}`; if (q.format === 'csv') return reply.header('content-type', 'text/csv').header('content-disposition', `attachment; filename="${name}.csv"`).send(toCsv(rows)); return reply.header('content-disposition', `attachment; filename="${name}.json"`).send(rows); });
  app.get('/logs/:id', { preHandler: app.requireAdmin() }, async (req) => { const d = await svc.db.col<any>(COLLECTIONS.requestLogs).findOne({ _id: new ObjectId((req.params as any).id) }); if (!d) throw httpError(404, 'NOT_FOUND', 'Log not found'); return okr(strip(d)); });
  app.delete('/logs', { preHandler: app.requireAdmin('admin') }, async (req, reply) => {
    const b = z.object({ all: z.boolean().optional(), keyId: z.string().optional(), clientId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), surface: z.string().optional(), error: z.string().optional() }).parse(req.body || {});
    if (!b.all && !b.keyId && !b.clientId && !b.from && !b.to && !b.surface && !b.error) return reply.code(400).send({ ok: false, error: 'NO_FILTER', message: 'Pass all:true or at least one filter.' });
    const f = b.all ? {} : logFilter(b); const r = await svc.db.col(COLLECTIONS.requestLogs).deleteMany(f); await audit(req, 'logs.clear', undefined, null, { ...b, deleted: r.deletedCount }); return okr({ deleted: r.deletedCount });
  });

  // ---- activity ----
  const actFilter = (q: any) => {
    const f: any = {}; const ts = dateRange(q); if (ts) f.ts = ts;
    if (q.kind) f.kind = q.kind; if (q.keyId) f.keyId = new ObjectId(q.keyId); if (q.clientId) f.clientId = new ObjectId(q.clientId); if (q.publicId) f.publicId = q.publicId; if (q.type) f.type = q.type; if (q.hash) f.hash = q.hash.toLowerCase(); if (q.upstreamId) f.upstreamAccountId = q.upstreamId; if (q.success != null && q.success !== '') f.success = q.success === 'true';
    if (q.q) f.$or = [{ name: { $regex: q.q, $options: 'i' } }, { hash: { $regex: q.q, $options: 'i' } }, { 'input.magnet': { $regex: q.q, $options: 'i' } }, { 'input.url': { $regex: q.q, $options: 'i' } }, { 'output.cdnUrl': { $regex: q.q, $options: 'i' } }, { keyName: { $regex: q.q, $options: 'i' } }, { publicId: q.q }, { error: { $regex: q.q, $options: 'i' } }];
    return f;
  };
  app.get('/activity', { preHandler: app.requireAdmin() }, async (req) => { const { page, limit, skip } = pageParams(req.query); const f = actFilter(req.query); const [items, total] = await Promise.all([svc.db.col<any>(COLLECTIONS.activity).find(f).sort({ ts: -1 }).skip(skip).limit(limit).toArray(), svc.db.col(COLLECTIONS.activity).countDocuments(f)]); return okr({ items: items.map(strip), total, page, limit }); });
  app.get('/activity/count', { preHandler: app.requireAdmin() }, async (req) => okr({ count: await svc.db.col(COLLECTIONS.activity).countDocuments(actFilter(req.query)) }));
  app.get('/activity/export', { preHandler: app.requireAdmin() }, async (req, reply) => { const q = req.query as any; const rows = (await svc.db.col<any>(COLLECTIONS.activity).find(actFilter(q)).sort({ ts: -1 }).limit(50000).toArray()).map(strip); const name = `activity-${new Date().toISOString().slice(0, 10)}`; if (q.format === 'csv') return reply.header('content-type', 'text/csv').header('content-disposition', `attachment; filename="${name}.csv"`).send(toCsv(rows)); return reply.header('content-disposition', `attachment; filename="${name}.json"`).send(rows); });
  app.delete('/activity', { preHandler: app.requireAdmin('admin') }, async (req, reply) => {
    const b = z.object({ all: z.boolean().optional(), kind: z.string().optional(), keyId: z.string().optional(), clientId: z.string().optional(), publicId: z.string().optional(), from: z.string().optional(), to: z.string().optional() }).parse(req.body || {});
    if (!b.all && !b.kind && !b.keyId && !b.clientId && !b.publicId && !b.from && !b.to) return reply.code(400).send({ ok: false, error: 'NO_FILTER', message: 'Pass all:true or at least one filter.' });
    const r = await svc.db.col(COLLECTIONS.activity).deleteMany(b.all ? {} : actFilter(b)); await audit(req, 'activity.clear', undefined, null, { ...b, deleted: r.deletedCount }); return okr({ deleted: r.deletedCount });
  });

  // ---- analytics ----
  app.get('/analytics/usage', { preHandler: app.requireAdmin() }, async (req) => {
    const q = req.query as any; const from = q.from ? q.from.slice(0, 10) : new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10); const to = q.to ? q.to.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const groupBy = q.groupBy || 'day'; const match: any = { d: { $gte: from, $lte: to } }; if (q.keyId) match.keyId = new ObjectId(q.keyId); if (q.clientId) match.clientId = new ObjectId(q.clientId);
    if (groupBy === 'route' || groupBy === 'error') {
      const field = groupBy === 'route' ? '$byRoute' : '$byError';
      const rows = await svc.db.col<any>(COLLECTIONS.usageDaily).aggregate([{ $match: match }, { $project: { kv: { $objectToArray: { $ifNull: [field, {}] } } } }, { $unwind: '$kv' }, { $group: { _id: '$kv.k', requests: { $sum: '$kv.v' } } }, { $sort: { requests: -1 } }, { $limit: 100 }]).toArray();
      return okr({ series: rows.map((r) => ({ key: r._id, label: r._id, requests: r.requests, errors: groupBy === 'error' ? r.requests : 0, cacheHits: 0, submits: 0, links: 0 })) });
    }
    const idExpr = groupBy === 'key' ? '$keyId' : groupBy === 'client' ? '$clientId' : '$d';
    const rows = await svc.db.col<any>(COLLECTIONS.usageDaily).aggregate([{ $match: match }, { $group: { _id: idExpr, requests: { $sum: '$requests' }, errors: { $sum: { $ifNull: ['$errors', 0] } }, cacheHits: { $sum: { $ifNull: ['$cacheHits', 0] } }, submits: { $sum: { $ifNull: ['$submits', 0] } }, links: { $sum: { $ifNull: ['$links', 0] } }, latencySum: { $sum: { $ifNull: ['$latencySum', 0] } } } }, { $sort: groupBy === 'day' ? { _id: 1 } : { requests: -1 } }, { $limit: 500 }]).toArray();
    let labels = new Map<string, string>();
    if (groupBy === 'key') labels = new Map((await svc.keys.keys().find({ _id: { $in: rows.map((r) => r._id).filter(Boolean) } }, { projection: { name: 1 } }).toArray()).map((k) => [k._id.toHexString(), k.name]));
    if (groupBy === 'client') labels = new Map((await svc.keys.clients().find({ _id: { $in: rows.map((r) => r._id).filter(Boolean) } }, { projection: { name: 1 } }).toArray()).map((c) => [c._id.toHexString(), c.name]));
    return okr({ series: rows.map((r) => { const key = r._id?.toHexString?.() ?? String(r._id); return { key, label: groupBy === 'day' ? key : labels.get(key) || '(deleted)', requests: r.requests, errors: r.errors, cacheHits: r.cacheHits, submits: r.submits, links: r.links, avgLatencyMs: r.requests ? Math.round(r.latencySum / r.requests) : 0 }; }) });
  });
  app.get('/analytics/quotas', { preHandler: app.requireAdmin() }, async () => {
    const ym = new Date().toISOString().slice(0, 7); const keys = await svc.keys.keys().find({ status: { $ne: 'revoked' } }).toArray();
    const [policies, clients, counters] = await Promise.all([svc.keys.policies().find({}).toArray(), svc.keys.clients().find({}, { projection: { name: 1 } }).toArray(), svc.db.col<any>(COLLECTIONS.quotaCounters).find({ ym }).toArray()]);
    const pm = new Map(policies.map((p) => [p._id.toHexString(), p])), cm = new Map(clients.map((c) => [c._id.toHexString(), c.name])), qm = new Map(counters.map((c) => [String(c.keyId), c]));
    return okr({ items: keys.map((k) => { const p = pm.get(k.policyId.toHexString()); const c = qm.get(k._id.toHexString()); const qr = p?.quotas.monthlyRequests || 0; return { keyId: k._id.toHexString(), keyName: k.name, clientName: cm.get(k.clientId.toHexString()) || '(deleted)', monthRequests: c?.requests || 0, quotaRequests: qr, monthCreates: c?.creates || 0, quotaCreates: p?.quotas.monthlyCreates || 0, pct: qr ? Math.round(((c?.requests || 0) / qr) * 100) : null }; }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1)) });
  });
  app.get('/analytics/upstream', { preHandler: app.requireAdmin() }, async (req) => {
    const q = req.query as any; const from = q.from ? new Date(q.from) : new Date(Date.now() - 7 * 86400e3); const to = q.to ? new Date(q.to) : new Date();
    const rows = await svc.db.col<any>(COLLECTIONS.activity).aggregate([{ $match: { ts: { $gte: from, $lte: to }, kind: 'submit', success: true } }, { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } }, type: '$type' }, n: { $sum: 1 } } }]).toArray();
    const reqRows = await svc.db.col<any>(COLLECTIONS.usageDaily).aggregate([{ $match: { d: { $gte: from.toISOString().slice(0, 10), $lte: to.toISOString().slice(0, 10) } } }, { $group: { _id: '$d', requests: { $sum: '$requests' } } }]).toArray();
    const byDay = new Map<string, any>(); for (const r of reqRows) byDay.set(r._id, { d: r._id, requests: r.requests, torrentCreates: 0, usenetCreates: 0, webdlCreates: 0 });
    for (const r of rows) { const d = byDay.get(r._id.d) || { d: r._id.d, requests: 0, torrentCreates: 0, usenetCreates: 0, webdlCreates: 0 }; d[`${r._id.type}Creates`] = r.n; byDay.set(r._id.d, d); }
    const acc = await svc.upstreams.getActiveDefault();
    return okr({ series: [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d)), caps: acc ? { perMinute: acc.limits.perMinute, createUncachedPerHour: acc.limits.createUncachedPerHour, createUsenetPerHour: acc.limits.createUsenetPerHour, createWebdlPerHour: acc.limits.createWebdlPerHour, torboxPerMinute: 300, torboxCreatePerHour: 60 } : null });
  });

  // ---- events ----
  app.get('/events', { preHandler: app.requireAdmin() }, async (req) => { const q = req.query as any; const { page, limit, skip } = pageParams(q); const f: any = {}; const ts = dateRange(q); if (ts) f.ts = ts; if (q.type) f.type = q.type; if (q.publicId) f.publicId = q.publicId; if (q.upstreamId) f.upstreamAccountId = q.upstreamId; if (q.source) f.source = q.source; const [items, total] = await Promise.all([svc.webhooks.events().find(f).sort({ ts: -1 }).skip(skip).limit(limit).toArray(), svc.webhooks.events().countDocuments(f)]); return okr({ items: items.map((e) => ({ id: e._id!.toHexString(), ts: e.ts, type: e.type, publicId: e.publicId, downloadName: e.downloadName, upstreamAccountId: e.upstreamAccountId, payload: e.payload, source: e.source })), total, page, limit }); });
  app.get('/events/export', { preHandler: app.requireAdmin() }, async (req, reply) => { const q = req.query as any; const f: any = {}; const ts = dateRange(q); if (ts) f.ts = ts; if (q.type) f.type = q.type; if (q.publicId) f.publicId = q.publicId; if (q.upstreamId) f.upstreamAccountId = q.upstreamId; if (q.source) f.source = q.source; const rows = (await svc.webhooks.events().find(f).sort({ ts: -1 }).limit(50000).toArray()).map((e) => ({ id: e._id!.toHexString(), ts: e.ts, type: e.type, publicId: e.publicId, downloadName: e.downloadName, upstreamAccountId: e.upstreamAccountId, source: e.source, payload: e.payload })); const name = `events-${new Date().toISOString().slice(0, 10)}`; if (q.format === 'csv') return reply.header('content-type', 'text/csv').header('content-disposition', `attachment; filename="${name}.csv"`).send(toCsv(rows)); return reply.header('content-disposition', `attachment; filename="${name}.json"`).send(rows); });
  app.delete('/events', { preHandler: app.requireAdmin('admin') }, async (req) => { const b = z.object({ all: z.boolean().optional(), from: z.string().optional(), to: z.string().optional(), type: z.string().optional() }).parse(req.body || {}); const f: any = {}; if (!b.all) { const ts = dateRange(b); if (ts) f.ts = ts; if (b.type) f.type = b.type; if (!Object.keys(f).length) throw httpError(400, 'NO_FILTER', 'Pass all:true or a filter'); } const r = await svc.webhooks.events().deleteMany(f); await audit(req, 'events.clear', undefined, null, { ...b, deleted: r.deletedCount }); return okr({ deleted: r.deletedCount }); });

  // ---- cache ----
  app.get('/cache/stats', { preHandler: app.requireAdmin() }, async () => { const s = await svc.cache.summary(); const tot = svc.cache.stats.hits + svc.cache.stats.misses; return okr({ ...s, hitRate24h: tot ? Math.round((svc.cache.stats.hits / tot) * 100) : null, hits: svc.cache.stats.hits, misses: svc.cache.stats.misses }); });
  app.delete('/cache', { preHandler: app.requireAdmin('admin') }, async (req) => { const b = z.object({ group: z.string().optional(), upstreamId: z.string().optional() }).parse(req.body || {}); const deleted = await svc.cache.invalidate({ group: b.group, upstreamAccountId: b.upstreamId }); await audit(req, 'cache.purge', undefined, null, { ...b, deleted }); return okr({ deleted }); });

  // ---- audit ----
  app.get('/audit', { preHandler: app.requireAdmin() }, async (req) => { const q = req.query as any; const { page, limit, skip } = pageParams(q); const f: any = {}; const ts = dateRange(q); if (ts) f.ts = ts; if (q.adminId) f.adminId = q.adminId; if (q.action) f.action = { $regex: q.action, $options: 'i' }; if (q.q) f.$or = [{ action: { $regex: q.q, $options: 'i' } }, { target: { $regex: q.q, $options: 'i' } }, { adminEmail: { $regex: q.q, $options: 'i' } }]; const [items, total] = await Promise.all([svc.db.col<any>(COLLECTIONS.auditLogs).find(f).sort({ ts: -1 }).skip(skip).limit(limit).toArray(), svc.db.col(COLLECTIONS.auditLogs).countDocuments(f)]); return okr({ items: items.map((a) => ({ id: a._id.toHexString(), ts: a.ts, adminId: a.adminId, adminEmail: a.adminEmail, action: a.action, target: a.target, before: a.before, after: a.after, ip: a.ip })), total, page, limit }); });

  // ---- alerts ----
  app.get('/alerts', { preHandler: app.requireAdmin() }, async (req) => { const q = req.query as any; const { page, limit, skip } = pageParams(q); const f: any = {}; if (q.unread === 'true') { f.readAt = null; f.$or = [{ snoozedUntil: null }, { snoozedUntil: { $exists: false } }, { snoozedUntil: { $lte: new Date() } }]; } if (q.severity) f.severity = q.severity; const [items, total, unread] = await Promise.all([svc.alerts.col().find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(), svc.alerts.col().countDocuments(f), svc.alerts.unreadCount()]); return okr({ items: items.map((a) => ({ id: a._id!.toHexString(), severity: a.severity, type: a.type, title: a.title, message: a.message, meta: a.meta, snoozedUntil: a.snoozedUntil ?? null, createdAt: a.createdAt, readAt: a.readAt })), total, page, limit, unread }); });
  app.post('/alerts/:id/read', { preHandler: app.requireAdmin() }, async (req) => { await svc.alerts.col().updateOne({ _id: new ObjectId((req.params as any).id) }, { $set: { readAt: new Date() } }); return okr(null); });
  app.post('/alerts/:id/snooze', { preHandler: app.requireAdmin() }, async (req) => { const b = z.object({ hours: z.number().min(0.25).max(24 * 30).optional() }).parse(req.body || {}); const until = new Date(Date.now() + (b.hours ?? 24) * 3600e3); await svc.alerts.col().updateOne({ _id: new ObjectId((req.params as any).id) }, { $set: { snoozedUntil: until } }); return okr({ snoozedUntil: until }); });
  app.post('/alerts/read-all', { preHandler: app.requireAdmin() }, async () => { const r = await svc.alerts.col().updateMany({ readAt: null }, { $set: { readAt: new Date() } }); return okr({ updated: r.modifiedCount }); });
  app.post('/alerts/test', { preHandler: app.requireAdmin('admin') }, async (req) => { const s = await svc.settings.get(); await svc.alerts.raise({ severity: 'info', type: 'test', title: 'Test alert', message: `Triggered by ${req.admin!.email}. ${s.alerts.webhookUrl ? 'Also sent to the configured webhook.' : 'No alert webhook configured.'}` }); return okr({ webhookConfigured: !!s.alerts.webhookUrl }); });
}
