import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, Bell, BookOpen, Bot, Boxes, CheckCircle2, Cloud, Code2, Download, Eye, Film, Gauge, Globe, KeyRound, Link2, Menu, Moon, Package, Play, Server, ShieldCheck, Sun, Tv, Users, Webhook, X, Zap } from 'lucide-react';
import { clsx } from 'clsx';
import { usePublicConfig, usePublicStats, usePublicStatus } from '../../lib/queries';
import { useTheme } from '../../lib/hooks/useTheme';
import { compact, duration } from '../../lib/format';
import { CodeBlock, Tabs } from '../../components/ui';

const origin = typeof window !== 'undefined' ? window.location.origin : 'https://gateway.example.com';

const SDK_TABS = [
  {
    key: 'js',
    label: 'JavaScript',
    lang: 'ts',
    code: `import { TorBoxApi } from '@torbox/torbox-api';

const client = new TorBoxApi({
  token: process.env.TBG_KEY,          // your gateway key: tbg_live_…
  baseUrl: '${origin}/v1/api',           // instead of https://api.torbox.app/v1/api
});

const { data } = await client.torrents.getTorrentList({ bypassCache: false });
console.log(data.length, 'torrents');`,
  },
  {
    key: 'py',
    label: 'Python',
    lang: 'python',
    code: `from torbox_api import TorboxApi

sdk = TorboxApi(
    access_token="tbg_live_…",
    base_url="${origin}/v1/api",       # instead of https://api.torbox.app/v1/api
)

result = sdk.torrents.get_torrent_list(api_version="v1")
print(result.data)`,
  },
  {
    key: 'go',
    label: 'Go',
    lang: 'go',
    code: `import torbox "github.com/TorBox-App/torbox-go/pkg/torboxapi"

cfg := torbox.NewConfig()
cfg.SetBaseUrl("${origin}/v1/api")   // instead of https://api.torbox.app/v1/api
cfg.SetAccessToken("tbg_live_…")

client := torbox.NewTorboxApi(cfg)
list, err := client.Torrents.GetTorrentList(context.Background(), "v1", torbox.GetTorrentListRequestParams{})`,
  },
  {
    key: 'curl',
    label: 'cURL',
    lang: 'bash',
    code: `# Exactly the same routes and envelopes as api.torbox.app — only the host and key change
curl -H "Authorization: Bearer tbg_live_…" \\
  "${origin}/v1/api/torrents/mylist?bypass_cache=false"`,
  },
];

const QUICK = [
  {
    key: 'curl',
    label: 'cURL',
    lang: 'bash',
    code: `# 1) Who am I? (scopes, limits, quota)
curl -H "Authorization: Bearer tbg_live_…" ${origin}/api/v1/me

# 2) Add a download (magnet, url or nzb)
curl -X POST -H "Authorization: Bearer tbg_live_…" -H "Content-Type: application/json" \\
  -d '{"magnet":"magnet:?xt=urn:btih:…"}' ${origin}/api/v1/downloads

# 3) Get a signed permalink for the first file (no key inside the URL)
curl -H "Authorization: Bearer tbg_live_…" \\
  "${origin}/api/v1/downloads/<publicId>/link?file=<fileId>&permalink=true"`,
  },
  {
    key: 'js',
    label: 'JavaScript',
    lang: 'ts',
    code: `const api = (path, init = {}) =>
  fetch('${origin}/api/v1' + path, {
    ...init,
    headers: { Authorization: 'Bearer tbg_live_…', 'Content-Type': 'application/json', ...init.headers },
  }).then((r) => r.json());

const me = await api('/me');                                            // 1
const dl = await api('/downloads', { method: 'POST', body: JSON.stringify({ magnet }) }); // 2
const link = await api(\`/downloads/\${dl.data.publicId}/link?file=\${dl.data.files[0].id}&permalink=true\`); // 3
console.log(link.data.url); // ${origin}/dl/<publicId>/<fileId>?k=…&sig=…`,
  },
  {
    key: 'py',
    label: 'Python',
    lang: 'python',
    code: `import requests
H = {"Authorization": "Bearer tbg_live_…"}
B = "${origin}/api/v1"

me = requests.get(f"{B}/me", headers=H).json()                                   # 1
dl = requests.post(f"{B}/downloads", json={"magnet": magnet}, headers=H).json()  # 2
pid, fid = dl["data"]["publicId"], dl["data"]["files"][0]["id"]
link = requests.get(f"{B}/downloads/{pid}/link", params={"file": fid, "permalink": "true"}, headers=H).json()  # 3
print(link["data"]["url"])`,
  },
];

