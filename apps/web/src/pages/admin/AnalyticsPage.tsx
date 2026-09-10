import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, Database } from 'lucide-react';
import { useQuotas, useUpstreamUsage, useUsage } from '../../lib/queries';
import type { QuotaItem, UsageSeriesItem } from '../../lib/types';
import { useQueryParams } from '../../lib/hooks/useQueryParams';
import { daysAgoIso, dateShort, num, pct } from '../../lib/format';
import { Card, CardBody, CardHeader, DataTable, DateRangePicker, Progress, Select, Skeleton, StatTile, type Column } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';
import { AreaSeriesChart, CHART, StackedRequestsChart } from '../../components/admin/charts';
import { FilterBar } from '../../components/admin/FilterBar';

type GroupBy = 'key' | 'client' | 'route' | 'error';

export function AnalyticsPage() {
  const { params, set } = useQueryParams<{ from?: string; to?: string; groupBy?: string }>();
  // Default range is computed once per mount, otherwise the query key would change on every render.
  const [defaultFrom] = useState(() => daysAgoIso(30));
  const from = params.from ?? defaultFrom;
  const to = params.to;
  const groupBy = (params.groupBy as GroupBy) || 'key';
  const range = useMemo(() => ({ from, to }), [from, to]);
  const daily = useUsage({ ...range, groupBy: 'day' });
  const grouped = useUsage({ ...range, groupBy });
  const quotas = useQuotas();
  const up = useUpstreamUsage(range);

  const groupCols: Column<UsageSeriesItem>[] = [
    {
      key: 'label',
      header: groupBy === 'key' ? 'Key' : groupBy === 'client' ? 'Client' : groupBy === 'route' ? 'Route' : 'Error code',
      primary: true,
      render: (r) =>
        groupBy === 'key' ? (
          <Link to={`/admin/keys/${r.key}`} className="truncate font-medium hover:underline">
            {r.label}
          </Link>
        ) : groupBy === 'client' ? (
          <Link to={`/admin/clients/${r.key}`} className="truncate font-medium hover:underline">
            {r.label}
          </Link>
        ) : (
          <Link to={`/admin/logs?${groupBy === 'route' ? 'route' : 'error'}=${encodeURIComponent(r.key)}`} className="truncate font-mono text-xs hover:underline">
            {r.label || r.key}
          </Link>
        ),
    },
    { key: 'req', header: 'Requests', align: 'right', render: (r) => <span className="tabular-nums">{num(r.requests)}</span> },
    { key: 'err', header: 'Errors', align: 'right', render: (r) => <span className={`tabular-nums ${r.errors ? 'text-red-600' : ''}`}>{num(r.errors)}</span> },
    { key: 'rate', header: 'Error rate', align: 'right', render: (r) => <span className="tabular-nums">{r.requests ? pct((r.errors / r.requests) * 100) : '–'}</span>, hideOnMobile: true },
    { key: 'cache', header: 'Cache hits', align: 'right', render: (r) => <span className="tabular-nums">{num(r.cacheHits)}</span>, hideOnMobile: true },
    { key: 'sub', header: 'Submits', align: 'right', render: (r) => <span className="tabular-nums">{num(r.submits)}</span> },
    { key: 'links', header: 'Links', align: 'right', render: (r) => <span className="tabular-nums">{num(r.links)}</span> },
  ];
  const quotaCols: Column<QuotaItem>[] = [
    {
      key: 'key',
      header: 'Key',
      primary: true,
      render: (r) => (
        <Link to={`/admin/keys/${r.keyId}`} className="block min-w-0 hover:underline">
          <span className="block truncate font-medium">{r.keyName}</span>
          <span className="block text-xs text-gray-500">{r.clientName}</span>
        </Link>
      ),
    },
    { key: 'req', header: 'Monthly requests', render: (r) => <Progress value={r.monthRequests} max={r.quotaRequests} className="min-w-[160px]" /> },
    { key: 'cre', header: 'Monthly creates', render: (r) => <Progress value={r.monthCreates} max={r.quotaCreates} className="min-w-[160px]" /> },
    { key: 'pct', header: 'Used', align: 'right', render: (r) => <span className={`tabular-nums font-medium ${r.pct >= 90 ? 'text-red-600' : r.pct >= 75 ? 'text-amber-600' : ''}`}>{pct(r.pct, 0)}</span> },
  ];

  const dailyData = (daily.data?.series ?? []).map((s) => ({ d: s.key, requests: s.requests, errors: s.errors, cacheHits: s.cacheHits, submits: s.submits, links: s.links }));
  const totals = useMemo(() => {
    const t = { requests: 0, errors: 0, cacheHits: 0 };
    for (const s of daily.data?.series ?? []) {
      t.requests += s.requests || 0;
      t.errors += s.errors || 0;
      t.cacheHits += s.cacheHits || 0;
    }
    return { ...t, cachePct: t.requests ? (t.cacheHits / t.requests) * 100 : 0, errorPct: t.requests ? (t.errors / t.requests) * 100 : 0 };
  }, [daily.data]);
  const upData = (up.data?.series ?? []).map((s) => ({ ...s }));
  const caps = up.data?.caps ?? {};

  return (
    <div>
      <PageHeader title="Analytics" description="Usage over time, breakdowns and quota consumption." />
      <FilterBar activeCount={params.from || params.to ? 1 : 0} onReset={() => set({ from: undefined, to: undefined })} cols={3}>
        <div className="col-span-2">
          <DateRangePicker from={from} to={to} onChange={(v) => set({ from: v.from, to: v.to })} />
        </div>
        <Select label="Group by" value={groupBy} onChange={(e) => set({ groupBy: e.target.value })}>
          <option value="key">API key</option>
          <option value="client">Client</option>
          <option value="route">Route</option>
          <option value="error">Error code</option>
        </Select>
      </FilterBar>

      <div className="space-y-6">
        <section aria-label="Range totals" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile label="Requests in range" value={num(totals.requests)} hint="all surfaces, per-day series" icon={<Activity className="h-5 w-5" />} tone="accent" loading={daily.isLoading} />
          <StatTile
            label="Cache savings"
            value={num(totals.cacheHits)}
            hint={totals.requests ? `${pct(totals.cachePct)} of requests served from cache · upstream calls avoided` : 'no requests in range'}
            icon={<Database className="h-5 w-5" />}
            tone={totals.cachePct >= 50 ? 'success' : 'neutral'}
            loading={daily.isLoading}
          />
          <StatTile label="Errors" value={num(totals.errors)} hint={totals.requests ? `${pct(totals.errorPct)} error rate` : undefined} icon={<AlertTriangle className="h-5 w-5" />} tone={totals.errorPct >= 5 ? 'danger' : totals.errors ? 'warning' : 'neutral'} loading={daily.isLoading} />
        </section>
        <Card>
          <CardHeader title="Usage over time" description="Requests, cache hits and errors per day" />
          <CardBody>
            {daily.isLoading ? <Skeleton className="h-[280px]" /> : <AreaSeriesChart data={dailyData} xKey="d" xFormatter={dateShort} height={280} series={[{ key: 'requests', name: 'Requests', color: CHART.ok }, { key: 'cacheHits', name: 'Cache hits', color: CHART.cached }, { key: 'errors', name: 'Errors', color: CHART.error }]} />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Upstream consumption" description={`Creates per day against TorBox caps${Object.keys(caps).length ? ` (${Object.entries(caps).map(([k, v]) => `${k}: ${num(v)}`).join(', ')})` : ''}`} />
          <CardBody>
            {up.isLoading ? (
              <Skeleton className="h-[260px]" />
            ) : (
              <StackedRequestsChart
                data={upData}
                xKey="d"
                xFormatter={dateShort}
                series={[
                  { key: 'uncachedCreates', name: 'Uncached torrents', color: CHART.ok },
                  { key: 'usenetCreates', name: 'Usenet', color: CHART.cached },
                  { key: 'webdlCreates', name: 'Web downloads', color: '#a5b4fc' },
                ]}
              />
            )}
            {upData.length > 0 && (
              <p className="mt-2 text-xs text-gray-500">
                Total requests in range: {num(upData.reduce((a, b) => a + (b.requests || 0), 0))} · creates: {num(upData.reduce((a, b) => a + (b.uncachedCreates || 0) + (b.usenetCreates || 0) + (b.webdlCreates || 0), 0))}
              </p>
            )}
          </CardBody>
        </Card>

        <div>
          <h3 className="mb-2 text-sm font-semibold">Breakdown by {groupBy}</h3>
          <DataTable columns={groupCols} rows={grouped.data?.series} rowKey={(r) => r.key} loading={grouped.isLoading} emptyTitle="No usage in range" />
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold">Monthly quotas</h3>
          <DataTable columns={quotaCols} rows={quotas.data?.items} rowKey={(r) => r.keyId} loading={quotas.isLoading} emptyTitle="No keys with quotas" emptyDescription="Set monthly quotas in a policy to track them here." />
        </div>
      </div>
    </div>
  );
}
