# Gateway HTTP contract (frontend ↔ backend)

Base: same origin. All admin endpoints live under `/admin/api`. Responses are JSON:
`{ "ok": true, "data": ... }` or `{ "ok": false, "error": "CODE", "message": "human text" }`.
Lists return `{ ok:true, data:{ items:[...], total:number, page:number, limit:number } }`.
Auth: HTTP-only cookie set by login. Every non-GET admin request MUST send header `x-tbg-csrf: 1`.
401 → redirect to `/admin/login`. 403 → show "forbidden". Dates are ISO strings.

## Roles
`owner` > `admin` > `viewer`. Viewer is read-only (GET only). Owner-only: upstreams write, admins, settings.security, log clearing.

## Auth
- `POST /admin/api/auth/login` `{email,password,totp?}` → `{admin}`; if 2FA enabled and no/invalid totp → 401 `TOTP_REQUIRED`.
- `POST /admin/api/auth/logout`
- `GET /admin/api/auth/me` → `{admin:{id,email,role,totpEnabled,mustChangePassword,createdAt}}`
- `POST /admin/api/auth/change-password` `{currentPassword,newPassword}`
- `POST /admin/api/auth/totp/setup` → `{secret, otpauthUrl}` (render QR client-side)
- `POST /admin/api/auth/totp/enable` `{code}` ; `POST /admin/api/auth/totp/disable` `{code}`
- `GET /admin/api/auth/sessions` → `{items:[{id,ip,userAgent,createdAt,expiresAt,current}]}` ; `DELETE /admin/api/auth/sessions/:id`

## Overview
`GET /admin/api/overview?hours=24` →
```
{ kpis:{ requests, errors, errorRate, cacheHitRate, p95LatencyMs, avgLatencyMs, activeKeys, clients, submits, links },
  upstream:[{ id,label,status,plan,planName,premiumExpiresAt,
              budgets:{ perMinute:{used,limit}, uncachedPerHour:{used,limit}, usenetPerHour:{used,limit}, webdlPerHour:{used,limit} } }],
  series:{ hourly:[{t, ok, error, cached}], topKeys:[{keyId,name,clientName,count}], topRoutes:[{route,count}], errorCodes:[{code,count}] },
  alerts:{ unread } }
```

## Alerts
- `GET /admin/api/alerts?unread=true&page&limit` → items `{id,severity:'info'|'warning'|'critical',type,title,message,createdAt,readAt,meta}`
- `POST /admin/api/alerts/:id/read`, `POST /admin/api/alerts/read-all`, `POST /admin/api/alerts/test`
- `POST /admin/api/alerts/:id/snooze` `{hours?}` (default 24) → `{snoozedUntil}`; snoozed alerts are excluded from `unread=true` lists and the bell count until `snoozedUntil`. Items carry `snoozedUntil`.

## Upstream accounts (TorBox keys)
Item: `{id,label,fingerprint,status:'active'|'degraded'|'disabled',plan,planName,emailMasked,premiumExpiresAt,lastVerifiedAt,lastError,weight,limits:{perMinute,createUncachedPerHour,createUsenetPerHour,createWebdlPerHour},webhookConfigured,keysCount,createdAt}`
- `GET /admin/api/upstreams` → `{items}`
- `POST /admin/api/upstreams` `{label, apiKey, limits?}` (verifies with TorBox `user/me` before saving)
- `PATCH /admin/api/upstreams/:id` `{label?,status?,weight?,limits?}`
- `POST /admin/api/upstreams/:id/verify` → item
- `POST /admin/api/upstreams/:id/rotate` `{apiKey}`
- `DELETE /admin/api/upstreams/:id` (fails `HAS_KEYS` if keys pinned)
- `GET /admin/api/upstreams/:id/details` → `{account:item, me:{...redacted user/me}, stats:{general,bandwidth[]}, notifications:[...]}`
- `POST /admin/api/upstreams/:id/webhook` `{enabled:boolean}` → configures TorBox webhook_url to our inbound hook
- `POST /admin/api/upstreams/:id/test-notification`
- `POST /admin/api/upstreams/:id/clear-notifications`