const USE_CASES = [
  { icon: Film, title: 'Media server companion', text: 'Feed Plex, Jellyfin or Emby with permalinks and HLS streams. Your TorBox key never leaves the gateway.' },
  { icon: Bot, title: 'Discord / Telegram bot', text: 'Let a community add magnets and fetch links with a scoped key that cannot touch account settings.' },
  { icon: Globe, title: 'Browser extension', text: 'Origin-allowlisted key with tight per-minute limits — safe to ship inside an extension.' },
  { icon: Tv, title: 'TV & device apps', text: 'Stremio, Kodi, Infuse: point them at the compat API with a per-device key you can revoke any time.' },
  { icon: Download, title: 'Download manager', text: 'Hand aria2, JDownloader or a plain wget a permalink. No token in the URL, expiry built in.' },
  { icon: Package, title: 'CI artifact fetcher', text: 'Pipelines pull cached artifacts through a read-only key with a monthly quota.' },
  { icon: Users, title: 'Family & friends', text: 'One premium account, one key per person, per-person quotas, per-person activity log.' },
  { icon: Server, title: 'SaaS wrapper', text: 'Resell access: clients, keys, policies, webhooks and usage analytics are all built in.' },
];

interface SectionDef {
  id: string;
  icon: typeof Zap;
  title: string;
  text: string;
  code?: string;
  lang?: string;
  bullets?: string[];
}
const SECTIONS: SectionDef[] = [
  {
    id: 'keys',
    icon: KeyRound,
    title: 'Issue your own API keys',
    text: 'Create clients, then hand each one a tbg_live_ key. Scopes decide which routes it may call; policies attach rate limits, monthly quotas and feature toggles; keys can be pinned to an upstream account, IP- or origin-restricted, expired, suspended, rotated with a grace period or revoked — instantly.',
    bullets: ['Scoped: torrents:read, torrents:write, downloads:link, stream… with readonly / media / full presets', 'Per-minute, hour and day limits plus monthly request and create quotas', 'IP / CIDR and browser-origin allowlists, optional expiry, JSON metadata', 'Secret shown once, hashed at rest, rotate with overlap'],
    code: `POST ${origin}/admin/api/keys
{
  "name": "Alice's Stremio",
  "clientId": "cl_…",
  "scopes": ["torrents:read", "torrents:write", "downloads:link", "stream"],
  "policyId": "<media policy id>",
  "upstreamAccountId": "<upstream account id>",
  "allowedIps": ["203.0.113.0/24"],
  "expiresAt": "2027-01-01T00:00:00Z"
}
→ { "key": { "prefix": "tbg_live_a1b2c3d4", "last4": "…", … }, "secret": "tbg_live_a1b2c3d4_…" }  // shown once`,
    lang: 'http',
  },
  {
    id: 'unified',
    icon: Download,
    title: 'Unified downloads API',
    text: 'One endpoint for torrents, usenet and web/debrid downloads. Send a magnet, a hoster URL or an NZB; get back a stable publicId, normalized state, progress and files — regardless of the underlying TorBox queue.',
    code: `POST ${origin}/api/v1/downloads
Authorization: Bearer tbg_live_…

{ "magnet": "magnet:?xt=urn:btih:…" }   // or { "url": "https://…" }, { "nzbUrl": "https://…/file.nzb" }
                                        // or simply { "source": "…" } — the type is auto-detected

→ {
    "success": true,
    "data": {
      "publicId": "k3Yx9QpL2mN7vB", "type": "torrent", "state": "downloading", "rawState": "downloading",
      "progress": 0.42, "files": [{ "id": 1, "name": "…mkv", "size": 1573741824 }], "duplicate": false
    }
  }`,
    lang: 'http',
  },
  {
    id: 'permalinks',
    icon: Link2,
    title: 'Safe permalinks & streaming',
    text: 'TorBox CDN links embed your account token. The gateway issues signed /dl/… permalinks and an HLS entry point instead — they expire, they are logged per key, and they never expose any secret. Perfect for Plex, Jellyfin, Stremio, Kodi and Infuse.',
    code: `GET /api/v1/downloads/k3Yx9QpL2mN7vB/link?file=1&permalink=true&expires_in=604800
→ { "url": "${origin}/dl/k3Yx9QpL2mN7vB/1?k=…&exp=1767225600&sig=9f2c…" }

GET /api/v1/downloads/k3Yx9QpL2mN7vB/files     # every file with linkUrl (permalink) + streamUrl (HLS entry)
GET /dl/k3Yx9QpL2mN7vB/1?k=…&exp=…&sig=…       # 307 → fresh TorBox CDN URL, logged per key
GET /s/k3Yx9QpL2mN7vB/1/master.m3u8?k=…&sig=…  # 307 → HLS playlist for players (stream scope)`,
    lang: 'http',
  },
  {
    id: 'cache',
    icon: Zap,
    title: 'Cache checks at indexer scale',
    text: 'Check hundreds of hashes per call. Results are cached and deduplicated across all your keys, so a Prowlarr/Jackett/Stremio addon burst costs a fraction of your TorBox rate limit.',
    code: `POST ${origin}/api/v1/cache/check
{ "hashes": ["d2d5…", "a91b…", "…"] }
→ { "success": true, "data": { "d2d5…": { "cached": true, "type": "torrent", "name": "…", "size": 1573741824 }, "a91b…": { "cached": false } } }`,
    lang: 'http',
  },
  {
    id: 'hosters',
    icon: CheckCircle2,
    title: 'Hoster pre-checks',
    text: 'Before submitting a web download, ask whether the host is supported and the link is alive. Saves a create slot on your hourly budget every time it says no.',
    code: `POST ${origin}/api/v1/links/check
{ "urls": ["https://1fichier.com/?abc", "https://example.com/file.zip"] }
→ { "data": [{ "url": "https://1fichier.com/?abc", "supported": true, "hoster": "1Fichier", "status": true, "nsfw": false,
              "limits": { "dailyLinkLimit": 50, "dailyBandwidthLimit": 107374182400, "perLinkSizeLimit": 53687091200 } },
            { "url": "https://example.com/file.zip", "supported": "direct", "hoster": null }] }`,
    lang: 'http',
  },
  {
    id: 'automation',
    icon: Cloud,
    title: 'Automation',
    text: 'RSS feeds, the download queue and cloud uploads (Google Drive, Dropbox, OneDrive, GoFile, 1Fichier, Pixeldrain) are exposed through the same scoped keys — so a scheduler or bot can run your library end-to-end without your master key.',
    code: `POST /api/v1/rss/feeds                        { "url": "https://…/rss", "name": "Shows", "do_regex": "1080p" }
POST /api/v1/rss/feeds/42/actions/pause         # update | delete | pause | resume
GET  /api/v1/queue?type=torrent
POST /api/v1/queue/123/actions/start            # start | delete
POST /api/v1/integrations/googledrive/upload    { "publicId": "k3Yx9QpL2mN7vB", "zip": true }`,
    lang: 'http',
  },
  {
    id: 'webhooks',
    icon: Webhook,
    title: 'Webhooks & events',
    text: 'The gateway ingests TorBox\'s webhook once and fans it out to your consumers as signed events (HMAC-SHA256 in X-TBG-Signature) with retries and a delivery log. Consumers can self-register endpoints, or poll /api/v1/events since a timestamp.',
    code: `POST https://your-app.example/hooks
X-TBG-Event: download.completed
X-TBG-Signature: t=1757505600,v1=<hmac_sha256(secret, t + "." + body)>

{ "id": "…", "type": "download.completed", "createdAt": "2026-09-10T12:00:00Z",
  "data": { "publicId": "k3Yx9QpL2mN7vB", "name": "…", "type": "torrent", "size": 1573741824 } }

POST ${origin}/api/v1/webhooks   { "url": "https://your-app.example/hooks", "events": ["download.completed"] }
GET  ${origin}/api/v1/events?since=2026-09-10T12:00:00Z    # pull alternative for consumers without a public URL`,
    lang: 'http',
  },
  {
    id: 'observability',
    icon: Eye,
    title: 'Observability & control',
    text: 'Every request is logged with route, status, latency, cache result and upstream error. Activity shows what each key submitted and which links it generated. Analytics roll it up per key, client, route or error. Quotas, a kill switch (suspend/revoke) and maintenance mode keep you in charge.',
    bullets: ['Request logs with full-text search, CSV/JSON export and retention policies', 'Activity: magnets/URLs submitted, CDN links and streams generated, control actions', 'Analytics per key, client, route and error code; monthly quota progress', 'Alerts on error spikes, low TorBox budget headroom, expiring premium, quota usage'],
  },
  {
    id: 'ratelimits',
    icon: Gauge,
    title: 'Rate-limit protection',
    text: 'TorBox allows roughly 300 requests per minute and 60 uncached torrent, usenet and web-download creates per hour per account. One noisy consumer can lock everyone out. The gateway tracks these budgets live, shares them fairly between keys via policies, serves repeated reads from cache and returns a friendly 429 with Retry-After before TorBox ever sees the overflow.',
    bullets: ['Live budget gauges per upstream account', 'Per-key windows independent of the shared account budget', 'Automatic caching of list/status calls with per-policy TTL overrides', 'Multiple upstream accounts with weighted balancing'],
  },
];

