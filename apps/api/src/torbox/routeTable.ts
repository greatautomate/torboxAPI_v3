import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export type BodyMode = 'json' | 'form' | 'multipart' | 'none';
export type LimiterClass = 'default' | 'createTorrent' | 'createUsenet' | 'createWebdl' | 'testNotification';
export type RouteDef = {
  method: string;
  path: string;              // e.g. /v1/api/torrents/mylist or /v1/api/notifications/clear/{id}
  regex: RegExp;
  group: string;             // torrents | usenet | webdl | queued | rss | notifications | user | general | stream | integration | vendors
  summary: string;
  scope: string | string[] | null;
  blocked: boolean;
  blockedReason?: string;
  limiter: LimiterClass;
  cacheTtl: number;          // seconds, 0 = no cache
  tokenInQuery: boolean;     // TorBox expects ?token= instead of Authorization header
  publicUpstream: boolean;   // no auth required by TorBox
  bodyMode: BodyMode;
  write: boolean;            // invalidates cache for its group on success
  type?: 'torrent' | 'usenet' | 'webdl';
};

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(here, 'openapi.json'), 'utf8')) as any;
/** TorBox's own OpenAPI document (source of parameters / request bodies for the compat mirror). */
export const TORBOX_SPEC: any = spec;

const BLOCKED: Record<string, string> = {
  'POST /v1/api/user/refreshtoken': 'Would rotate the operator\'s TorBox key',
  'GET /v1/api/user/getconfirmation': 'Operator account confirmation codes',
  'DELETE /v1/api/user/deleteme': 'Would delete the operator\'s TorBox account',
  'POST /v1/api/user/addreferral': 'Operator account referral',
  'GET /v1/api/user/auth/device/start': 'Device-code flow is not used for operator-owned accounts',
  'POST /v1/api/user/auth/device/token': 'Device-code flow is not used for operator-owned accounts',
};