## Clients
Item `{id,name,contactEmail,notes,status:'active'|'suspended',defaultPolicyId,keysCount,requests30d,createdAt}`
- `GET /admin/api/clients?q&page&limit`, `POST` `{name,contactEmail?,notes?,defaultPolicyId?}`, `PATCH /:id`, `DELETE /:id` (revokes its keys), `POST /:id/reset-usage` (resets monthly quota counters of every key of the client → `{keys}`), `GET /:id` → `{client, keys:[keyItem], usage:{month:{requests,creates}, daily:[{d,requests,errors}]}}`

## API keys
Item `{id,clientId,clientName,name,prefix,last4,mode:'live'|'test',scopes[],policyId,policyName,upstreamAccountId,upstreamLabel,allowedIps[],allowedOrigins[],expiresAt,status:'active'|'suspended'|'revoked',revokedAt,graceUntil,lastUsedAt,lastUsedIp,requests30d,createdAt,metadata}` — `graceUntil` is set while a rotated-out secret is still accepted.
- `GET /admin/api/keys?clientId&status&q&page&limit`
- `POST /admin/api/keys` `{name,clientId,scopes[],policyId?,upstreamAccountId?,allowedIps?,allowedOrigins?,expiresAt?,metadata?}` → `{key:item, secret}` (secret shown once). `policyId` null/omitted → the client's default policy, then the gateway default; `upstreamAccountId` null/omitted → the active default upstream account (400 `NO_UPSTREAM` if none).
- `GET /admin/api/keys/:id` → `{key:item, usage:{month:{requests,creates,quotaRequests,quotaCreates}, today:{requests,errors}, daily:[{d,requests,errors,cacheHits,submits,links}]}, buckets:{perMinute:{used,limit,resetAt},perHour:{…},perDay:{…},createUncachedPerHour:{…},createPerHour:{…}}}`
- `PATCH /admin/api/keys/:id` (same fields as create minus clientId; `policyId: null` resets to the gateway default policy)
- `POST /admin/api/keys/:id/rotate` `{graceMinutes?}` → `{secret}`
- `POST /admin/api/keys/:id/suspend`, `/resume`, `/revoke`, `/reset-usage`, `/reset-limits`

## Policies
Item `{id,name,description,limits:{perMinute,perHour,perDay,createUncachedPerHour,createPerHour},quotas:{monthlyRequests,monthlyCreates},features:{allowPermalinks,allowStreaming,allowUploads,allowSettingsWrite,allowBypassCache,allowWebhooks},cacheTtlOverrides:{[routeGroup]:seconds},keysCount,isDefault}`
- `GET /admin/api/policies`, `POST`, `PATCH /:id`, `DELETE /:id` (fails if keys use it), `POST /:id/make-default`

## Meta
- `GET /admin/api/meta/scopes` → `{items:[{scope,group,description,default:boolean}], presets:{readonly:[...],full:[...],media:[...]}}`
- `GET /admin/api/meta/routes` → `{items:[{method,path,scope,group,cacheTtl,blocked,limiter}]}` (compat route table)

## Request logs
Item `{id,ts,requestId,keyId,keyName,clientId,clientName,upstreamAccountId,method,route,path,query,status,upstreamStatus,torboxError,success,latencyMs,upstreamLatencyMs,cacheHit,ip,userAgent,reqBytes,resBytes,surface:'compat'|'v1'|'permalink'|'stream'}`
- `GET /admin/api/logs?from&to&keyId&clientId&route&status&error&cacheHit&ip&requestId&surface&q&page&limit` — `status` accepts an exact code (`429`), a class (`5xx`) or a comma list (`401,403`)
- `GET /admin/api/logs/:id`
- `GET /admin/api/logs/export?<same filters>&format=csv|json` (file download)
- `DELETE /admin/api/logs` body `{all?:true, keyId?, clientId?, from?, to?}` → `{deleted}`
- `GET /admin/api/logs/count?<filters>` → `{count}` (for the confirmation dialog)

