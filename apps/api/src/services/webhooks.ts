import { ObjectId } from 'mongodb';
import type { Database } from '../db.js';
import { COLLECTIONS } from '../db.js';
import { decrypt, encrypt, hmac, randomId } from '../crypto.js';
import type { Config } from '../config.js';
import type { DownloadService, DlType } from './downloads.js';
import type { UpstreamAccount, UpstreamService } from './upstreams.js';
import type { LogService } from './logging.js';

export const EVENT_TYPES = ['download.completed', 'download.failed', 'download.deleted', 'download.expiring', 'download.added', 'job.completed', 'job.failed', 'notification.received', 'test'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type GatewayEvent = { _id?: ObjectId; ts: Date; type: EventType; publicId: string | null; downloadName: string | null; upstreamAccountId: string | null; createdByKeyId: ObjectId | null; clientId: ObjectId | null; payload: any; dedupeKey: string; source: 'webhook' | 'reconciler' | 'gateway' };
export type WebhookEndpoint = { _id: ObjectId; clientId: ObjectId; keyId: ObjectId | null; url: string; secretEnc: string; events: string[]; active: boolean; failureCount: number; disabledReason: string | null; lastDeliveryAt: Date | null; createdAt: Date; updatedAt: Date };
export type Delivery = { _id?: ObjectId; endpointId: ObjectId; eventId: ObjectId | null; event: string; payload: any; status: 'pending' | 'delivered' | 'failed' | 'dead'; attempts: number; nextAttemptAt: Date; lastResponse: { status: number; body: string } | null; createdAt: Date; deliveredAt: Date | null };
const BACKOFF_SEC = [60, 300, 1800, 7200, 43200];

export class WebhookService {
  constructor(private db: Database, private cfg: Config, private downloads: DownloadService, private upstreams: UpstreamService, private logs: LogService) {}
  endpoints() { return this.db.col<WebhookEndpoint>(COLLECTIONS.webhookEndpoints); }
  deliveries() { return this.db.col<Delivery>(COLLECTIONS.webhookDeliveries); }
  events() { return this.db.col<GatewayEvent>(COLLECTIONS.events); }

  async createEndpoint(input: { clientId: string; keyId?: string | null; url: string; events: string[] }) {
    const secret = `whsec_${randomId(32)}`; const now = new Date();
    const doc: WebhookEndpoint = { _id: new ObjectId(), clientId: new ObjectId(input.clientId), keyId: input.keyId ? new ObjectId(input.keyId) : null, url: input.url, secretEnc: encrypt(this.cfg.MASTER_ENCRYPTION_KEY, secret), events: input.events?.length ? input.events : ['*'], active: true, failureCount: 0, disabledReason: null, lastDeliveryAt: null, createdAt: now, updatedAt: now };
    await this.endpoints().insertOne(doc);
    return { endpoint: doc, secret };
  }
  async rotateSecret(id: ObjectId) { const secret = `whsec_${randomId(32)}`; await this.endpoints().updateOne({ _id: id }, { $set: { secretEnc: encrypt(this.cfg.MASTER_ENCRYPTION_KEY, secret), updatedAt: new Date() } }); return secret; }

  /** Persist an event (deduped) and fan it out to matching endpoints. */
  async emit(ev: Omit<GatewayEvent, 'ts'> & { ts?: Date }): Promise<boolean> {
    const doc: GatewayEvent = { ...ev, ts: ev.ts || new Date() };
    try { await this.events().insertOne(doc); } catch { return false; }
    const q: any = { active: true, $or: [{ events: '*' }, { events: ev.type }] };
    if (ev.clientId) q.clientId = ev.clientId; else if (ev.type !== 'test') q.clientId = { $exists: true };
    const eps = await this.endpoints().find(q).toArray();
    const targets = eps.filter((e) => !e.keyId || !ev.createdByKeyId || e.keyId.equals(ev.createdByKeyId));
    if (targets.length) await this.deliveries().insertMany(targets.map((e) => ({ endpointId: e._id, eventId: doc._id ?? null, event: ev.type, payload: this.payloadFor(doc), status: 'pending' as const, attempts: 0, nextAttemptAt: new Date(), lastResponse: null, createdAt: new Date(), deliveredAt: null })));
    return true;
  }
  payloadFor(ev: GatewayEvent) { return { id: ev._id?.toHexString(), type: ev.type, createdAt: ev.ts.toISOString(), data: { publicId: ev.publicId, name: ev.downloadName, ...ev.payload } }; }

  async enqueueTest(endpoint: WebhookEndpoint) {
    const d: Delivery = { endpointId: endpoint._id, eventId: null, event: 'test', payload: { id: randomId(), type: 'test', createdAt: new Date().toISOString(), data: { message: 'Test delivery from TorBox Gateway' } }, status: 'pending', attempts: 0, nextAttemptAt: new Date(), lastResponse: null, createdAt: new Date(), deliveredAt: null };
    const r = await this.deliveries().insertOne(d); d._id = r.insertedId;
    return this.deliver(d, endpoint);
  }

  async deliver(d: Delivery, ep?: WebhookEndpoint | null) {
    ep = ep || (await this.endpoints().findOne({ _id: d.endpointId }));
    if (!ep) { await this.deliveries().updateOne({ _id: d._id }, { $set: { status: 'dead' } }); return { ok: false, status: 0 }; }
    const body = JSON.stringify(d.payload); const ts = Math.floor(Date.now() / 1000);
    const sig = hmac(decrypt(this.cfg.MASTER_ENCRYPTION_KEY, ep.secretEnc), `${ts}.${body}`);
    let status = 0; let text = '';
    try {
      const res = await fetch(ep.url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'torbox-gateway-webhooks/1.0', 'x-tbg-signature': `t=${ts},v1=${sig}`, 'x-tbg-event': d.event, 'x-tbg-delivery': d._id!.toHexString() }, body, signal: AbortSignal.timeout(15_000) });
      status = res.status; text = (await res.text()).slice(0, 2000);
    } catch (e: any) { status = 0; text = e?.message || String(e); }
    const ok = status >= 200 && status < 300; const attempts = d.attempts + 1;
    if (ok) {
      await this.deliveries().updateOne({ _id: d._id }, { $set: { status: 'delivered', attempts, lastResponse: { status, body: text }, deliveredAt: new Date() } });
      await this.endpoints().updateOne({ _id: ep._id }, { $set: { failureCount: 0, lastDeliveryAt: new Date() } });
    } else {
      const dead = attempts >= BACKOFF_SEC.length;
      await this.deliveries().updateOne({ _id: d._id }, { $set: { status: dead ? 'dead' : 'failed', attempts, lastResponse: { status, body: text }, nextAttemptAt: new Date(Date.now() + (BACKOFF_SEC[attempts - 1] || 43200) * 1000) } });
      const fc = ep.failureCount + 1; const upd: any = { failureCount: fc, lastDeliveryAt: new Date() };
      if (fc >= 25) { upd.active = false; upd.disabledReason = `Disabled after ${fc} consecutive failures (last HTTP ${status})`; }
      await this.endpoints().updateOne({ _id: ep._id }, { $set: upd });
    }
    return { ok, status, body: text };
  }
  async dispatchDue(limit = 50) {
    const due = await this.deliveries().find({ status: { $in: ['pending', 'failed'] }, nextAttemptAt: { $lte: new Date() } }).sort({ nextAttemptAt: 1 }).limit(limit).toArray();
    let delivered = 0;
    for (const d of due) { const r = await this.deliver(d); if (r.ok) delivered++; }
    return { attempted: due.length, delivered };
  }

  /** Poll TorBox lists and emit state-transition events (completed / deleted / expiring). */
  async reconcile(account: UpstreamAccount) {
    const accountId = account._id.toHexString(); const emitted: string[] = [];
    const seenIds = new Map<DlType, Set<number>>();
    for (const type of ['torrent', 'usenet', 'webdl'] as DlType[]) {
      const before = new Map((await this.downloads.index().find({ upstreamAccountId: accountId, type, deletedAt: null }).toArray()).map((d) => [d.torboxId, d]));
      const r = await this.downloads.rawList(account, type, { bypassCache: false });
      if (r.error) continue;
      seenIds.set(type, new Set(r.items.map((i) => i.id)));
      const idx = await this.downloads.ensureIndexed(accountId, type, r.items);
      for (const it of r.items) {
        const prev = before.get(it.id); const cur = idx.get(it.id)!; const finished = !!(it.download_finished && it.download_present);
        if (!prev) { if (await this.emit({ type: 'download.added', publicId: cur.publicId, downloadName: it.name, upstreamAccountId: accountId, createdByKeyId: cur.createdByKeyId, clientId: null, payload: { type, torboxId: it.id, hash: it.hash, state: it.download_state }, dedupeKey: `added:${accountId}:${type}:${it.id}`, source: 'reconciler' })) emitted.push('download.added'); }
        if (finished && !(prev?.lastFinished)) { if (await this.emit({ type: 'download.completed', publicId: cur.publicId, downloadName: it.name, upstreamAccountId: accountId, createdByKeyId: cur.createdByKeyId, clientId: null, payload: { type, torboxId: it.id, hash: it.hash, size: it.size, files: (it.files || []).length }, dedupeKey: `completed:${accountId}:${type}:${it.id}`, source: 'reconciler' })) emitted.push('download.completed'); }
        const failedNow = /error|fail|missing/i.test(it.download_state || '') && !/error|fail|missing/i.test(prev?.lastState || '');
        if (failedNow) { if (await this.emit({ type: 'download.failed', publicId: cur.publicId, downloadName: it.name, upstreamAccountId: accountId, createdByKeyId: cur.createdByKeyId, clientId: null, payload: { type, torboxId: it.id, state: it.download_state }, dedupeKey: `failed:${accountId}:${type}:${it.id}:${it.download_state}`, source: 'reconciler' })) emitted.push('download.failed'); }
        if (it.expires_at) { const ms = new Date(it.expires_at).getTime() - Date.now(); if (ms > 0 && ms < 86400e3) { if (await this.emit({ type: 'download.expiring', publicId: cur.publicId, downloadName: it.name, upstreamAccountId: accountId, createdByKeyId: cur.createdByKeyId, clientId: null, payload: { type, torboxId: it.id, expiresAt: it.expires_at }, dedupeKey: `expiring:${accountId}:${type}:${it.id}:${it.expires_at}`, source: 'reconciler' })) emitted.push('download.expiring'); } }
      }
      for (const [id, prev] of before) if (!seenIds.get(type)!.has(id)) {
        await this.downloads.index().updateOne({ _id: prev._id }, { $set: { deletedAt: new Date() } });
        if (await this.emit({ type: 'download.deleted', publicId: prev.publicId, downloadName: prev.name, upstreamAccountId: accountId, createdByKeyId: prev.createdByKeyId, clientId: null, payload: { type, torboxId: id, hash: prev.hash }, dedupeKey: `deleted:${accountId}:${type}:${id}`, source: 'reconciler' })) emitted.push('download.deleted');
      }
    }
    // resolve clientId for deliveries created without it (events carry createdByKeyId)
    return emitted;
  }

  /** Inbound TorBox webhook: store raw payload, derive an event. */
  async handleInbound(accountId: string, raw: any, ip: string) {
    const title = String(raw?.title ?? raw?.subject ?? raw?.event ?? ''); const message = String(raw?.message ?? raw?.description ?? raw?.detail ?? '');
    let eventType: EventType = 'notification.received'; let publicId: string | null = null; let name: string | null = null; let createdByKeyId: ObjectId | null = null;
    const text = `${title} ${message}`;
    const m = /(?:torrent|download|usenet|web download)\s+"?(.+?)"?\s+(?:has|is)\s+(?:finished|completed|ready|been downloaded)/i.exec(text) || /"([^"]+)"/.exec(text);
    if (m) { const idx = await this.downloads.index().findOne({ upstreamAccountId: accountId, name: m[1] }, { sort: { lastSeenAt: -1 } }); if (idx) { publicId = idx.publicId; name = idx.name; createdByKeyId = idx.createdByKeyId; if (/finish|complet|ready|downloaded/i.test(text)) eventType = 'download.completed'; else if (/fail|error/i.test(text)) eventType = 'download.failed'; } }
    const parsed = eventType !== 'notification.received';
    await this.db.col(COLLECTIONS.inboundHooks).insertOne({ ts: new Date(), accountId, ip, parsed, eventType, raw });
    await this.emit({ type: eventType, publicId, downloadName: name, upstreamAccountId: accountId, createdByKeyId, clientId: null, payload: { title, message, raw }, dedupeKey: `hook:${accountId}:${eventType}:${publicId || ''}:${title}:${message}`.slice(0, 500), source: 'webhook' });
    return { parsed, eventType };
  }
}
