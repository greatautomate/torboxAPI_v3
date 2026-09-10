import { ObjectId } from 'mongodb';
import type { Database } from '../db.js';
import { COLLECTIONS } from '../db.js';
import type { Settings } from './settings.js';

export type RequestLog = {
  _id?: ObjectId; ts: Date; requestId: string; keyId: ObjectId | null; keyName: string | null; clientId: ObjectId | null; clientName: string | null; upstreamAccountId: string | null;
  method: string; route: string; path: string; query: string; status: number; upstreamStatus: number | null; torboxError: string | null; success: boolean;
  latencyMs: number; upstreamLatencyMs: number | null; cacheHit: boolean; ip: string; userAgent: string; reqBytes: number; resBytes: number; surface: 'compat' | 'v1' | 'permalink' | 'stream' | 'public';
};
export type Activity = {
  _id?: ObjectId; ts: Date; kind: 'submit' | 'link' | 'stream' | 'control' | 'edit'; keyId: ObjectId | null; keyName: string | null; clientId: ObjectId | null; clientName: string | null; upstreamAccountId: string | null;
  type: 'torrent' | 'usenet' | 'webdl' | null; publicId: string | null; torboxId: number | null; hash: string | null; name: string | null;
  input?: Record<string, unknown>; output?: Record<string, unknown>; action?: string; success: boolean; error: string | null; detail: string | null; ip: string; requestId?: string;
};

const SENSITIVE_QUERY = new Set(['token', 'password', 'session_token', 'google_token', 'dropbox_token', 'onedrive_token', 'gofile_token', 'onefichier_token', 'pixeldrain_token', 'presigned_token', 'sig']);
export function redactQuery(q: URLSearchParams | Record<string, any>, full: boolean): string {
  const sp = q instanceof URLSearchParams ? q : new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, String(x)]) : [[k, String(v)]])) as any);
  const out = new URLSearchParams();
  sp.forEach((v, k) => out.append(k, SENSITIVE_QUERY.has(k) ? '***' : full ? v : v.length > 64 ? v.slice(0, 64) + '…' : v));
  return out.toString();
}
export const truncateIp = (ip: string, on: boolean) => (on && /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip.replace(/\.\d+$/, '.0') : ip);

export class LogService {
  constructor(private db: Database) {}
  async logRequest(log: RequestLog) {
    await this.db.col<RequestLog>(COLLECTIONS.requestLogs).insertOne(log).catch(() => {});
    if (log.keyId) {
      const d = log.ts.toISOString().slice(0, 10);
      const inc: any = { requests: 1 };
      if (!log.success) inc.errors = 1;
      if (log.cacheHit) inc.cacheHits = 1;
      inc[`byRoute.${log.route.replace(/[.$]/g, '_')}`] = 1;
      if (log.torboxError) inc[`byError.${log.torboxError.replace(/[.$]/g, '_')}`] = 1;
      inc.latencySum = log.latencyMs;
      await this.db.col(COLLECTIONS.usageDaily).updateOne({ keyId: log.keyId, d }, { $inc: inc, $setOnInsert: { clientId: log.clientId, createdAt: new Date() } }, { upsert: true }).catch(() => {});
      const ym = d.slice(0, 7);
      await this.db.col(COLLECTIONS.quotaCounters).updateOne({ _id: `${log.keyId.toHexString()}:${ym}` } as any, { $inc: { requests: 1 }, $setOnInsert: { keyId: log.keyId, ym } }, { upsert: true }).catch(() => {});
    }
  }
  async logActivity(a: Activity) {
    await this.db.col<Activity>(COLLECTIONS.activity).insertOne(a).catch(() => {});
    if (a.keyId && a.kind === 'submit' && a.success) {
      const d = a.ts.toISOString().slice(0, 10);
      await this.db.col(COLLECTIONS.usageDaily).updateOne({ keyId: a.keyId, d }, { $inc: { submits: 1 }, $setOnInsert: { clientId: a.clientId, createdAt: new Date() } }, { upsert: true }).catch(() => {});
      await this.db.col(COLLECTIONS.quotaCounters).updateOne({ _id: `${a.keyId.toHexString()}:${d.slice(0, 7)}` } as any, { $inc: { creates: 1 }, $setOnInsert: { keyId: a.keyId, ym: d.slice(0, 7) } }, { upsert: true }).catch(() => {});
    }
    if (a.keyId && a.kind === 'link' && a.success) {
      const d = a.ts.toISOString().slice(0, 10);
      await this.db.col(COLLECTIONS.usageDaily).updateOne({ keyId: a.keyId, d }, { $inc: { links: 1 }, $setOnInsert: { clientId: a.clientId, createdAt: new Date() } }, { upsert: true }).catch(() => {});
    }
  }
  async monthlyUsage(keyId: ObjectId, ym = new Date().toISOString().slice(0, 7)) {
    const doc = await this.db.col<any>(COLLECTIONS.quotaCounters).findOne({ _id: `${keyId.toHexString()}:${ym}` } as any);
    return { requests: doc?.requests || 0, creates: doc?.creates || 0 };
  }
  async resetUsage(keyId: ObjectId) {
    await this.db.col(COLLECTIONS.quotaCounters).deleteMany({ keyId });
    await this.db.col(COLLECTIONS.usageDaily).deleteMany({ keyId });
  }
}

export function applyPrivacy(settings: Settings, ip: string) { return truncateIp(ip, settings.privacy.truncateIps); }