function StatusPill() {
  const s = usePublicStatus();
  const d = s.data?.data;
  const ok = d?.gateway === 'ok' && d?.upstream?.ok !== false;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/70 px-3 py-1 text-xs font-medium text-gray-700 backdrop-blur dark:border-gray-800 dark:bg-gray-900/70 dark:text-gray-300" role="status">
      <span className={clsx('h-2 w-2 rounded-full', s.isLoading ? 'bg-gray-400 animate-pulse' : ok ? 'bg-green-500' : 'bg-amber-500')} aria-hidden />
      {s.isLoading ? 'Checking status…' : s.isError || !d ? 'Status unavailable' : ok ? `All systems operational · ${d.budgetHeadroomPct != null ? `${Math.round(d.budgetHeadroomPct)}% budget headroom` : 'gateway ok'}` : 'Upstream degraded'}
    </span>
  );
}

export function HomePage() {
  const cfg = usePublicConfig();
  const showStats = cfg.data?.homepage?.showPublicStats === true;
  const stats = usePublicStats(showStats);
  const { isDark, toggle } = useTheme();
  const [menu, setMenu] = useState(false);
  const [sdkTab, setSdkTab] = useState('js');
  const [quickTab, setQuickTab] = useState('curl');
  const name = cfg.data?.branding?.name || 'TorBox Gateway';
  const tagline = cfg.data?.branding?.tagline || 'Multi-tenant API gateway for TorBox';
  const flags = cfg.data?.homepage?.sections ?? {};
  const show = (id: string) => flags[id] !== false;
  const sections = useMemo(() => SECTIONS.filter((s) => show(s.id)), [flags]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.title = `${name} — One TorBox account. Unlimited safe API keys.`;
  }, [name]);
  const docsHref = cfg.data?.docsPublic === false ? '/admin' : '/docs';

  const nav = [
    { label: 'Features', href: '#features' },
    { label: 'Use cases', href: '#usecases' },
    { label: 'Quick start', href: '#quickstart' },
    { label: 'Docs', href: docsHref, icon: BookOpen },
    { label: 'OpenAPI', href: '/openapi.json', icon: Code2 },
  ];

  return (
    <div className="min-h-dvh bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="sticky top-0 z-40 border-b border-gray-200/70 bg-white/80 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-gray-800/70 dark:bg-gray-950/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <a href="/" className="flex items-center gap-2.5 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-600 text-white" aria-hidden>
              {cfg.data?.branding?.logoUrl ? <img src={cfg.data.branding.logoUrl} alt="" className="h-8 w-8 rounded-lg object-cover" /> : <Boxes className="h-4 w-4" />}
            </span>
            <span className="truncate">{name}</span>
          </a>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {nav.map((n) => (
              <a key={n.label} href={n.href} className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
                {n.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <button type="button" onClick={toggle} className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800" aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}>
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <Link to="/admin" className="hidden min-h-[40px] items-center gap-1.5 rounded-lg bg-accent-600 px-3.5 text-sm font-medium text-white hover:bg-accent-700 sm:inline-flex">
              <ShieldCheck className="h-4 w-4" aria-hidden /> Admin
            </Link>
            <button type="button" onClick={() => setMenu((m) => !m)} className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 md:hidden dark:text-gray-300 dark:hover:bg-gray-800" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu}>
              {menu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {menu && (
          <nav className="border-t border-gray-200 px-4 py-3 md:hidden dark:border-gray-800" aria-label="Mobile">
            <ul className="space-y-1">
              {nav.map((n) => (
                <li key={n.label}>
                  <a href={n.href} onClick={() => setMenu(false)} className="flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800">
                    {n.label}
                  </a>
                </li>
              ))}
              <li>
                <Link to="/admin" className="flex min-h-[44px] items-center gap-2 rounded-lg bg-accent-600 px-3 text-sm font-medium text-white">
                  <ShieldCheck className="h-4 w-4" aria-hidden /> Admin dashboard
                </Link>
              </li>
            </ul>
          </nav>
        )}
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.15),transparent_60%)]" aria-hidden />
          <div className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20">
            <div className="mx-auto max-w-3xl text-center">
              <StatusPill />
              <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                One TorBox account.
                <br />
                <span className="text-accent-600 dark:text-accent-400">Unlimited safe API keys.</span>
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base text-gray-600 sm:text-lg dark:text-gray-400">
                {cfg.data?.homepage?.customIntro ||
                  'Plug in your TorBox API key once, then issue gateway keys to apps, devices, bots and friends — with scopes, rate limits, quotas, logs, permalinks, streaming and webhooks. Drop-in compatible with the official SDKs.'}
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link to="/admin" className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-accent-600 px-6 text-base font-semibold text-white shadow-sm hover:bg-accent-700 sm:w-auto">
                  Open the admin dashboard <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <a href={docsHref} className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-gray-300 px-6 text-base font-semibold hover:bg-gray-50 sm:w-auto dark:border-gray-700 dark:hover:bg-gray-900">
                  <BookOpen className="h-4 w-4" aria-hidden /> Read the docs
                </a>
              </div>
              {showStats && stats.data && (
                <dl className="mx-auto mt-10 grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-3">
                  {[
                    { l: 'Requests served', v: compact(stats.data.requestsTotal) },
                    { l: 'Downloads created', v: compact(stats.data.downloadsCreated) },
                    { l: 'Uptime', v: duration(stats.data.uptimeSec) },
                  ].map((s) => (
                    <div key={s.l} className="rounded-xl border border-gray-200 bg-white/60 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{s.l}</dt>
                      <dd className="mt-1 text-2xl font-semibold tabular-nums">{s.v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        </section>

        {/* SDK */}
        {show('dropin') && (
          <section id="features" className="border-t border-gray-100 py-16 sm:py-20 dark:border-gray-900">
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
                <div>
                  <p className="text-sm font-semibold text-accent-600 dark:text-accent-400">Drop-in replacement</p>
                  <h2 className="mt-2 text-3xl font-bold tracking-tight">Works with the official TorBox SDKs</h2>
                  <p className="mt-4 text-gray-600 dark:text-gray-400">
                    The compat surface at <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm dark:bg-gray-800">{origin}/v1/api</code> mirrors <code className="font-mono text-sm">api.torbox.app/v1/api</code> route for route, envelope for envelope. Change the base URL, swap in a gateway key, done — your existing code, Stremio addons and *arr integrations keep working while every call is authenticated, rate-limited, cached and logged.
                  </p>
                  <ul className="mt-6 space-y-2 text-sm text-gray-700 dark:text-gray-300">
                    {['Identical paths, query parameters and response shapes', 'Enhanced /api/v1 surface available side by side', 'OpenAPI 3.1 spec at /openapi.json, interactive docs at /docs'].map((t) => (
                      <li key={t} className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" aria-hidden /> {t}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="min-w-0">
                  <Tabs items={SDK_TABS.map((t) => ({ key: t.key, label: t.label }))} value={sdkTab} onChange={setSdkTab} variant="pills" className="mb-3" />
                  {SDK_TABS.filter((t) => t.key === sdkTab).map((t) => (
                    <CodeBlock key={t.key} code={t.code} language={t.lang} title={t.label} />
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Feature sections */}
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className={clsx('py-16 sm:py-20', i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-900/40' : '')}>
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <div className={clsx('grid grid-cols-1 items-start gap-10', s.code && 'lg:grid-cols-2')}>
                <div className={clsx(!s.code && 'max-w-3xl')}>
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-950 dark:text-accent-300" aria-hidden>
                    <s.icon className="h-5 w-5" />
                  </span>
                  <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">{s.title}</h2>
                  <p className="mt-3 text-gray-600 dark:text-gray-400">{s.text}</p>
                  {s.bullets && (
                    <ul className="mt-5 grid grid-cols-1 gap-2 text-sm text-gray-700 sm:grid-cols-2 dark:text-gray-300">
                      {s.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" aria-hidden /> {b}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {s.code && <CodeBlock code={s.code} language={s.lang} className="min-w-0" />}
              </div>
            </div>
          </section>
        ))}

        {/* Use cases */}
        {show('gallery') && (
          <section id="usecases" className="py-16 sm:py-20">
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold text-accent-600 dark:text-accent-400">Use cases</p>
                <h2 className="mt-2 text-3xl font-bold tracking-tight">Built for the ways people actually share a debrid account</h2>
              </div>
              <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {USE_CASES.map((u) => (
                  <article key={u.title} className="card p-5">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent-50 text-accent-600 dark:bg-accent-950 dark:text-accent-300" aria-hidden>
                      <u.icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-3 font-semibold">{u.title}</h3>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{u.text}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Quick start */}
        {show('quickstart') && (
          <section id="quickstart" className="bg-gray-50 py-16 sm:py-20 dark:bg-gray-900/40">
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <div className="grid grid-cols-1 gap-10 lg:grid-cols-5">
                <div className="lg:col-span-2">
                  <p className="text-sm font-semibold text-accent-600 dark:text-accent-400">Quick start</p>
                  <h2 className="mt-2 text-3xl font-bold tracking-tight">Three calls to your first stream</h2>
                  <ol className="mt-6 space-y-4">
                    {[
                      { t: 'Create a key', d: 'In the admin dashboard, add your TorBox key as an upstream account, create a client and issue a tbg_live_ key with the media preset.' },
                      { t: 'Add a download', d: 'POST a magnet, URL or NZB to /api/v1/downloads. You get a publicId that is stable across TorBox queues.' },
                      { t: 'Get a permalink', d: 'Request a signed permalink or HLS URL for any file and drop it into your player — no token inside.' },
                    ].map((s, i) => (
                      <li key={s.t} className="flex gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-600 text-xs font-semibold text-white">{i + 1}</span>
                        <div>
                          <p className="font-medium">{s.t}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">{s.d}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="min-w-0 lg:col-span-3">
                  <Tabs items={QUICK.map((t) => ({ key: t.key, label: t.label }))} value={quickTab} onChange={setQuickTab} variant="pills" className="mb-3" />
                  {QUICK.filter((t) => t.key === quickTab).map((t) => (
                    <CodeBlock key={t.key} code={t.code} language={t.lang} title={t.label} />
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="rounded-2xl bg-accent-600 px-6 py-10 text-center text-white sm:px-12">
              <h2 className="text-2xl font-bold sm:text-3xl">Stop sharing your TorBox key.</h2>
              <p className="mx-auto mt-2 max-w-xl text-accent-100">Give every app and every person their own key — and keep the power to see, limit and revoke.</p>
              <Link to="/admin" className="mt-6 inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-white px-6 font-semibold text-accent-700 hover:bg-accent-50">
                Go to admin <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-200 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] text-sm text-gray-500 dark:border-gray-800">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div>
            <p className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
              <Boxes className="h-4 w-4 text-accent-600" aria-hidden /> {name}
            </p>
            <p className="mt-2">{tagline}</p>
            {cfg.data?.version && <p className="mt-1 text-xs">v{cfg.data.version}</p>}
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-gray-100">Developers</p>
            <ul className="mt-2 space-y-1.5">
              <li><a href={docsHref} className="hover:text-accent-600">API documentation</a></li>
              <li><a href="/openapi.json" className="hover:text-accent-600">OpenAPI specification</a></li>
              <li><a href="/api/v1/status" className="hover:text-accent-600">Status endpoint</a></li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-gray-100">Surfaces</p>
            <ul className="mt-2 space-y-1.5 font-mono text-xs">
              <li>/v1/api/* — TorBox compatible</li>
              <li>/api/v1/* — enhanced API</li>
              <li>/dl/:id/:file — permalinks</li>
              <li>/s/:id/:file/master.m3u8 — HLS</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-gray-100">Operator</p>
            <ul className="mt-2 space-y-1.5">
              <li><Link to="/admin" className="hover:text-accent-600">Admin dashboard</Link></li>
              {cfg.data?.branding?.supportEmail && <li><a href={`mailto:${cfg.data.branding.supportEmail}`} className="hover:text-accent-600">{cfg.data.branding.supportEmail}</a></li>}
              <li><a href="https://torbox.app" target="_blank" rel="noreferrer" className="hover:text-accent-600">TorBox ↗</a></li>
            </ul>
          </div>
        </div>
        <p className="mx-auto mt-8 max-w-6xl px-4 text-xs sm:px-6">Not affiliated with TorBox. TorBox is a trademark of its owner. Icons: <Activity className="inline h-3 w-3" aria-hidden /> <Bell className="inline h-3 w-3" aria-hidden /> <Play className="inline h-3 w-3" aria-hidden /> lucide.</p>
      </footer>
    </div>
  );
}
