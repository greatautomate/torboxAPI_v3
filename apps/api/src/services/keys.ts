import { ObjectId } from 'mongodb';
import type { Database } from '../db.js';
import { COLLECTIONS } from '../db.js';
import { generateApiKey, parseKeyPrefix, sha256 } from '../crypto.js';
import { ALL_SCOPES, SCOPES } from '../shared/scopes.js';

export type PolicyLimits = { perMinute: number; perHour: number; perDay: number; createUncachedPerHour: number; createPerHour: number };
export type PolicyQuotas = { monthlyRequests: number; monthlyCreates: number };
export type PolicyFeatures = { allowPermalinks: boolean; allowStreaming: boolean; allowUploads: boolean; allowSettingsWrite: boolean; allowBypassCache: boolean; allowWebhooks: boolean };
export type Policy = { _id: ObjectId; name: string; description: string; limits: PolicyLimits; quotas: PolicyQuotas; features: PolicyFeatures; cacheTtlOverrides: Record<string, number>; isDefault: boolean; createdAt: Date; updatedAt: Date };

export const DEFAULT_POLICY: Omit<Policy, '_id' | 'createdAt' | 'updatedAt'> = {
  name: 'Default', description: 'Balanced defaults for a single consumer', isDefault: true,
  limits: { perMinute: 60, perHour: 1000, perDay: 10000, createUncachedPerHour: 10, createPerHour: 20 },
  quotas: { monthlyRequests: 200000, monthlyCreates: 2000 },
  features: { allowPermalinks: true, allowStreaming: true, allowUploads: true, allowSettingsWrite: false, allowBypassCache: false, allowWebhooks: true },
  cacheTtlOverrides: {},
};

export type ApiKey = {
  _id: ObjectId; clientId: ObjectId; name: string; prefix: string; hash: string; last4: string; mode: 'live' | 'test'; scopes: string[]; policyId: ObjectId;
  upstreamAccountId: ObjectId; allowedIps: string[]; allowedOrigins: string[]; expiresAt: Date | null; status: 'active' | 'suspended' | 'revoked'; revokedAt: Date | null;
  lastUsedAt: Date | null; lastUsedIp: string | null; metadata: Record<string, unknown>; createdBy: string | null; previousSecrets: { hash: string; validUntil: Date }[]; createdAt: Date; updatedAt: Date;
};
export type Client = { _id: ObjectId; name: string; contactEmail: string; notes: string; status: 'active' | 'suspended'; defaultPolicyId: ObjectId | null; createdAt: Date; updatedAt: Date };

export class KeyService {
  constructor(private db: Database) {}
  keys() { return this.db.col<ApiKey>(COLLECTIONS.apiKeys); }
  policies() { return this.db.col<Policy>(COLLECTIONS.policies); }
  clients() { return this.db.col<Client>(COLLECTIONS.clients); }

