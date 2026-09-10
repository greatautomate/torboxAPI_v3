import type { Database } from '../db.js';
import { COLLECTIONS } from '../db.js';
import { sha256 } from '../crypto.js';

export type CacheEntry = { _id: string; group: string; upstreamAccountId: string | null; status: number; contentType: string; body: Buffer; expiresAt: Date; createdAt: Date; hits: number };
const MAX_BODY = 14 * 1024 * 1024;

export class CacheService {
  stats = { hits: 0, misses: 0, byGroup: new Map<string, { hits: number; misses: number }>() };
  constructor(private db: Database) {}
  private col() { return this.db.col<CacheEntry>(COLLECTIONS.cache); }
  key(parts: (string | number | null | undefined)[]) { return sha256(parts.map((p) => String(p ?? '')).join('|')); }
  private bump(group: string, hit: boolean) {
    const g = this.stats.byGroup.get(group) || { hits: 0, misses: 0 }; hit ? g.hits++ : g.misses++; this.stats.byGroup.set(group, g);
    hit ? this.stats.hits++ : this.stats.misses++;
  }
  async get(id: string, group: string): Promise<CacheEntry | null> {
    const doc = await this.col().findOne({ _id: id });
    if (!doc || doc.expiresAt.getTime() < Date.now()) { this.bump(group, false); return null; }
    this.bump(group, true);
    this.col().updateOne({ _id: id }, { $inc: { hits: 1 } }).catch(() => {});
    return { ...doc, body: Buffer.isBuffer(doc.body) ? doc.body : Buffer.from((doc.body as any).buffer) };
  }
  async set(id: string, group: string, upstreamAccountId: string | null, status: number, contentType: string, body: Buffer, ttlSec: number) {
    if (ttlSec <= 0 || body.length > MAX_BODY) return;
    await this.col().updateOne({ _id: id }, { $set: { group, upstreamAccountId, status, contentType, body, expiresAt: new Date(Date.now() + ttlSec * 1000), createdAt: new Date() }, $setOnInsert: { hits: 0 } }, { upsert: true }).catch(() => {});
  }
  async invalidate(filter: { group?: string; upstreamAccountId?: string | null } = {}): Promise<number> {
    const q: any = {};
    if (filter.group) q.group = filter.group;
    if (filter.upstreamAccountId) q.upstreamAccountId = filter.upstreamAccountId;
    const r = await this.col().deleteMany(q);
    return r.deletedCount;
  }
  async summary() {
    const [agg] = await this.col().aggregate([{ $group: { _id: null, entries: { $sum: 1 }, bytes: { $sum: { $bsonSize: '$$ROOT' } } } }]).toArray();
    const groups = await this.col().aggregate([{ $group: { _id: '$group', entries: { $sum: 1 }, hits: { $sum: '$hits' } } }]).toArray();
    return {
      entries: agg?.entries || 0, bytes: agg?.bytes || 0,
      byGroup: groups.map((g) => ({ group: g._id, entries: g.entries, hits: this.stats.byGroup.get(g._id)?.hits ?? g.hits, misses: this.stats.byGroup.get(g._id)?.misses ?? 0 })),
    };
  }
}