function classify(method: string, path: string, op: any): Omit<RouteDef, 'regex'> {
  const key = `${method} ${path}`;
  const p = path.replace(/^\/v1\/api/, '');
  const isGet = method === 'GET';
  let group = (op.tags?.[0] || 'general') as string;
  group = ({ 'web downloads': 'webdl', 'usenet downloads': 'usenet' } as Record<string, string>)[group] || group;
  if (p.startsWith('/notifications')) group = 'notifications';
  if (p.startsWith('/queued')) group = 'queued';

  let scope: string | string[] | null = null;
  let blocked = false; let blockedReason: string | undefined;
  let limiter: LimiterClass = 'default';
  let cacheTtl = 0; let tokenInQuery = false; let publicUpstream = false; let write = !isGet;
  let type: RouteDef['type'];

  if (BLOCKED[key]) { blocked = true; blockedReason = BLOCKED[key]; }
  if (group === 'vendors') { blocked = true; blockedReason = 'Vendor API requires TorBox vendor enablement; not exposed to consumer keys'; }
  if (p.startsWith('/integration/oauth/') && p !== '/integration/oauth/me') { blocked = true; blockedReason = 'Operator OAuth flows are managed from the admin dashboard'; }

  switch (group) {
    case 'torrents': {
      type = 'torrent';
      if (p.includes('/requestdl')) { scope = 'downloads:link'; tokenInQuery = true; write = false; }
      else if (p.includes('/createtorrent')) { scope = 'torrents:write'; limiter = 'createTorrent'; }
      else if (p.includes('/asynccreatetorrent')) { scope = 'torrents:write'; limiter = 'createTorrent'; }
      else if (p.includes('/magnettofile')) { scope = 'general'; publicUpstream = true; write = false; }
      else if (p.includes('/torrentinfo')) { scope = 'torrents:read'; publicUpstream = true; cacheTtl = isGet ? 1800 : 0; write = false; }
      else if (p.includes('/checkcached')) { scope = 'torrents:read'; cacheTtl = 3600; write = false; }
      else if (p.includes('/mylist')) { scope = 'torrents:read'; cacheTtl = 30; }
      else if (p.includes('/exportdata')) { scope = 'torrents:read'; }
      else scope = isGet ? 'torrents:read' : 'torrents:write';
      break;
    }
    case 'usenet': {
      type = 'usenet';
      if (p.includes('/requestdl')) { scope = 'downloads:link'; tokenInQuery = true; write = false; }
      else if (p.includes('/createusenetdownload')) { scope = 'usenet:write'; limiter = 'createUsenet'; }
      else if (p === '/usenet/provider/connection') { scope = 'general'; publicUpstream = true; cacheTtl = 3600; write = false; }
      else if (p.startsWith('/usenet/provider')) { scope = 'usenet:provider'; write = !isGet; }
      else if (p.includes('/checkcached')) { scope = 'usenet:read'; cacheTtl = 3600; write = false; }
      else if (p.includes('/mylist')) { scope = 'usenet:read'; cacheTtl = 10; }
      else scope = isGet ? 'usenet:read' : 'usenet:write';
      break;
    }
    case 'webdl': {
      type = 'webdl';
      if (p.includes('/requestdl')) { scope = 'downloads:link'; tokenInQuery = true; write = false; }
      else if (p.includes('/createwebdownload')) { scope = 'webdl:write'; limiter = 'createWebdl'; }
      else if (p.includes('/hosters')) { scope = 'webdl:read'; cacheTtl = 3600; write = false; }
      else if (p.includes('/checkcached')) { scope = 'webdl:read'; cacheTtl = 3600; write = false; }
      else if (p.includes('/mylist')) { scope = 'webdl:read'; cacheTtl = 10; }
      else scope = isGet ? 'webdl:read' : 'webdl:write';
      break;
    }
    case 'queued': {
      scope = isGet ? ['torrents:read', 'usenet:read', 'webdl:read'] : ['torrents:write', 'usenet:write', 'webdl:write'];
      if (isGet) cacheTtl = 10;
      break;
    }
    case 'rss': scope = isGet ? 'rss:read' : 'rss:write'; break;
    case 'notifications': {
      if (p === '/notifications/rss') { scope = 'notifications:read'; tokenInQuery = true; write = false; }
      else if (isGet) scope = 'notifications:read';
      else { scope = 'notifications:write'; if (p === '/notifications/test') limiter = 'testNotification'; }
      break;
    }
    case 'stream': scope = 'stream'; write = false; break;
    case 'integration': {
      if (p === '/integration/oauth/me') scope = 'integrations:read';
      else scope = isGet ? 'integrations:read' : 'integrations:write';
      break;
    }
    case 'user': {
      if (p === '/user/settings/editsettings') scope = 'user:settings';
      else if (p === '/user/me' || p === '/user/stats') { scope = 'user:read'; cacheTtl = 60; write = false; }
      else scope = 'user:read';
      break;
    }
    case 'general':
    default: {
      scope = 'general'; publicUpstream = true; write = false;
      if (p.startsWith('/stats') || p.startsWith('/changelogs') || p.startsWith('/speedtest')) cacheTtl = 600;
      if (path === '/') cacheTtl = 30;
    }
  }

  let bodyMode: BodyMode = 'none';
  const ct = Object.keys(op.requestBody?.content || {})[0];
  if (ct?.includes('multipart')) bodyMode = 'multipart';
  else if (ct?.includes('x-www-form-urlencoded')) bodyMode = 'form';
  else if (ct?.includes('json')) bodyMode = 'json';

  return { method, path, group, summary: op.summary || '', scope, blocked, blockedReason, limiter, cacheTtl, tokenInQuery, publicUpstream, bodyMode, write, type };
}

function toRegex(path: string): RegExp {
  const src = path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\\{[^}]+\\\}|\{[^}]+\}/g, '[^/]+');
  return new RegExp(`^${src}/?$`);
}

export const ROUTE_TABLE: RouteDef[] = [];
for (const [path, ops] of Object.entries<any>(spec.paths)) {
  for (const [m, op] of Object.entries<any>(ops)) {
    const method = m.toUpperCase();
    const def = classify(method, path, op);
    ROUTE_TABLE.push({ ...def, regex: toRegex(path) });
  }
}
// Sort so literal paths win over templated ones
ROUTE_TABLE.sort((a, b) => Number(a.path.includes('{')) - Number(b.path.includes('{')) || b.path.length - a.path.length);

export function matchRoute(method: string, pathname: string): RouteDef | undefined {
  return ROUTE_TABLE.find((r) => r.method === method && r.regex.test(pathname));
}
export const CACHE_GROUPS = ['torrents', 'usenet', 'webdl', 'queued', 'user', 'general'];
