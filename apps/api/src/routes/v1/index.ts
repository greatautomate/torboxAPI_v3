/** Enhanced, normalized API under /api/v1. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { fail, ok } from '../../shared/errors.js';
import { DL_TYPES, PATHS, type DlType } from '../../services/downloads.js';
import { PLAN_NAMES } from '../../torbox/client.js';
import { COLLECTIONS } from '../../db.js';
import { ObjectId } from 'mongodb';
import { EVENT_TYPES } from '../../services/webhooks.js';

const typeParam = z.enum(['torrent', 'usenet', 'webdl']);
const actor = (req: FastifyRequest) => { const c = req.consumer!; return { keyId: c.key._id, keyName: c.key.name, clientId: c.client._id, clientName: c.client.name, ip: c.ip, requestId: req.id as string }; };
function sendErr(reply: FastifyReply, e: any) {
  const status = e?.status && e.status >= 400 && e.status < 600 ? e.status : 500;
  return reply.code(status).send(fail(e?.code || 'GATEWAY_ERROR', e?.message || 'Unexpected gateway error', e?.data ?? null));
}
const bool = (v: any) => v === true || v === 'true' || v === '1';

export default async function v1Routes(app: FastifyInstance) {
  const svc = app.svc;
  await app.register(multipart, { limits: { fileSize: svc.cfg.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 30 }, attachFieldsToBody: 'keyValues' });
  app.addHook('onRequest', async (req) => { req.surface = 'v1'; });

  const auth = (scope: string | string[] | null, allowQueryToken = false) => async (req: FastifyRequest, reply: FastifyReply) => { if (!(await app.authenticateConsumer(req, reply, { scope, allowQueryToken }))) return reply; };
  const limits = (limiter: any = 'default') => async (req: FastifyRequest, reply: FastifyReply) => { if (!(await app.consumeLimits(req, reply, { limiter }))) return reply; };
  const resolveDownload = async (req: FastifyRequest, reply: FastifyReply, publicId: string) => {
    const idx = await svc.downloads.resolve(publicId);
    if (!idx || idx.upstreamAccountId !== req.consumer!.upstream._id.toHexString()) { reply.code(404).send(fail('ITEM_NOT_FOUND', 'No download with this id on your account.')); return null; }
    return idx;
  };

  // ---- status (public, no key) ----
  app.get('/api/v1/status', { config: { public: true } }, async (req, reply) => {
    req.surface = 'public'; req.skipLog = true;
    const h = await svc.db.col<any>(COLLECTIONS.upstreamHealth).findOne({}, { sort: { ts: -1 } });
    const acc = await svc.upstreams.getActiveDefault();
    let headroom: number | null = null;
    if (acc) { const p = await svc.limiter.peek(`upstream:${acc._id.toHexString()}`, 'minute', acc.limits.perMinute); headroom = p.limit ? Math.max(0, Math.round((1 - p.used / p.limit) * 100)) : null; }
    return ok({ gateway: 'ok', version: svc.cfg.version, upstream: h ? { ok: h.ok, latencyMs: h.latencyMs, checkedAt: h.ts } : null, budgetHeadroomPct: headroom }, 'Gateway status');
  });

  // ---- me ----
  app.get('/api/v1/me', { preHandler: [auth(null), limits()] }, async (req) => {
    const c = req.consumer!; const keyId = c.key._id.toHexString();
    const [m, hr, d, cu, usage] = await Promise.all([
      svc.limiter.peek(`key:${keyId}`, 'minute', c.policy.limits.perMinute), svc.limiter.peek(`key:${keyId}`, 'hour', c.policy.limits.perHour), svc.limiter.peek(`key:${keyId}`, 'day', c.policy.limits.perDay),
      svc.limiter.peek(`key:${keyId}:uncached`, 'hour', c.policy.limits.createUncachedPerHour), svc.logs.monthlyUsage(c.key._id),
    ]);
    return ok({
      key: { id: keyId, name: c.key.name, prefix: c.key.prefix, scopes: c.key.scopes, expiresAt: c.key.expiresAt, createdAt: c.key.createdAt }, client: { id: c.client._id.toHexString(), name: c.client.name },
      policy: { name: c.policy.name, limits: c.policy.limits, quotas: c.policy.quotas, features: c.policy.features },
      budgets: { perMinute: { used: m.used, limit: m.limit, resetAt: m.resetAt }, perHour: { used: hr.used, limit: hr.limit, resetAt: hr.resetAt }, perDay: { used: d.used, limit: d.limit, resetAt: d.resetAt }, createUncachedPerHour: { used: cu.used, limit: cu.limit, resetAt: cu.resetAt } },
      usage: { month: usage, quotas: c.policy.quotas },
      upstream: { plan: c.upstream.plan, planName: c.upstream.plan == null ? null : PLAN_NAMES[c.upstream.plan], premiumExpiresAt: c.upstream.premiumExpiresAt, status: c.upstream.status },
    }, 'Gateway key information');
  });

  // ---- account (redacted upstream) ----
  app.get('/api/v1/account', { preHandler: [auth('user:read'), limits()] }, async (req) => {
    const c = req.consumer!; const me = c.upstream.meCache || {};
    return ok({ plan: c.upstream.plan, planName: c.upstream.plan == null ? null : PLAN_NAMES[c.upstream.plan], isSubscribed: c.upstream.isSubscribed, premiumExpiresAt: c.upstream.premiumExpiresAt, cooldownUntil: me.cooldown_until ?? null, totalDownloaded: me.total_downloaded ?? null, additionalConcurrentSlots: me.additional_concurrent_slots ?? null, longTermSeeding: me.long_term_seeding ?? null, torrentsDownloaded: me.torrents_downloaded ?? null, webDownloadsDownloaded: me.web_downloads_downloaded ?? null, usenetDownloadsDownloaded: me.usenet_downloads_downloaded ?? null, lastVerifiedAt: c.upstream.lastVerifiedAt }, 'Upstream account summary');
  });

  // ---- downloads ----
  app.get('/api/v1/downloads', { preHandler: [auth(['torrents:read', 'usenet:read', 'webdl:read']), limits()] }, async (req, reply) => {
    const q = z.object({ type: z.string().optional(), state: z.string().optional(), q: z.string().optional(), limit: z.coerce.number().min(1).max(1000).optional(), cursor: z.string().optional(), bypass_cache: z.any().optional(), mine: z.any().optional() }).parse(req.query);
    const c = req.consumer!;
    const allowed = DL_TYPES.filter((t) => c.key.scopes.includes(`${({ torrent: 'torrents', usenet: 'usenet', webdl: 'webdl' } as any)[t]}:read`));
    const types = q.type ? q.type.split(',').map((t) => t.trim()).filter((t): t is DlType => DL_TYPES.includes(t as DlType) && allowed.includes(t as DlType)) : allowed;
    const r = await svc.downloads.list(c.upstream, { types, state: q.state, q: q.q, limit: q.limit, cursor: q.cursor, bypassCache: bool(q.bypass_cache) && c.policy.features.allowBypassCache, createdByKeyId: bool(q.mine) ? c.key._id.toHexString() : undefined });
    return reply.send({ ...ok(r.items, 'Downloads retrieved'), meta: { total: r.total, next: r.next, types, errors: r.errors } });
  });

  app.post('/api/v1/downloads', { preHandler: [auth(['torrents:write', 'usenet:write', 'webdl:write'])] }, async (req, reply) => {
    const c = req.consumer!;
    const body: any = req.body || {};
    const file = req.isMultipart() ? body.file : undefined;
    const input = z.object({ type: typeParam.optional(), source: z.string().optional(), magnet: z.string().optional(), url: z.string().optional(), nzbUrl: z.string().optional(), name: z.string().max(200).optional(), seed: z.coerce.number().int().min(1).max(3).optional(), allowZip: z.any().optional(), password: z.string().optional(), postProcessing: z.coerce.number().int().min(-1).max(3).optional(), asQueued: z.any().optional(), onlyIfCached: z.any().optional(), allowDuplicate: z.any().optional(), fileName: z.string().optional() }).parse(Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'file')));
    if (input.source) { if (input.source.startsWith('magnet:')) input.magnet = input.source; else if (/\.nzb(\?|$)/i.test(input.source)) input.nzbUrl = input.source; else input.url = input.source; }
    const fileBuf = file ? (Buffer.isBuffer(file) ? file : Buffer.from(file)) : undefined;
    const fileName = input.fileName || (req as any).__fileName || (fileBuf ? (fileBuf.subarray(0, 1).toString() === 'd' ? 'upload.torrent' : 'upload.nzb') : undefined);
    if (fileBuf && !c.policy.features.allowUploads) return reply.code(403).send(fail('FEATURE_DISABLED', 'File uploads are disabled for this key.'));
    const type = input.type || (await import('../../services/downloads.js')).detectType({ magnet: input.magnet, url: input.url, nzbUrl: input.nzbUrl, fileName });
    if (!type) return reply.code(400).send(fail('INVALID_OPTION', 'Provide a magnet, an http(s) link, an NZB link or a .torrent/.nzb file.'));
    const scopeNeeded = ({ torrent: 'torrents:write', usenet: 'usenet:write', webdl: 'webdl:write' } as const)[type];
    if (!c.key.scopes.includes(scopeNeeded)) return reply.code(403).send(fail('SCOPE_DENIED', `This key lacks the required scope: ${scopeNeeded}.`));
    const limiter = ({ torrent: 'createTorrent', usenet: 'createUsenet', webdl: 'createWebdl' } as const)[type];
    let uncached = false;
    if (type === 'torrent' && !bool(input.onlyIfCached)) { const { extractHash } = await import('../../services/downloads.js'); const h = input.magnet ? extractHash(input.magnet) : null; uncached = h ? (await svc.downloads.isCached(c.upstream, 'torrent', h)) !== true : true; }
    if (!(await app.consumeLimits(req, reply, { limiter, uncached }))) return;
    try {
      const r = await svc.downloads.create(c.upstream, actor(req), { type, magnet: input.magnet, url: input.url, nzbUrl: input.nzbUrl, file: fileBuf ? { buffer: fileBuf, filename: fileName! } : undefined, name: input.name, seed: input.seed, allowZip: input.allowZip == null ? undefined : bool(input.allowZip), password: input.password, postProcessing: input.postProcessing, asQueued: bool(input.asQueued), onlyIfCached: bool(input.onlyIfCached), allowDuplicate: bool(input.allowDuplicate) });
      return reply.code(r.duplicate ? 200 : 201).send(ok({ ...r.download, duplicate: r.duplicate }, r.detail));
    } catch (e) { return sendErr(reply, e); }
  });

  app.get('/api/v1/downloads/:publicId', { preHandler: [auth(['torrents:read', 'usenet:read', 'webdl:read']), limits()] }, async (req, reply) => {
    const idx = await resolveDownload(req, reply, (req.params as any).publicId); if (!idx) return;
    const dl = await svc.downloads.getOne(req.consumer!.upstream, idx, bool((req.query as any).bypass_cache) && req.consumer!.policy.features.allowBypassCache);
    if (!dl) return reply.code(404).send(fail('ITEM_NOT_FOUND', 'This download no longer exists on the account.'));
    return ok(dl, 'Download retrieved');
  });

  app.get('/api/v1/downloads/:publicId/files', { preHandler: [auth(['torrents:read', 'usenet:read', 'webdl:read']), limits()] }, async (req, reply) => {
    const idx = await resolveDownload(req, reply, (req.params as any).publicId); if (!idx) return;
    const c = req.consumer!; const dl = await svc.downloads.getOne(c.upstream, idx);
    if (!dl) return reply.code(404).send(fail('ITEM_NOT_FOUND', 'This download no longer exists on the account.'));
    const canLink = c.key.scopes.includes('downloads:link') && c.policy.features.allowPermalinks; const canStream = c.key.scopes.includes('stream') && c.policy.features.allowStreaming;
    const keyId = c.key._id.toHexString();
    return ok({ publicId: dl.publicId, name: dl.name, zipLink: canLink ? svc.downloads.permalink(keyId, dl.publicId, 0, true) : null, files: dl.files.map((f) => ({ ...f, linkUrl: canLink ? svc.downloads.permalink(keyId, dl.publicId, f.id, false) : null, streamUrl: canStream && /^video\//.test(f.mimetype || '') ? svc.downloads.streamLink(keyId, dl.publicId, f.id) : null })) }, 'Files retrieved');
  });

  app.get('/api/v1/downloads/:publicId/link', { preHandler: [auth('downloads:link'), limits()] }, async (req, reply) => {
    const idx = await resolveDownload(req, reply, (req.params as any).publicId); if (!idx) return;
    const q = z.object({ file: z.coerce.number().int().min(0).optional(), zip: z.any().optional(), redirect: z.any().optional(), permalink: z.any().optional(), expires_in: z.coerce.number().int().min(60).max(31536000).optional() }).parse(req.query);
    const c = req.consumer!;
    if (bool(q.permalink)) { if (!c.policy.features.allowPermalinks) return reply.code(403).send(fail('FEATURE_DISABLED', 'Permalinks are disabled for this key.')); return ok({ url: svc.downloads.permalink(c.key._id.toHexString(), idx.publicId, q.file ?? 0, bool(q.zip), q.expires_in ? new Date(Date.now() + q.expires_in * 1000) : null) }, 'Permalink created'); }
    const r = await svc.downloads.requestLink(c.upstream, actor(req), idx, { fileId: q.file, zip: bool(q.zip), userIp: c.ip, via: 'api' });
    req.torboxError = r.success ? null : r.error;
    if (!r.success) return reply.code(r.status >= 400 && r.status < 500 ? r.status : 502).send(fail(r.error || 'UPSTREAM_ERROR', r.detail));
    if (bool(q.redirect)) return reply.redirect(r.data, 307);
    return ok({ url: r.data, expiresAt: new Date(Date.now() + 3 * 3600e3).toISOString() }, r.detail);
  });

  app.post('/api/v1/downloads/:publicId/actions/:action', { preHandler: [auth(['torrents:write', 'usenet:write', 'webdl:write']), limits()] }, async (req, reply) => {
    const { publicId, action } = req.params as any;
    if (!['delete', 'reannounce', 'resume', 'pause', 'stop_seeding'].includes(action)) return reply.code(400).send(fail('INVALID_OPTION', "Action must be one of: delete, reannounce, resume, pause, stop_seeding."));
    const idx = await resolveDownload(req, reply, publicId); if (!idx) return;
    const c = req.consumer!; const need = ({ torrent: 'torrents:write', usenet: 'usenet:write', webdl: 'webdl:write' } as const)[idx.type];
    if (!c.key.scopes.includes(need)) return reply.code(403).send(fail('SCOPE_DENIED', `This key lacks the required scope: ${need}.`));
    const r = await svc.downloads.control(c.upstream, actor(req), idx, action);
    req.torboxError = r.success ? null : r.error;
    return reply.code(r.success ? 200 : r.status >= 400 && r.status < 500 ? r.status : 502).send({ success: r.success, error: r.error, detail: r.detail, data: r.data });
  });

  app.patch('/api/v1/downloads/:publicId', { preHandler: [auth(['torrents:write', 'usenet:write', 'webdl:write']), limits()] }, async (req, reply) => {
    const idx = await resolveDownload(req, reply, (req.params as any).publicId); if (!idx) return;
    const body = z.object({ name: z.string().min(1).max(200).optional(), tags: z.array(z.string().max(200)).optional(), alternativeHashes: z.array(z.string()).optional(), airlocked: z.boolean().optional() }).parse(req.body || {});
    const c = req.consumer!; const need = ({ torrent: 'torrents:write', usenet: 'usenet:write', webdl: 'webdl:write' } as const)[idx.type];
    if (!c.key.scopes.includes(need)) return reply.code(403).send(fail('SCOPE_DENIED', `This key lacks the required scope: ${need}.`));
    const r = await svc.downloads.edit(c.upstream, actor(req), idx, body);
    req.torboxError = r.success ? null : r.error;
    return reply.code(r.success ? 200 : r.status >= 400 && r.status < 500 ? r.status : 502).send({ success: r.success, error: r.error, detail: r.detail, data: r.data });
  });

  // ---- cache & link checks ----
  app.post('/api/v1/cache/check', { preHandler: [auth(['torrents:read', 'usenet:read', 'webdl:read']), limits()] }, async (req, reply) => {
    const body = z.object({ hashes: z.array(z.string().min(8)).min(1).max(5000), type: typeParam.optional(), listFiles: z.boolean().optional() }).parse(req.body || {});
    const c = req.consumer!; const types: DlType[] = body.type ? [body.type] : DL_TYPES.filter((t) => c.key.scopes.includes(`${({ torrent: 'torrents', usenet: 'usenet', webdl: 'webdl' } as any)[t]}:read`));
    const out: Record<string, any> = Object.fromEntries(body.hashes.map((h) => [h.toLowerCase(), { cached: false }]));
    for (const t of types) {
      for (let i = 0; i < body.hashes.length; i += 100) {
        const batch = body.hashes.slice(i, i + 100);
        const ck = svc.cache.key(['cachecheck', c.upstream._id.toHexString(), t, body.listFiles ? 1 : 0, [...batch].sort().join(',')]);
        let data: any; const hit = await svc.cache.get(ck, t);
        if (hit) data = JSON.parse(hit.body.toString()); else {
          const r = await svc.torbox.call<any>(c.upstreamKey, 'POST', PATHS[t].checkcached, { query: { format: 'list', list_files: body.listFiles ? 'true' : 'false' }, json: { hashes: batch } });
          if (!r.success) { req.torboxError = r.error; continue; }
          data = Array.isArray(r.data) ? r.data : r.data ? Object.values(r.data) : [];
          await svc.cache.set(ck, t, c.upstream._id.toHexString(), 200, 'application/json', Buffer.from(JSON.stringify(data)), 3600);
        }
        for (const d of data) if (d?.hash) out[d.hash.toLowerCase()] = { cached: true, type: t, name: d.name, size: d.size, ...(d.files ? { files: d.files } : {}) };
      }
    }
    return ok(out, 'Cache status retrieved');
  });

  app.get('/api/v1/hosters', { preHandler: [auth('webdl:read'), limits()] }, async (req) => {
    const live = bool((req.query as any).live); const c = req.consumer!;
    const ck = svc.cache.key(['hosters', live ? c.upstream._id.toHexString() : 'global']);
    const hit = await svc.cache.get(ck, 'webdl'); if (hit) { req.cacheHit = true; return JSON.parse(hit.body.toString()); }
    const r = await svc.torbox.call<any>(live ? c.upstreamKey : null, 'GET', '/v1/api/webdl/hosters');
    if (r.success) await svc.cache.set(ck, 'webdl', null, 200, 'application/json', Buffer.from(JSON.stringify(ok(r.data, r.detail))), live ? 300 : 3600);
    return r.success ? ok(r.data, r.detail) : fail(r.error || 'UPSTREAM_ERROR', r.detail);
  });

  app.post('/api/v1/links/check', { preHandler: [auth('webdl:read'), limits()] }, async (req, reply) => {
    const body = z.object({ urls: z.array(z.string().url()).min(1).max(500) }).parse(req.body || {});
    const ck = svc.cache.key(['hosters', 'global']); let hosters: any[] | null = null;
    const hit = await svc.cache.get(ck, 'webdl'); if (hit) hosters = JSON.parse(hit.body.toString()).data;
    if (!hosters) { const r = await svc.torbox.call<any>(null, 'GET', '/v1/api/webdl/hosters'); if (!r.success) return reply.code(502).send(fail(r.error || 'UPSTREAM_ERROR', r.detail)); hosters = r.data; await svc.cache.set(ck, 'webdl', null, 200, 'application/json', Buffer.from(JSON.stringify(ok(r.data, r.detail))), 3600); }
    const compiled = (hosters || []).map((h: any) => ({ h, re: safeRegex(h.regex) }));
    return ok(body.urls.map((u) => { const host = new URL(u).hostname.toLowerCase(); const m = compiled.find(({ h, re }) => (re && re.test(u)) || (h.domains || []).some((d: string) => host === d || host.endsWith(`.${d}`))); return m ? { url: u, supported: true, hoster: m.h.name, status: !!m.h.status, note: m.h.note, nsfw: !!m.h.nsfw, type: m.h.type, limits: { dailyLinkLimit: m.h.daily_link_limit, dailyBandwidthLimit: m.h.daily_bandwidth_limit, perLinkSizeLimit: m.h.per_link_size_limit } } : { url: u, supported: /^https?:\/\//.test(u) && /\.(mkv|mp4|avi|zip|rar|7z|iso|pdf|jpg|png|mp3|flac)(\?|$)/i.test(u) ? 'direct' : false, hoster: null }; }), 'Link check complete');
  });

  // ---- torrent info / magnet to file ----
  app.get('/api/v1/torrents/info', { preHandler: [auth('torrents:read'), limits()] }, async (req, reply) => {
    const q = z.object({ hash: z.string().optional(), magnet: z.string().optional(), timeout: z.coerce.number().int().min(1).max(60).optional() }).parse(req.query);
    const { extractHash } = await import('../../services/downloads.js'); const h = q.hash || (q.magnet ? extractHash(q.magnet) : null);
    if (!h) return reply.code(400).send(fail('MISSING_REQUIRED_OPTION', 'Provide hash= or magnet='));
    const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'GET', '/v1/api/torrents/torrentinfo', { query: { hash: h, timeout: String(q.timeout ?? 10), use_cache_lookup: 'true' }, timeoutMs: 70000 });
    req.torboxError = r.success ? null : r.error;
    const cached = await svc.downloads.isCached(req.consumer!.upstream, 'torrent', h);
    return reply.code(r.success ? 200 : 502).send({ ...r, data: r.data ? { ...r.data, cached } : r.data, status: undefined, durationMs: undefined });
  });
  app.post('/api/v1/torrents/magnet-to-file', { preHandler: [auth('general'), limits()] }, async (req, reply) => {
    const body = z.object({ magnet: z.string().startsWith('magnet:') }).parse(req.body || {});
    const up = await svc.torbox.request({ method: 'POST', path: '/v1/api/torrents/magnettofile', body: JSON.stringify(body), contentType: 'application/json' });
    if (up.json && up.json.success === false) return reply.code(502).send(up.json);
    return reply.header('content-type', up.contentType || 'application/x-bittorrent').header('content-disposition', 'attachment; filename="magnet.torrent"').send(up.body);
  });

  // ---- queue ----
  app.get('/api/v1/queue', { preHandler: [auth(['torrents:read', 'usenet:read', 'webdl:read']), limits()] }, async (req) => {
    const t = (typeParam.optional().parse((req.query as any).type) || 'torrent');
    const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'GET', '/v1/api/queued/getqueued', { query: { type: t } });
    return { success: r.success || r.error === 'ITEM_NOT_FOUND', error: r.error === 'ITEM_NOT_FOUND' ? null : r.error, detail: r.detail, data: r.data || [] };
  });
  app.post('/api/v1/queue/:queuedId/actions/:action', { preHandler: [auth(['torrents:write', 'usenet:write', 'webdl:write']), limits()] }, async (req, reply) => {
    const { queuedId, action } = req.params as any; if (!['start', 'delete'].includes(action)) return reply.code(400).send(fail('INVALID_OPTION', 'Action must be start or delete.'));
    const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'POST', '/v1/api/queued/controlqueued', { json: { queued_id: Number(queuedId), operation: action } });
    await svc.logs.logActivity({ ts: new Date(), kind: 'control', ...actor(req), upstreamAccountId: req.consumer!.upstream._id.toHexString(), type: null, publicId: null, torboxId: Number(queuedId), hash: null, name: 'queued item', action: `queue:${action}`, success: !!r.success, error: r.success ? null : r.error, detail: r.detail });
    return reply.code(r.success ? 200 : 400).send({ success: r.success, error: r.error, detail: r.detail, data: r.data });
  });

  // ---- stream ----
  app.get('/api/v1/stream/:publicId/:fileId', { preHandler: [auth('stream'), limits()] }, async (req, reply) => {
    const c = req.consumer!; if (!c.policy.features.allowStreaming) return reply.code(403).send(fail('FEATURE_DISABLED', 'Streaming is disabled for this key.'));
    const idx = await resolveDownload(req, reply, (req.params as any).publicId); if (!idx) return;
    const q = z.object({ audio: z.coerce.number().int().optional(), subtitle: z.coerce.number().int().optional(), resolution: z.coerce.number().int().optional() }).parse(req.query);
    const r = await svc.downloads.createStream(c.upstream, actor(req), idx, { fileId: Number((req.params as any).fileId), audio: q.audio, subtitle: q.subtitle, resolution: q.resolution });
    req.torboxError = r.success ? null : r.error;
    if (!r.success) return reply.code(r.error === 'PLAN_RESTRICTED_FEATURE' ? 402 : 502).send(fail(r.error || 'UPSTREAM_ERROR', r.detail));
    const d = r.data; return ok({ hlsUrl: d.hls_url, entryUrl: svc.downloads.streamLink(c.key._id.toHexString(), idx.publicId, Number((req.params as any).fileId)), presignedToken: d.presigned_token, needsTranscoding: d.needs_transcoding, isTranscoding: d.is_transcoding, audioIndex: d.audio_index, subtitleIndex: d.subtitle_index, resolutionIndex: d.resolution_index, metadata: d.metadata, searchMetadata: d.search_metadata, intro: d.intro_information, name: d.name, mimetype: d.mimetype, size: d.size }, r.detail);
  });

  // ---- RSS ----
  app.get('/api/v1/rss/feeds', { preHandler: [auth('rss:read'), limits()] }, async (req) => { const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'GET', '/v1/api/rss/getfeeds', { query: (req.query as any).id ? { id: String((req.query as any).id) } : {} }); return { success: r.success, error: r.error, detail: r.detail, data: r.data }; });
  app.get('/api/v1/rss/feeds/:id/items', { preHandler: [auth('rss:read'), limits()] }, async (req) => { const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'GET', '/v1/api/rss/getfeeditems', { query: { rss_feed_id: String((req.params as any).id) } }); return { success: r.success, error: r.error, detail: r.detail, data: r.data }; });
  app.post('/api/v1/rss/feeds', { preHandler: [auth('rss:write'), limits()] }, async (req, reply) => { const b = z.object({ url: z.string().url(), name: z.string().min(1), do_regex: z.string().optional(), dont_regex: z.string().optional(), dont_older_than: z.number().optional(), scan_interval: z.number().min(10).optional(), pass_check: z.boolean().optional(), rss_type: z.enum(['torrent', 'usenet', 'webdl']).optional(), torrent_seeding: z.number().min(1).max(3).optional() }).parse(req.body || {}); const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'POST', '/v1/api/rss/addrss', { json: b }); await svc.logs.logActivity({ ts: new Date(), kind: 'control', ...actor(req), upstreamAccountId: req.consumer!.upstream._id.toHexString(), type: null, publicId: null, torboxId: null, hash: null, name: b.name, action: 'rss:add', input: { url: b.url }, success: !!r.success, error: r.success ? null : r.error, detail: r.detail }); return reply.code(r.success ? 201 : 400).send({ success: r.success, error: r.error, detail: r.detail, data: r.data }); });
  app.patch('/api/v1/rss/feeds/:id', { preHandler: [auth('rss:write'), limits()] }, async (req, reply) => { const b: any = req.body || {}; const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'POST', '/v1/api/rss/modifyrss', { json: { ...b, rss_feed_id: Number((req.params as any).id) } }); return reply.code(r.success ? 200 : 400).send({ success: r.success, error: r.error, detail: r.detail, data: r.data }); });
  app.post('/api/v1/rss/feeds/:id/actions/:action', { preHandler: [auth('rss:write'), limits()] }, async (req, reply) => { const { id, action } = req.params as any; if (!['update', 'delete', 'pause', 'resume'].includes(action)) return reply.code(400).send(fail('INVALID_OPTION', 'Action must be update, delete, pause or resume.')); const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'POST', '/v1/api/rss/controlrss', { json: { rss_feed_id: Number(id), operation: action } }); await svc.logs.logActivity({ ts: new Date(), kind: 'control', ...actor(req), upstreamAccountId: req.consumer!.upstream._id.toHexString(), type: null, publicId: null, torboxId: Number(id), hash: null, name: 'rss feed', action: `rss:${action}`, success: !!r.success, error: r.success ? null : r.error, detail: r.detail }); return reply.code(r.success ? 200 : 400).send({ success: r.success, error: r.error, detail: r.detail, data: r.data }); });

  // ---- notifications ----
  app.get('/api/v1/notifications', { preHandler: [auth('notifications:read'), limits()] }, async (req) => { const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'GET', '/v1/api/notifications/mynotifications'); return { success: r.success, error: r.error, detail: r.detail, data: r.data }; });
  app.delete('/api/v1/notifications', { preHandler: [auth('notifications:write'), limits()] }, async (req) => { const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'POST', '/v1/api/notifications/clear'); return { success: r.success, error: r.error, detail: r.detail, data: r.data }; });
  app.delete('/api/v1/notifications/:id', { preHandler: [auth('notifications:write'), limits()] }, async (req) => { const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'POST', `/v1/api/notifications/clear/${encodeURIComponent((req.params as any).id)}`); return { success: r.success, error: r.error, detail: r.detail, data: r.data }; });
  app.post('/api/v1/notifications/test', { preHandler: [auth('notifications:write'), limits('testNotification')] }, async (req) => { const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'POST', '/v1/api/notifications/test'); return { success: r.success, error: r.error, detail: r.detail, data: r.data }; });

  // ---- integrations ----
  app.get('/api/v1/integrations/jobs', { preHandler: [auth('integrations:read'), limits()] }, async (req) => { const h = (req.query as any).hash; const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'GET', h ? `/v1/api/integration/jobs/${encodeURIComponent(h)}` : '/v1/api/integration/jobs'); return { success: r.success, error: r.error, detail: r.detail, data: r.data }; });
  app.get('/api/v1/integrations/jobs/:id', { preHandler: [auth('integrations:read'), limits()] }, async (req) => { const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'GET', `/v1/api/integration/job/${encodeURIComponent((req.params as any).id)}`); return { success: r.success, error: r.error, detail: r.detail, data: r.data }; });
  app.delete('/api/v1/integrations/jobs/:id', { preHandler: [auth('integrations:write'), limits()] }, async (req) => { const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'DELETE', `/v1/api/integration/job/${encodeURIComponent((req.params as any).id)}`); return { success: r.success, error: r.error, detail: r.detail, data: r.data }; });
  app.post('/api/v1/integrations/:provider/upload', { preHandler: [auth('integrations:write'), limits()] }, async (req, reply) => {
    const provider = String((req.params as any).provider); if (!['googledrive', 'dropbox', 'onedrive', 'gofile', '1fichier', 'pixeldrain'].includes(provider)) return reply.code(400).send(fail('INVALID_OPTION', 'Unknown provider.'));
    const b = z.object({ publicId: z.string(), fileId: z.number().int().optional(), zip: z.boolean().optional(), token: z.string().optional() }).parse(req.body || {});
    const idx = await resolveDownload(req, reply, b.publicId); if (!idx) return;
    const tokenField = ({ googledrive: 'google_token', dropbox: 'dropbox_token', onedrive: 'onedrive_token', gofile: 'gofile_token', '1fichier': 'onefichier_token', pixeldrain: 'pixeldrain_token' } as any)[provider];
    const json: any = { id: idx.torboxId, file_id: b.fileId ?? null, zip: !!b.zip, type: PATHS[idx.type].streamType === 'webdownload' ? 'webdl' : idx.type }; if (b.token) json[tokenField] = b.token;
    const r = await svc.torbox.call<any>(req.consumer!.upstreamKey, 'POST', `/v1/api/integration/${provider}`, { json });
    await svc.logs.logActivity({ ts: new Date(), kind: 'control', ...actor(req), upstreamAccountId: idx.upstreamAccountId, type: idx.type, publicId: idx.publicId, torboxId: idx.torboxId, hash: idx.hash, name: idx.name, action: `upload:${provider}`, success: !!r.success, error: r.success ? null : r.error, detail: r.detail });
    return reply.code(r.success ? 202 : 400).send({ success: r.success, error: r.error, detail: r.detail, data: r.data });
  });

  // ---- events & webhooks (consumer self-service) ----
  app.get('/api/v1/events', { preHandler: [auth('webhooks'), limits()] }, async (req) => {
    const q = z.object({ since: z.string().optional(), type: z.string().optional(), limit: z.coerce.number().min(1).max(500).optional() }).parse(req.query);
    const c = req.consumer!; const f: any = { upstreamAccountId: c.upstream._id.toHexString(), $or: [{ createdByKeyId: c.key._id }, { createdByKeyId: null }] };
    if (q.since) f.ts = { $gt: new Date(q.since) }; if (q.type) f.type = q.type;
    const items = await svc.webhooks.events().find(f).sort({ ts: 1 }).limit(q.limit || 100).toArray();
    return ok(items.map((e) => svc.webhooks.payloadFor(e)), 'Events retrieved');
  });
  app.get('/api/v1/webhooks', { preHandler: [auth('webhooks'), limits()] }, async (req) => { const c = req.consumer!; const items = await svc.webhooks.endpoints().find({ keyId: c.key._id }).toArray(); return ok(items.map((e) => ({ id: e._id.toHexString(), url: e.url, events: e.events, active: e.active, failureCount: e.failureCount, disabledReason: e.disabledReason, createdAt: e.createdAt })), 'Webhooks retrieved'); });
  app.post('/api/v1/webhooks', { preHandler: [auth('webhooks'), limits()] }, async (req, reply) => {
    const c = req.consumer!; if (!c.policy.features.allowWebhooks) return reply.code(403).send(fail('FEATURE_DISABLED', 'Webhooks are disabled for this key.'));
    const b = z.object({ url: z.string().url().refine((u) => u.startsWith('https://') || svc.cfg.NODE_ENV !== 'production', 'Webhook URLs must use https'), events: z.array(z.enum(EVENT_TYPES as any)).optional() }).parse(req.body || {});
    if ((await svc.webhooks.endpoints().countDocuments({ keyId: c.key._id })) >= 10) return reply.code(400).send(fail('LIMIT', 'At most 10 webhook endpoints per key.'));
    const r = await svc.webhooks.createEndpoint({ clientId: c.client._id.toHexString(), keyId: c.key._id.toHexString(), url: b.url, events: b.events || ['*'] });
    return reply.code(201).send(ok({ id: r.endpoint._id.toHexString(), url: r.endpoint.url, events: r.endpoint.events, secret: r.secret }, 'Webhook created. Store the secret: it is shown once.'));
  });
  app.delete('/api/v1/webhooks/:id', { preHandler: [auth('webhooks'), limits()] }, async (req, reply) => { const c = req.consumer!; const r = await svc.webhooks.endpoints().deleteOne({ _id: new ObjectId((req.params as any).id), keyId: c.key._id }); return r.deletedCount ? ok(null, 'Webhook deleted') : reply.code(404).send(fail('ITEM_NOT_FOUND', 'Webhook not found')); });
  app.post('/api/v1/webhooks/:id/test', { preHandler: [auth('webhooks'), limits()] }, async (req, reply) => { const c = req.consumer!; const ep = await svc.webhooks.endpoints().findOne({ _id: new ObjectId((req.params as any).id), keyId: c.key._id }); if (!ep) return reply.code(404).send(fail('ITEM_NOT_FOUND', 'Webhook not found')); const r = await svc.webhooks.enqueueTest(ep); return ok(r, r.ok ? 'Test delivered' : 'Test delivery failed'); });
}

function safeRegex(src?: string): RegExp | null { if (!src) return null; try { return new RegExp(src, 'i'); } catch { return null; } }
