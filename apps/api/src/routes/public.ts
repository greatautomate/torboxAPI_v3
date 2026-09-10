/** Permalinks, signed stream entries, inbound TorBox webhook, public config, health, OpenAPI. */
import type { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { fail, ok } from '../shared/errors.js';
import { COLLECTIONS } from '../db.js';
import { clientIp } from '../plugins/consumerAuth.js';
import { buildOpenApi } from '../openapi/build.js';

export default async function publicRoutes(app: FastifyInstance) {
  const svc = app.svc;

  app.get('/healthz', async () => ({ ok: true, version: svc.cfg.version, uptimeSec: Math.round((Date.now() - svc.startedAt) / 1000) }));
  app.get('/readyz', async (_req, reply) => {
    try {
      const latencyMs = await svc.db.ping();
      const h = await svc.db.col<any>(COLLECTIONS.upstreamHealth).findOne({}, { sort: { ts: -1 } });
      const stale = h ? Date.now() - new Date(h.ts).getTime() > 15 * 60_000 : true;
      return { ok: true, mongo: { ok: true, latencyMs }, upstream: h ? { ok: h.ok, checkedAt: h.ts, stale } : { ok: null, stale: true } };
    } catch (e: any) { return reply.code(503).send({ ok: false, error: e?.message }); }
  });

  app.get('/public/config', async () => {
    const s = await svc.settings.get();
    return { ok: true, data: { branding: s.branding, homepage: s.homepage, docsPublic: s.docs.public, baseUrl: svc.cfg.publicBaseUrl, version: svc.cfg.version } };
  });
  app.get('/public/stats', async (_req, reply) => {
    const s = await svc.settings.get(); if (!s.homepage.showPublicStats) return reply.code(404).send({ ok: false, error: 'DISABLED', message: 'Public stats are disabled' });
    const [agg] = await svc.db.col<any>(COLLECTIONS.usageDaily).aggregate([{ $group: { _id: null, requests: { $sum: '$requests' }, submits: { $sum: '$submits' } } }]).toArray();
    return { ok: true, data: { requestsTotal: agg?.requests || 0, downloadsCreated: agg?.submits || 0, uptimeSec: Math.round((Date.now() - svc.startedAt) / 1000) } };
  });

  app.get('/openapi.json', async (_req, reply) => { const s = await svc.settings.get(); if (!s.docs.public) return reply.code(404).send({ ok: false }); return buildOpenApi(svc.cfg.publicBaseUrl, s.branding.name, svc.cfg.version); });

  // ---- signed permalink: /dl/:publicId/:fileId?k=&zip=&exp=&sig= → 307 to CDN ----
  app.get('/dl/:publicId/:fileId', async (req, reply) => {
    req.surface = 'permalink';
    const { publicId, fileId } = req.params as any; const q = req.query as any;
    const exp = Number(q.exp || 0); const zip = q.zip === '1' || q.zip === 'true';
    if (!q.k || !q.sig || !svc.downloads.verifyPermalink('dl', String(q.k), publicId, Number(fileId), zip, exp, String(q.sig))) return reply.code(403).send(fail('BAD_SIGNATURE', exp && exp * 1000 < Date.now() ? 'This link has expired.' : 'Invalid link signature.'));
    const key = await svc.keys.keys().findOne({ _id: new ObjectId(String(q.k)) }).catch(() => null);
    if (!key || key.status !== 'active' || (key.expiresAt && key.expiresAt < new Date()) || !key.scopes.includes('downloads:link')) return reply.code(403).send(fail('KEY_INACTIVE', 'The key that created this link is no longer active.'));
    const [policy, client] = await Promise.all([svc.keys.policies().findOne({ _id: key.policyId }), svc.keys.clients().findOne({ _id: key.clientId })]);
    if (!client || client.status !== 'active' || !policy?.features.allowPermalinks) return reply.code(403).send(fail('FEATURE_DISABLED', 'Permalinks are disabled for this key.'));
    const idx = await svc.downloads.resolve(publicId); if (!idx || idx.upstreamAccountId !== key.upstreamAccountId.toHexString()) return reply.code(404).send(fail('ITEM_NOT_FOUND', 'Unknown download.'));
    const upstream = await svc.upstreams.get(idx.upstreamAccountId); if (!upstream || upstream.status === 'disabled') return reply.code(503).send(fail('UPSTREAM_DISABLED', 'Upstream account disabled.'));
    req.consumer = { key, policy, client, upstream, upstreamKey: svc.upstreams.decryptKey(upstream), ip: clientIp(req) };
    if (!(await app.consumeLimits(req, reply, { limiter: 'default' }))) return;
    const r = await svc.downloads.requestLink(upstream, { keyId: key._id, keyName: key.name, clientId: client._id, clientName: client.name, ip: clientIp(req), requestId: req.id as string }, idx, { fileId: Number(fileId), zip, userIp: clientIp(req), via: 'permalink' });
    req.torboxError = r.success ? null : r.error; req.upstreamMs = r.durationMs; req.upstreamStatus = r.status;
    if (!r.success) return reply.code(r.status >= 400 && r.status < 500 ? r.status : 502).send(fail(r.error || 'UPSTREAM_ERROR', r.detail));
    return reply.header('cache-control', 'no-store').redirect(r.data, 307);
  });

  // ---- signed stream entry: /s/:publicId/:fileId/master.m3u8?k=&exp=&sig= → 307 to HLS ----
  app.get('/s/:publicId/:fileId/master.m3u8', async (req, reply) => {
    req.surface = 'stream';
    const { publicId, fileId } = req.params as any; const q = req.query as any; const exp = Number(q.exp || 0);
    if (!q.k || !q.sig || !svc.downloads.verifyPermalink('s', String(q.k), publicId, Number(fileId), false, exp, String(q.sig))) return reply.code(403).send(fail('BAD_SIGNATURE', 'Invalid or expired link signature.'));
    const key = await svc.keys.keys().findOne({ _id: new ObjectId(String(q.k)) }).catch(() => null);
    if (!key || key.status !== 'active' || !key.scopes.includes('stream')) return reply.code(403).send(fail('KEY_INACTIVE', 'The key that created this link is no longer active.'));
    const [policy, client] = await Promise.all([svc.keys.policies().findOne({ _id: key.policyId }), svc.keys.clients().findOne({ _id: key.clientId })]);
    if (!client || client.status !== 'active' || !policy?.features.allowStreaming) return reply.code(403).send(fail('FEATURE_DISABLED', 'Streaming is disabled for this key.'));
    const idx = await svc.downloads.resolve(publicId); if (!idx || idx.upstreamAccountId !== key.upstreamAccountId.toHexString()) return reply.code(404).send(fail('ITEM_NOT_FOUND', 'Unknown download.'));
    const upstream = await svc.upstreams.get(idx.upstreamAccountId); if (!upstream) return reply.code(503).send(fail('UPSTREAM_DISABLED', 'Upstream account disabled.'));
    req.consumer = { key, policy, client, upstream, upstreamKey: svc.upstreams.decryptKey(upstream), ip: clientIp(req) };
    if (!(await app.consumeLimits(req, reply, { limiter: 'default' }))) return;
    const r = await svc.downloads.createStream(upstream, { keyId: key._id, keyName: key.name, clientId: client._id, clientName: client.name, ip: clientIp(req), requestId: req.id as string }, idx, { fileId: Number(fileId), audio: q.audio != null ? Number(q.audio) : undefined, subtitle: q.subtitle != null ? Number(q.subtitle) : undefined, resolution: q.resolution != null ? Number(q.resolution) : undefined });
    req.torboxError = r.success ? null : r.error;
    if (!r.success || !r.data?.hls_url) return reply.code(502).send(fail(r.error || 'UPSTREAM_ERROR', r.detail));
    return reply.header('cache-control', 'no-store').redirect(r.data.hls_url, 307);
  });

  // ---- inbound TorBox webhook ----
  app.post('/hooks/torbox/:accountId/:secret', { config: { rawBody: true } }, async (req, reply) => {
    req.surface = 'public'; req.skipLog = true;
    const { accountId, secret } = req.params as any;
    if (secret !== svc.cfg.WEBHOOK_INBOUND_SECRET) return reply.code(404).send({ ok: false });
    const acc = await svc.upstreams.get(accountId).catch(() => null); if (!acc) return reply.code(404).send({ ok: false });
    const r = await svc.webhooks.handleInbound(accountId, req.body ?? {}, clientIp(req));
    return { ok: true, ...r };
  });
  app.get('/hooks/torbox/:accountId/:secret', async (req, reply) => { const { secret } = req.params as any; return secret === svc.cfg.WEBHOOK_INBOUND_SECRET ? { ok: true, message: 'TorBox webhook receiver is ready. Configure this URL in TorBox settings (webhook_url).' } : reply.code(404).send({ ok: false }); });
}
export { ok };