## Activity (what consumers submitted, what TorBox generated)
Item `{id,ts,kind:'submit'|'link'|'stream'|'control'|'edit',keyId,keyName,clientId,clientName,upstreamAccountId,type:'torrent'|'usenet'|'webdl'|null,publicId,torboxId,hash,name,
        input:{magnet?,url?,fileName?,fileSize?,nzbUrl?,password?:'***'},          // submit
        output:{cdnUrl?,fileId?,zip?,permalink?,hlsUrl?,expiresAt?},               // link/stream
        action?, success, error, detail, ip}`
- `GET /admin/api/activity?kind&keyId&clientId&publicId&type&hash&from&to&q&page&limit`
- `GET /admin/api/activity/export?<filters>&format=csv|json`
- `DELETE /admin/api/activity` `{all?,kind?,keyId?,clientId?,from?,to?}` → `{deleted}`
- `GET /admin/api/activity/count?<filters>`

## Analytics
- `GET /admin/api/analytics/usage?from&to&groupBy=day|key|client|route|error` → `{series:[{key,label,requests,errors,cacheHits,submits,links}]}`
- `GET /admin/api/analytics/quotas` → `{items:[{keyId,keyName,clientName,monthRequests,quotaRequests,monthCreates,quotaCreates,pct}]}`
- `GET /admin/api/analytics/upstream?from&to` → `{series:[{d,requests,uncachedCreates,usenetCreates,webdlCreates}], caps:{...}}`

## Downloads (unified view of everything on the upstream accounts)
Download `{publicId,type,torboxId,upstreamAccountId,name,hash,size,state,rawState,progress,downloadSpeed,uploadSpeed,eta,seeds,peers,ratio,cached,active,downloadFinished,downloadPresent,expiresAt,createdAt,updatedAt,files:[{id,name,shortName,size,mimetype,zipped}],tags[],createdByKeyId,createdByKeyName}`
- `GET /admin/api/downloads?upstreamId&type&state&q&page&limit&live=true`
- `GET /admin/api/downloads/:publicId` → `{download, index:{firstSeenAt,lastSeenAt,deletedAt,createdByKeyName}, history:[activityItem]}` — when the item no longer exists upstream `download` is a stub with the full shape (empty `files`/`tags`) plus `missing:true`
- `POST /admin/api/downloads/:publicId/stream` `{fileId?,audio?,subtitle?,resolution?}` → `{hlsUrl,presignedToken,needsTranscoding,isTranscoding,metadata,name,mimetype}` (402 `PLAN_RESTRICTED_FEATURE` when the upstream plan lacks streaming)
- `POST /admin/api/downloads/:publicId/action` `{action:'delete'|'reannounce'|'resume'|'pause'|'stop_seeding'|'start'}`
- `POST /admin/api/downloads/:publicId/link` `{fileId?,zip?}` → `{url}`
- `POST /admin/api/downloads/bulk-delete` `{upstreamId,olderThanDays?,createdByKeyId?,state?}` → `{deleted}`

## Webhooks
Endpoint `{id,clientId,clientName,keyId,url,events[],active,failureCount,disabledReason,lastDeliveryAt,createdAt}` (secret shown once on create)
- `GET /admin/api/webhooks` → `{items, eventTypes}`, `POST` `{clientId,keyId?,url,events[]}` → `{endpoint,secret}`, `PATCH /:id` `{url?,events?,active?,keyId?:string|null}`, `DELETE /:id`, `POST /:id/test`, `POST /:id/rotate-secret` → `{secret}`
- `GET /admin/api/webhooks/deliveries?endpointId&status&page&limit` → items `{id,endpointId,event,status:'pending'|'delivered'|'failed'|'dead',attempts,nextAttemptAt,lastResponse:{status,body},payload,createdAt,deliveredAt}`
- `DELETE /admin/api/webhooks/deliveries` body `{all?, endpointId?, status?, from?, to?}` → `{deleted}`
- `POST /admin/api/webhooks/deliveries/:id/redeliver`
- `GET /admin/api/webhooks/inbound` → `{byAccount:[{accountId,label,configured,url,lastReceivedAt,received24h,parseFailures24h}], recent:[{id,ts,accountId,parsed,eventType,raw}]}` (the receiver URL is per account)

