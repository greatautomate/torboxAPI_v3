# Runbook

## Daily operations (all in the admin dashboard)
* **Add / rotate the TorBox key**: Upstream accounts → Add / Rotate. The key is verified with `user/me` before being stored (AES-256-GCM).
* **Issue a key**: API keys → New key → choose client, scopes (presets: read-only / full / media), policy, upstream, IP allow-list, expiry. The secret is shown once.
* **Investigate a consumer**: API keys → key → Logs / Activity tabs, or Activity page filtered by key. "Submitted links" shows every magnet/URL/file; "Generated links" shows every CDN URL TorBox produced and which permalink/stream produced it.
* **Clear data**: Request logs / Activity / Events pages → Clear (filters + count confirmation). Reset a key's usage or rate-limit buckets from the key page. Retention (TTL) is under Settings → Retention.
* **Emergency**: Settings → Maintenance (returns 503 to consumers) or Read-only (blocks creates/controls). Suspend a client to suspend all its keys.

## Alerts
Dashboard bell + Alerts page. Optional outgoing webhook (Discord/Slack compatible) under Settings → Alerts. Sources: upstream key rejected, premium expiring, upstream budget low, key near quota, error-rate spike, expired keys, webhook endpoint disabled.

## Background jobs
Run in-process on the web service (lease-locked) and every 2 minutes from the Render cron `torbox-gateway-jobs`. Status and "Run now" under System.

| Job | Interval | Purpose |
|---|---|---|
| verify-upstreams | 5 min | `user/me` probe, plan/expiry refresh, health history, alerts |
| reconcile-downloads | 2 min | Poll `mylist` ×3, emit download events |
| dispatch-webhooks | 1 min | Deliver outbox with backoff (1m, 5m, 30m, 2h, 12h) |
| expire-keys | 1 h | Revoke keys past `expiresAt` |
| quota-alerts | 15 min | Warn at ≥ quota threshold |
| error-rate-alert | 5 min | Warn on error spikes |
| prune-retention | 6 h | Enforce retention and rebuild TTL indexes |
| refresh-hosters | 1 h | Warm hoster catalogue cache |

## Health
* `GET /healthz` – process up (Render health check). `GET /readyz` – Mongo ping + last upstream probe.
* `GET /api/v1/status` – public status used by the homepage.

## Rotating secrets
* `SESSION_SECRET`: rotate any time (all admins re-login).
* `PERMALINK_SIGNING_SECRET`: rotating invalidates all existing permalinks/stream links.
* `MASTER_ENCRYPTION_KEY`: **do not rotate without re-encrypting**. Procedure: add all upstream keys again via Rotate after changing the env var (old ciphertexts cannot be decrypted).
* `WEBHOOK_INBOUND_SECRET`: rotate, then re-enable the TorBox webhook on each upstream account (dashboard toggle) so TorBox gets the new URL.

## Testing locally without TorBox
`npm run dev:mock` starts a mock TorBox on :10100 (`TORBOX_API_BASE=http://localhost:10100`, key `mock-torbox-key`). `npm run dev:mongo` starts an in-memory MongoDB on :27017 when Docker/Atlas is unavailable.
