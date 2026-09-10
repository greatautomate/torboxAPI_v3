import { ObjectId } from 'mongodb';
import type { Database } from '../db.js';
import { COLLECTIONS } from '../db.js';
import { decrypt, encrypt, sha256 } from '../crypto.js';
import { PLAN_NAMES, TorboxClient } from '../torbox/client.js';
import type { Config } from '../config.js';

export type UpstreamLimits = { perMinute: number; createUncachedPerHour: number; createUsenetPerHour: number; createWebdlPerHour: number };
export type UpstreamAccount = {
  _id: ObjectId; label: string; apiKeyEnc: string; fingerprint: string; status: 'active' | 'degraded' | 'disabled';
  plan: number | null; email: string | null; premiumExpiresAt: Date | null; isSubscribed: boolean | null; lastVerifiedAt: Date | null; lastError: string | null;
  weight: number; limits: UpstreamLimits; webhookConfigured: boolean; meCache?: any; createdAt: Date; updatedAt: Date;
};

export const maskEmail = (e?: string | null) => (e ? e.replace(/^(.).*(@.*)$/, '$1***$2') : null);

export class UpstreamService {
  private keyCache = new Map<string, { key: string; at: number }>();
  constructor(private db: Database, private cfg: Config, private torbox: TorboxClient) {}
  private col() { return this.db.col<UpstreamAccount>(COLLECTIONS.upstreams); }
  defaultLimits(): UpstreamLimits {
    return { perMinute: this.cfg.UPSTREAM_GLOBAL_PER_MINUTE, createUncachedPerHour: this.cfg.UPSTREAM_GLOBAL_CREATE_UNCACHED_PER_HOUR, createUsenetPerHour: this.cfg.UPSTREAM_GLOBAL_CREATE_USENET_PER_HOUR, createWebdlPerHour: this.cfg.UPSTREAM_GLOBAL_CREATE_WEBDL_PER_HOUR };
  }
  toDto(a: UpstreamAccount, keysCount = 0) {
    return { id: a._id.toHexString(), label: a.label, fingerprint: a.fingerprint, status: a.status, plan: a.plan, planName: a.plan == null ? null : PLAN_NAMES[a.plan] || `Plan ${a.plan}`, emailMasked: maskEmail(a.email), premiumExpiresAt: a.premiumExpiresAt, isSubscribed: a.isSubscribed, lastVerifiedAt: a.lastVerifiedAt, lastError: a.lastError, weight: a.weight, limits: a.limits, webhookConfigured: a.webhookConfigured, keysCount, createdAt: a.createdAt };
  }
  async list() { return this.col().find({}).sort({ createdAt: 1 }).toArray(); }
  async get(id: string | ObjectId) { return this.col().findOne({ _id: new ObjectId(id) }); }
  async getActiveDefault() { return this.col().findOne({ status: { $ne: 'disabled' } }, { sort: { weight: -1, createdAt: 1 } }); }
  decryptKey(a: UpstreamAccount): string {
    const id = a._id.toHexString(); const c = this.keyCache.get(id);
    if (c && c.at > Date.now() - 60_000) return c.key;
    const key = decrypt(this.cfg.MASTER_ENCRYPTION_KEY, a.apiKeyEnc);
    this.keyCache.set(id, { key, at: Date.now() });
    return key;
  }
  async verifyKey(apiKey: string) {
    const r = await this.torbox.call<any>(apiKey, 'GET', '/v1/api/user/me', { query: { settings: 'false' } });
    if (!r.success || !r.data) throw Object.assign(new Error(r.detail || 'TorBox rejected the key'), { code: r.error || 'BAD_TOKEN', status: 400 });
    return r.data as { plan: number; email: string; premium_expires_at: string; is_subscribed: boolean; [k: string]: any };
  }
  async create(label: string, apiKey: string, limits?: Partial<UpstreamLimits>) {
    const me = await this.verifyKey(apiKey);
    const fp = sha256(apiKey).slice(0, 12);
    if (await this.col().findOne({ fingerprint: fp })) throw Object.assign(new Error('This TorBox key is already registered'), { code: 'DUPLICATE', status: 409 });
    const now = new Date();
    const doc: UpstreamAccount = { _id: new ObjectId(), label, apiKeyEnc: encrypt(this.cfg.MASTER_ENCRYPTION_KEY, apiKey), fingerprint: fp, status: 'active', plan: me.plan ?? null, email: me.email ?? null, premiumExpiresAt: me.premium_expires_at ? new Date(me.premium_expires_at) : null, isSubscribed: me.is_subscribed ?? null, lastVerifiedAt: now, lastError: null, weight: 1, limits: { ...this.defaultLimits(), ...(limits || {}) }, webhookConfigured: false, meCache: redactMe(me), createdAt: now, updatedAt: now };
    await this.col().insertOne(doc);
    return doc;
  }
  async rotate(id: string, apiKey: string) {
    const me = await this.verifyKey(apiKey);
    await this.col().updateOne({ _id: new ObjectId(id) }, { $set: { apiKeyEnc: encrypt(this.cfg.MASTER_ENCRYPTION_KEY, apiKey), fingerprint: sha256(apiKey).slice(0, 12), plan: me.plan ?? null, email: me.email ?? null, premiumExpiresAt: me.premium_expires_at ? new Date(me.premium_expires_at) : null, isSubscribed: me.is_subscribed ?? null, lastVerifiedAt: new Date(), lastError: null, status: 'active', meCache: redactMe(me), updatedAt: new Date() } });
    this.keyCache.delete(id);
    return this.get(id);
  }
  /** Re-verify an account with TorBox; records health and degrades status on auth errors. */
  async verify(a: UpstreamAccount) {
    const started = Date.now();
    const r = await this.torbox.call<any>(this.decryptKey(a), 'GET', '/v1/api/user/me', { query: { settings: 'false' }, timeoutMs: 15000 });
    const ok = r.success && !!r.data;
    const set: any = { lastVerifiedAt: new Date(), updatedAt: new Date() };
    if (ok) { Object.assign(set, { plan: r.data.plan ?? null, email: r.data.email ?? null, premiumExpiresAt: r.data.premium_expires_at ? new Date(r.data.premium_expires_at) : null, isSubscribed: r.data.is_subscribed ?? null, lastError: null, meCache: redactMe(r.data) }); if (a.status === 'degraded') set.status = 'active'; }
    else { set.lastError = `${r.error}: ${r.detail}`; if (['BAD_TOKEN', 'NO_AUTH'].includes(r.error || '') && a.status === 'active') set.status = 'degraded'; }
    await this.col().updateOne({ _id: a._id }, { $set: set });
    await this.db.col(COLLECTIONS.upstreamHealth).insertOne({ ts: new Date(), accountId: a._id.toHexString(), ok, latencyMs: Date.now() - started, detail: ok ? null : `${r.error}: ${r.detail}` });
    return { ok, error: ok ? null : r.error, detail: r.detail, latencyMs: Date.now() - started };
  }
}

/** Keep only non-sensitive fields of TorBox user/me for the dashboard. */
export function redactMe(me: any) {
  if (!me) return null;
  const { customer, base_email, email, settings, ...rest } = me;
  return { ...rest, emailMasked: maskEmail(email) };
}
