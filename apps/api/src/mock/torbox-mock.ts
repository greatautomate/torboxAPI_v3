/**
 * Minimal TorBox mock server used for local development and tests.
 * Replays the success examples from the official Postman docs (fixtures.json), validates the Bearer token
 * against MOCK_TORBOX_KEYS (comma separated, default "mock-torbox-key"), and applies a few dynamic behaviours
 * (createtorrent returns incrementing ids, mylist reflects created items, requestdl returns a fake CDN link).
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8')) as Record<string, any>;

export function createTorboxMock(opts: { keys?: string[]; port?: number } = {}) {
  const keys = new Set(opts.keys || (process.env.MOCK_TORBOX_KEYS || 'mock-torbox-key').split(','));
  const state = { torrents: [] as any[], usenet: [] as any[], webdl: [] as any[], nextId: 1000, notifications: [] as any[], calls: [] as { method: string; path: string; query: URLSearchParams; auth: string | null }[] };
  const publicPaths = ['/', '/v1/api/stats', '/v1/api/stats/30days', '/v1/api/changelogs/json', '/v1/api/changelogs/rss', '/v1/api/speedtest', '/v1/api/torrents/torrentinfo', '/v1/api/torrents/magnettofile', '/v1/api/usenet/provider/connection', '/v1/api/user/auth/device/start', '/v1/api/user/auth/device/token', '/v1/api/webdl/hosters'];
  const item = (type: string, id: number, name: string, hash: string, extra: any = {}) => ({
    id, auth_id: 'mock-auth', server: 1, hash, name, size: 734003200, active: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    download_state: 'cached', seeds: 10, peers: 2, ratio: 1, progress: 1, download_speed: 0, upload_speed: 0, eta: 0, torrent_file: false,
    expires_at: new Date(Date.now() + 30 * 86400e3).toISOString(), download_present: true, download_finished: true, cached: true, owner: 'mock-auth',
    files: [{ id: 0, md5: 'x', hash, name: `${name}/video.mkv`, size: 734003200, zipped: false, s3_path: 'x', infected: false, mimetype: 'video/x-matroska', short_name: 'video.mkv', absolute_path: `/${name}/video.mkv`, opensubtitles_hash: 'x' }],
    tags: [], alternative_hashes: [], airlocked: false, ...(type !== 'torrent' ? { original_url: extra.url || 'https://example.com/file' } : {}), ...extra,
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://mock');
    const method = req.method || 'GET';
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token');
    state.calls.push({ method, path: url.pathname, query: url.searchParams, auth });
    const send = (status: number, body: any, ct = 'application/json') => { res.writeHead(status, { 'content-type': ct }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    if (!publicPaths.includes(url.pathname) && !url.pathname.startsWith('/v1/api/torrents/torrentinfo')) {
      if (!auth) return send(403, { success: false, error: 'NO_AUTH', detail: 'Please provide a valid API token.', data: null });
      if (!keys.has(auth)) return send(403, { success: false, error: 'BAD_TOKEN', detail: 'Your token is invalid or has expired. Please log in again or reset your token.', data: null });
    }
    const p = url.pathname;
    // dynamic behaviours
    const parseBody = () => {
      const ct = req.headers['content-type'] || '';
      if (ct.includes('json')) { try { return JSON.parse(raw.toString()); } catch { return {}; } }
      if (ct.includes('x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw.toString()));
      if (ct.includes('multipart')) { const out: any = {}; const m = /boundary=([^;]+)/.exec(ct); if (m) for (const part of raw.toString('latin1').split(`--${m[1]}`)) { const nm = /name="([^"]+)"/.exec(part); if (nm) { const idx = part.indexOf('\r\n\r\n'); out[nm[1]] = part.slice(idx + 4).replace(/\r\n$/, ''); if (/filename="/.test(part)) out[nm[1]] = `<file ${out[nm[1]].length} bytes>`; } } return out; }
      return {};
    };
    if (method === 'POST' && (p === '/v1/api/torrents/createtorrent' || p === '/v1/api/torrents/asynccreatetorrent')) {
      const b = parseBody(); if (!b.magnet && !b.file) return send(400, { success: false, error: 'MISSING_REQUIRED_OPTION', detail: 'You must provide either a file or magnet link.', data: null });
      const hash = (/btih:([a-fA-F0-9]{40})/.exec(b.magnet || '')?.[1] || 'a'.repeat(40)).toLowerCase();
      if (b.add_only_if_cached === 'true' && hash.startsWith('f')) return send(400, { success: false, error: 'DOWNLOAD_NOT_CACHED', detail: 'Torrent not found in cache. Disable the add only if cached parameter to add the download.', data: null });
      const id = state.nextId++; state.torrents.push(item('torrent', id, b.name || `Torrent ${id}`, hash, { magnet: b.magnet, cached: !hash.startsWith('f'), download_state: hash.startsWith('f') ? 'downloading' : 'cached' }));
      if (p.includes('async')) return send(200, fixtures['POST /v1/api/torrents/asynccreatetorrent']);
      return send(200, { success: true, error: null, detail: 'Torrent Added Successfully', data: { hash, torrent_id: id, auth_id: 'mock-auth' } });
    }
    if (method === 'POST' && p === '/v1/api/usenet/createusenetdownload') { const b = parseBody(); if (!b.link && !b.file) return send(400, { success: false, error: 'MISSING_REQUIRED_OPTION', detail: 'No link or file provided.', data: null }); const id = state.nextId++; const hash = `u${id}`.padEnd(40, '0'); state.usenet.push(item('usenet', id, b.name || `NZB ${id}`, hash, { url: b.link })); return send(200, { success: true, error: null, detail: 'Download started successfully.', data: { hash, usenetdownload_id: id, auth_id: 'mock-auth' } }); }
    if (method === 'POST' && p === '/v1/api/webdl/createwebdownload') { const b = parseBody(); if (!b.link) return send(400, { success: false, error: 'INVALID_LINK', detail: 'The link you provided is invalid.', data: null }); if (/unsupported/.test(b.link)) return send(400, { success: false, error: 'UNSUPPORTED_SITE', detail: 'The site you are trying to download from is not supported.', data: null }); const id = state.nextId++; const hash = `w${id}`.padEnd(40, '0'); state.webdl.push(item('webdl', id, b.name || `Web ${id}`, hash, { url: b.link })); return send(200, { success: true, error: null, detail: 'Download started.', data: { hash, webdownload_id: id, auth_id: 'mock-auth', jdownloader_id: null, link_list: [b.link] } }); }
    const lists: Record<string, any[]> = { '/v1/api/torrents/mylist': state.torrents, '/v1/api/usenet/mylist': state.usenet, '/v1/api/webdl/mylist': state.webdl };
    if (method === 'GET' && lists[p]) { const id = url.searchParams.get('id'); const arr = lists[p]; if (id) { const one = arr.find((x) => String(x.id) === id); return one ? send(200, { success: true, error: null, detail: 'ok', data: one }) : send(404, { success: false, error: 'ITEM_NOT_FOUND', detail: 'Item not found', data: null }); } const off = Number(url.searchParams.get('offset') || 0), lim = Number(url.searchParams.get('limit') || 1000); return send(200, { success: true, error: null, detail: 'list retrieved successfully.', data: arr.slice(off, off + lim) }); }
    if (method === 'POST' && /\/control(torrent|usenetdownload|webdownload)$/.test(p)) { const b = parseBody(); const arr = p.includes('torrent') ? state.torrents : p.includes('usenet') ? state.usenet : state.webdl; const id = b.torrent_id ?? b.usenet_id ?? b.webdl_id; if (!['delete', 'reannounce', 'resume', 'pause', 'stop_seeding'].includes(b.operation)) return send(400, { success: false, error: 'INVALID_OPTION', detail: 'Invalid operation.', data: null }); if (b.all) { arr.length = 0; } else { const i = arr.findIndex((x) => x.id === Number(id)); if (i < 0) return send(409, { success: false, error: 'NOT_OWNER', detail: 'You are not the owner of this torrent.', data: null }); if (b.operation === 'delete') arr.splice(i, 1); } return send(200, { success: true, error: null, detail: `${b.operation} successful.`, data: null }); }
    if (method === 'GET' && p.endsWith('/requestdl')) { const id = url.searchParams.get('torrent_id') || url.searchParams.get('usenet_id') || url.searchParams.get('web_id'); if (!id) return send(400, { success: false, error: 'MISSING_REQUIRED_OPTION', detail: 'id required', data: null }); const link = `https://cdn.mock.torbox/dl/${id}/${url.searchParams.get('file_id') || 0}?token=${Math.random().toString(36).slice(2)}${url.searchParams.get('zip_link') === 'true' ? '&zip=1' : ''}`; if (url.searchParams.get('redirect') === 'true') { res.writeHead(307, { location: link }); return res.end(); } return send(200, { success: true, error: null, detail: 'Download requested successfully.', data: link }); }
    if (method === 'GET' && p.endsWith('/checkcached')) { const hashes = url.searchParams.getAll('hash').flatMap((h) => h.split(',')).filter(Boolean); const fmt = url.searchParams.get('format') || 'object'; const found = hashes.filter((h) => !h.toLowerCase().startsWith('f')).map((h) => ({ name: `Item ${h.slice(0, 6)}`, size: 1024, hash: h })); return send(200, { success: true, error: null, detail: 'cache status retrieved successfully.', data: fmt === 'list' ? found : Object.fromEntries(found.map((f) => [f.hash, f])) }); }
    if (method === 'POST' && p.endsWith('/checkcached')) { const b = parseBody(); const fmt = url.searchParams.get('format') || 'object'; const found = (b.hashes || []).filter((h: string) => !h.toLowerCase().startsWith('f')).map((h: string) => ({ name: `Item ${h.slice(0, 6)}`, size: 1024, hash: h })); return send(200, { success: true, error: null, detail: 'cache status retrieved successfully.', data: fmt === 'list' ? found : Object.fromEntries(found.map((f: any) => [f.hash, f])) }); }
    if (method === 'GET' && p === '/v1/api/torrents/exportdata' && url.searchParams.get('type') === 'file') return send(200, Buffer.from('d8:announce0:e'), 'application/x-bittorrent');
    if (method === 'POST' && p === '/v1/api/torrents/magnettofile') return send(200, Buffer.from('d8:announce0:e'), 'application/x-bittorrent');
    if (method === 'GET' && p === '/v1/api/notifications/rss') return send(200, '<?xml version="1.0"?><rss version="2.0"><channel><title>TorBox Notifications</title></channel></rss>', 'application/rss+xml');
    if (method === 'GET' && p === '/v1/api/user/transaction/pdf') return send(200, Buffer.from('%PDF-1.4 mock'), 'application/pdf');
    if (method === 'PUT' && p === '/v1/api/user/settings/editsettings') { const b = parseBody(); state.notifications.push({ settings: b }); return send(200, { success: true, error: null, detail: 'User settings updated successfully.', data: null }); }
    // fixture fallback (templated paths)
    const key = Object.keys(fixtures).find((k) => { const [m, fp] = k.split(' '); if (m !== method) return false; const re = new RegExp('^' + fp.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+') + '/?$'); return re.test(p); });
    if (key) return send(200, fixtures[key]);
    if (p === '/') return send(200, { success: true, error: null, detail: 'API is up and running.', data: null });
    return send(404, { success: false, error: 'ENDPOINT_NOT_FOUND', detail: 'Endpoint not found', data: null });
  });
  return { server, state, listen: () => new Promise<number>((r) => server.listen(opts.port ?? 0, () => r((server.address() as any).port))), close: () => new Promise<void>((r) => server.close(() => r())) };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const port = Number(process.env.MOCK_TORBOX_PORT || 10100);
  createTorboxMock({ port }).listen().then((p) => console.log(`[torbox-mock] listening on http://localhost:${p} (keys: ${process.env.MOCK_TORBOX_KEYS || 'mock-torbox-key'})`));
}