  async ensureDefaultPolicy(): Promise<Policy> {
    let p = await this.policies().findOne({ isDefault: true });
    if (!p) {
      const now = new Date();
      const doc = { _id: new ObjectId(), ...DEFAULT_POLICY, createdAt: now, updatedAt: now } as Policy;
      await this.policies().insertOne(doc).catch(() => {});
      p = (await this.policies().findOne({ isDefault: true })) || doc;
    }
    return p;
  }
  validateScopes(scopes: string[]) {
    const bad = scopes.filter((s) => !ALL_SCOPES.has(s));
    if (bad.length) throw Object.assign(new Error(`Unknown scopes: ${bad.join(', ')}`), { status: 400, code: 'INVALID_SCOPE' });
    return Array.from(new Set(scopes.length ? scopes : SCOPES.filter((s) => s.default).map((s) => s.scope)));
  }
  async create(input: { name: string; clientId: string; scopes: string[]; policyId?: string; upstreamAccountId: string; allowedIps?: string[]; allowedOrigins?: string[]; expiresAt?: string | null; metadata?: Record<string, unknown>; createdBy?: string; mode?: 'live' | 'test' }) {
    const gen = generateApiKey(input.mode || 'live');
    const policy = input.policyId ? await this.policies().findOne({ _id: new ObjectId(input.policyId) }) : await this.ensureDefaultPolicy();
    if (!policy) throw Object.assign(new Error('Policy not found'), { status: 404, code: 'NOT_FOUND' });
    const now = new Date();
    const doc: ApiKey = {
      _id: new ObjectId(), clientId: new ObjectId(input.clientId), name: input.name, prefix: gen.prefix, hash: gen.hash, last4: gen.last4, mode: input.mode || 'live',
      scopes: this.validateScopes(input.scopes || []), policyId: policy._id, upstreamAccountId: new ObjectId(input.upstreamAccountId),
      allowedIps: (input.allowedIps || []).map((s) => s.trim()).filter(Boolean), allowedOrigins: (input.allowedOrigins || []).map((s) => s.trim()).filter(Boolean),
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, status: 'active', revokedAt: null, lastUsedAt: null, lastUsedIp: null, metadata: input.metadata || {}, createdBy: input.createdBy || null, previousSecrets: [], createdAt: now, updatedAt: now,
    };
    await this.keys().insertOne(doc);
    return { key: doc, secret: gen.secret };
  }
  async rotate(id: string, graceMinutes = 0) {
    const key = await this.keys().findOne({ _id: new ObjectId(id) });
    if (!key) throw Object.assign(new Error('Key not found'), { status: 404, code: 'NOT_FOUND' });
    const gen = generateApiKey(key.mode);
    const prev = graceMinutes > 0 ? [...key.previousSecrets.filter((p) => p.validUntil > new Date()), { hash: key.hash, validUntil: new Date(Date.now() + graceMinutes * 60_000) }] : [];
    await this.keys().updateOne({ _id: key._id }, { $set: { prefix: gen.prefix, hash: gen.hash, last4: gen.last4, previousSecrets: prev, updatedAt: new Date() } });
    return { secret: gen.secret };
  }
  /** Resolve a presented secret to an active key document (or null). Handles rotation grace period. */
  async authenticate(secret: string): Promise<{ key: ApiKey; policy: Policy; client: Client } | { error: string; detail: string } > {
    const prefix = parseKeyPrefix(secret);
    if (!prefix) return { error: 'BAD_TOKEN', detail: 'Malformed gateway API key.' };
    const hash = sha256(secret);
    let key = await this.keys().findOne({ hash });
    if (!key) {
      key = await this.keys().findOne({ 'previousSecrets.hash': hash, 'previousSecrets.validUntil': { $gt: new Date() } });
      if (!key) return { error: 'BAD_TOKEN', detail: 'Unknown or revoked gateway API key.' };
    }
    if (key.status === 'revoked') return { error: 'BAD_TOKEN', detail: 'This gateway API key has been revoked.' };
    if (key.status === 'suspended') return { error: 'KEY_SUSPENDED', detail: 'This gateway API key is suspended. Contact the operator.' };
    if (key.expiresAt && key.expiresAt < new Date()) return { error: 'KEY_EXPIRED', detail: 'This gateway API key has expired.' };
    const [policy, client] = await Promise.all([this.policies().findOne({ _id: key.policyId }), this.clients().findOne({ _id: key.clientId })]);
    if (!client || client.status === 'suspended') return { error: 'CLIENT_SUSPENDED', detail: 'The client owning this key is suspended.' };
    return { key, policy: policy || (await this.ensureDefaultPolicy()), client };
  }
  touch(keyId: ObjectId, ip: string) { this.keys().updateOne({ _id: keyId }, { $set: { lastUsedAt: new Date(), lastUsedIp: ip } }).catch(() => {}); }
}

/** CIDR / exact IP allowlist check (IPv4 CIDR + exact IPv6 match). */
export function ipAllowed(ip: string, allow: string[]): boolean {
  if (!allow.length) return true;
  const norm = ip.replace(/^::ffff:/, '');
  for (const rule of allow) {
    if (rule === norm || rule === ip) return true;
    const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(rule);
    if (m && /^\d+\.\d+\.\d+\.\d+$/.test(norm)) {
      const toInt = (s: string) => s.split('.').reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
      const bits = Number(m[2]); const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      if ((toInt(norm) & mask) === (toInt(m[1]) & mask)) return true;
    }
  }
  return false;
}
