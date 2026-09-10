# Deploying TorBox Gateway (torboxAPI) on Render — manual setup (no Blueprint)

This guide walks through creating every Render resource by hand in the dashboard instead of
letting Render read `render.yaml`. Use it when you want to control each service yourself, deploy
to a different region/plan, or you simply do not want Render to manage infrastructure from the repo.

The blueprint (`render.yaml`) remains the reference for values; everything below mirrors it.

What you will end up with:

| Resource | Type | Purpose |
|---|---|---|
| MongoDB Atlas cluster | external | All state (keys, policies, logs, cache, rate buckets, sessions) |
| `torbox-gateway` | Render **Web Service** (Node) | API + admin dashboard + homepage |
| `torbox-gateway-jobs` | Render **Cron Job** (Node) | Background jobs every 2 minutes (safety net; web also runs them in-process) |
| `torbox-gateway-shared` | Render **Environment Group** | Non-secret config shared by both services |

---

## 0. Prerequisites

* The repository pushed to GitHub or GitLab (Render deploys from a Git provider). The default branch used below is `main`.
* A Render account with a payment method (the web service needs at least the Starter plan; free instances spin down and lose in-process jobs).
* A MongoDB Atlas account.
* A TorBox API key (from https://torbox.app → Settings → API).
* `openssl` locally to generate secrets.

Runtime facts about the project that drive the settings below:

* Node **22** is required (`engines.node >= 22` in `package.json`).
* npm workspaces monorepo: `apps/web` (React/Vite SPA) is built first, then `apps/api` (Fastify). The API serves `apps/web/dist` as static files, so **one web service hosts everything**.
* The server listens on `PORT` (defaults to 10000) on `0.0.0.0`.
* Health check: `GET /healthz`. Readiness (Mongo ping + upstream probe): `GET /readyz`.
* The process exits at startup if any required env var is missing or too short (validated in `apps/api/src/config.ts`).

---

## 1. Generate secrets (do this once, locally)

Run these and keep the output somewhere safe. **Both** Render services need identical values.

```bash
openssl rand -base64 32     # MASTER_ENCRYPTION_KEY  (AES-256-GCM key for TorBox keys, TOTP secrets, webhook secrets)
openssl rand -hex 32        # SESSION_SECRET          (admin session cookies)
openssl rand -hex 32        # PERMALINK_SIGNING_SECRET (HMAC for /dl/... and /s/... links)
openssl rand -hex 16        # WEBHOOK_INBOUND_SECRET  (path segment of the inbound TorBox webhook URL)
```

Minimum lengths enforced by the app: `MASTER_ENCRYPTION_KEY`, `SESSION_SECRET`, `PERMALINK_SIGNING_SECRET` ≥ 16 chars; `WEBHOOK_INBOUND_SECRET` ≥ 8 chars.

> `MASTER_ENCRYPTION_KEY` cannot be rotated later without re-adding every upstream TorBox key
> (see `docs/RUNBOOK.md`). Store it in a password manager now.

---

## 2. Create the MongoDB Atlas cluster

1. Atlas → **Build a Database**. Pick a dedicated tier (M10+ recommended for production; M0 free tier works for testing).
2. Choose **AWS / us-east-1 (N. Virginia)** if you will deploy Render in the Virginia region (lowest latency). Match regions otherwise.
3. **Database Access** → Add New Database User: authentication *Password*, role **Read and write to any database** or a custom role with `readWrite` on the `torbox_gateway` database. Note the username and password.
4. **Network Access** → Add IP Address:
   * Quick option: `0.0.0.0/0` (allow from anywhere; the DB user password is the only guard), or
   * Tighter: after creating the Render web service and cron job, copy each service's **Outbound IP addresses** (shown at the top of the service page under "Connect") and add them here. Add the IPs of **both** services.
5. **Connect** → **Drivers** → copy the SRV connection string. It looks like:

   ```
   mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
   ```

   URL-encode the password if it contains special characters (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`).

   The database name is **not** put in the URI; the app reads it from `MONGODB_DB_NAME` (default `torbox_gateway`).

---

## 3. Create the shared Environment Group

Render dashboard → **Env Groups** (left sidebar) → **New Environment Group**.

* **Name**: `torbox-gateway-shared`
* Add these key/value pairs (all non-secret):

| Key | Value | Notes |
|---|---|---|
| `NODE_VERSION` | `22` | Forces Node 22 on Render's Node runtime |
| `NODE_ENV` | `production` | |
| `LOG_LEVEL` | `info` | `debug` for troubleshooting |
| `MONGODB_DB_NAME` | `torbox_gateway` | |
| `TORBOX_API_BASE` | `https://api.torbox.app` | |
| `UPSTREAM_GLOBAL_PER_MINUTE` | `280` | Under TorBox's 300/min cap |
| `UPSTREAM_GLOBAL_CREATE_UNCACHED_PER_HOUR` | `55` | Under TorBox's 60/h cap |
| `UPSTREAM_GLOBAL_CREATE_USENET_PER_HOUR` | `55` | |
| `UPSTREAM_GLOBAL_CREATE_WEBDL_PER_HOUR` | `55` | |
| `LOG_RETENTION_DAYS` | `30` | |
| `MAX_UPLOAD_MB` | `100` | Max `.torrent`/`.nzb` upload size |
| `TRUST_PROXY` | `true` | Required behind Render's proxy for correct client IPs / IP allow-lists |

Click **Create Environment Group**. Secrets are deliberately **not** in the group; you will paste them into each service individually in the next steps.

---

## 4. Create the Web Service (`torbox-gateway`)

Dashboard → **New +** → **Web Service**.

### 4.1 Source
* **Build and deploy from a Git repository** → connect GitHub/GitLab if not yet done → select the torboxAPI repo.

### 4.2 Settings

| Field | Value |
|---|---|
| **Name** | `torbox-gateway` |
| **Region** | `Virginia (US East)` (match your Atlas region) |
| **Branch** | `main` |
| **Root Directory** | *(leave empty — the repo root contains the root `package.json` with workspaces)* |
| **Runtime / Language** | `Node` |
| **Build Command** | `npm ci --include=dev && npm run build` |
| **Start Command** | `npm start` |
| **Instance Type** | `Standard` (1 CPU / 2 GB) for production, `Starter` for staging. Do **not** use Free: it sleeps after inactivity and cannot run background jobs reliably. |

`--include=dev` is required: the env group sets `NODE_ENV=production`, and npm silently skips devDependencies (Vite, TypeScript, Tailwind) when that variable is set. Without it the build fails with `TS2688: Cannot find type definition file for 'vite/client'`. The committed `render.yaml` already includes this flag.
`npm run build` builds the web SPA then compiles the API (`tsc` + asset copy). `npm start` runs `node apps/api/dist/server.js`.

### 4.3 Environment variables
Scroll to **Environment Variables**.

1. **Link the env group**: click **Link Environment Group** (or "Add from env group") → choose `torbox-gateway-shared`.
2. **Add the service-specific variables** one by one:

| Key | Value | Secret? |
|---|---|---|
| `MONGODB_URI` | the Atlas SRV string from step 2 | yes |
| `MASTER_ENCRYPTION_KEY` | from step 1 | yes |
| `SESSION_SECRET` | from step 1 (or click **Generate** in Render) | yes |
| `PERMALINK_SIGNING_SECRET` | from step 1 | yes |
| `WEBHOOK_INBOUND_SECRET` | from step 1 | yes |
| `PORT` | `10000` | no |
| `RUN_JOBS_IN_PROCESS` | `true` | no — web instances run the lease-locked scheduler too |
| `TORBOX_API_KEY` | your TorBox key | yes — **bootstrap only**, removed in step 8 |
| `ADMIN_BOOTSTRAP_EMAIL` | e.g. `admin@yourdomain.com` | no — first-boot only |
| `ADMIN_BOOTSTRAP_PASSWORD` | strong temporary password (≥ 8 chars) | yes — first-boot only, change after login |
| `PUBLIC_BASE_URL` | *(leave unset for now)* | Falls back to Render's `RENDER_EXTERNAL_URL` automatically. Set it in step 9 once you have a custom domain. |

> The blueprint wires `PUBLIC_BASE_URL` to `RENDER_EXTERNAL_URL` via `fromService`. Manually you do not need that:
> `apps/api/src/config.ts` already reads `RENDER_EXTERNAL_URL` when `PUBLIC_BASE_URL` is empty, and Render injects
> `RENDER_EXTERNAL_URL` into every web service.

### 4.4 Advanced settings
Expand **Advanced**:

| Field | Value | Why |
|---|---|---|
| **Health Check Path** | `/healthz` | Render only routes traffic / marks deploy live once this returns 200 |
| **Pre-Deploy Command** | `npm run migrate` | Creates Mongo indexes and TTLs before the new version receives traffic. Idempotent. (Available on paid instance types.) |
| **Auto-Deploy** | `After CI Checks Pass` (or `Yes`) | The repo has a GitHub Actions CI workflow; "after checks pass" waits for it. Pick `Yes` if you are not on GitHub or have no checks. |
| **Max Shutdown Delay** | `60` seconds | Lets in-flight uploads (≤100 MB) finish on redeploy. Found under Settings after creation if not shown here. |
| **Number of instances** | `1` | Safe to raise later: all state, rate limits and sessions live in Mongo |
| **Pull Request Previews** | Off / manual | |

Click **Create Web Service** (or **Deploy Web Service**). The first deploy starts immediately; expect roughly 3–6 minutes (npm ci + Vite build + tsc).

### 4.5 Watch the first deploy
Open the **Logs** tab. A successful sequence looks like:

1. Build: `npm ci`, `vite build`, `tsc` complete.
2. Pre-deploy: `migrate: indexes ensured`.
3. Start: Fastify listening on `0.0.0.0:10000`, then Render reports the health check passed and the deploy is **Live**.

If the process crashes with `Invalid configuration:` followed by variable names, a required env var is missing or too short — fix it under **Environment** and Render redeploys automatically.

---

## 5. Create the Cron Job (`torbox-gateway-jobs`)

The web service already runs jobs in-process (`RUN_JOBS_IN_PROCESS=true`). This cron is a safety net that guarantees jobs still run during deploys/restarts or if you later set `RUN_JOBS_IN_PROCESS=false`. Jobs are lease-locked in Mongo, so both running at once is safe.

Dashboard → **New +** → **Cron Job**.

| Field | Value |
|---|---|
| **Name** | `torbox-gateway-jobs` |
| **Region** | same as the web service (`Virginia`) |
| **Branch** | `main` |
| **Root Directory** | *(empty)* |
| **Runtime** | `Node` |
| **Schedule** | `*/2 * * * *` (every 2 minutes) |
| **Build Command** | `npm ci --include=dev && npm run build -w apps/api` |
| **Command** | `npm run jobs` |
| **Instance Type** | `Starter` |
| **Auto-Deploy** | `After CI Checks Pass` / `Yes` |

`npm run build -w apps/api` compiles only the backend (the cron never serves the SPA), which keeps its builds shorter.
`npm run jobs` executes `node apps/api/dist/jobs/run.js --due`: it runs every job that is due, prints a JSON summary, and exits.

### Environment variables for the cron
1. **Link** the `torbox-gateway-shared` env group.
2. Add — with **exactly the same values** as the web service:

| Key | Value |
|---|---|
| `MONGODB_URI` | same as web |
| `MASTER_ENCRYPTION_KEY` | same as web (must match — it decrypts the stored TorBox keys) |
| `PERMALINK_SIGNING_SECRET` | same as web |
| `WEBHOOK_INBOUND_SECRET` | same as web (used to build webhook URLs in alerts/emails) |
| `SESSION_SECRET` | any ≥16-char value; unused by jobs but required by config validation |
| `PUBLIC_BASE_URL` | the web service URL, e.g. `https://torbox-gateway.onrender.com` (cron jobs do not get `RENDER_EXTERNAL_URL`, so set this explicitly; update it when you add a custom domain) |

Do **not** set `TORBOX_API_KEY`, `ADMIN_BOOTSTRAP_*`, `PORT` or `RUN_JOBS_IN_PROCESS` on the cron.

Click **Create Cron Job**. After the build finishes you can press **Trigger Run** to test it; the log should end with a line like `{"ok":true,"ran":[...]}`.

---

## 6. Lock down Atlas network access (if you skipped `0.0.0.0/0`)

Open each Render service → the **Connect** button (top right) → **Outbound** tab. Copy the static outbound IPs of **both** the web service and the cron job and add them in Atlas → Network Access. Then trigger a manual deploy of the web service (**Manual Deploy → Deploy latest commit**) to confirm `/readyz` still reports Mongo as reachable.

---

## 7. First login and bootstrap

1. Open `https://torbox-gateway.onrender.com/admin` (the URL is shown at the top of the web service page).
2. Sign in with `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD`.
3. Immediately: **Admins → your account → change password → enable TOTP 2FA**.
4. **Upstream accounts**: if `TORBOX_API_KEY` was set, the key was verified with `user/me` and migrated into the encrypted store on first boot and appears here. If you did not set it, click **Add** and paste the TorBox key now.
5. Create a **Client**, then an **API key** (`tbg_live_…`) with the desired scopes and policy. The secret is shown once.
6. Smoke test from your machine:

```bash
BASE=https://torbox-gateway.onrender.com
curl -s $BASE/healthz
curl -s $BASE/readyz
curl -s -H "Authorization: Bearer tbg_live_..." $BASE/api/v1/me
curl -s -H "Authorization: Bearer tbg_live_..." $BASE/v1/api/user/me     # TorBox-compatible mirror
```

Also check `System` in the dashboard: job statuses should show recent runs (from the in-process scheduler and/or the cron).

---

## 8. Post-bootstrap cleanup (important)

Once the upstream key is visible under **Upstream accounts**:

1. Web service → **Environment** → delete `TORBOX_API_KEY`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`. They are only read on first boot, and leaving a plaintext TorBox key in env defeats the encrypted store.
2. Save; Render redeploys automatically. Verify `/admin` still logs in with your new password.

---

## 9. Custom domain (optional)

1. Web service → **Settings → Custom Domains → Add Custom Domain** → e.g. `api.example.com`.
2. Create the DNS record Render shows (CNAME to `torbox-gateway.onrender.com`, or A/ALIAS records for an apex). Wait until Render shows the certificate as issued.
3. Set `PUBLIC_BASE_URL=https://api.example.com` on **both** the web service and the cron job. This value is used to build permalinks (`/dl/...`), HLS URLs (`/s/...`), and the inbound TorBox webhook URL, so it must be the domain consumers actually use.
4. If any upstream account already had the TorBox webhook enabled, toggle it off/on in **Upstream accounts** so TorBox is registered with the new URL (`https://api.example.com/hooks/torbox/<accountId>/<WEBHOOK_INBOUND_SECRET>`).

---

## 10. Day-2 operations on Render

* **Redeploy / rollback**: web service → **Manual Deploy** → *Deploy latest commit*, or pick an earlier deploy → **Rollback**. The pre-deploy `npm run migrate` runs on every deploy and is idempotent.
* **Scaling**: Settings → **Scaling** → raise instance count. Nothing is stored on disk; rate limits, cache and sessions are in Mongo. Add any new outbound IPs to Atlas if you locked the allow-list.
* **Logs**: the Logs tab streams stdout; `LOG_LEVEL=debug` in the env group applies to both services (changing a group value redeploys every linked service).
* **Shell**: paid instances have a **Shell** tab. Useful commands:
  ```bash
  node apps/api/dist/migrate.js                 # re-run index creation
  node apps/api/dist/jobs/run.js --all          # force every job once
  node apps/api/dist/jobs/run.js --job=verify-upstreams
  ```
* **Rotating secrets**: see `docs/RUNBOOK.md` → "Rotating secrets". Always change a secret on **both** services in the same sitting.
* **Maintenance / read-only mode**: done from the dashboard (Settings → Maintenance), no Render change needed.

---

## 11. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Build fails: `TS2688: Cannot find type definition file for 'vite/client'`, and `npm ci` reports only ~170 packages | `NODE_ENV=production` made `npm ci` omit devDependencies. Use `npm ci --include=dev` in the Build Command (both services), or set `NPM_CONFIG_PRODUCTION=false`. |
| Build fails with `EBADENGINE` / syntax errors in `tsc` | Node too old. Ensure `NODE_VERSION=22` is in the linked env group (or set Node version in Settings → Environment). |
| `Invalid configuration: MONGODB_URI: ...` at start | Missing/short env var. Compare against the tables in steps 4.3 / 5. |
| Deploy stuck on "health check" then fails | App crashed after boot (check logs), or `PORT` mismatch. The app binds `0.0.0.0:$PORT`; leave `PORT=10000` or unset it. |
| `MongoServerError: bad auth : authentication failed` (code 8000, `AtlasError`) at start | Network is fine; the username/password in `MONGODB_URI` is rejected. Check: `<password>` placeholder or angle brackets left in the URI; password not URL-encoded; user created in a different Atlas project; you used your Atlas login instead of a **Database Access** user; `authSource=` pointing at a non-`admin` DB; user created seconds ago (wait 1–2 min). Simplest fix: Atlas → Database Access → Edit user → **Edit Password** → Autogenerate (letters/digits only) → paste the new URI into Render. |
| `MongoServerSelectionError` / `readyz` reports Mongo down | Atlas Network Access does not include Render's outbound IPs, wrong password, or password not URL-encoded. |
| Pre-deploy command option not available | Pre-deploy requires a paid instance type. Alternative: run `npm run migrate` once from the Shell tab, or change Start Command to `npm run migrate && npm start`. |
| Cron logs `Invalid configuration: SESSION_SECRET` | Add any ≥16-char `SESSION_SECRET` to the cron (unused but validated). |
| Admin can't log in / logged out on every deploy | `SESSION_SECRET` differs between deploys (e.g. you re-generated it). Set a fixed value. |
| Client IP allow-lists reject everyone | `TRUST_PROXY` missing or `false`. Must be `true` behind Render. |
| Permalinks / stream links point to `onrender.com` after adding a domain | Update `PUBLIC_BASE_URL` on both services (step 9). |
| Webhooks from TorBox never arrive | `PUBLIC_BASE_URL` wrong or `WEBHOOK_INBOUND_SECRET` differs between web and cron; re-enable the webhook toggle per upstream account. |

---

## Appendix A — Full variable checklist

**Env group `torbox-gateway-shared`** (linked to both):
`NODE_VERSION`, `NODE_ENV`, `LOG_LEVEL`, `MONGODB_DB_NAME`, `TORBOX_API_BASE`,
`UPSTREAM_GLOBAL_PER_MINUTE`, `UPSTREAM_GLOBAL_CREATE_UNCACHED_PER_HOUR`,
`UPSTREAM_GLOBAL_CREATE_USENET_PER_HOUR`, `UPSTREAM_GLOBAL_CREATE_WEBDL_PER_HOUR`,
`LOG_RETENTION_DAYS`, `MAX_UPLOAD_MB`, `TRUST_PROXY`

**Web service only**:
`MONGODB_URI`, `MASTER_ENCRYPTION_KEY`, `SESSION_SECRET`, `PERMALINK_SIGNING_SECRET`,
`WEBHOOK_INBOUND_SECRET`, `PORT`, `RUN_JOBS_IN_PROCESS`, `PUBLIC_BASE_URL` (optional),
`TORBOX_API_KEY` / `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` (first boot only, then delete)

**Cron job only**:
`MONGODB_URI`, `MASTER_ENCRYPTION_KEY`, `SESSION_SECRET`, `PERMALINK_SIGNING_SECRET`,
`WEBHOOK_INBOUND_SECRET`, `PUBLIC_BASE_URL`

## Appendix B — Mapping from `render.yaml` to dashboard fields

| `render.yaml` key | Dashboard location |
|---|---|
| `envVarGroups[].envVars` | Env Groups → New Environment Group |
| `services[].type: web` | New + → Web Service |
| `services[].type: cron` + `schedule` | New + → Cron Job → Schedule |
| `runtime: node` | Runtime / Language: Node |
| `plan` | Instance Type |
| `region`, `branch` | Region, Branch |
| `buildCommand`, `startCommand` | Build Command, Start Command (cron: "Command"). Add `--include=dev` to `npm ci` because `NODE_ENV=production` is set. |
| `preDeployCommand` | Advanced → Pre-Deploy Command |
| `healthCheckPath` | Advanced → Health Check Path |
| `autoDeployTrigger: checksPass` | Auto-Deploy: After CI Checks Pass |
| `maxShutdownDelaySeconds` | Settings → Max Shutdown Delay |
| `numInstances` | Settings → Scaling |
| `envVars[].sync: false` | Add a normal env var and paste the secret |
| `envVars[].generateValue: true` | Env var → **Generate** button |
| `envVars[].fromService … RENDER_EXTERNAL_URL` | Leave `PUBLIC_BASE_URL` unset on web (falls back automatically); set explicitly on cron |
| `fromGroup` | Link Environment Group |
| `domains` | Settings → Custom Domains |
