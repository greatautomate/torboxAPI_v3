/**
 * 1:1 mirror of the TorBox API under /v1/api/*. Consumers authenticate with a gateway key; the upstream TorBox key
 * is injected server-side. Bodies and responses are passed through untouched (JSON, XML, PDF, .torrent bytes, redirects).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ObjectId } from 'mongodb';
import { matchRoute, type RouteDef } from '../../torbox/routeTable.js';
import { fail } from '../../shared/errors.js';
import { hasScope } from '../../shared/scopes.js';
import { extractHash, type DlType } from '../../services/downloads.js';
import { maskEmail } from '../../services/upstreams.js';

const SETTINGS_BLOCKLIST = new Set(['webhook_url', 'webhook_notifications', 'email_notifications', 'discord_id', 'telegram_id', 'patreon_id', 'mega_email', 'mega_password', 'pixeldrain_api_key', 'onefichier_api_key', 'gofile_api_key', 'google_drive_folder_id', 'onedrive_save_path', 'onefichier_folder_id', 'gofile_folder_id']);
const SETTINGS_SECRETS = ['mega_password', 'pixeldrain_api_key', 'onefichier_api_key', 'gofile_api_key', 'webhook_url', 'telegram_id', 'discord_id', 'patreon_id', 'mega_email'];

function parseMultipartFields(buf: Buffer, contentType: string): Record<string, string> {
  const m = /boundary="?([^";]+)"?/.exec(contentType); const out: Record<string, string> = {};
  if (!m) return out;
  for (const part of buf.toString('latin1').split(`--${m[1]}`)) {
    const nm = /name="([^"]+)"/.exec(part); if (!nm) continue;
    const idx = part.indexOf('\r\n\r\n'); if (idx < 0) continue;
    out[nm[1]] = /filename="/.test(part.slice(0, idx)) ? `<file:${/filename="([^"]*)"/.exec(part)?.[1] || ''}>` : part.slice(idx + 4).replace(/\r\n$/, '').slice(0, 4096);
  }
  return out;
}

export default async function compatRoutes(app: FastifyInstance) {
  const svc = app.svc;
  // Raw pass-through parsers (scoped to this plugin): keep bytes untouched so multipart boundaries survive.
  app.addContentTypeParser(['multipart/form-data', 'application/x-www-form-urlencoded', 'application/octet-stream', 'text/plain'], { parseAs: 'buffer', bodyLimit: svc.cfg.MAX_UPLOAD_MB * 1024 * 1024 }, (_req, body, done) => done(null, body));
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 2 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    req.surface = 'compat';
    const url = new URL(req.url, 'http://x');
    const pathname = url.pathname === '/v1/api' || url.pathname === '/v1/api/' ? '/' : url.pathname;
    const route = matchRoute(req.method === 'HEAD' ? 'GET' : req.method, pathname);
    if (!route) return reply.code(404).send(fail('ENDPOINT_NOT_FOUND', `No TorBox endpoint matches ${req.method} ${pathname}.`));
    if (route.blocked) return reply.code(403).send(fail('ENDPOINT_BLOCKED', `This endpoint is not available through the gateway: ${route.blockedReason}.`));
    const c = await app.authenticateConsumer(req, reply, { scope: route.scope, allowQueryToken: route.tokenInQuery });
    if (!c) return;
    const settings = await svc.settings.get();
    if (settings.maintenance.readOnly && route.write) return reply.code(503).send(fail('READ_ONLY', 'The gateway is in read-only mode; write operations are temporarily disabled.'));
    if (route.bodyMode === 'multipart' && !c.policy.features.allowUploads && Buffer.isBuffer(req.body) && /filename=/.test(req.body.subarray(0, 4096).toString('latin1'))) return reply.code(403).send(fail('FEATURE_DISABLED', 'File uploads are disabled for this key.'));
    if (route.group === 'stream' && !c.policy.features.allowStreaming) return reply.code(403).send(fail('FEATURE_DISABLED', 'Streaming is disabled for this key.'));

    // Query: drop our token, honour bypass_cache only when allowed
    const query = new URLSearchParams(url.search);
    query.delete('token'); query.delete('api_key');
    if (query.get('bypass_cache') === 'true' && !c.policy.features.allowBypassCache) query.set('bypass_cache', 'false');

    // Body preparation + parsed fields for classification/activity
    const ct = String(req.headers['content-type'] || '');
    let body: Buffer | null = null; let fields: Record<string, any> = {};
    if (Buffer.isBuffer(req.body)) {
      body = req.body;
      if (route.bodyMode === 'multipart' && ct.includes('multipart')) fields = parseMultipartFields(body, ct);
      else if (ct.includes('x-www-form-urlencoded')) fields = Object.fromEntries(new URLSearchParams(body.toString()));
      else if (ct.includes('json')) { try { fields = JSON.parse(body.toString() || '{}'); } catch { return reply.code(400).send(fail('INVALID_JSON', 'Request body is not valid JSON.')); } }
    }
    if (route.path === '/v1/api/user/settings/editsettings') {
      if (!c.policy.features.allowSettingsWrite) return reply.code(403).send(fail('FEATURE_DISABLED', 'Editing upstream settings is disabled for this key.'));
      const blocked = Object.keys(fields).filter((k) => SETTINGS_BLOCKLIST.has(k));
      if (blocked.length) return reply.code(403).send(fail('FIELD_BLOCKED', `These settings can only be changed by the operator: ${blocked.join(', ')}.`));
    }

    // Uncached classification for torrent creates (TorBox charges uncached adds against a separate 60/h pool)
    let uncached = false;
    if (route.limiter === 'createTorrent') {
      if (fields.add_only_if_cached === 'true') uncached = false;
      else { const h = fields.magnet ? extractHash(String(fields.magnet)) : null; const cached = h ? await svc.downloads.isCached(c.upstream, 'torrent', h) : null; uncached = cached !== true; }
    }
    if (!(await app.consumeLimits(req, reply, { limiter: route.limiter, uncached }))) return;

    // Cache
    const accountId = c.upstream._id.toHexString();
    const ttl = c.policy.cacheTtlOverrides?.[route.group] ?? route.cacheTtl;
    const sortedQuery = new URLSearchParams([...query.entries()].sort()).toString();
    const cacheKey = svc.cache.key(['compat', route.method, route.path, accountId, sortedQuery]);
    if (req.method === 'GET' && ttl > 0 && query.get('bypass_cache') !== 'true') {
      const hit = await svc.cache.get(cacheKey, route.group);
      if (hit) { req.cacheHit = true; req.upstreamStatus = hit.status; return reply.code(hit.status).header('content-type', hit.contentType).header('x-tbg-cache', 'HIT').header('x-tbg-request-id', req.id).send(hit.body); }
    }

    // Forward
    const fwdHeaders: Record<string, string> = {};
    if (body && ct) fwdHeaders['content-type'] = ct;
    if (req.headers.accept) fwdHeaders.accept = String(req.headers.accept);
    if (req.headers.range) fwdHeaders.range = String(req.headers.range);
    let up;
    try {
      up = await svc.torbox.request({ method: req.method, path: route.path === '/' ? '/' : pathname, apiKey: c.upstreamKey, tokenInQuery: route.tokenInQuery, query, body, headers: fwdHeaders, redirect: 'manual', timeoutMs: route.bodyMode === 'multipart' ? 120000 : undefined });
    } catch (e: any) {
      req.torboxError = 'UPSTREAM_UNAVAILABLE';
      return reply.code(502).send(fail(e?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', 'Could not reach TorBox. Please retry shortly.'));
    }
    req.upstreamMs = up.durationMs; req.upstreamStatus = up.status;
    const json = up.json;
    if (json) req.torboxError = json.error && json.success === false ? json.error : null;

    // Activity + index side effects
    await recordActivity(app, req, route, fields, query, json, up.headers.location).catch((e) => req.log.warn({ err: e }, 'activity record failed'));
    if (route.write && json?.success) await svc.cache.invalidate({ group: route.group, upstreamAccountId: accountId });

    // Response
    reply.header('x-tbg-request-id', req.id).header('x-tbg-cache', ttl > 0 ? 'MISS' : 'BYPASS');
    if (up.status >= 300 && up.status < 400 && up.headers.location) return reply.code(up.status).header('location', up.headers.location).send();
    let outBody: Buffer = up.body;
    if (json && route.path === '/v1/api/user/me' && json.success && json.data && !hasScope(c.key.scopes, 'user:pii')) {
      const d: any = { ...(json.data as any) }; d.email = maskEmail(d.email); d.base_email = maskEmail(d.base_email); delete d.customer; delete d.auth_id;
      if (d.settings) for (const k of SETTINGS_SECRETS) if (k in d.settings) d.settings[k] = d.settings[k] ? '***' : d.settings[k];
      outBody = Buffer.from(JSON.stringify({ ...json, data: d }));
    }
    if (!json && up.status >= 400 && !up.contentType.includes('json')) outBody = Buffer.from(JSON.stringify(fail('UPSTREAM_ERROR', `TorBox returned HTTP ${up.status} with a non-JSON body.`, { status: up.status })));
    const outCt = !json && up.status >= 400 ? 'application/json' : up.contentType || 'application/json';
    if (ttl > 0 && req.method === 'GET' && up.status === 200 && json?.success !== false) await svc.cache.set(cacheKey, route.group, accountId, up.status, outCt, outBody, ttl);
    for (const h of ['content-disposition', 'cache-control']) if (up.headers[h]) reply.header(h, up.headers[h]);
    return reply.code(up.status).header('content-type', outCt).send(outBody);
  };

  app.all('/v1/api', handler);
  app.all('/v1/api/*', handler);
}

async function recordActivity(app: FastifyInstance, req: FastifyRequest, route: RouteDef, fields: Record<string, any>, query: URLSearchParams, json: any, location?: string) {
  const svc = app.svc; const c = req.consumer!; const accountId = c.upstream._id.toHexString();
  const actor = { keyId: c.key._id, keyName: c.key.name, clientId: c.client._id, clientName: c.client.name, ip: c.ip, requestId: req.id as string };
  const base = { ts: new Date(), ...actor, upstreamAccountId: accountId, success: !!json?.success, error: json?.success ? null : json?.error ?? 'UPSTREAM_ERROR', detail: json?.detail ?? null };
  const type = route.type as DlType | undefined;
  if (route.limiter === 'createTorrent' || route.limiter === 'createUsenet' || route.limiter === 'createWebdl') {
    const torboxId: number | undefined = json?.data?.torrent_id ?? json?.data?.usenetdownload_id ?? json?.data?.webdownload_id;
    const hash: string | null = json?.data?.hash ?? (fields.magnet ? extractHash(String(fields.magnet)) : null);
    let publicId: string | null = null;
    if (json?.success && torboxId != null && type) { const idx = await svc.downloads.ensureIndexed(accountId, type, [{ id: torboxId, hash, name: fields.name || null }], { keyId: c.key._id, keyName: c.key.name }); publicId = idx.get(torboxId)?.publicId ?? null; }
    const input: Record<string, unknown> = {};
    if (fields.magnet) input.magnet = fields.magnet; if (fields.link) input.url = fields.link; if (fields.file) input.fileName = String(fields.file).replace(/^<file:|>$/g, ''); if (fields.name) input.name = fields.name; if (fields.password) input.password = '***'; if (fields.as_queued) input.asQueued = fields.as_queued; if (fields.add_only_if_cached) input.onlyIfCached = fields.add_only_if_cached; if (fields.seed) input.seed = fields.seed;
    return svc.logs.logActivity({ ...base, kind: 'submit', type: type ?? null, publicId, torboxId: torboxId ?? null, hash, name: fields.name || null, input });
  }
  if (route.tokenInQuery && route.path.endsWith('/requestdl') && type) {
    const id = Number(query.get('torrent_id') || query.get('usenet_id') || query.get('web_id'));
    const idx = id ? (await svc.downloads.index().findOne({ upstreamAccountId: accountId, type, torboxId: id })) : null;
    const cdnUrl = json?.success ? json.data : req.upstreamStatus && req.upstreamStatus >= 300 && req.upstreamStatus < 400 ? location || '(redirected)' : null;
    return svc.logs.logActivity({ ...base, success: !!json?.success || (req.upstreamStatus! >= 300 && req.upstreamStatus! < 400), kind: 'link', type, publicId: idx?.publicId ?? null, torboxId: id || null, hash: idx?.hash ?? null, name: idx?.name ?? null, action: 'compat', output: { cdnUrl, fileId: Number(query.get('file_id') || 0), zip: query.get('zip_link') === 'true', expiresAt: new Date(Date.now() + 3 * 3600e3).toISOString() } });
  }
  if (route.path.includes('/control') && type) {
    const id = Number(fields.torrent_id ?? fields.usenet_id ?? fields.webdl_id);
    const idx = id ? await svc.downloads.index().findOne({ upstreamAccountId: accountId, type, torboxId: id }) : null;
    if (json?.success && fields.operation === 'delete') { if (fields.all) await svc.downloads.index().updateMany({ upstreamAccountId: accountId, type, deletedAt: null }, { $set: { deletedAt: new Date() } }); else if (idx) await svc.downloads.index().updateOne({ _id: idx._id }, { $set: { deletedAt: new Date() } }); }
    return svc.logs.logActivity({ ...base, kind: 'control', type, publicId: idx?.publicId ?? null, torboxId: id || null, hash: idx?.hash ?? null, name: idx?.name ?? null, action: `${fields.operation}${fields.all ? ' (all)' : ''}` });
  }
  if (route.path.includes('/edit') && type) {
    const id = Number(fields.torrent_id ?? fields.usenet_download_id ?? fields.webdl_id);
    const idx = id ? await svc.downloads.index().findOne({ upstreamAccountId: accountId, type, torboxId: id }) : null;
    return svc.logs.logActivity({ ...base, kind: 'edit', type, publicId: idx?.publicId ?? null, torboxId: id || null, hash: idx?.hash ?? null, name: fields.name ?? idx?.name ?? null, action: 'edit', input: { name: fields.name, tags: fields.tags, alternative_hashes: fields.alternative_hashes, airlocked: fields.airlocked } });
  }
  if (route.group === 'stream' && route.path.endsWith('/createstream')) {
    const id = Number(query.get('id')); const t = ({ torrent: 'torrent', usenet: 'usenet', webdownload: 'webdl' } as Record<string, DlType>)[query.get('type') || 'torrent'];
    const idx = id && t ? await svc.downloads.index().findOne({ upstreamAccountId: accountId, type: t, torboxId: id }) : null;
    return svc.logs.logActivity({ ...base, kind: 'stream', type: t ?? null, publicId: idx?.publicId ?? null, torboxId: id || null, hash: idx?.hash ?? null, name: idx?.name ?? null, output: { hlsUrl: json?.data?.hls_url ?? null, fileId: Number(query.get('file_id') || 0) } });
  }
  if (route.group === 'queued' && !route.write) return;
  if (route.group === 'queued' || route.group === 'rss' || (route.group === 'notifications' && route.write) || route.path === '/v1/api/user/settings/editsettings') {
    return svc.logs.logActivity({ ...base, kind: 'control', type: null, publicId: null, torboxId: fields.queued_id ?? fields.rss_feed_id ?? null, hash: null, name: route.summary, action: `${route.group}:${fields.operation || route.method.toLowerCase()}` });
  }
}
export { ObjectId };
