import { MongoClient, type Db, type Collection, type Document } from 'mongodb';
import type { Config } from './config.js';

export const COLLECTIONS = {
  admins: 'admins', adminSessions: 'admin_sessions', upstreams: 'upstream_accounts', clients: 'clients', apiKeys: 'api_keys',
  policies: 'policies', rateBuckets: 'rate_buckets', quotaCounters: 'quota_counters', requestLogs: 'request_logs',
  usageDaily: 'usage_daily', cache: 'cache_entries', downloadIndex: 'download_index', activity: 'activity',
  webhookEndpoints: 'webhook_endpoints', webhookDeliveries: 'webhook_deliveries', events: 'events', inboundHooks: 'inbound_hooks',
  alerts: 'alerts', auditLogs: 'audit_logs', settings: 'settings', jobLocks: 'job_locks', jobRuns: 'job_runs', upstreamHealth: 'upstream_health',
} as const;

export class Database {
  client: MongoClient;
  db!: Db;
  constructor(private cfg: Config) {
    this.client = new MongoClient(cfg.MONGODB_URI, { maxPoolSize: 20, serverSelectionTimeoutMS: 10_000, retryWrites: true });
  }
  async connect() {
    await this.client.connect();
    this.db = this.client.db(this.cfg.MONGODB_DB_NAME);
    return this;
  }
  col<T extends Document = Document>(name: (typeof COLLECTIONS)[keyof typeof COLLECTIONS]): Collection<T> {
    return this.db.collection<T>(name);
  }
  async ping(): Promise<number> {
    const t = Date.now();
    await this.db.command({ ping: 1 });
    return Date.now() - t;
  }
  async close() { await this.client.close(); }

  /** Idempotent index creation. TTL indexes are (re)created with the configured retention. */
  async ensureIndexes(retention: { requestLogsDays: number; activityDays: number; eventsDays: number; webhookDeliveriesDays: number }) {
    const c = COLLECTIONS;
    const day = 86400;
    await this.col(c.admins).createIndex({ email: 1 }, { unique: true });
    await this.col(c.adminSessions).createIndex({ tokenHash: 1 }, { unique: true });
    await this.col(c.adminSessions).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.col(c.upstreams).createIndex({ status: 1 });
    await this.col(c.clients).createIndex({ name: 1 });
    await this.col(c.apiKeys).createIndex({ hash: 1 }, { unique: true });
    await this.col(c.apiKeys).createIndex({ prefix: 1 });
    await this.col(c.apiKeys).createIndex({ clientId: 1 });
    await this.col(c.apiKeys).createIndex({ status: 1, expiresAt: 1 });
    await this.col(c.apiKeys).createIndex({ 'previousSecrets.hash': 1 });
    await this.col(c.policies).createIndex({ name: 1 }, { unique: true });
    await this.col(c.rateBuckets).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.col(c.requestLogs).createIndex({ ts: -1 });
    await this.col(c.requestLogs).createIndex({ keyId: 1, ts: -1 });
    await this.col(c.requestLogs).createIndex({ clientId: 1, ts: -1 });
    await this.col(c.requestLogs).createIndex({ torboxError: 1, ts: -1 });
    await this.col(c.requestLogs).createIndex({ requestId: 1 });
    await this.ttl(c.requestLogs, 'ts', retention.requestLogsDays * day);
    await this.col(c.usageDaily).createIndex({ keyId: 1, d: 1 }, { unique: true });
    await this.col(c.usageDaily).createIndex({ d: 1 });
    await this.col(c.cache).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.col(c.cache).createIndex({ group: 1, upstreamAccountId: 1 });
    await this.col(c.downloadIndex).createIndex({ publicId: 1 }, { unique: true });
    await this.col(c.downloadIndex).createIndex({ upstreamAccountId: 1, type: 1, torboxId: 1 }, { unique: true });
    await this.col(c.downloadIndex).createIndex({ hash: 1 });
    await this.col(c.activity).createIndex({ ts: -1 });
    await this.col(c.activity).createIndex({ keyId: 1, ts: -1 });
    await this.col(c.activity).createIndex({ publicId: 1, ts: -1 });
    await this.col(c.activity).createIndex({ kind: 1, ts: -1 });
    await this.ttl(c.activity, 'ts', retention.activityDays * day);
    await this.col(c.webhookEndpoints).createIndex({ clientId: 1 });
    await this.col(c.webhookDeliveries).createIndex({ status: 1, nextAttemptAt: 1 });
    await this.col(c.webhookDeliveries).createIndex({ endpointId: 1, createdAt: -1 });
    await this.ttl(c.webhookDeliveries, 'createdAt', retention.webhookDeliveriesDays * day);
    await this.col(c.events).createIndex({ dedupeKey: 1 }, { unique: true });
    await this.col(c.events).createIndex({ ts: -1 });
    await this.col(c.events).createIndex({ publicId: 1, ts: -1 });
    await this.ttl(c.events, 'ts', retention.eventsDays * day);
    await this.col(c.inboundHooks).createIndex({ ts: -1 });
    await this.ttl(c.inboundHooks, 'ts', 7 * day);
    await this.col(c.alerts).createIndex({ createdAt: -1 });
    await this.col(c.alerts).createIndex({ readAt: 1, createdAt: -1 });
    await this.col(c.alerts).createIndex({ dedupeKey: 1 }, { unique: true, sparse: true });
    await this.col(c.auditLogs).createIndex({ ts: -1 });
    await this.col(c.auditLogs).createIndex({ adminId: 1, ts: -1 });
    await this.col(c.jobLocks).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.col(c.upstreamHealth).createIndex({ ts: -1 });
    await this.ttl(c.upstreamHealth, 'ts', 7 * day);
  }

  /** Create or update a TTL index (Mongo cannot alter expireAfterSeconds via createIndex; use collMod). */
  private async ttl(collection: string, field: string, seconds: number) {
    const name = `${field}_ttl`;
    const col = this.db.collection(collection);
    const existing = (await col.listIndexes().toArray().catch(() => [])).find((i) => i.name === name);
    if (!existing) {
      await col.createIndex({ [field]: 1 }, { name, expireAfterSeconds: seconds });
    } else if (existing.expireAfterSeconds !== seconds) {
      await this.db.command({ collMod: collection, index: { name, expireAfterSeconds: seconds } });
    }
  }
}