## Events
- `GET /admin/api/events?type&publicId&upstreamId&from&to&page&limit` → items `{id,ts,type,publicId,downloadName,upstreamAccountId,payload,source:'webhook'|'reconciler'}`
- `GET /admin/api/events/export?<same filters>&format=csv|json` (file download)
- `DELETE /admin/api/events` `{all?,from?,to?,type?}`

## Cache
- `GET /admin/api/cache/stats` → `{entries,bytes,hitRate24h,byGroup:[{group,entries,hits,misses}]}`
- `DELETE /admin/api/cache` `{group?,upstreamId?}` → `{deleted}`

## Settings
`GET /admin/api/settings` / `PATCH /admin/api/settings` with
```
{ branding:{name,tagline,logoUrl,accentColor,supportEmail},
  homepage:{ showPublicStats, sections:{[id]:boolean}, customIntro },
  cors:{ allowedOrigins:[] },
  maintenance:{ enabled, message, readOnly },
  retention:{ requestLogsDays, activityDays, eventsDays, webhookDeliveriesDays },
  privacy:{ storeFullQuery, truncateIps },
  alerts:{ webhookUrl, thresholds:{ errorRatePct, budgetHeadroomPct, premiumExpiringDays, quotaPct } },
  docs:{ public } }
```
The GET response additionally carries a read-only `homepageSections: string[]` (the section ids the homepage knows about).

## Admins
- `GET /admin/api/admins`, `POST` `{email,password,role}`, `PATCH /:id` `{role?,disabled?}`, `DELETE /:id`, `POST /:id/reset-totp`, `POST /:id/reset-password` `{password}`

## Audit
- `GET /admin/api/audit?adminId&action&from&to&page&limit` → items `{id,ts,adminId,adminEmail,action,target,before,after,ip}`

## Playground
- `POST /admin/api/playground` `{keyId,method,path,query?,headers?,body?}` → `{status,headers,body,durationMs,curl}` (path starts with `/v1/api/` or `/api/v1/`)

## System
- `GET /admin/api/system` → `{version,uptimeSec,node,env,publicBaseUrl,upstreamBase,memoryMb,mongo:{ok,latencyMs?,error?,collections?:[{name,count,storageBytes}]},jobs:[{name,everySec,lastRunAt,lastStatus,lastDurationMs,lastError,nextDueAt,lockedBy}],upstreamHealth:[{accountId,label,ok,latencyMs,ts,detail}],inProcessJobs:boolean}`
- `POST /admin/api/system/jobs/:name/run`

## Public (no auth; homepage)
- `GET /public/config` → `{branding, homepage, docsPublic, baseUrl, version}`
- `GET /public/stats` → `{requestsTotal, downloadsCreated, uptimeSec}` (only if enabled, else 404)
- `GET /api/v1/status` → `{success:true,data:{gateway:'ok',upstream:{ok,latencyMs,checkedAt},budgetHeadroomPct}}`

## Consumer surfaces (documented at /docs, OpenAPI at /openapi.json)
- Compat mirror `/v1/api/*` (TorBox envelope), enhanced `/api/v1/*`, permalinks `/dl/:publicId/:fileId?k=<keyId>&sig=&exp=&zip=`, stream entry `/s/:publicId/:fileId/master.m3u8?k=<keyId>&sig=&exp=` (307 redirects; `k` identifies the issuing key so revoking it kills the link).
