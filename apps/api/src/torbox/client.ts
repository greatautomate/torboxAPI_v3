import type { Envelope } from '../shared/errors.js';

export type UpstreamResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  json: Envelope | null;
  durationMs: number;
  contentType: string;
};

export class TorboxClient {
  constructor(private base: string, private timeoutMs = 45_000, private userAgent = 'torbox-gateway/1.0') {}

  /**
   * Low level request. `path` is the TorBox path (e.g. /v1/api/user/me). `apiKey` is injected as Bearer header,
   * or as ?token= when `tokenInQuery` is set. Body may be a Buffer (raw pass-through), a string, FormData or URLSearchParams.
   */
  async request(opts: {
    method: string; path: string; apiKey?: string | null; tokenInQuery?: boolean;
    query?: Record<string, string | string[] | undefined> | URLSearchParams;
    body?: Buffer | string | FormData | URLSearchParams | null; contentType?: string;
    headers?: Record<string, string>; redirect?: 'follow' | 'manual'; timeoutMs?: number;
  }): Promise<UpstreamResponse> {
    const url = new URL(opts.path, this.base);
    if (opts.query instanceof URLSearchParams) {
      opts.query.forEach((v, k) => url.searchParams.append(k, v));
    } else if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x)); else url.searchParams.append(k, v);
      }
    }
    if (opts.apiKey && opts.tokenInQuery) url.searchParams.set('token', opts.apiKey);
    const headers: Record<string, string> = { accept: 'application/json, */*;q=0.8', 'user-agent': this.userAgent, ...(opts.headers || {}) };
    if (opts.apiKey && !opts.tokenInQuery) headers.authorization = `Bearer ${opts.apiKey}`;
    if (opts.contentType && !(opts.body instanceof FormData)) headers['content-type'] = opts.contentType;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? this.timeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(url, { method: opts.method, headers, body: opts.body as any, redirect: opts.redirect ?? 'manual', signal: ctrl.signal });
      const body = Buffer.from(await res.arrayBuffer());
      const h: Record<string, string> = {};
      res.headers.forEach((v, k) => { h[k] = v; });
      const contentType = h['content-type'] || '';
      let json: Envelope | null = null;
      if (contentType.includes('json') || (body.length && body[0] === 0x7b)) {
        try { json = JSON.parse(body.toString('utf8')); } catch { json = null; }
      }
      return { status: res.status, headers: h, body, json, durationMs: Date.now() - started, contentType };
    } finally { clearTimeout(t); }
  }

  /** Convenience JSON call that returns the envelope (or a synthesized one on transport/parse failure). */
  async call<T = any>(apiKey: string | null, method: string, path: string, opts: {
    query?: Record<string, string | string[] | undefined>; json?: unknown; form?: Record<string, string>; multipart?: FormData; tokenInQuery?: boolean; timeoutMs?: number;
  } = {}): Promise<Envelope<T> & { status: number; durationMs: number }> {
    let body: any = null; let contentType: string | undefined;
    if (opts.json !== undefined) { body = JSON.stringify(opts.json); contentType = 'application/json'; }
    else if (opts.form) { body = new URLSearchParams(opts.form); contentType = 'application/x-www-form-urlencoded'; }
    else if (opts.multipart) { body = opts.multipart; }
    try {
      const r = await this.request({ method, path, apiKey, query: opts.query, body, contentType, tokenInQuery: opts.tokenInQuery, timeoutMs: opts.timeoutMs });
      if (r.json) return { ...(r.json as Envelope<T>), status: r.status, durationMs: r.durationMs };
      if (r.status >= 300 && r.status < 400) return { success: true, error: null, detail: 'Redirect', data: (r.headers.location as any), status: r.status, durationMs: r.durationMs };
      return { success: false, error: 'UPSTREAM_ERROR', detail: `TorBox returned a non-JSON response (HTTP ${r.status})`, data: null as any, status: r.status, durationMs: r.durationMs };
    } catch (e: any) {
      const aborted = e?.name === 'AbortError';
      return { success: false, error: aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', detail: aborted ? 'TorBox did not respond in time' : `Could not reach TorBox: ${e?.message || e}`, data: null as any, status: 502, durationMs: 0 };
    }
  }
}

/** Plan code → name (from TorBox docs). */
export const PLAN_NAMES: Record<number, string> = { 0: 'Free', 1: 'Essential', 2: 'Pro', 3: 'Standard' };
export const PLAN_SIZE_LIMIT: Record<number, number> = { 0: 10737418240, 1: 214748364800, 2: 536870912000, 3: 214748364800 };
