import { ObjectId } from 'mongodb';
import type { Database } from '../db.js';
import { COLLECTIONS } from '../db.js';
import { randomId, signParams } from '../crypto.js';
import type { TorboxClient } from '../torbox/client.js';
import type { CacheService } from './cache.js';
import type { UpstreamAccount, UpstreamService } from './upstreams.js';
import type { LogService, Activity } from './logging.js';
import type { Config } from '../config.js';

export type DlType = 'torrent' | 'usenet' | 'webdl';
export const DL_TYPES: DlType[] = ['torrent', 'usenet', 'webdl'];
export type DownloadState = 'queued' | 'metadata' | 'downloading' | 'stalled' | 'paused' | 'processing' | 'seeding' | 'completed' | 'cached' | 'failed' | 'unknown';
export type Download = {
  publicId: string; type: DlType; torboxId: number; upstreamAccountId: string; name: string; hash: string; size: number; state: DownloadState; rawState: string;
  progress: number; downloadSpeed: number; uploadSpeed: number; eta: number; seeds: number; peers: number; ratio: number; cached: boolean; active: boolean;
  downloadFinished: boolean; downloadPresent: boolean; expiresAt: string | null; createdAt: string | null; updatedAt: string | null; originalUrl?: string | null;
  files: { id: number; name: string; shortName: string; size: number; mimetype: string; zipped: boolean }[]; tags: string[]; alternativeHashes: string[]; airlocked: boolean;
  createdByKeyId?: string | null; createdByKeyName?: string | null;
};
export type IndexDoc = { _id?: ObjectId; publicId: string; type: DlType; torboxId: number; hash: string | null; upstreamAccountId: string; name: string | null; createdByKeyId: ObjectId | null; createdByKeyName: string | null; lastState: string | null; lastFinished: boolean; expiresAt: Date | null; firstSeenAt: Date; lastSeenAt: Date; deletedAt?: Date | null };

export const PATHS: Record<DlType, { list: string; create: string; control: string; edit: string; requestdl: string; checkcached: string; idField: string; editIdField: string; dlIdField: string; streamType: string }> = {
  torrent: { list: '/v1/api/torrents/mylist', create: '/v1/api/torrents/createtorrent', control: '/v1/api/torrents/controltorrent', edit: '/v1/api/torrents/edittorrent', requestdl: '/v1/api/torrents/requestdl', checkcached: '/v1/api/torrents/checkcached', idField: 'torrent_id', editIdField: 'torrent_id', dlIdField: 'torrent_id', streamType: 'torrent' },
  usenet: { list: '/v1/api/usenet/mylist', create: '/v1/api/usenet/createusenetdownload', control: '/v1/api/usenet/controlusenetdownload', edit: '/v1/api/usenet/editusenetdownload', requestdl: '/v1/api/usenet/requestdl', checkcached: '/v1/api/usenet/checkcached', idField: 'usenet_id', editIdField: 'usenet_download_id', dlIdField: 'usenet_id', streamType: 'usenet' },
  webdl: { list: '/v1/api/webdl/mylist', create: '/v1/api/webdl/createwebdownload', control: '/v1/api/webdl/controlwebdownload', edit: '/v1/api/webdl/editwebdownload', requestdl: '/v1/api/webdl/requestdl', checkcached: '/v1/api/webdl/checkcached', idField: 'webdl_id', editIdField: 'webdl_id', dlIdField: 'web_id', streamType: 'webdownload' },
};

