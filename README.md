# TorBox Gateway

A multi-tenant **API gateway, key-management platform and admin dashboard built on top of the [TorBox API](https://api-docs.torbox.app/)**.

Plug in your TorBox API key once. Issue as many **gateway keys** (`tbg_live_…`) as you like to your apps, friends, customers or media servers, each with its own scopes, rate limits, quotas, IP allow-list and expiry. Every call is authenticated, metered, logged (including every link a consumer submitted and every CDN link TorBox generated), cached where safe, and forwarded to TorBox with your upstream key — which consumers never see.

```
Consumers ──(tbg key)──▶  Gateway (Render web service)  ──(TorBox key)──▶  api.torbox.app
                             │  /v1/api/*   1:1 TorBox mirror (official SDKs work by swapping baseUrl)
                             │  /api/v1/*   enhanced API: unified downloads, smart create, permalinks, cache/link checks, streams, webhooks
                             │  /admin      dashboard (keys, policies, logs, activity, analytics, downloads, webhooks, settings)
                             │  /           homepage with all use cases   ·   /docs Swagger UI   ·   /openapi.json
                             └─ MongoDB Atlas (all state: keys, policies, logs, activity, cache, rate buckets, events, audit)
```

## Features

* **Two API surfaces**: compat mirror of all 91 TorBox operations (bodies/responses passed through untouched — JSON, XML, PDF, `.torrent` bytes, redirects) and an enhanced REST API.
* **Key management**: scopes (20), reusable policies (per-minute/hour/day limits, uncached-create budget, monthly quotas, feature flags), rotation with grace period, suspend/revoke, IP/CIDR allow-lists, expiry, test-mode keys.
* **Upstream protection**: global budgets per TorBox account sized under TorBox's 300/min and 60/h caps, uncached-torrent classification, circuit-free retry rules, cache with per-group TTLs and write invalidation.
* **Complete activity history**: submitted magnets/URLs/files, generated CDN links, permalinks, streams, control/edit actions — per key, per client, per download, exportable (CSV/JSON) and clearable with count confirmation.
* **Safe sharing**: HMAC-signed permalinks (`/dl/...`) and HLS entry URLs (`/s/...`) that never expose a key and die with the key.
* **Events & webhooks**: inbound TorBox webhook receiver + reconciler → `download.completed/failed/deleted/expiring/added` events, signed deliveries with retries, consumer self-service subscriptions, pull feed.
* **Admin dashboard**: overview, alerts, upstream accounts, clients, keys, policies, request logs, activity, analytics, downloads, webhooks, events, cache, settings, admins (roles + TOTP 2FA), audit log, playground, system. **Responsive / mobile-friendly.**
* **Ops**: Render Blueprint (`render.yaml`), MongoDB Atlas persistence, health/readiness endpoints, lease-locked background jobs, retention/TTLs, alert webhook (Discord/Slack compatible).

## Quick start (local)

```bash
npm install
cp .env.example .env                      # fill MONGODB_URI etc. — or use the mock TorBox:
#   TORBOX_API_BASE=http://localhost:10100  TORBOX_API_KEY=mock-torbox-key
npm run dev:mock                          # mock TorBox on :10100, API on :10000, Vite on :5173
# production-like:
npm run build && npm start                # serves API + built frontend on :10000
```

Then open `http://localhost:10000/admin`, sign in with `ADMIN_BOOTSTRAP_EMAIL/PASSWORD`, change the password, add your TorBox key under **Upstream accounts** (if `TORBOX_API_KEY` wasn't set), create a client and a key, and call:

```bash
curl -H "Authorization: Bearer tbg_live_..." http://localhost:10000/api/v1/me
curl -H "Authorization: Bearer tbg_live_..." http://localhost:10000/v1/api/user/me      # TorBox-compatible
```

## Admin dashboard tour

* **Overview** — KPIs, hourly traffic, upstream budget gauges, top keys/routes, error codes.
* **Upstream accounts / Clients / API keys / Policies** — full lifecycle management. The key wizard has scope presets, shows the secret once with a ready-to-run quick start, and keys can be rotated with a grace period, suspended, revoked or opened straight in the Playground. Policies have a live "effective limits" preview against the upstream budget and a rate-limit simulator.
* **Request logs / Activity / Analytics / Downloads** — filterable, exportable (CSV/JSON) and clearable with count confirmation; request drawers show a timings waterfall; downloads support TorBox actions, CDN links and HLS streams with the upstream endpoint named in every confirmation.
* **Webhooks / Events / Cache / Playground / Settings / Admins / Audit / System** — as described in `docs/ADMIN_API.md`.
* **Keyboard**: `/` focuses the search box, `⌘K` / `Ctrl+K` opens the command palette (jump to pages, search keys/clients/logs/downloads, quick actions). Dark/light theme, mobile drawer navigation and card layouts under 768 px.

## Deploy on Render (with MongoDB Atlas)

> Prefer to click through the dashboard instead of using the Blueprint? See **[docs/RENDER_MANUAL_DEPLOY.md](docs/RENDER_MANUAL_DEPLOY.md)** for a step-by-step manual setup (web service, cron job, env group, Atlas, troubleshooting).

1. Create an Atlas cluster (M10+ recommended, AWS us-east-1 to match Render Virginia), a DB user with `readWrite` on `torbox_gateway`, and allow Render's static outbound IPs (or `0.0.0.0/0`).
2. Push this repo to GitHub → Render **New → Blueprint** → select the repo. Render reads `render.yaml`.
3. Enter the prompted secrets: `MONGODB_URI`, `MASTER_ENCRYPTION_KEY` (`openssl rand -base64 32`), `PERMALINK_SIGNING_SECRET`, `WEBHOOK_INBOUND_SECRET`, `TORBOX_API_KEY`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`.
4. First deploy runs `npm ci --include=dev && npm run build` (the `--include=dev` flag is required because `NODE_ENV=production` would otherwise make npm skip devDependencies such as Vite/TypeScript), then `npm run migrate` (indexes/TTLs) and boots. Open `https://<service>.onrender.com/admin`, log in, change the password, enable 2FA.
5. Remove `TORBOX_API_KEY` from the env (it now lives encrypted in Mongo). Add a custom domain and set `PUBLIC_BASE_URL` if desired.

Restarts, redeploys and scaling (`numInstances`) are safe: nothing is stored on the instance.

## Repository layout

```
apps/api      Fastify 5 + TypeScript backend (routes/compat, routes/v1, routes/admin, services, jobs, mock TorBox, tests)
apps/web      React 19 + Vite + Tailwind SPA: homepage (/) and admin dashboard (/admin)
docs/         ADMIN_API.md (frontend↔backend contract), ARCHITECTURE.md, RUNBOOK.md, RENDER_MANUAL_DEPLOY.md (dashboard deploy without Blueprint)
render.yaml   Render Blueprint (web + cron)
```

## Scripts

| Command | What |
|---|---|
| `npm run dev` / `npm run dev:mock` | API (tsx watch) + Vite dev server (+ mock TorBox) |
| `npm run build` | Build web then API (API serves `apps/web/dist`) |
| `npm start` | Run the production server |
| `npm test` | Vitest: unit + integration (mongodb-memory-server + mock TorBox) |
| `npm run typecheck` | TypeScript for both apps |
| `npm run migrate` | Ensure indexes/TTLs (Render preDeployCommand) |
| `npm run jobs` | Run due background jobs once (Render cron) |

## Environment variables

See `.env.example`. Required: `MONGODB_URI`, `MASTER_ENCRYPTION_KEY`, `SESSION_SECRET`, `PERMALINK_SIGNING_SECRET`, `WEBHOOK_INBOUND_SECRET`. Bootstrap (first boot only): `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`, `TORBOX_API_KEY`.

## Security notes

Upstream TorBox keys are AES-256-GCM encrypted at rest; gateway keys are stored as SHA-256 hashes and shown once; admin sessions are HTTP-only signed cookies with CSRF header check; operator-only TorBox endpoints (refresh token, delete account, device auth, OAuth registration, vendors) are blocked for consumer keys; `user/me` PII is masked unless the `user:pii` scope is granted; every admin mutation is audited.

## License

MIT
