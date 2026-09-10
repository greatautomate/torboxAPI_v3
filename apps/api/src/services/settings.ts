import type { Database } from '../db.js';
import { COLLECTIONS } from '../db.js';

export type Settings = {
  _id: 'global';
  branding: { name: string; tagline: string; logoUrl: string; accentColor: string; supportEmail: string };
  homepage: { showPublicStats: boolean; sections: Record<string, boolean>; customIntro: string };
  cors: { allowedOrigins: string[] };
  maintenance: { enabled: boolean; message: string; readOnly: boolean };
  retention: { requestLogsDays: number; activityDays: number; eventsDays: number; webhookDeliveriesDays: number };
  privacy: { storeFullQuery: boolean; truncateIps: boolean };
  alerts: { webhookUrl: string; thresholds: { errorRatePct: number; budgetHeadroomPct: number; premiumExpiringDays: number; quotaPct: number } };
  docs: { public: boolean };
  updatedAt?: Date;
};

export const HOMEPAGE_SECTIONS = ['dropin', 'keys', 'unified', 'permalinks', 'cache', 'hosters', 'automation', 'webhooks', 'observability', 'ratelimits', 'gallery', 'quickstart'];

export const DEFAULT_SETTINGS: Settings = {
  _id: 'global',
  branding: { name: 'TorBox Gateway', tagline: 'One TorBox account. Unlimited safe API keys.', logoUrl: '', accentColor: '#4f46e5', supportEmail: '' },
  homepage: { showPublicStats: false, sections: Object.fromEntries(HOMEPAGE_SECTIONS.map((s) => [s, true])), customIntro: '' },
  cors: { allowedOrigins: [] },
  maintenance: { enabled: false, message: 'The gateway is under maintenance. Please retry shortly.', readOnly: false },
  retention: { requestLogsDays: 30, activityDays: 90, eventsDays: 30, webhookDeliveriesDays: 7 },
  privacy: { storeFullQuery: true, truncateIps: false },
  alerts: { webhookUrl: '', thresholds: { errorRatePct: 25, budgetHeadroomPct: 15, premiumExpiringDays: 7, quotaPct: 90 } },
  docs: { public: true },
};

export class SettingsService {
  private cache: Settings | null = null;
  private cachedAt = 0;
  constructor(private db: Database) {}
  async get(force = false): Promise<Settings> {
    if (!force && this.cache && Date.now() - this.cachedAt < 5000) return this.cache;
    const doc = await this.db.col<Settings>(COLLECTIONS.settings).findOne({ _id: 'global' } as any);
    this.cache = deepMerge(DEFAULT_SETTINGS, doc || {});
    this.cachedAt = Date.now();
    return this.cache;
  }
  async update(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.get(true);
    const next = deepMerge(current, patch);
    next._id = 'global'; next.updatedAt = new Date();
    await this.db.col<Settings>(COLLECTIONS.settings).replaceOne({ _id: 'global' } as any, next, { upsert: true });
    this.cache = next; this.cachedAt = Date.now();
    return next;
  }
}

export function deepMerge<T>(base: T, patch: any): T {
  if (Array.isArray(base) || Array.isArray(patch)) return (patch ?? base) as T;
  if (base && typeof base === 'object' && patch && typeof patch === 'object') {
    const out: any = { ...base };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      out[k] = k in (base as any) ? deepMerge((base as any)[k], v) : v;
    }
    return out;
  }
  return (patch === undefined ? base : patch) as T;
}
