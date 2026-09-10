import { ObjectId } from 'mongodb';
import type { Database } from '../db.js';
import { COLLECTIONS } from '../db.js';

export type Alert = { _id?: ObjectId; severity: 'info' | 'warning' | 'critical'; type: string; title: string; message: string; meta?: any; dedupeKey?: string; createdAt: Date; readAt: Date | null; snoozedUntil?: Date | null };

export class AuditService {
  constructor(private db: Database) {}
  async record(entry: { adminId: string | null; adminEmail: string | null; action: string; target?: string; before?: any; after?: any; ip: string }) {
    await this.db.col(COLLECTIONS.auditLogs).insertOne({ ts: new Date(), ...entry, before: redact(entry.before), after: redact(entry.after) }).catch(() => {});
  }
}

const SECRET_KEYS = /(apiKey|apiKeyEnc|secret|password|passwordHash|totpSecretEnc|token)/i;
export function redact(v: any): any {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(redact);
  const out: any = {};
  for (const [k, val] of Object.entries(v)) out[k] = SECRET_KEYS.test(k) ? '***' : redact(val);
  return out;
}

export class AlertService {
  constructor(private db: Database, private getWebhookUrl: () => Promise<string>) {}
  col() { return this.db.col<Alert>(COLLECTIONS.alerts); }
  /** Create an alert; when dedupeKey is set an unread alert with the same key is updated instead of duplicated. */
  async raise(a: Omit<Alert, 'createdAt' | 'readAt'>) {
    if (a.dedupeKey) {
      const existing = await this.col().findOne({ dedupeKey: a.dedupeKey });
      if (existing && !existing.readAt) { await this.col().updateOne({ _id: existing._id }, { $set: { message: a.message, meta: a.meta, createdAt: new Date() } }); return existing._id!; }
      if (existing) await this.col().deleteOne({ _id: existing._id });
    }
    const doc: Alert = { ...a, createdAt: new Date(), readAt: null };
    const r = await this.col().insertOne(doc);
    this.notify(doc).catch(() => {});
    return r.insertedId;
  }
  async notify(a: Alert) {
    const url = await this.getWebhookUrl();
    if (!url) return;
    const text = `[${a.severity.toUpperCase()}] ${a.title}\n${a.message}`;
    const body = url.includes('discord.com') ? { content: text.slice(0, 1900) } : url.includes('slack.com') ? { text } : { severity: a.severity, type: a.type, title: a.title, message: a.message, meta: a.meta, createdAt: a.createdAt };
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  }
  async unreadCount() { return this.col().countDocuments({ readAt: null, $or: [{ snoozedUntil: null }, { snoozedUntil: { $exists: false } }, { snoozedUntil: { $lte: new Date() } }] }); }
}
