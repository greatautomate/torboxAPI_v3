import type { Database } from '../db.js';
import { COLLECTIONS } from '../db.js';

export type Window = 'minute' | 'hour' | 'day';
const WINDOW_MS: Record<Window, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000 };

export type LimitCheck = { allowed: boolean; used: number; limit: number; resetAt: Date; window: Window; name: string };

/**
 * Fixed-window counters stored in MongoDB (one document per subject/window/bucket) with TTL cleanup.
 * A two-bucket sliding approximation weights the previous bucket by the remaining fraction of the current one,
 * which keeps bursts at bucket boundaries under control without Redis.
 */
export class RateLimiter {
  constructor(private db: Database) {}
  private col() { return this.db.col<any>(COLLECTIONS.rateBuckets); }
  private bucketId(subject: string, window: Window, start: number) { return `${subject}:${window}:${start}`; }

  /** Read current usage (sliding) without consuming. */
  async peek(subject: string, window: Window, limit: number, name = subject): Promise<LimitCheck> {
    const now = Date.now(); const size = WINDOW_MS[window]; const start = Math.floor(now / size) * size;
    const [cur, prev] = await Promise.all([
      this.col().findOne({ _id: this.bucketId(subject, window, start) }),
      this.col().findOne({ _id: this.bucketId(subject, window, start - size) }),
    ]);
    const frac = (size - (now - start)) / size;
    const used = (cur?.count || 0) + Math.floor((prev?.count || 0) * frac);
    return { allowed: used < limit, used, limit, resetAt: new Date(start + size), window, name };
  }

  /** Atomically consume one unit; returns allowed=false (and rolls back) when over the limit. limit<=0 means unlimited. */
  async consume(subject: string, window: Window, limit: number, name = subject, amount = 1): Promise<LimitCheck> {
    const now = Date.now(); const size = WINDOW_MS[window]; const start = Math.floor(now / size) * size;
    if (limit <= 0) return { allowed: true, used: 0, limit: 0, resetAt: new Date(start + size), window, name };
    const id = this.bucketId(subject, window, start);
    const prev = await this.col().findOne({ _id: this.bucketId(subject, window, start - size) });
    const frac = (size - (now - start)) / size;
    const carried = Math.floor((prev?.count || 0) * frac);
    const doc = await this.col().findOneAndUpdate(
      { _id: id },
      { $inc: { count: amount }, $setOnInsert: { subject, window, expiresAt: new Date(start + size * 2 + 60_000) } },
      { upsert: true, returnDocument: 'after' },
    );
    const used = (doc?.count || amount) + carried;
    if (used > limit) {
      await this.col().updateOne({ _id: id }, { $inc: { count: -amount } });
      return { allowed: false, used: used - amount, limit, resetAt: new Date(start + size), window, name };
    }
    return { allowed: true, used, limit, resetAt: new Date(start + size), window, name };
  }

  /** Consume several limits atomically-ish: check all first, then consume; if any fails, refund the ones consumed. */
  async consumeAll(items: { subject: string; window: Window; limit: number; name: string }[]): Promise<{ ok: true; checks: LimitCheck[] } | { ok: false; failed: LimitCheck; checks: LimitCheck[] }> {
    const consumed: typeof items = []; const checks: LimitCheck[] = [];
    for (const it of items) {
      const c = await this.consume(it.subject, it.window, it.limit, it.name);
      checks.push(c);
      if (!c.allowed) {
        for (const done of consumed) await this.refund(done.subject, done.window);
        return { ok: false, failed: c, checks };
      }
      if (it.limit > 0) consumed.push(it);
    }
    return { ok: true, checks };
  }
  async refund(subject: string, window: Window, amount = 1) {
    const size = WINDOW_MS[window]; const start = Math.floor(Date.now() / size) * size;
    await this.col().updateOne({ _id: this.bucketId(subject, window, start), count: { $gte: amount } }, { $inc: { count: -amount } });
  }
  async reset(subjectPrefix: string) {
    await this.col().deleteMany({ subject: { $regex: `^${subjectPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } });
  }
}
