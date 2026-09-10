import { AlertTriangle, Play } from 'lucide-react';
import { api } from '../../lib/api';
import { qk, useApiMutation, useSystem } from '../../lib/queries';
import type { SystemInfo } from '../../lib/types';
import { bytes, date, duration, ms, num, relative } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, SkeletonCard, StatTile, StatusBadge, type Column } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';

type Coll = NonNullable<SystemInfo['mongo']['collections']>[number];
type Job = SystemInfo['jobs'][number];

export function SystemPage() {
  const q = useSystem();
  const { canWrite } = useAuth();
  const run = useApiMutation((name: string) => api.system.runJob(name), { invalidate: [qk.system], success: (_r, n) => `Job "${n}" started` });
  const d = q.data;
  const collCols: Column<Coll>[] = [
    { key: 'name', header: 'Collection', primary: true, render: (c) => <span className="font-mono text-xs">{c.name}</span> },
    { key: 'count', header: 'Documents', align: 'right', render: (c) => <span className="tabular-nums">{num(c.count)}</span> },
    { key: 'size', header: 'Storage', align: 'right', render: (c) => <span className="tabular-nums">{bytes(c.storageBytes)}</span> },
  ];
  const jobCols: Column<Job>[] = [
    {
      key: 'name',
      header: 'Job',
      primary: true,
      render: (j) => (
        <span className="block min-w-0">
          <span className="block truncate font-mono text-xs">{j.name}</span>
          {j.everySec != null && <span className="block text-xs text-gray-500">every {j.everySec}s</span>}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Last status',
      render: (j) => (
        <span className="flex flex-wrap items-center gap-1">
          {j.lastStatus ? <StatusBadge status={j.lastStatus} /> : <span className="text-gray-400">never</span>}
          {j.lastError && (
            <Badge tone="danger" title={j.lastError} className="cursor-help">
              <AlertTriangle className="mr-1 h-3 w-3" aria-hidden />
              error
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'last', header: 'Last run', render: (j) => <span className="text-xs text-gray-500" title={date(j.lastRunAt)}>{relative(j.lastRunAt)}</span> },
    { key: 'dur', header: 'Duration', align: 'right', render: (j) => <span className="text-xs tabular-nums">{ms(j.lastDurationMs)}</span>, hideOnMobile: true },
    { key: 'next', header: 'Next due', render: (j) => <span className="text-xs text-gray-500">{j.nextDueAt ? relative(j.nextDueAt) : '–'}</span> },
    { key: 'lock', header: 'Lock', render: (j) => (j.lockedBy ? <Badge tone="warning">{j.lockedBy}</Badge> : <span className="text-gray-400">–</span>), hideOnMobile: true },
  ];
  return (
    <div>
      <PageHeader title="System" description="Runtime, database, background jobs and upstream health." />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {!d ? (
          Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <StatTile label="Version" value={d.version} hint={`env: ${d.env}`} />
            <StatTile label="Uptime" value={duration(d.uptimeSec)} />
            <StatTile label="Node" value={d.node} hint={d.inProcessJobs ? 'jobs run in-process' : 'jobs run externally'} />
            <StatTile
              label="MongoDB"
              value={d.mongo.ok ? 'connected' : 'down'}
              hint={d.mongo.ok ? (d.mongo.latencyMs != null ? `${ms(d.mongo.latencyMs)} ping` : 'ping not measured') : <span className="break-words text-red-600 dark:text-red-400">{d.mongo.error ?? 'connection failed'}</span>}
              tone={d.mongo.ok ? 'success' : 'danger'}
            />
            <StatTile label="Memory (RSS)" value={d.memoryMb != null ? `${num(Math.round(d.memoryMb))} MB` : '–'} hint="resident set size of this process" />
            <StatTile label="Public base URL" value={<span className="break-all font-mono text-sm" title={d.publicBaseUrl}>{d.publicBaseUrl ?? '–'}</span>} hint="used for permalinks, docs and webhook receivers" />
            <StatTile label="Upstream base" value={<span className="break-all font-mono text-sm" title={d.upstreamBase}>{d.upstreamBase ?? '–'}</span>} hint="TorBox API origin the gateway proxies to" />
            <StatTile label="Background jobs" value={num(d.jobs.length)} hint={d.jobs.some((j) => j.lastError) ? `${num(d.jobs.filter((j) => j.lastError).length)} with errors` : 'all healthy'} tone={d.jobs.some((j) => j.lastError) ? 'warning' : 'neutral'} />
          </>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Background jobs</h3>
          <DataTable
            columns={jobCols}
            rows={d?.jobs}
            rowKey={(j) => j.name}
            loading={q.isLoading}
            dense
            emptyTitle="No jobs registered"
            actions={(j) =>
              canWrite ? (
                <Button size="sm" variant="outline" leftIcon={<Play className="h-4 w-4" />} onClick={() => run.mutate(j.name)} loading={run.isPending && run.variables === j.name} disabled={!!j.lockedBy}>
                  Run now
                </Button>
              ) : null
            }
          />
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Upstream health" description="Latest probe per TorBox account" />
            <CardBody className="p-0">
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {d?.upstreamHealth.map((u) => (
                  <li key={u.accountId} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${u.ok ? 'bg-green-500' : 'bg-red-500'}`} aria-hidden />
                      {u.label}
                    </span>
                    <span className="text-xs text-gray-500">
                      {u.ok ? 'ok' : 'failing'} · {ms(u.latencyMs)} · {relative(u.ts)}
                    </span>
                  </li>
                ))}
                {d && !d.upstreamHealth.length && <li className="px-4 py-6 text-center text-sm text-gray-500">No upstream accounts.</li>}
              </ul>
            </CardBody>
          </Card>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Mongo collections</h3>
            <DataTable columns={collCols} rows={d ? d.mongo.collections ?? [] : undefined} rowKey={(c) => c.name} loading={q.isLoading} dense emptyTitle={d && !d.mongo.ok ? 'MongoDB unavailable' : 'No collections'} emptyDescription={d && !d.mongo.ok ? d.mongo.error : undefined} />
          </div>
        </div>
      </div>
    </div>
  );
}
