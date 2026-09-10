# Architecture notes

See `/workspace/home/PLAN.md` (the original plan) for the full design. Implementation summary:

* **Request pipeline (consumer)**: `authenticateConsumer` (key lookup by SHA-256 → status/expiry → IP allow-list → scope) → `consumeLimits` (per-key minute/hour/day, create budgets, monthly quotas, global per-upstream budgets; Mongo fixed windows with two-bucket sliding correction) → cache lookup → upstream call (`TorboxClient`, key injected as Bearer or `?token=`) → activity side effects (`download_index`, `activity`) → response → `onResponse` request log + daily rollups.
* **Compat surface** (`routes/compat`): route table generated from `torbox/openapi.json` (`routeTable.ts`) with scope/limiter/cache/blocked classification; raw body pass-through; PII masking for `user/me`; settings field allow-list.
* **Enhanced surface** (`routes/v1`): normalized `Download` DTO (`services/downloads.ts`), smart create with type detection and hash dedupe, signed permalinks/stream entries (`/dl`, `/s` in `routes/public.ts`), batch cache checks, hoster pre-checks, RSS/notifications/integrations, consumer webhooks and event feed.
* **Admin API** (`routes/admin/*`): session cookie auth + CSRF header + roles; resources (upstreams, clients, keys, policies), logs/activity/analytics/events/cache/audit/alerts, ops (overview, downloads, webhooks, settings, playground, system).
* **Jobs** (`jobs/index.ts`): verify-upstreams, reconcile-downloads, dispatch-webhooks, expire-keys, quota-alerts, error-rate-alert, prune-retention, refresh-hosters. Lease locks in `job_locks`; runs in-process and/or from the Render cron (`jobs/run.ts`).
* **Persistence**: see `db.ts` `ensureIndexes` for every collection and TTL.
* **Mock TorBox** (`mock/torbox-mock.ts`): replays Postman success examples + dynamic create/list/control/requestdl behaviour; used by tests and `npm run dev:mock`.
