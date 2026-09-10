/** Background jobs with MongoDB lease locks. Run in-process (RUN_JOBS_IN_PROCESS) and/or from the Render cron service. */
import type { Services } from '../context.js';
import { COLLECTIONS } from '../db.js';
import { randomId } from '../crypto.js';

export type JobDef = { name: string; everySec: number; run: (svc: Services) => Promise<any> };

export const JOBS: JobDef[] = [
  { name: 'verify-upstreams', everySec: 300, run: async (svc) => {
    const accounts = await svc.upstreams.list(); const out: any[] = []; const s = await svc.settings.get();
    for (const a of accounts) {
      if (a.status === 'disabled') continue;
      const r = await svc.upstreams.verify(a); out.push({ label: a.label, ...r });
      if (!r.ok && ['BAD_TOKEN', 'NO_AUTH', 'AUTH_ERROR'].includes(r.error || '')) await svc.alerts.raise({ severity: 'critical', type: 'upstream.auth', title: `TorBox key rejected: ${a.label}`, message: `${r.error}: ${r.detail}`, dedupeKey: `upstream.auth:${a._id}` });
      if (a.premiumExpiresAt && a.premiumExpiresAt.getTime() - Date.now() < s.alerts.thresholds.premiumExpiringDays * 86400e3) await svc.alerts.raise({ severity: 'warning', type: 'upstream.expiring', title: `TorBox premium expiring: ${a.label}`, message: `Premium expires ${a.premiumExpiresAt.toISOString().slice(0, 10)}`, dedupeKey: `upstream.expiring:${a._id}` });
      const p = await svc.limiter.peek(`upstream:${a._id.toHexString()}`, 'minute', a.limits.perMinute);
      if (p.limit && (1 - p.used / p.limit) * 100 < s.alerts.thresholds.budgetHeadroomPct) await svc.alerts.raise({ severity: 'warning', type: 'upstream.budget', title: `Upstream budget low: ${a.label}`, message: `${p.used}/${p.limit} requests used this minute`, dedupeKey: `upstream.budget:${a._id}` });
    }
    return out;
  } },
  { name: 'reconcile-downloads', everySec: 120, run: async (svc) => {
    const accounts = await svc.upstreams.list(); const out: Record<string, string[]> = {};
    const subs = await svc.webhooks.endpoints().countDocuments({ active: true });
    for (const a of accounts) { if (a.status === 'disabled') continue; if (!subs && !(await svc.db.col(COLLECTIONS.downloadIndex).countDocuments({ upstreamAccountId: a._id.toHexString() }, { limit: 1 }))) continue; out[a.label] = await svc.webhooks.reconcile(a); }
    return out;
  } },
  { name: 'dispatch-webhooks', everySec: 60, run: async (svc) => svc.webhooks.dispatchDue(100) },
  { name: 'expire-keys', everySec: 3600, run: async (svc) => {
    const r = await svc.keys.keys().updateMany({ status: 'active', expiresAt: { $ne: null, $lt: new Date() } }, { $set: { status: 'revoked', revokedAt: new Date(), updatedAt: new Date() } });
    if (r.modifiedCount) await svc.alerts.raise({ severity: 'info', type: 'keys.expired', title: `${r.modifiedCount} key(s) expired`, message: 'Expired gateway keys were revoked automatically.' });
    return { revoked: r.modifiedCount };
  } },
  { name: 'quota-alerts', everySec: 900, run: async (svc) => {
    const s = await svc.settings.get(); const ym = new Date().toISOString().slice(0, 7); let raised = 0;
    for (const k of await svc.keys.keys().find({ status: 'active' }).toArray()) {
      const p = await svc.keys.policies().findOne({ _id: k.policyId }); if (!p?.quotas.monthlyRequests) continue;
      const u = await svc.logs.monthlyUsage(k._id, ym); const pct = (u.requests / p.quotas.monthlyRequests) * 100;
      if (pct >= s.alerts.thresholds.quotaPct) { await svc.alerts.raise({ severity: 'warning', type: 'key.quota', title: `Key near quota: ${k.name}`, message: `${u.requests}/${p.quotas.monthlyRequests} monthly requests (${pct.toFixed(0)}%)`, dedupeKey: `key.quota:${k._id}:${ym}`, meta: { keyId: k._id.toHexString() } }); raised++; }
    }
    return { raised };
  } },
  { name: 'error-rate-alert', everySec: 300, run: async (svc) => {
    const s = await svc.settings.get(); const since = new Date(Date.now() - 15 * 60_000);
    const [agg] = await svc.db.col<any>(COLLECTIONS.requestLogs).aggregate([{ $match: { ts: { $gte: since } } }, { $group: { _id: null, n: { $sum: 1 }, err: { $sum: { $cond: ['$success', 0, 1] } } } }]).toArray();
    if (agg && agg.n >= 20) { const pct = (agg.err / agg.n) * 100; if (pct >= s.alerts.thresholds.errorRatePct) await svc.alerts.raise({ severity: 'warning', type: 'errors.spike', title: 'Error rate spike', message: `${pct.toFixed(0)}% of ${agg.n} requests failed in the last 15 minutes`, dedupeKey: 'errors.spike' }); return { n: agg.n, errPct: pct }; }
    return { n: agg?.n || 0 };
  } },
  { name: 'prune-retention', everySec: 21600, run: async (svc) => {
    const s = await svc.settings.get(); await svc.db.ensureIndexes(s.retention);
    const day = 86400e3; const del = async (col: string, field: string, days: number) => (await svc.db.col(col as any).deleteMany({ [field]: { $lt: new Date(Date.now() - days * day) } })).deletedCount;
    return { requestLogs: await del(COLLECTIONS.requestLogs, 'ts', s.retention.requestLogsDays), activity: await del(COLLECTIONS.activity, 'ts', s.retention.activityDays), events: await del(COLLECTIONS.events, 'ts', s.retention.eventsDays), deliveries: await del(COLLECTIONS.webhookDeliveries, 'createdAt', s.retention.webhookDeliveriesDays), sessions: (await svc.db.col(COLLECTIONS.adminSessions).deleteMany({ expiresAt: { $lt: new Date() } })).deletedCount };
  } },
  { name: 'refresh-hosters', everySec: 3600, run: async (svc) => { const r = await svc.torbox.call<any>(null, 'GET', '/v1/api/webdl/hosters'); if (r.success) await svc.cache.set(svc.cache.key(['hosters', 'global']), 'webdl', null, 200, 'application/json', Buffer.from(JSON.stringify({ success: true, error: null, detail: r.detail, data: r.data })), 3600); return { ok: r.success, hosters: Array.isArray(r.data) ? r.data.length : 0 }; } },
];

