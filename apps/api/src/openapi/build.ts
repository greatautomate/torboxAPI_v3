import { ROUTE_TABLE, TORBOX_SPEC } from '../torbox/routeTable.js';

/** Builds the gateway OpenAPI document: compat mirror (from TorBox's spec) + enhanced API. */
export function buildOpenApi(baseUrl: string, name: string, version: string) {
  const envelope = { type: 'object', properties: { success: { type: 'boolean' }, error: { type: ['string', 'null'] }, detail: { type: 'string' }, data: {} }, required: ['success', 'error', 'detail', 'data'] };
  const download = { type: 'object', properties: { publicId: { type: 'string' }, type: { type: 'string', enum: ['torrent', 'usenet', 'webdl'] }, torboxId: { type: 'integer' }, name: { type: 'string' }, hash: { type: 'string' }, size: { type: 'integer' }, state: { type: 'string', enum: ['queued', 'metadata', 'downloading', 'stalled', 'paused', 'processing', 'seeding', 'completed', 'cached', 'failed', 'unknown'] }, rawState: { type: 'string' }, progress: { type: 'number' }, downloadSpeed: { type: 'integer' }, uploadSpeed: { type: 'integer' }, eta: { type: 'integer' }, seeds: { type: 'integer' }, peers: { type: 'integer' }, ratio: { type: 'number' }, cached: { type: 'boolean' }, active: { type: 'boolean' }, downloadFinished: { type: 'boolean' }, downloadPresent: { type: 'boolean' }, expiresAt: { type: ['string', 'null'] }, createdAt: { type: ['string', 'null'] }, files: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, shortName: { type: 'string' }, size: { type: 'integer' }, mimetype: { type: 'string' }, zipped: { type: 'boolean' } } } }, tags: { type: 'array', items: { type: 'string' } } } };
  const sec = [{ gatewayKey: [] }];
  const paths: Record<string, any> = {};
  const ENVELOPE = { $ref: '#/components/schemas/Envelope' };
  const baseResponses = { 403: { description: 'NO_AUTH / BAD_TOKEN / SCOPE_DENIED / IP_NOT_ALLOWED' }, 429: { description: 'RATE_LIMIT / QUOTA_EXCEEDED (Retry-After header)' } };
  /** Enhanced-API operation. `extra.data` (a JSON schema) documents the `data` field of the envelope. */
  const op = (summary: string, description: string, { data, ...extra }: any = {}) => ({
    summary, description, security: sec,
    responses: { 200: { description: 'Envelope', content: { 'application/json': { schema: data ? { allOf: [ENVELOPE, { type: 'object', properties: { data } }] } : ENVELOPE } } }, ...baseResponses },
    ...extra,
  });
  const q = (name: string, type = 'string', required = false, description = '') => ({ name, in: 'query', required, schema: { type }, description });
  const body = (schema: any, ct = 'application/json') => ({ requestBody: { required: true, content: { [ct]: { schema } } } });

  paths['/api/v1/status'] = { get: { ...op('Gateway & upstream status', 'Public. No key required.'), security: [] } };
  paths['/api/v1/me'] = { get: op('Your gateway key', 'Scopes, policy, live budgets and monthly usage of the calling key.') };
  paths['/api/v1/account'] = op2('get', 'Upstream account summary (redacted)', 'Scope user:read.');
  paths['/api/v1/downloads'] = {
    get: op('Unified download list', 'Torrents, Usenet and web downloads normalized into one list. Cursor pagination.', { data: { type: 'array', items: { $ref: '#/components/schemas/Download' } }, parameters: [q('type', 'string', false, 'Comma separated: torrent,usenet,webdl'), q('state'), q('q', 'string', false, 'Search name/hash/id'), q('limit', 'integer'), q('cursor'), q('mine', 'boolean', false, 'Only items created by this key'), q('bypass_cache', 'boolean')] }),
    post: op('Smart create', 'Send a magnet, http(s) link, NZB link or a .torrent/.nzb file (multipart field "file"). The type is detected automatically. Deduplicates by hash.', body({ type: 'object', properties: { source: { type: 'string', description: 'magnet:, http(s) URL or NZB URL' }, magnet: { type: 'string' }, url: { type: 'string' }, nzbUrl: { type: 'string' }, name: { type: 'string' }, seed: { type: 'integer', enum: [1, 2, 3] }, allowZip: { type: 'boolean' }, password: { type: 'string' }, postProcessing: { type: 'integer' }, asQueued: { type: 'boolean' }, onlyIfCached: { type: 'boolean' }, allowDuplicate: { type: 'boolean' }, type: { type: 'string', enum: ['torrent', 'usenet', 'webdl'] } } })),
  };
  paths['/api/v1/downloads/{publicId}'] = { get: op('Get one download', '', { data: { $ref: '#/components/schemas/Download' }, parameters: [pp('publicId')] }), patch: op('Edit name/tags/hashes', 'Read-modify-write on top of TorBox PUT edit endpoints.', { parameters: [pp('publicId')], ...body({ type: 'object', properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, alternativeHashes: { type: 'array', items: { type: 'string' } }, airlocked: { type: 'boolean' } } }) }) };
  paths['/api/v1/downloads/{publicId}/files'] = { get: op('Files with signed link/stream URLs', 'Each file gets a permalink (/dl/...) and, for videos, a stream entry (/s/...). Neither embeds any API key.', { parameters: [pp('publicId')] }) };
  paths['/api/v1/downloads/{publicId}/link'] = { get: op('CDN link', 'Fresh TorBox CDN link (valid ~3h to start). permalink=true returns a signed gateway permalink instead. redirect=true 307s to the CDN.', { parameters: [pp('publicId'), q('file', 'integer'), q('zip', 'boolean'), q('redirect', 'boolean'), q('permalink', 'boolean'), q('expires_in', 'integer', false, 'Permalink lifetime in seconds')] }) };
  paths['/api/v1/downloads/{publicId}/actions/{action}'] = { post: op('Control a download', 'action ∈ delete | reannounce | resume | pause | stop_seeding', { parameters: [pp('publicId'), pp('action')] }) };
  paths['/api/v1/cache/check'] = { post: op('Batch cache check', 'Up to 5000 hashes across all types; batched and cached for 1h.', body({ type: 'object', required: ['hashes'], properties: { hashes: { type: 'array', items: { type: 'string' } }, type: { type: 'string' }, listFiles: { type: 'boolean' } } })) };
  paths['/api/v1/links/check'] = { post: op('Hoster pre-check', 'Validates URLs against the TorBox hoster catalogue locally (no upstream create call).', body({ type: 'object', required: ['urls'], properties: { urls: { type: 'array', items: { type: 'string' } } } })) };
  paths['/api/v1/hosters'] = { get: op('Hoster catalogue', 'live=true adds the account\'s remaining daily allowances.', { parameters: [q('live', 'boolean')] }) };
  paths['/api/v1/torrents/info'] = { get: op('Torrent metadata', 'From the BitTorrent network via TorBox. Adds our cache status.', { parameters: [q('hash'), q('magnet'), q('timeout', 'integer')] }) };
  paths['/api/v1/torrents/magnet-to-file'] = { post: op('Magnet → .torrent', 'Returns torrent bytes.', body({ type: 'object', required: ['magnet'], properties: { magnet: { type: 'string' } } })) };
  paths['/api/v1/queue'] = { get: op('Queued downloads', '', { parameters: [q('type')] }) };
  paths['/api/v1/queue/{queuedId}/actions/{action}'] = { post: op('Start or delete a queued download', '', { parameters: [pp('queuedId'), pp('action')] }) };
  paths['/api/v1/stream/{publicId}/{fileId}'] = { get: op('Create stream', 'HLS stream for a video file (Pro upstream). Returns hlsUrl plus a signed entry URL.', { parameters: [pp('publicId'), pp('fileId'), q('audio', 'integer'), q('subtitle', 'integer'), q('resolution', 'integer')] }) };
  paths['/api/v1/rss/feeds'] = { get: op('RSS feeds', ''), post: op('Add RSS feed', '', body({ type: 'object', required: ['url', 'name'], properties: { url: { type: 'string' }, name: { type: 'string' }, do_regex: { type: 'string' }, dont_regex: { type: 'string' }, dont_older_than: { type: 'integer' }, scan_interval: { type: 'integer' }, rss_type: { type: 'string' }, torrent_seeding: { type: 'integer' } } })) };
  paths['/api/v1/rss/feeds/{id}'] = { patch: op('Modify RSS feed', '', { parameters: [pp('id')] }) };
  paths['/api/v1/rss/feeds/{id}/items'] = { get: op('RSS feed items', '', { parameters: [pp('id')] }) };
  paths['/api/v1/rss/feeds/{id}/actions/{action}'] = { post: op('Control RSS feed', 'update | delete | pause | resume', { parameters: [pp('id'), pp('action')] }) };
  paths['/api/v1/notifications'] = { get: op('Notifications', ''), delete: op('Clear all notifications', '') };
  paths['/api/v1/notifications/{id}'] = { delete: op('Clear one notification', '', { parameters: [pp('id')] }) };
  paths['/api/v1/notifications/test'] = { post: op('Send test notification', '1/min upstream limit.') };
  paths['/api/v1/integrations/jobs'] = { get: op('Cloud upload jobs', '', { parameters: [q('hash')] }) };
  paths['/api/v1/integrations/jobs/{id}'] = { get: op('Job status', '', { parameters: [pp('id')] }), delete: op('Cancel job', '', { parameters: [pp('id')] }) };
  paths['/api/v1/integrations/{provider}/upload'] = { post: op('Queue cloud upload', 'provider ∈ googledrive | dropbox | onedrive | gofile | 1fichier | pixeldrain', { parameters: [pp('provider')], ...body({ type: 'object', required: ['publicId'], properties: { publicId: { type: 'string' }, fileId: { type: 'integer' }, zip: { type: 'boolean' }, token: { type: 'string' } } }) }) };
  paths['/api/v1/events'] = { get: op('Event feed', 'Pull-based alternative to webhooks.', { parameters: [q('since'), q('type'), q('limit', 'integer')] }) };
  paths['/api/v1/webhooks'] = { get: op('List webhooks', ''), post: op('Create webhook', 'Signed with X-TBG-Signature: t=<unix>,v1=<hmac_sha256(secret, t + "." + body)>', body({ type: 'object', required: ['url'], properties: { url: { type: 'string' }, events: { type: 'array', items: { type: 'string' } } } })) };
  paths['/api/v1/webhooks/{id}'] = { delete: op('Delete webhook', '', { parameters: [pp('id')] }) };
  paths['/api/v1/webhooks/{id}/test'] = { post: op('Test webhook', '', { parameters: [pp('id')] }) };
  paths['/dl/{publicId}/{fileId}'] = { get: { summary: 'Signed permalink (307 → CDN)', description: 'Obtained from /files or /link?permalink=true. No API key in the URL; revoking the key invalidates it.', parameters: [pp('publicId'), pp('fileId'), q('k'), q('zip'), q('exp'), q('sig')], responses: { 307: { description: 'Redirect to TorBox CDN' } } } };
  paths['/s/{publicId}/{fileId}/master.m3u8'] = { get: { summary: 'Signed HLS entry (307 → HLS)', parameters: [pp('publicId'), pp('fileId'), q('k'), q('exp'), q('sig')], responses: { 307: { description: 'Redirect to TorBox HLS playlist' } } } };

  // ---- compat mirror: parameters and request bodies come straight from TorBox's own OpenAPI document ----
  const usedSchemas = new Set<string>();
  const collectRefs = (o: any) => { if (!o || typeof o !== 'object') return; if (typeof o.$ref === 'string') usedSchemas.add(o.$ref.split('/').pop()!); for (const v of Object.values(o)) collectRefs(v); };
  for (const r of ROUTE_TABLE) {
    const p = r.path === '/' ? '/v1/api' : r.path;
    const up = TORBOX_SPEC.paths?.[r.path]?.[r.method.toLowerCase()] ?? {};
    const parameters = ((up.parameters ?? []) as any[])
      .filter((x) => x.in !== 'header') // TorBox's Authorization header is replaced by the gateway key
      .map((x) => x.in === 'query' && x.name === 'token' && r.tokenInQuery
        ? { ...x, required: false, description: 'Your gateway key (tbg_live_…) — alternative to the Authorization header for URLs opened directly by a browser or media player.' }
        : x);
    const requestBody = up.requestBody ? { ...up.requestBody, required: up.requestBody.required ?? true } : undefined;
    collectRefs(parameters); collectRefs(requestBody);
    paths[p] = paths[p] || {};
    paths[p][r.method.toLowerCase()] = {
      tags: [`compat:${r.group}`], summary: r.summary,
      description: r.blocked ? `BLOCKED on the gateway: ${r.blockedReason}` : `1:1 proxy of TorBox ${r.method} ${r.path}. Scope: ${Array.isArray(r.scope) ? r.scope.join(' | ') : r.scope}. ${r.cacheTtl ? `Cached ${r.cacheTtl}s.` : ''} ${r.tokenInQuery ? 'Pass your gateway key as ?token=.' : ''}`.trim(),
      security: sec,
      ...(parameters.length ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses: r.blocked ? { 403: { description: 'BLOCKED — this TorBox endpoint is not exposed to consumer keys' } } : { 200: { description: 'TorBox response passed through' }, ...baseResponses },
      deprecated: r.blocked,
    };
  }
  // Only ship the TorBox component schemas the mirror actually references (transitively).
  const torboxSchemas: Record<string, any> = {};
  for (let size = -1; size !== usedSchemas.size;) { size = usedSchemas.size; for (const n of [...usedSchemas]) { const sc = TORBOX_SPEC.components?.schemas?.[n]; if (sc) { torboxSchemas[n] = sc; collectRefs(sc); } } }

  // ---- tags: enhanced API first, then the compat mirror ----
  const ENHANCED_TAGS: [prefix: string, tag: string, description: string][] = [
    ['/api/v1/downloads', 'downloads', 'Unified downloads across torrents, Usenet and web downloads: list, create, files, links, control'],
    ['/api/v1/cache', 'checks', 'Cache and hoster pre-checks'], ['/api/v1/links', 'checks', ''], ['/api/v1/hosters', 'checks', ''],
    ['/api/v1/torrents', 'torrents', 'Torrent metadata helpers'],
    ['/api/v1/queue', 'queue', 'Queued (not yet started) downloads'],
    ['/api/v1/stream', 'stream', 'HLS streams for video files'],
    ['/api/v1/rss', 'rss', 'RSS feed automation'],
    ['/api/v1/notifications', 'notifications', 'TorBox account notifications'],
    ['/api/v1/integrations', 'integrations', 'Cloud upload jobs (Google Drive, Dropbox, OneDrive, Gofile, 1fichier, Pixeldrain)'],
    ['/api/v1/events', 'webhooks', 'Event feed and webhook subscriptions'], ['/api/v1/webhooks', 'webhooks', ''],
    ['/dl/', 'links', 'Signed permalinks and HLS entry URLs — no API key in the URL, die with the key'], ['/s/', 'links', ''],
    ['/api/v1', 'account', 'Gateway status, your key and the upstream account'],
  ];
  for (const [p, item] of Object.entries(paths)) {
    if (p.startsWith('/v1/api')) continue;
    const tag = ENHANCED_TAGS.find(([prefix]) => p.startsWith(prefix))![1];
    for (const o of Object.values(item) as any[]) o.tags = [tag];
  }
  const tagOrder = ['account', 'downloads', 'checks', 'torrents', 'queue', 'stream', 'rss', 'notifications', 'integrations', 'webhooks', 'links'];
  const tags = [
    ...tagOrder.map((t) => ({ name: t, description: ENHANCED_TAGS.find(([, tag, d]) => tag === t && d)![2] })),
    ...['torrents', 'usenet', 'webdl', 'queued', 'stream', 'rss', 'notifications', 'integration', 'user', 'general', 'vendors'].map((g) => ({ name: `compat:${g}`, description: `1:1 mirror of TorBox /v1/api/${g === 'general' ? '' : g} — point official TorBox SDKs here by swapping baseUrl.` })),
  ];
  return {
    openapi: '3.1.0', info: { title: `${name} API`, version, description: `Gateway on top of the TorBox API. Two surfaces: **/v1/api/*** mirrors TorBox 1:1 (point the official SDKs here) and **/api/v1/*** is the enhanced, normalized API. Authenticate with \`Authorization: Bearer tbg_live_...\`.` },
    servers: [{ url: baseUrl }], tags,
    components: { securitySchemes: { gatewayKey: { type: 'http', scheme: 'bearer', description: 'Gateway API key (tbg_live_…). Also accepted as X-API-Key header, or ?token= on requestdl-style routes.' } }, schemas: { Envelope: envelope, Download: download, ...torboxSchemas } }, paths,
  };
  function pp(name: string) { return { name, in: 'path', required: true, schema: { type: 'string' } }; }
  function op2(method: string, summary: string, description: string) { return { [method]: op(summary, description) }; }
}