export function mapState(raw: string | undefined | null, finished?: boolean, present?: boolean): DownloadState {
  const s = (raw || '').toLowerCase();
  let st: DownloadState = 'unknown';
  if (s.includes('stalled')) st = 'stalled';
  else if (s.includes('metadl') || s.includes('meta')) st = 'metadata';
  else if (s.includes('queued')) st = 'queued';
  else if (s.includes('paused')) st = 'paused';
  else if (s.includes('upload') || s.includes('seed')) st = 'seeding';
  else if (s.includes('download')) st = 'downloading';
  else if (s.includes('checking') || s.includes('process') || s.includes('moving')) st = 'processing';
  else if (s.includes('cached')) st = 'cached';
  else if (s.includes('completed')) st = 'completed';
  else if (s.includes('error') || s.includes('fail') || s.includes('missing')) st = 'failed';
  if (finished && present && st !== 'seeding') st = 'completed';
  return st;
}
export function extractHash(magnetOrHash: string): string | null {
  const m = /btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/.exec(magnetOrHash);
  if (m) return m[1].toLowerCase();
  if (/^[a-fA-F0-9]{40}$/.test(magnetOrHash.trim())) return magnetOrHash.trim().toLowerCase();
  return null;
}
export function detectType(input: { magnet?: string; url?: string; fileName?: string; nzbUrl?: string }): DlType | null {
  if (input.magnet || (input.url && input.url.startsWith('magnet:'))) return 'torrent';
  if (input.nzbUrl) return 'usenet';
  if (input.fileName) { if (/\.torrent$/i.test(input.fileName)) return 'torrent'; if (/\.nzb$/i.test(input.fileName)) return 'usenet'; }
  if (input.url) { if (/\.nzb(\?|$)/i.test(input.url) || /nzb/i.test(new URL(input.url, 'http://x').hostname)) return 'usenet'; if (/^https?:\/\//i.test(input.url)) return 'webdl'; }
  return null;
}

export class DownloadService {
  constructor(private db: Database, private cfg: Config, private torbox: TorboxClient, private cache: CacheService, private upstreams: UpstreamService, private logs: LogService) {}
  index() { return this.db.col<IndexDoc>(COLLECTIONS.downloadIndex); }

  normalize(type: DlType, raw: any, accountId: string, idx?: IndexDoc | null): Download {
    return {
      publicId: idx?.publicId || '', type, torboxId: raw.id, upstreamAccountId: accountId, name: raw.name, hash: raw.hash, size: raw.size ?? 0,
      state: mapState(raw.download_state, raw.download_finished, raw.download_present), rawState: raw.download_state ?? '', progress: raw.progress ?? 0,
      downloadSpeed: raw.download_speed ?? 0, uploadSpeed: raw.upload_speed ?? 0, eta: raw.eta ?? 0, seeds: raw.seeds ?? 0, peers: raw.peers ?? 0, ratio: raw.ratio ?? 0,
      cached: !!raw.cached, active: !!raw.active, downloadFinished: !!raw.download_finished, downloadPresent: !!raw.download_present, expiresAt: raw.expires_at ?? null,
      createdAt: raw.created_at ?? null, updatedAt: raw.updated_at ?? null, originalUrl: raw.original_url ?? null,
      files: (raw.files || []).map((f: any) => ({ id: f.id, name: f.name, shortName: f.short_name, size: f.size, mimetype: f.mimetype, zipped: !!f.zipped })),
      tags: raw.tags || [], alternativeHashes: raw.alternative_hashes || [], airlocked: !!raw.airlocked, createdByKeyId: idx?.createdByKeyId?.toHexString() ?? null, createdByKeyName: idx?.createdByKeyName ?? null,
    };
  }

  /** Ensure every raw item has an index document; returns map torboxId → IndexDoc. */
  async ensureIndexed(accountId: string, type: DlType, items: any[], creator?: { keyId: ObjectId; keyName: string }): Promise<Map<number, IndexDoc>> {
    const out = new Map<number, IndexDoc>();
    if (!items.length) return out;
    const existing = await this.index().find({ upstreamAccountId: accountId, type, torboxId: { $in: items.map((i) => i.id) } }).toArray();
    for (const e of existing) out.set(e.torboxId, e);
    const now = new Date(); const ops: any[] = [];
    for (const it of items) {
      const e = out.get(it.id);
      if (e) { ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: { name: it.name ?? e.name, hash: it.hash ?? e.hash, lastState: it.download_state ?? e.lastState, lastFinished: !!(it.download_finished && it.download_present), expiresAt: it.expires_at ? new Date(it.expires_at) : e.expiresAt, lastSeenAt: now, deletedAt: null } } } }); continue; }
      const doc: IndexDoc = { publicId: randomId(14), type, torboxId: it.id, hash: it.hash ?? null, upstreamAccountId: accountId, name: it.name ?? null, createdByKeyId: creator?.keyId ?? null, createdByKeyName: creator?.keyName ?? null, lastState: it.download_state ?? null, lastFinished: !!(it.download_finished && it.download_present), expiresAt: it.expires_at ? new Date(it.expires_at) : null, firstSeenAt: now, lastSeenAt: now, deletedAt: null };
      ops.push({ updateOne: { filter: { upstreamAccountId: accountId, type, torboxId: it.id }, update: { $setOnInsert: doc }, upsert: true } });
      out.set(it.id, doc);
    }
    if (ops.length) await this.index().bulkWrite(ops, { ordered: false }).catch(() => {});
    // re-read inserted ones to get their publicIds (in case of races)
    const missing = items.filter((i) => !existing.find((e) => e.torboxId === i.id)).map((i) => i.id);
    if (missing.length) for (const e of await this.index().find({ upstreamAccountId: accountId, type, torboxId: { $in: missing } }).toArray()) out.set(e.torboxId, e);
    return out;
  }

  /** Raw list from TorBox (cached briefly). */
  async rawList(account: UpstreamAccount, type: DlType, opts: { bypassCache?: boolean; id?: number } = {}): Promise<{ items: any[]; error: string | null; detail: string }> {
    const accountId = account._id.toHexString();
    const ck = this.cache.key(['v1list', accountId, type, opts.id ?? '', opts.bypassCache ? 1 : 0]);
    const ttl = type === 'torrent' ? 30 : 10;
    if (!opts.bypassCache) { const c = await this.cache.get(ck, type); if (c) return JSON.parse(c.body.toString()); }
    const r = await this.torbox.call<any>(this.upstreams.decryptKey(account), 'GET', PATHS[type].list, { query: { bypass_cache: opts.bypassCache ? 'true' : 'false', ...(opts.id != null ? { id: String(opts.id) } : { limit: '1000', offset: '0' }) } });
    const items = r.success && r.data ? (Array.isArray(r.data) ? r.data : [r.data]) : [];
    const res = { items, error: r.success || r.error === 'ITEM_NOT_FOUND' ? null : r.error, detail: r.detail };
    if (!res.error) await this.cache.set(ck, type, accountId, 200, 'application/json', Buffer.from(JSON.stringify(res)), ttl);
    return res;
  }

  async list(account: UpstreamAccount, opts: { types?: DlType[]; state?: string; q?: string; bypassCache?: boolean; createdByKeyId?: string; limit?: number; cursor?: string }) {
    const accountId = account._id.toHexString();
    const types = opts.types?.length ? opts.types : DL_TYPES;
    const all: Download[] = []; const errors: Record<string, string> = {};
    await Promise.all(types.map(async (t) => {
      const r = await this.rawList(account, t, { bypassCache: opts.bypassCache });
      if (r.error) errors[t] = `${r.error}: ${r.detail}`;
      const idx = await this.ensureIndexed(accountId, t, r.items);
      for (const it of r.items) all.push(this.normalize(t, it, accountId, idx.get(it.id)));
    }));
    let items = all;
    if (opts.state) items = items.filter((d) => d.state === opts.state);
    if (opts.createdByKeyId) items = items.filter((d) => d.createdByKeyId === opts.createdByKeyId);
    if (opts.q) { const q = opts.q.toLowerCase(); items = items.filter((d) => d.name?.toLowerCase().includes(q) || d.hash?.toLowerCase().includes(q) || d.publicId === opts.q || String(d.torboxId) === opts.q); }
    items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const limit = Math.min(Math.max(opts.limit || 100, 1), 1000);
    const offset = opts.cursor ? Number(Buffer.from(opts.cursor, 'base64url').toString()) || 0 : 0;
    const page = items.slice(offset, offset + limit);
    const next = offset + limit < items.length ? Buffer.from(String(offset + limit)).toString('base64url') : null;
    return { items: page, total: items.length, next, errors };
  }

  async resolve(publicId: string): Promise<IndexDoc | null> { return this.index().findOne({ publicId }); }

  async getOne(account: UpstreamAccount, idx: IndexDoc, bypassCache = false): Promise<Download | null> {
    const r = await this.rawList(account, idx.type, { id: idx.torboxId, bypassCache });
    const raw = r.items.find((i) => i.id === idx.torboxId);
    if (!raw) return null;
    await this.ensureIndexed(account._id.toHexString(), idx.type, [raw]);
    return this.normalize(idx.type, raw, account._id.toHexString(), idx);
  }

  async isCached(account: UpstreamAccount, type: DlType, hash: string): Promise<boolean | null> {
    const accountId = account._id.toHexString();
    const ck = this.cache.key(['cached', accountId, type, hash.toLowerCase()]);
    const c = await this.cache.get(ck, type);
    if (c) return JSON.parse(c.body.toString()).cached;
    const r = await this.torbox.call<any>(this.upstreams.decryptKey(account), 'GET', PATHS[type].checkcached, { query: { hash, format: 'list', list_files: 'false' }, timeoutMs: 15000 });
    if (!r.success) return null;
    const cached = Array.isArray(r.data) ? r.data.some((d: any) => d.hash?.toLowerCase() === hash.toLowerCase()) : !!(r.data && typeof r.data === 'object' && Object.keys(r.data).some((k) => k.toLowerCase() === hash.toLowerCase()));
    await this.cache.set(ck, type, accountId, 200, 'application/json', Buffer.from(JSON.stringify({ cached })), 3600);
    return cached;
  }

  /** Smart create: detects type, calls the right TorBox endpoint, indexes the item, records activity. */
  async create(account: UpstreamAccount, actor: Activity extends infer A ? Pick<Activity, 'keyId' | 'keyName' | 'clientId' | 'clientName' | 'ip' | 'requestId'> : never, input: {
    type?: DlType; magnet?: string; url?: string; nzbUrl?: string; file?: { buffer: Buffer; filename: string }; name?: string; seed?: number; allowZip?: boolean; password?: string;
    postProcessing?: number; asQueued?: boolean; onlyIfCached?: boolean; allowDuplicate?: boolean;
  }) {
    const accountId = account._id.toHexString();
    const type = input.type || detectType({ magnet: input.magnet, url: input.url, fileName: input.file?.filename, nzbUrl: input.nzbUrl });
    if (!type) throw Object.assign(new Error('Could not detect the download type. Provide a magnet link, a .torrent/.nzb file, an NZB URL or an http(s) link.'), { status: 400, code: 'INVALID_OPTION' });
    const p = PATHS[type];
    const hash = input.magnet ? extractHash(input.magnet) : input.url?.startsWith('magnet:') ? extractHash(input.url) : null;
    // dedupe by hash
    if (hash && !input.allowDuplicate) {
      const existing = await this.index().findOne({ upstreamAccountId: accountId, type, hash, deletedAt: null });
      if (existing) {
        const dl = await this.getOne(account, existing);
        if (dl) { await this.logs.logActivity({ ts: new Date(), kind: 'submit', ...actor, upstreamAccountId: accountId, type, publicId: existing.publicId, torboxId: existing.torboxId, hash, name: dl.name, input: submitInput(input), success: true, error: null, detail: 'Already on the account (deduplicated)' }); return { download: dl, duplicate: true, detail: 'This item already exists on the account.' }; }
      }
    }
    let r: any;
    if (type === 'webdl') {
      const form: Record<string, string> = { link: input.url || input.magnet || '' };
      if (input.password) form.password = input.password; if (input.name) form.name = input.name;
      if (input.asQueued) form.as_queued = 'true'; if (input.onlyIfCached) form.add_only_if_cached = 'true';
      r = await this.torbox.call<any>(this.upstreams.decryptKey(account), 'POST', p.create, { form, timeoutMs: 60000 });
    } else {
      const fd = new FormData();
      if (type === 'torrent') { if (input.magnet || input.url) fd.append('magnet', input.magnet || input.url!); if (input.seed != null) fd.append('seed', String(input.seed)); if (input.allowZip != null) fd.append('allow_zip', String(input.allowZip)); }
      else { if (input.nzbUrl || input.url) fd.append('link', input.nzbUrl || input.url!); if (input.password) fd.append('password', input.password); if (input.postProcessing != null) fd.append('post_processing', String(input.postProcessing)); }
      if (input.file) fd.append('file', new Blob([input.file.buffer]), input.file.filename);
      if (input.name) fd.append('name', input.name);
      if (input.asQueued) fd.append('as_queued', 'true'); if (input.onlyIfCached) fd.append('add_only_if_cached', 'true');
      r = await this.torbox.call<any>(this.upstreams.decryptKey(account), 'POST', p.create, { multipart: fd, timeoutMs: 120000 });
    }
    const torboxId: number | undefined = r.data?.torrent_id ?? r.data?.usenetdownload_id ?? r.data?.webdownload_id;
    const outHash: string | null = r.data?.hash ?? hash ?? null;
    let download: Download | null = null; let publicId: string | null = null;
    if (r.success && torboxId != null) {
      const idxMap = await this.ensureIndexed(accountId, type, [{ id: torboxId, hash: outHash, name: input.name || null }], actor.keyId ? { keyId: actor.keyId, keyName: actor.keyName || '' } : undefined);
      const idx = idxMap.get(torboxId)!; publicId = idx.publicId;
      await this.cache.invalidate({ group: type, upstreamAccountId: accountId });
      download = (await this.getOne(account, idx, true)) || { ...this.normalize(type, { id: torboxId, hash: outHash, name: input.name || outHash || `${type} ${torboxId}`, download_state: input.asQueued ? 'queued' : 'downloading' }, accountId, idx) };
    }
    await this.logs.logActivity({ ts: new Date(), kind: 'submit', ...actor, upstreamAccountId: accountId, type, publicId, torboxId: torboxId ?? null, hash: outHash, name: download?.name || input.name || null, input: submitInput(input), success: !!r.success, error: r.success ? null : r.error, detail: r.detail });
    if (!r.success) throw Object.assign(new Error(r.detail || 'TorBox rejected the download'), { status: r.status >= 400 && r.status < 500 ? r.status : 400, code: r.error || 'UPSTREAM_ERROR', data: r.data });
    return { download: download!, duplicate: false, detail: r.detail, asyncQueued: torboxId == null };
  }

  async control(account: UpstreamAccount, actor: Pick<Activity, 'keyId' | 'keyName' | 'clientId' | 'clientName' | 'ip' | 'requestId'>, idx: IndexDoc, operation: string) {
    const p = PATHS[idx.type]; const accountId = account._id.toHexString();
    const r = await this.torbox.call<any>(this.upstreams.decryptKey(account), 'POST', p.control, { json: { [p.idField]: idx.torboxId, operation } });
    await this.logs.logActivity({ ts: new Date(), kind: 'control', ...actor, upstreamAccountId: accountId, type: idx.type, publicId: idx.publicId, torboxId: idx.torboxId, hash: idx.hash, name: idx.name, action: operation, success: !!r.success, error: r.success ? null : r.error, detail: r.detail });
    if (r.success) { await this.cache.invalidate({ group: idx.type, upstreamAccountId: accountId }); if (operation === 'delete') await this.index().updateOne({ _id: idx._id }, { $set: { deletedAt: new Date() } }); }
    return r;
  }

  async edit(account: UpstreamAccount, actor: Pick<Activity, 'keyId' | 'keyName' | 'clientId' | 'clientName' | 'ip' | 'requestId'>, idx: IndexDoc, patch: { name?: string; tags?: string[]; alternativeHashes?: string[]; airlocked?: boolean }) {
    const p = PATHS[idx.type]; const accountId = account._id.toHexString();
    const current = await this.getOne(account, idx, true);
    const body: any = { [p.editIdField]: idx.torboxId, name: patch.name ?? current?.name, tags: patch.tags ?? current?.tags ?? [], alternative_hashes: patch.alternativeHashes ?? current?.alternativeHashes ?? [] };
    if (patch.airlocked != null) body.airlocked = patch.airlocked;
    const r = await this.torbox.call<any>(this.upstreams.decryptKey(account), 'PUT', p.edit, { json: body });
    await this.logs.logActivity({ ts: new Date(), kind: 'edit', ...actor, upstreamAccountId: accountId, type: idx.type, publicId: idx.publicId, torboxId: idx.torboxId, hash: idx.hash, name: patch.name ?? idx.name, action: 'edit', input: patch as any, success: !!r.success, error: r.success ? null : r.error, detail: r.detail });
    if (r.success) await this.cache.invalidate({ group: idx.type, upstreamAccountId: accountId });
    return r;
  }

  /** Ask TorBox for a CDN link (requestdl). Records the generated link in the activity log. */
  async requestLink(account: UpstreamAccount, actor: Pick<Activity, 'keyId' | 'keyName' | 'clientId' | 'clientName' | 'ip' | 'requestId'>, idx: IndexDoc, opts: { fileId?: number; zip?: boolean; userIp?: string; via?: 'api' | 'permalink' | 'compat' }) {
    const p = PATHS[idx.type]; const accountId = account._id.toHexString();
    const query: Record<string, string> = { [p.dlIdField]: String(idx.torboxId), file_id: String(opts.fileId ?? 0), zip_link: opts.zip ? 'true' : 'false', redirect: 'false' };
    if (opts.userIp) query.user_ip = opts.userIp;
    const r = await this.torbox.call<string>(this.upstreams.decryptKey(account), 'GET', p.requestdl, { query, tokenInQuery: true });
    await this.logs.logActivity({ ts: new Date(), kind: 'link', ...actor, upstreamAccountId: accountId, type: idx.type, publicId: idx.publicId, torboxId: idx.torboxId, hash: idx.hash, name: idx.name, action: opts.via || 'api', output: { cdnUrl: r.success ? r.data : null, fileId: opts.fileId ?? 0, zip: !!opts.zip, expiresAt: r.success ? new Date(Date.now() + 3 * 3600e3).toISOString() : null }, success: !!r.success, error: r.success ? null : r.error, detail: r.detail });
    return r;
  }

  /** Signed permalink bound to the gateway key (revoking the key invalidates all its links). */
  permalink(keyId: string, publicId: string, fileId: number, zip: boolean, expiresAt?: Date | null): string {
    const exp = expiresAt ? Math.floor(expiresAt.getTime() / 1000) : 0;
    const sig = signParams(this.cfg.PERMALINK_SIGNING_SECRET, [keyId, publicId, fileId, zip ? 1 : 0], exp || undefined);
    const u = new URL(`/dl/${publicId}/${fileId}`, this.cfg.publicBaseUrl);
    u.searchParams.set('k', keyId); if (zip) u.searchParams.set('zip', '1'); if (exp) u.searchParams.set('exp', String(exp)); u.searchParams.set('sig', sig);
    return u.toString();
  }
  streamLink(keyId: string, publicId: string, fileId: number, expiresAt?: Date | null): string {
    const exp = expiresAt ? Math.floor(expiresAt.getTime() / 1000) : 0;
    const sig = signParams(this.cfg.PERMALINK_SIGNING_SECRET, ['s', keyId, publicId, fileId], exp || undefined);
    const u = new URL(`/s/${publicId}/${fileId}/master.m3u8`, this.cfg.publicBaseUrl);
    u.searchParams.set('k', keyId); if (exp) u.searchParams.set('exp', String(exp)); u.searchParams.set('sig', sig);
    return u.toString();
  }
  verifyPermalink(kind: 'dl' | 's', keyId: string, publicId: string, fileId: number, zip: boolean, exp: number, sig: string): boolean {
    if (exp && exp * 1000 < Date.now()) return false;
    const expected = kind === 'dl' ? signParams(this.cfg.PERMALINK_SIGNING_SECRET, [keyId, publicId, fileId, zip ? 1 : 0], exp || undefined) : signParams(this.cfg.PERMALINK_SIGNING_SECRET, ['s', keyId, publicId, fileId], exp || undefined);
    return expected === sig;
  }

  async createStream(account: UpstreamAccount, actor: Pick<Activity, 'keyId' | 'keyName' | 'clientId' | 'clientName' | 'ip' | 'requestId'>, idx: IndexDoc, opts: { fileId?: number; audio?: number; subtitle?: number | null; resolution?: number | null }) {
    const accountId = account._id.toHexString();
    const query: Record<string, string> = { id: String(idx.torboxId), file_id: String(opts.fileId ?? 0), type: PATHS[idx.type].streamType, chosen_audio_index: String(opts.audio ?? 0) };
    if (opts.subtitle != null) query.chosen_subtitle_index = String(opts.subtitle); if (opts.resolution != null) query.chosen_resolution_index = String(opts.resolution);
    const r = await this.torbox.call<any>(this.upstreams.decryptKey(account), 'GET', '/v1/api/stream/createstream', { query, timeoutMs: 60000 });
    await this.logs.logActivity({ ts: new Date(), kind: 'stream', ...actor, upstreamAccountId: accountId, type: idx.type, publicId: idx.publicId, torboxId: idx.torboxId, hash: idx.hash, name: idx.name, output: { hlsUrl: r.data?.hls_url ?? null, fileId: opts.fileId ?? 0, needsTranscoding: r.data?.needs_transcoding }, success: !!r.success, error: r.success ? null : r.error, detail: r.detail });
    return r;
  }
}

function submitInput(input: any) {
  const out: Record<string, unknown> = {};
  if (input.magnet) out.magnet = input.magnet; if (input.url) out.url = input.url; if (input.nzbUrl) out.nzbUrl = input.nzbUrl;
  if (input.file) { out.fileName = input.file.filename; out.fileSize = input.file.buffer.length; }
  if (input.name) out.name = input.name; if (input.password) out.password = '***'; if (input.asQueued) out.asQueued = true; if (input.onlyIfCached) out.onlyIfCached = true;
  if (input.seed != null) out.seed = input.seed; if (input.postProcessing != null) out.postProcessing = input.postProcessing;
  return out;
}