export class JobRunner {
  private owner = randomId(8);
  private timer: NodeJS.Timeout | null = null;
  constructor(private svc: Services) {}
  locks() { return this.svc.db.col<any>(COLLECTIONS.jobLocks); }
  runs() { return this.svc.db.col<any>(COLLECTIONS.jobRuns); }

  async runDue(force?: string): Promise<{ ran: string[] }> {
    const ran: string[] = [];
    for (const job of JOBS) {
      if (force && job.name !== force) continue;
      const last = await this.runs().findOne({ _id: job.name });
      if (!force && last?.lastRunAt && Date.now() - new Date(last.lastRunAt).getTime() < job.everySec * 1000) continue;
      if (!(await this.acquire(job.name, Math.max(60, job.everySec)))) continue;
      const started = Date.now();
      try {
        const result = await job.run(this.svc);
        await this.runs().updateOne({ _id: job.name }, { $set: { lastRunAt: new Date(), lastStatus: 'ok', lastDurationMs: Date.now() - started, lastResult: JSON.parse(JSON.stringify(result ?? null)).toString().slice(0, 0) || result, lastError: null, everySec: job.everySec } }, { upsert: true });
        ran.push(job.name);
      } catch (e: any) {
        await this.runs().updateOne({ _id: job.name }, { $set: { lastRunAt: new Date(), lastStatus: 'error', lastDurationMs: Date.now() - started, lastError: String(e?.message || e), everySec: job.everySec } }, { upsert: true });
      } finally { await this.release(job.name); }
    }
    return { ran };
  }
  private async acquire(name: string, ttlSec: number) {
    try { await this.locks().insertOne({ _id: name, owner: this.owner, expiresAt: new Date(Date.now() + ttlSec * 1000) }); return true; }
    catch { const r = await this.locks().findOneAndUpdate({ _id: name, expiresAt: { $lt: new Date() } }, { $set: { owner: this.owner, expiresAt: new Date(Date.now() + ttlSec * 1000) } }); return !!r; }
  }
  private async release(name: string) { await this.locks().deleteOne({ _id: name, owner: this.owner }); }
  start(intervalMs = 30_000) { const tick = () => this.runDue().catch(() => {}); this.timer = setInterval(tick, intervalMs); setTimeout(tick, 5000); }
  stop() { if (this.timer) clearInterval(this.timer); }
  async status() {
    const runs = await this.runs().find({}).toArray(); const locks = await this.locks().find({}).toArray();
    return JOBS.map((j) => { const r = runs.find((x) => x._id === j.name); const l = locks.find((x) => x._id === j.name); return { name: j.name, everySec: j.everySec, lastRunAt: r?.lastRunAt || null, lastStatus: r?.lastStatus || null, lastDurationMs: r?.lastDurationMs || null, lastError: r?.lastError || null, lastResult: r?.lastResult ?? null, nextDueAt: r?.lastRunAt ? new Date(new Date(r.lastRunAt).getTime() + j.everySec * 1000) : new Date(), lockedBy: l?.owner || null }; });
  }
}
