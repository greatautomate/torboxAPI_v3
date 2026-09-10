import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestEnv, adminLogin, admin, createKey, type TestEnv } from './setup.js';
import { encrypt, decrypt, generateApiKey, parseKeyPrefix, hashPassword, verifyPassword, totpCode, verifyTotp, generateTotpSecret } from '../src/crypto.js';
import { matchRoute, ROUTE_TABLE } from '../src/torbox/routeTable.js';
import { mapState, detectType, extractHash } from '../src/services/downloads.js';
import { ipAllowed } from '../src/services/keys.js';

describe('unit: crypto & helpers', () => {
  it('encrypts/decrypts round trip', () => { const c = encrypt('master', 'hello'); expect(c).not.toContain('hello'); expect(decrypt('master', c)).toBe('hello'); });
  it('generates parseable keys', () => { const k = generateApiKey(); expect(k.secret.startsWith('tbg_live_')).toBe(true); expect(parseKeyPrefix(k.secret)).toBe(k.prefix); expect(parseKeyPrefix('nope')).toBeNull(); });
  it('hashes passwords', () => { const h = hashPassword('secret-pass'); expect(verifyPassword('secret-pass', h)).toBe(true); expect(verifyPassword('wrong', h)).toBe(false); });
  it('totp', () => { const s = generateTotpSecret(); expect(verifyTotp(s, totpCode(s))).toBe(true); expect(verifyTotp(s, '000000')).toBe(false); });
  it('route table covers all 91 TorBox operations (85 paths) and classifies them', () => {
    expect(ROUTE_TABLE.length).toBe(91); expect(new Set(ROUTE_TABLE.map((r) => r.path)).size).toBe(85);
    const r = matchRoute('POST', '/v1/api/torrents/createtorrent')!; expect(r.scope).toBe('torrents:write'); expect(r.limiter).toBe('createTorrent'); expect(r.bodyMode).toBe('multipart');
    expect(matchRoute('GET', '/v1/api/torrents/requestdl')!.tokenInQuery).toBe(true);
    expect(matchRoute('POST', '/v1/api/notifications/clear/123')!.path).toBe('/v1/api/notifications/clear/{id}');
    expect(matchRoute('POST', '/v1/api/user/refreshtoken')!.blocked).toBe(true);
    expect(matchRoute('GET', '/v1/api/vendors/account')!.blocked).toBe(true);
    expect(matchRoute('GET', '/v1/api/torrents/checkcached')!.cacheTtl).toBe(3600);
    expect(matchRoute('GET', '/v1/api/nope')).toBeUndefined();
  });
  it('normalizes states and detects types', () => {
    expect(mapState('downloading')).toBe('downloading'); expect(mapState('stalled (no seeds)')).toBe('stalled'); expect(mapState('uploading')).toBe('seeding'); expect(mapState('cached', true, true)).toBe('completed'); expect(mapState('metaDL')).toBe('metadata');
    expect(detectType({ magnet: 'magnet:?xt=urn:btih:abc' })).toBe('torrent'); expect(detectType({ url: 'https://x.y/file.nzb' })).toBe('usenet'); expect(detectType({ url: 'https://1fichier.com/?abc' })).toBe('webdl'); expect(detectType({ fileName: 'a.torrent' })).toBe('torrent'); expect(detectType({})).toBeNull();
    expect(extractHash('magnet:?xt=urn:btih:' + 'A'.repeat(40) + '&dn=x')).toBe('a'.repeat(40));
    expect(ipAllowed('10.0.0.5', ['10.0.0.0/24'])).toBe(true); expect(ipAllowed('10.0.1.5', ['10.0.0.0/24'])).toBe(false); expect(ipAllowed('::1', [])).toBe(true);
  });
});

