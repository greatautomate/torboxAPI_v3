import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, Gauge, KeyRound, Link2, Timer, Upload, Users } from 'lucide-react';
import { useOverview } from '../../lib/queries';
import { date, ms, num, pct, ratioPct } from '../../lib/format';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, Progress, SkeletonCard, StatTile, StatusBadge, Tabs } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';
import { RankedBars, StackedRequestsChart } from '../../components/admin/charts';

const BUDGETS: Array<{ key: 'perMinute' | 'uncachedPerHour' | 'usenetPerHour' | 'webdlPerHour'; label: string }> = [
  { key: 'perMinute', label: 'Requests / minute' },
  { key: 'uncachedPerHour', label: 'Uncached torrents / hour' },
  { key: 'usenetPerHour', label: 'Usenet / hour' },
  { key: 'webdlPerHour', label: 'Web downloads / hour' },
];

export function OverviewPage() {
  const [hours, setHours] = useState<'24' | '168'>('24');
  const h = Number(hours);
  const ov = useOverview(h);
  const d = ov.data;
  const k = d?.kpis;
  const fmtHour = (t: string) => (h > 48 ? date(t, { month: 'short', day: 'numeric' }) : date(t, { hour: 'numeric' }));

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Gateway health, upstream budgets and traffic at a glance."
        actions={<Tabs variant="pills" items={[{ key: '24', label: 'Last 24h' }, { key: '168', label: 'Last 7 days' }]} value={hours} onChange={setHours} />}
      />
      {ov.isError ? (
        <ErrorState message={ov.error.message} onRetry={() => ov.refetch()} />
      ) : (
        <div className="space-y-6">
          <section aria-label="Key metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {ov.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
            ) : (
              <>
                <StatTile label="Requests" value={num(k?.requests)} hint={`${num(k?.errors)} errors · ${pct(k?.errorRate)} rate`} icon={<Activity className="h-5 w-5" />} tone="accent" />
                <StatTile label="Cache hit rate" value={pct(k?.cacheHitRate)} hint="served without hitting TorBox" icon={<Gauge className="h-5 w-5" />} />
                <StatTile label="Latency p95" value={ms(k?.p95LatencyMs)} hint={`avg ${ms(k?.avgLatencyMs)}`} icon={<Timer className="h-5 w-5" />} />
                <StatTile label="Active keys" value={num(k?.activeKeys)} hint={`${num(k?.clients)} clients`} icon={<KeyRound className="h-5 w-5" />} />
                <StatTile label="Submits / links" value={`${num(k?.submits)} / ${num(k?.links)}`} hint="downloads created / links generated" icon={<Link2 className="h-5 w-5" />} />
              </>
            )}
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Requests per hour" description="OK, cached and error responses" />
              <CardBody>
                {ov.isLoading ? <div className="h-[260px] animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" /> : <StackedRequestsChart data={d?.series.hourly ?? []} xKey="t" xFormatter={fmtHour} />}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Alerts" actions={<Link to="/admin/alerts" className="text-xs font-medium text-accent-600 hover:underline">View all</Link>} />
              <CardBody>
                {ov.isLoading ? (
                  <SkeletonCard />
                ) : (
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full ${d?.alerts.unread ? 'bg-amber-50 text-amber-600 dark:bg-amber-950' : 'bg-green-50 text-green-600 dark:bg-green-950'}`}>
                      <AlertTriangle className="h-5 w-5" aria-hidden />
                    </div>
                    <div>
                      <p className="text-2xl font-semibold tabular-nums">{num(d?.alerts.unread)}</p>
                      <p className="text-xs text-gray-500">unread alerts</p>
                    </div>
                  </div>
                )}
                <div className="mt-5 border-t border-gray-100 pt-4 dark:border-gray-800">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Top error codes</p>
                  {d?.series.errorCodes.length ? (
                    <ul className="space-y-1.5 text-sm">
                      {d.series.errorCodes.slice(0, 6).map((e) => (
                        <li key={e.code} className="flex items-center justify-between gap-2">
                          <Link to={`/admin/logs?error=${encodeURIComponent(e.code)}`} className="truncate font-mono text-xs text-red-600 hover:underline">
                            {e.code}
                          </Link>
                          <span className="tabular-nums text-gray-600 dark:text-gray-400">{num(e.count)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-500">No errors in this window.</p>
                  )}
                </div>
              </CardBody>
            </Card>
          </section>

          <section>
            <Card>
              <CardHeader title="Upstream budgets" description="TorBox rate-limit consumption per account" actions={<Link to="/admin/upstreams" className="text-xs font-medium text-accent-600 hover:underline">Manage accounts</Link>} />
              <CardBody>
                {ov.isLoading ? (
                  <SkeletonCard />
                ) : !d?.upstream.length ? (
                  <EmptyState title="No upstream accounts" description="Add a TorBox API key to start issuing gateway keys." action={<Link to="/admin/upstreams" className="text-sm font-medium text-accent-600 hover:underline">Add upstream account</Link>} />
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {d.upstream.map((u) => (
                      <div key={u.id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{u.label}</p>
                            <p className="text-xs text-gray-500">
                              {u.planName ?? 'plan'}
                              {u.premiumExpiresAt && ` · expires ${date(u.premiumExpiresAt, { dateStyle: 'medium' })}`}
                            </p>
                          </div>
                          <StatusBadge status={u.status} />
                        </div>
                        <div className="space-y-3">
                          {BUDGETS.map((b) => {
                            const v = u.budgets[b.key];
                            const p = ratioPct(v.used, v.limit);
                            return <Progress key={b.key} label={`${b.label} (${p}%)`} value={v.used} max={v.limit} />;
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Top keys" description="Most active gateway keys" />
              <CardBody>
                {ov.isLoading ? (
                  <SkeletonCard />
                ) : (
                  <RankedBars
                    items={(d?.series.topKeys ?? []).map((t) => ({
                      label: (
                        <Link to={`/admin/keys/${t.keyId}`} className="hover:underline">
                          {t.name}
                        </Link>
                      ),
                      sub: t.clientName,
                      value: t.count,
                    }))}
                  />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Top routes" description="Most requested routes" />
              <CardBody>
                {ov.isLoading ? (
                  <SkeletonCard />
                ) : (
                  <RankedBars
                    items={(d?.series.topRoutes ?? []).map((t) => ({
                      label: (
                        <Link to={`/admin/logs?route=${encodeURIComponent(t.route)}`} className="font-mono text-xs hover:underline">
                          {t.route}
                        </Link>
                      ),
                      value: t.count,
                    }))}
                  />
                )}
              </CardBody>
            </Card>
          </section>
          <p className="flex items-center gap-1 text-xs text-gray-400">
            <Users className="h-3 w-3" aria-hidden /> {num(k?.clients)} clients · <Upload className="h-3 w-3" aria-hidden /> {num(k?.submits)} submits in window
            {d?.alerts && <Badge className="ml-2">auto-refreshes every minute</Badge>}
          </p>
        </div>
      )}
    </div>
  );
}