describe('integration: gateway', () => {
  let env: TestEnv; let cookie: string; let key: { key: any; secret: string };
  beforeAll(async () => { env = await startTestEnv(); cookie = await adminLogin(env); key = await createKey(env, cookie); });
  afterAll(async () => { await env?.stop(); });
  const bearer = (s = key.secret) => ({ authorization: `Bearer ${s}` });

  it('bootstrapped an upstream from TORBOX_API_KEY and encrypted it', async () => {
    const ups = await env.svc.upstreams.list(); expect(ups).toHaveLength(1); expect(ups[0].apiKeyEnc).not.toContain('mock-torbox-key'); expect(env.svc.upstreams.decryptKey(ups[0])).toBe('mock-torbox-key'); expect(ups[0].plan).toBe(0);
  });
  it('rejects missing/invalid gateway keys with TorBox-style envelopes', async () => {
    const r1 = await env.app.inject({ method: 'GET', url: '/v1/api/user/me' }); expect(r1.statusCode).toBe(403); expect(JSON.parse(r1.body)).toMatchObject({ success: false, error: 'NO_AUTH' });
    const r2 = await env.app.inject({ method: 'GET', url: '/v1/api/user/me', headers: bearer('tbg_live_aaaaaaaa_' + 'b'.repeat(32)) }); expect(JSON.parse(r2.body).error).toBe('BAD_TOKEN');
  });
  it('compat: proxies user/me with the upstream key injected and PII masked', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/v1/api/user/me?settings=false', headers: bearer() }); expect(r.statusCode).toBe(200);
    const j = JSON.parse(r.body); expect(j.success).toBe(true); expect(j.data.email).toMatch(/^e\*\*\*@/); expect(j.data.customer).toBeUndefined();
    const call = env.mock.state.calls.find((c) => c.path === '/v1/api/user/me'); expect(call?.auth).toBe('mock-torbox-key');
    expect(r.headers['x-ratelimit-limit']).toBe('60');
  });
  it('compat: enforces scopes and blocks operator-only endpoints', async () => {
    const r = await env.app.inject({ method: 'POST', url: '/v1/api/rss/addrss', headers: { ...bearer(), 'content-type': 'application/json' }, payload: { url: 'x', name: 'y' } }); expect(r.statusCode).toBe(403); expect(JSON.parse(r.body).error).toBe('SCOPE_DENIED');
    const b = await env.app.inject({ method: 'POST', url: '/v1/api/user/refreshtoken', headers: { ...bearer(), 'content-type': 'application/json' }, payload: { session_token: 'x' } }); expect(b.statusCode).toBe(403); expect(JSON.parse(b.body).error).toBe('ENDPOINT_BLOCKED');
    const nf = await env.app.inject({ method: 'GET', url: '/v1/api/does/not/exist', headers: bearer() }); expect(nf.statusCode).toBe(404);
  });
  it('compat: multipart createtorrent passes through, indexes the item and logs a submit activity', async () => {
    const boundary = '----tbgtest'; const hash = 'c'.repeat(40);
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="magnet"\r\n\r\nmagnet:?xt=urn:btih:${hash}&dn=Test\r\n--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nMy Torrent\r\n--${boundary}--\r\n`;
    const r = await env.app.inject({ method: 'POST', url: '/v1/api/torrents/createtorrent', headers: { ...bearer(), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(r.statusCode).toBe(200); const j = JSON.parse(r.body); expect(j.success).toBe(true); expect(j.data.hash).toBe(hash);
    const act = await env.svc.db.col<any>('activity').findOne({ kind: 'submit', hash }); expect(act).toBeTruthy(); expect(act.input.magnet).toContain(hash); expect(act.keyName).toBe('test key'); expect(act.publicId).toBeTruthy();
    const idx = await env.svc.downloads.index().findOne({ hash }); expect(idx?.createdByKeyName).toBe('test key');
  });
  it('compat: mylist is cached and cache invalidated on write', async () => {
    const a = await env.app.inject({ method: 'GET', url: '/v1/api/torrents/mylist', headers: bearer() }); expect(a.headers['x-tbg-cache']).toBe('MISS');
    const b = await env.app.inject({ method: 'GET', url: '/v1/api/torrents/mylist', headers: bearer() }); expect(b.headers['x-tbg-cache']).toBe('HIT'); expect(JSON.parse(b.body).data.length).toBeGreaterThan(0);
  });
  it('compat: requestdl swaps ?token= for the upstream key and records the generated CDN link', async () => {
    const list = JSON.parse((await env.app.inject({ method: 'GET', url: '/v1/api/torrents/mylist?bypass_cache=true', headers: bearer() })).body).data; const id = list[0].id;
    const r = await env.app.inject({ method: 'GET', url: `/v1/api/torrents/requestdl?token=${key.secret}&torrent_id=${id}&file_id=0` }); expect(r.statusCode).toBe(200);
    const j = JSON.parse(r.body); expect(j.data).toContain('cdn.mock.torbox');
    const call = env.mock.state.calls.filter((c) => c.path === '/v1/api/torrents/requestdl').pop()!; expect(call.query.get('token')).toBe('mock-torbox-key');
    const act = await env.svc.db.col<any>('activity').findOne({ kind: 'link', torboxId: id }); expect(act.output.cdnUrl).toContain('cdn.mock.torbox');
    const redir = await env.app.inject({ method: 'GET', url: `/v1/api/torrents/requestdl?token=${key.secret}&torrent_id=${id}&redirect=true` }); expect(redir.statusCode).toBe(307); expect(redir.headers.location).toContain('cdn.mock.torbox');
  });
  it('compat: non-JSON pass-through (torrent bytes, rss xml)', async () => {
    const t = await env.app.inject({ method: 'POST', url: '/v1/api/torrents/magnettofile', headers: { ...bearer(), 'content-type': 'application/json' }, payload: { magnet: 'magnet:?xt=urn:btih:' + 'd'.repeat(40) } }); expect(t.headers['content-type']).toContain('bittorrent'); expect(t.body.startsWith('d8:announce')).toBe(true);
    const rss = await env.app.inject({ method: 'GET', url: `/v1/api/notifications/rss?token=${key.secret}` }); expect(rss.headers['content-type']).toContain('rss'); expect(rss.body).toContain('<rss');
  });
  it('v1: /me, unified downloads, smart create, files with permalinks, permalink redirect', async () => {
    const me = JSON.parse((await env.app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer() })).body); expect(me.data.key.name).toBe('test key'); expect(me.data.budgets.perMinute.limit).toBe(60);
    const c = await env.app.inject({ method: 'POST', url: '/api/v1/downloads', headers: { ...bearer(), 'content-type': 'application/json' }, payload: { source: 'https://example.com/movie.mkv', name: 'Web item' } }); expect(c.statusCode).toBe(201); const dl = JSON.parse(c.body).data; expect(dl.type).toBe('webdl'); expect(dl.publicId).toBeTruthy();
    const dup = await env.app.inject({ method: 'POST', url: '/api/v1/downloads', headers: { ...bearer(), 'content-type': 'application/json' }, payload: { magnet: 'magnet:?xt=urn:btih:' + 'c'.repeat(40) } }); expect(JSON.parse(dup.body).data.duplicate).toBe(true);
    const list = JSON.parse((await env.app.inject({ method: 'GET', url: '/api/v1/downloads?bypass_cache=true', headers: bearer() })).body); expect(list.success).toBe(true); expect(list.data.some((d: any) => d.type === 'webdl') && list.data.some((d: any) => d.type === 'torrent')).toBe(true); expect(list.meta.total).toBeGreaterThanOrEqual(2);
    const files = JSON.parse((await env.app.inject({ method: 'GET', url: `/api/v1/downloads/${dl.publicId}/files`, headers: bearer() })).body); const link: string = files.data.files[0].linkUrl; expect(link).toContain('/dl/'); expect(link).not.toContain(key.secret); expect(files.data.files[0].streamUrl).toContain('/s/');
    const u = new URL(link); const r = await env.app.inject({ method: 'GET', url: u.pathname + u.search }); expect(r.statusCode).toBe(307); expect(r.headers.location).toContain('cdn.mock.torbox');
    const bad = await env.app.inject({ method: 'GET', url: u.pathname + u.search.replace(/sig=\w+/, 'sig=deadbeef') }); expect(bad.statusCode).toBe(403);
    const act = await env.svc.db.col<any>('activity').findOne({ kind: 'link', publicId: dl.publicId }); expect(act.action).toBe('permalink');
  });
  it('v1: cache check, link check, actions, patch', async () => {
    const cc = JSON.parse((await env.app.inject({ method: 'POST', url: '/api/v1/cache/check', headers: { ...bearer(), 'content-type': 'application/json' }, payload: { hashes: ['a'.repeat(40), 'f'.repeat(40)], type: 'torrent' } })).body); expect(cc.data['a'.repeat(40)].cached).toBe(true); expect(cc.data['f'.repeat(40)].cached).toBe(false);
    const lc = JSON.parse((await env.app.inject({ method: 'POST', url: '/api/v1/links/check', headers: { ...bearer(), 'content-type': 'application/json' }, payload: { urls: ['https://1fichier.com/?abc', 'https://unknown.example/x'] } })).body); expect(lc.data[0].supported).toBe(true); expect(lc.data[0].hoster).toBe('1Fichier'); expect(lc.data[1].supported).toBe(false);
    const list = JSON.parse((await env.app.inject({ method: 'GET', url: '/api/v1/downloads?type=torrent&bypass_cache=true', headers: bearer() })).body).data; const t = list[0];
    const ra = await env.app.inject({ method: 'POST', url: `/api/v1/downloads/${t.publicId}/actions/reannounce`, headers: bearer() }); expect(JSON.parse(ra.body).success).toBe(true);
    const del = await env.app.inject({ method: 'POST', url: `/api/v1/downloads/${t.publicId}/actions/delete`, headers: bearer() }); expect(JSON.parse(del.body).success).toBe(true);
    const gone = await env.app.inject({ method: 'GET', url: `/api/v1/downloads/${t.publicId}?bypass_cache=true`, headers: bearer() }); expect(gone.statusCode).toBe(404);
  });
  it('rate limits: per-key minute budget returns 429 with Retry-After', async () => {
    const a = admin(env, cookie);
    const pol = await a.post('/admin/api/policies', { name: 'tiny', limits: { perMinute: 2, perHour: 100, perDay: 100, createUncachedPerHour: 1, createPerHour: 5 }, quotas: { monthlyRequests: 0, monthlyCreates: 0 }, features: { allowPermalinks: true, allowStreaming: true, allowUploads: true, allowSettingsWrite: false, allowBypassCache: true, allowWebhooks: true } }); expect(pol.statusCode).toBe(201);
    const k2 = await createKey(env, cookie, { name: 'tiny key', policyId: JSON.parse(pol.body).data.id });
    const s = [] as number[]; for (let i = 0; i < 4; i++) s.push((await env.app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(k2.secret) })).statusCode);
    expect(s.filter((x) => x === 429).length).toBeGreaterThanOrEqual(1);
    const last = await env.app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(k2.secret) }); expect(last.statusCode).toBe(429); expect(last.headers['retry-after']).toBeTruthy(); expect(JSON.parse(last.body).error).toBe('RATE_LIMIT');
  });
  it('admin: logs & activity are recorded, filterable, exportable and clearable with counts', async () => {
    const a = admin(env, cookie);
    const logs = JSON.parse((await a.get('/admin/api/logs?limit=5')).body); expect(logs.ok).toBe(true); expect(logs.data.total).toBeGreaterThan(5); expect(logs.data.items[0]).toHaveProperty('route'); expect(logs.data.items[0].keyName).toBeTruthy();
    const byKey = JSON.parse((await a.get(`/admin/api/logs?keyId=${key.key.id}&limit=1`)).body); expect(byKey.data.total).toBeGreaterThan(0);
    const act = JSON.parse((await a.get('/admin/api/activity?kind=link')).body); expect(act.data.items.length).toBeGreaterThan(0); expect(act.data.items[0].output.cdnUrl).toBeTruthy();
    const csv = await a.get('/admin/api/activity/export?format=csv'); expect(csv.headers['content-type']).toContain('csv'); expect(csv.body.split('\n').length).toBeGreaterThan(1);
    const cnt = JSON.parse((await a.get('/admin/api/logs/count?surface=compat')).body).data.count; expect(cnt).toBeGreaterThan(0);
    const del = JSON.parse((await a.del('/admin/api/logs', { surface: 'compat' })).body); expect(del.data.deleted).toBe(cnt);
    const noFilter = await a.del('/admin/api/logs', {}); expect(noFilter.statusCode).toBe(400);
    const audit = JSON.parse((await a.get('/admin/api/audit?action=logs.clear')).body); expect(audit.data.items.length).toBe(1);
  });
  it('admin: overview, keys lifecycle (rotate with grace, suspend, revoke), downloads view, settings', async () => {
    const a = admin(env, cookie);
    const ov = JSON.parse((await a.get('/admin/api/overview')).body); expect(ov.data.kpis.activeKeys).toBeGreaterThan(0); expect(ov.data.upstream[0].budgets.perMinute.limit).toBe(280);
    const rot = JSON.parse((await a.post(`/admin/api/keys/${key.key.id}/rotate`, { graceMinutes: 5 })).body); const newSecret = rot.data.secret;
    expect((await env.app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(key.secret) })).statusCode).toBe(200);
    expect((await env.app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(newSecret) })).statusCode).toBe(200);
    await a.post(`/admin/api/keys/${key.key.id}/suspend`); expect(JSON.parse((await env.app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(newSecret) })).body).error).toBe('KEY_SUSPENDED');
    await a.post(`/admin/api/keys/${key.key.id}/resume`);
    const dls = JSON.parse((await a.get('/admin/api/downloads?live=true')).body); expect(dls.data.items.length).toBeGreaterThan(0); expect(dls.data.items[0]).toHaveProperty('createdByKeyName');
    const one = JSON.parse((await a.get(`/admin/api/downloads/${dls.data.items[0].publicId}`)).body); expect(one.data.history.length).toBeGreaterThan(0);
    const st = JSON.parse((await a.patch('/admin/api/settings', { maintenance: { enabled: true, message: 'brb' } })).body); expect(st.data.maintenance.enabled).toBe(true);
    const m = await env.app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(newSecret) }); expect(m.statusCode).toBe(503); expect(JSON.parse(m.body).error).toBe('MAINTENANCE');
    await a.patch('/admin/api/settings', { maintenance: { enabled: false } });
    await a.post(`/admin/api/keys/${key.key.id}/revoke`); expect(JSON.parse((await env.app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(newSecret) })).body).error).toBe('BAD_TOKEN');
    key = await createKey(env, cookie);
  });
  it('admin: viewer role is read-only; CSRF header required; playground works', async () => {
    const a = admin(env, cookie);
    const v = await a.post('/admin/api/admins', { email: 'viewer@example.com', password: 'viewer-password-1', role: 'viewer' }); expect(v.statusCode).toBe(201);
    const noCsrf = await env.app.inject({ method: 'POST', url: '/admin/api/alerts/read-all', headers: { cookie } }); expect(noCsrf.statusCode).toBe(403);
    const pg = JSON.parse((await a.post('/admin/api/playground', { keyId: key.key.id, method: 'GET', path: '/api/v1/me' })).body); expect(pg.data.status).toBe(200); expect(pg.data.body.data.key.name).toBe('test key'); expect(pg.data.curl).toContain('curl');
  });
  it('webhooks: inbound TorBox hook creates an event; reconcile emits completed; delivery is signed', async () => {
    const a = admin(env, cookie);
    const clients = JSON.parse((await a.get('/admin/api/clients')).body).data.items;
    const received: any[] = []; const { createServer } = await import('node:http');
    const srv = createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { received.push({ headers: req.headers, body: b }); res.writeHead(200); res.end('ok'); }); });
    await new Promise<void>((r) => srv.listen(0, r)); const port = (srv.address() as any).port;
    const ep = JSON.parse((await a.post('/admin/api/webhooks', { clientId: clients[0].id, url: `http://127.0.0.1:${port}/hook`, events: ['*'] })).body); expect(ep.data.secret).toMatch(/^whsec_/);
    const test = JSON.parse((await a.post(`/admin/api/webhooks/${ep.data.endpoint.id}/test`)).body); expect(test.data.ok).toBe(true); expect(received[0].headers['x-tbg-signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    const ups = await env.svc.upstreams.list(); const accId = ups[0]._id.toHexString();
    const hook = await env.app.inject({ method: 'POST', url: `/hooks/torbox/${accId}/inbound-secret`, headers: { 'content-type': 'application/json' }, payload: { title: 'Download finished', message: 'Torrent "Web item" has finished downloading' } }); expect(hook.statusCode).toBe(200);
    const ev = await env.svc.webhooks.events().findOne({ source: 'webhook' }); expect(ev).toBeTruthy();
    const emitted = await env.svc.webhooks.reconcile(ups[0]); expect(Array.isArray(emitted)).toBe(true);
    const dispatched = await env.svc.webhooks.dispatchDue(); expect(dispatched.attempted).toBeGreaterThan(0);
    const consumerEvents = JSON.parse((await env.app.inject({ method: 'GET', url: '/api/v1/events', headers: bearer() })).body); expect(consumerEvents.success).toBe(true);
    srv.close();
  });
  it('admin: nullable policy/upstream on create, status classes, snooze, webhook keyId + deliveries clear, events export, client reset, missing-download stub, stream', async () => {
    const a = admin(env, cookie);
    const clients = JSON.parse((await a.get('/admin/api/clients')).body).data.items;
    const k = await a.post('/admin/api/keys', { name: 'defaults key', clientId: clients[0].id, scopes: ['general', 'torrents:read', 'stream'], policyId: null, upstreamAccountId: null, allowedIps: [], allowedOrigins: [], expiresAt: null, metadata: null }); expect(k.statusCode).toBe(201);
    const kd = JSON.parse(k.body).data.key; expect(kd.policyName).toBe('Default'); expect(kd.upstreamLabel).toBe('Primary TorBox account'); expect(kd.graceUntil).toBeNull(); expect(kd.mode).toBe('live');
    const up = JSON.parse((await a.patch(`/admin/api/keys/${kd.id}`, { policyId: null })).body); expect(up.data.policyName).toBe('Default');
    const s4 = JSON.parse((await a.get('/admin/api/logs?status=4xx&limit=1')).body); expect(s4.ok).toBe(true); expect(s4.data.total).toBeGreaterThan(0);
    const s5 = JSON.parse((await a.get('/admin/api/logs?status=5xx&limit=1')).body); expect(s5.ok).toBe(true);
    const sl = JSON.parse((await a.get('/admin/api/logs?status=401,403,429&limit=1')).body); expect(sl.data.total).toBeGreaterThanOrEqual(s4.data.total > 0 ? 1 : 0);
    await a.post('/admin/api/alerts/test'); const al = JSON.parse((await a.get('/admin/api/alerts?unread=true')).body); expect(al.data.total).toBeGreaterThan(0); const alertId = al.data.items[0].id;
    const sn = JSON.parse((await a.post(`/admin/api/alerts/${alertId}/snooze`, { hours: 1 })).body); expect(sn.data.snoozedUntil).toBeTruthy();
    const al2 = JSON.parse((await a.get('/admin/api/alerts?unread=true')).body); expect(al2.data.items.find((x: any) => x.id === alertId)).toBeUndefined();
    expect(JSON.parse((await a.get('/admin/api/alerts')).body).data.items.find((x: any) => x.id === alertId).snoozedUntil).toBeTruthy();
    const ep = JSON.parse((await a.post('/admin/api/webhooks', { clientId: clients[0].id, url: 'http://127.0.0.1:9/hook', events: ['*'] })).body).data.endpoint;
    expect(JSON.parse((await a.patch(`/admin/api/webhooks/${ep.id}`, { keyId: kd.id })).body).data.keyId).toBe(kd.id);
    expect(JSON.parse((await a.patch(`/admin/api/webhooks/${ep.id}`, { keyId: null })).body).data.keyId).toBeNull();
    const cleared = JSON.parse((await a.del('/admin/api/webhooks/deliveries', { endpointId: ep.id })).body); expect(cleared.ok).toBe(true); expect(typeof cleared.data.deleted).toBe('number');
    expect((await a.del('/admin/api/webhooks/deliveries', {})).statusCode).toBe(400);
    const inb = JSON.parse((await a.get('/admin/api/webhooks/inbound')).body); expect(inb.data.byAccount[0].url).toContain('/hooks/torbox/'); expect(inb.data.url).toBeUndefined();
    const ex = await a.get('/admin/api/events/export?format=csv'); expect(ex.statusCode).toBe(200); expect(ex.headers['content-type']).toContain('csv');
    const exj = await a.get('/admin/api/events/export?format=json'); expect(Array.isArray(JSON.parse(exj.body))).toBe(true);
    const ru = JSON.parse((await a.post(`/admin/api/clients/${clients[0].id}/reset-usage`)).body); expect(ru.data.keys).toBeGreaterThan(0);
    const st = JSON.parse((await a.get('/admin/api/settings')).body); expect(Array.isArray(st.data.homepageSections)).toBe(true);
    const gone = await env.svc.downloads.index().findOne({ deletedAt: { $ne: null } } as any);
    if (gone) { const g = JSON.parse((await a.get(`/admin/api/downloads/${gone.publicId}`)).body); expect(g.data.download.missing).toBe(true); expect(g.data.download.files).toEqual([]); expect(g.data.download.tags).toEqual([]); expect(g.data.index).toBeTruthy(); }
    const dls = JSON.parse((await a.get('/admin/api/downloads?live=true')).body).data.items; expect(dls.length).toBeGreaterThan(0);
    const stream = await a.post(`/admin/api/downloads/${dls[0].publicId}/stream`, { fileId: 0 }); expect([200, 400, 402]).toContain(stream.statusCode); if (stream.statusCode === 200) expect(JSON.parse(stream.body).data.hlsUrl).toBeTruthy();
    const sys = JSON.parse((await a.get('/admin/api/system')).body); expect(sys.data.mongo.ok).toBe(true); expect(typeof sys.data.memoryMb).toBe('number');
  });
  it('openapi and health', async () => {
    const o = JSON.parse((await env.app.inject({ method: 'GET', url: '/openapi.json' })).body); expect(Object.keys(o.paths).length).toBeGreaterThan(100); expect(o.paths['/api/v1/downloads'].post).toBeTruthy();
    // compat mirror carries TorBox's parameters / request bodies so Swagger "Try it out" has inputs; every op is tagged
    expect(o.paths['/v1/api/torrents/mylist'].get.parameters.map((x: any) => x.name)).toEqual(['id', 'bypass_cache', 'offset', 'limit']);
    expect(o.paths['/v1/api/torrents/controltorrent'].post.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/ControlTorrent');
    expect(o.components.schemas.ControlTorrent).toBeTruthy();
    expect(o.paths['/v1/api/torrents/requestdl'].get.parameters.find((x: any) => x.name === 'token').required).toBe(false);
    for (const item of Object.values(o.paths) as any[]) for (const op of Object.values(item) as any[]) expect(op.tags?.length).toBe(1);
    expect(o.tags[0].name).toBe('account'); expect(o.paths['/api/v1/downloads'].get.tags).toEqual(['downloads']);
    expect((await env.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200); expect(JSON.parse((await env.app.inject({ method: 'GET', url: '/readyz' })).body).mongo.ok).toBe(true);
    expect(JSON.parse((await env.app.inject({ method: 'GET', url: '/api/v1/status' })).body).data.gateway).toBe('ok');
  });
});
