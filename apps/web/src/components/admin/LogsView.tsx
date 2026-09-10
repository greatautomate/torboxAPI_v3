import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Trash2 } from 'lucide-react';
import { api, type Query } from '../../lib/api';
import { useAllClients, useAllKeys, useApiMutation, useLogs } from '../../lib/queries';
import type { RequestLog } from '../../lib/types';
import { bytes, date, json, ms, num, time, truncate } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Badge, Button, ConfirmDialog, CopyField, DataTable, DateRangePicker, DescriptionList, Drawer, Input, JsonView, Select, httpTone, type Column } from '../ui';
import { FilterBar, countActive } from './FilterBar';
import { useFilters } from './useFilters';

const FILTER_KEYS = ['from', 'to', 'keyId', 'clientId', 'route', 'status', 'error', 'cacheHit', 'ip', 'requestId', 'surface', 'q'];

export function LogsView({ fixed = {}, embedded = false }: { fixed?: Partial<Record<string, string>>; embedded?: boolean }) {
  const f = useFilters(embedded);
  const { params, set, reset, page, limit } = f;
  const { isOwner } = useAuth();
  const query: Query = useMemo(() => {
    const q: Query = { page, limit };
    for (const k of FILTER_KEYS) if (params[k]) q[k] = params[k];
    Object.assign(q, fixed);
    return q;
  }, [params, page, limit, fixed]);
  const filtersOnly: Query = useMemo(() => {
    const q: Query = {};
    for (const k of FILTER_KEYS) if (params[k]) q[k] = params[k];
    Object.assign(q, fixed);
    return q;
  }, [params, fixed]);

  const logs = useLogs(query);
  const keys = useAllKeys();
  const clients = useAllClients();
  const [selected, setSelected] = useState<RequestLog | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);

  const clear = useApiMutation((b: Parameters<typeof api.logs.clear>[0]) => api.logs.clear(b), {
    invalidate: [['logs']],
    success: (d) => `Deleted ${num(d.deleted)} log entries`,
  });

  const openClear = async () => {
    setCounting(true);
    setClearOpen(true);
    try {
      const r = await api.logs.count(filtersOnly);
      setCount(r.count);
    } catch {
      setCount(null);
    } finally {
      setCounting(false);
    }
  };
  const doClear = async () => {
    const hasFilter = Object.keys(filtersOnly).length > 0;
    await clear.mutateAsync(hasFilter ? { keyId: filtersOnly.keyId as string | undefined, clientId: filtersOnly.clientId as string | undefined, from: filtersOnly.from as string | undefined, to: filtersOnly.to as string | undefined } : { all: true });
  };

  const columns: Column<RequestLog>[] = [
    { key: 'ts', header: 'Time', render: (r) => <span className="whitespace-nowrap tabular-nums text-gray-600 dark:text-gray-400">{time(r.ts)}</span>, width: '110px', hideOnMobile: false },
    {
      key: 'route',
      header: 'Route',
      primary: true,
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-12 shrink-0 font-mono text-[11px] font-semibold text-gray-500">{r.method}</span>
          <span className="truncate font-mono text-xs" title={r.path}>
            {r.route || r.path}
          </span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={httpTone(r.status)}>{r.status}</Badge>, width: '80px' },
    ...(fixed.keyId ? [] : [{ key: 'key', header: 'Key', render: (r: RequestLog) => (r.keyId ? <Link to={`/admin/keys/${r.keyId}`} className="truncate text-accent-600 hover:underline" onClick={(e) => e.stopPropagation()}>{r.keyName ?? r.keyId}</Link> : <span className="text-gray-400">–</span>) }]),
    { key: 'latency', header: 'Latency', align: 'right', render: (r) => <span className="tabular-nums">{ms(r.latencyMs)}</span>, width: '90px' },
    { key: 'cache', header: 'Cache', render: (r) => (r.cacheHit ? <Badge tone="accent">hit</Badge> : <span className="text-xs text-gray-400">miss</span>), width: '70px', hideOnMobile: true },
    { key: 'surface', header: 'Surface', render: (r) => <span className="text-xs text-gray-500">{r.surface}</span>, width: '90px', hideOnMobile: true },
    { key: 'err', header: 'TorBox error', render: (r) => (r.torboxError ? <span className="truncate font-mono text-xs text-red-600">{truncate(r.torboxError, 24)}</span> : <span className="text-gray-400">–</span>), hideOnMobile: true },
    { key: 'ip', header: 'IP', render: (r) => <span className="font-mono text-xs">{r.ip}</span>, hideOnMobile: true },
  ];

  const active = countActive(params);
  const exportBtns = (
    <>
      <Button variant="outline" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={() => window.open(api.logs.exportUrl(filtersOnly, 'csv'), '_blank')}>
        CSV
      </Button>
      <Button variant="outline" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={() => window.open(api.logs.exportUrl(filtersOnly, 'json'), '_blank')}>
        JSON
      </Button>
      {isOwner && (
        <Button variant="danger" size="sm" leftIcon={<Trash2 className="h-4 w-4" />} onClick={openClear}>
          Clear logs
        </Button>
      )}
    </>
  );

  return (
    <div>
      <FilterBar activeCount={active} onReset={reset} actions={exportBtns} cols={4}>
        <div className="col-span-2 md:col-span-2">
          <DateRangePicker from={params.from} to={params.to} onChange={(v) => set({ from: v.from, to: v.to })} presets={false} />
        </div>
        <Input label="Search" placeholder="path, user agent, request id…" value={params.q ?? ''} onChange={(e) => set({ q: e.target.value })} />
        {!fixed.keyId && (
          <Select label="API key" value={params.keyId ?? ''} onChange={(e) => set({ keyId: e.target.value })}>
            <option value="">All keys</option>
            {keys.data?.items.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name} ({k.clientName})
              </option>
            ))}
          </Select>
        )}
        {!fixed.clientId && !fixed.keyId && (
          <Select label="Client" value={params.clientId ?? ''} onChange={(e) => set({ clientId: e.target.value })}>
            <option value="">All clients</option>
            {clients.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Input label="Route" placeholder="/api/v1/downloads" value={params.route ?? ''} onChange={(e) => set({ route: e.target.value })} />
        <Input label="HTTP status" placeholder="e.g. 429 or 5xx" value={params.status ?? ''} onChange={(e) => set({ status: e.target.value })} />
        <Input label="TorBox error" placeholder="e.g. DATABASE_ERROR" value={params.error ?? ''} onChange={(e) => set({ error: e.target.value })} />
        <Select label="Cache hit" value={params.cacheHit ?? ''} onChange={(e) => set({ cacheHit: e.target.value })}>
          <option value="">Any</option>
          <option value="true">Hit</option>
          <option value="false">Miss</option>
        </Select>
        <Input label="IP" value={params.ip ?? ''} onChange={(e) => set({ ip: e.target.value })} />
        <Input label="Request ID" value={params.requestId ?? ''} onChange={(e) => set({ requestId: e.target.value })} />
        <Select label="Surface" value={params.surface ?? ''} onChange={(e) => set({ surface: e.target.value })}>
          <option value="">Any</option>
          <option value="compat">compat (/v1/api)</option>
          <option value="v1">v1 (/api/v1)</option>
          <option value="permalink">permalink</option>
          <option value="stream">stream</option>
        </Select>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={logs.data?.items}
        rowKey={(r) => r.id}
        loading={logs.isLoading || logs.isFetching}
        onRowClick={setSelected}
        dense
        emptyTitle="No requests match"
        emptyDescription="Adjust the filters or wait for consumers to send traffic."
        pagination={{ page, limit, total: logs.data?.total ?? 0, onPage: (p) => set({ page: p }, false), onLimit: (l) => set({ limit: l }) }}
      />

      <LogDrawer log={selected} onClose={() => setSelected(null)} />

      <ConfirmDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={doClear}
        danger
        title="Clear request logs?"
        confirmLabel={count !== null ? `Delete ${num(count)} entries` : 'Delete'}
        loading={counting}
        description={
          counting ? 'Counting matching entries…' : count === null ? 'Could not count matching entries. Continue anyway?' : `${num(count)} log ${count === 1 ? 'entry' : 'entries'} match the current filters (key, client, date range) and will be permanently deleted.`
        }
      />
    </div>
  );
}

export function LogDrawer({ log, onClose }: { log: RequestLog | null; onClose: () => void }) {
  return (
    <Drawer open={!!log} onClose={onClose} title={log ? `${log.method} ${log.route || log.path}` : ''} description={log ? date(log.ts, { dateStyle: 'medium', timeStyle: 'medium' }) : undefined} width="lg">
      {log && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Badge tone={httpTone(log.status)}>HTTP {log.status}</Badge>
            {log.upstreamStatus !== null && <Badge tone={httpTone(log.upstreamStatus)}>upstream {log.upstreamStatus}</Badge>}
            {log.cacheHit && <Badge tone="accent">cache hit</Badge>}
            <Badge>{log.surface}</Badge>
            {log.torboxError && <Badge tone="danger">{log.torboxError}</Badge>}
          </div>
          <CopyField label="Request ID" value={log.requestId} />
          <Timings log={log} />
          <DescriptionList
            items={[
              { label: 'Path', value: <code className="break-all font-mono text-xs">{log.path}</code>, full: true },
              { label: 'Route', value: <code className="font-mono text-xs">{log.route}</code> },
              { label: 'Method', value: log.method },
              { label: 'Key', value: log.keyId ? <Link to={`/admin/keys/${log.keyId}`} className="text-accent-600 hover:underline">{log.keyName ?? log.keyId}</Link> : '–' },
              { label: 'Client', value: log.clientId ? <Link to={`/admin/clients/${log.clientId}`} className="text-accent-600 hover:underline">{log.clientName ?? log.clientId}</Link> : '–' },
              { label: 'Upstream account', value: log.upstreamAccountId ?? '–' },
              { label: 'Success', value: log.success ? 'yes' : 'no' },
              { label: 'Latency', value: ms(log.latencyMs) },
              { label: 'Upstream latency', value: ms(log.upstreamLatencyMs) },
              { label: 'Request bytes', value: bytes(log.reqBytes) },
              { label: 'Response bytes', value: bytes(log.resBytes) },
              { label: 'IP', value: <span className="font-mono text-xs">{log.ip}</span> },
              { label: 'User agent', value: <span className="break-all text-xs">{log.userAgent || '–'}</span>, full: true },
            ]}
          />
          {log.query && (
            <div>
              <p className="label">Query</p>
              <JsonView value={typeof log.query === 'string' ? log.query : json(log.query)} maxHeight="200px" />
            </div>
          )}
          <div>
            <p className="label">Raw</p>
            <JsonView value={log} maxHeight="320px" />
          </div>
        </div>
      )}
    </Drawer>
  );
}

/** Where the time went: gateway work (auth → limiter → cache lookup → logging) versus the upstream TorBox call. */
function Timings({ log }: { log: RequestLog }) {
  const total = Math.max(0, log.latencyMs || 0);
  const upstream = log.upstreamLatencyMs != null ? Math.max(0, Math.min(total, log.upstreamLatencyMs)) : 0;
  const gateway = Math.max(0, total - upstream);
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  const segments: Array<{ label: string; value: number; className: string }> = [
    { label: 'Gateway (auth · limiter · cache · normalize)', value: gateway, className: 'bg-accent-500' },
    ...(log.cacheHit ? [] : [{ label: 'Upstream (TorBox)', value: upstream, className: 'bg-amber-500' }]),
  ];
  return (
    <div>
      <p className="label">Timings</p>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" role="img" aria-label={`Total ${ms(total)}; upstream ${ms(upstream)}`}>
        {segments.map((s) => (
          <span key={s.label} className={s.className} style={{ width: `${pct(s.value)}%` }} title={`${s.label}: ${ms(s.value)}`} />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-1 gap-1 text-xs text-gray-600 sm:grid-cols-2 dark:text-gray-400">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${s.className}`} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="tabular-nums">{ms(s.value)} · {pct(s.value)}%</span>
          </li>
        ))}
        <li className="flex items-center gap-2 font-medium text-gray-800 dark:text-gray-200">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-gray-300 dark:bg-gray-600" aria-hidden />
          <span className="min-w-0 flex-1">Total</span>
          <span className="tabular-nums">{ms(total)}</span>
        </li>
        {log.cacheHit && <li className="sm:col-span-2 text-accent-700 dark:text-accent-300">Served from the gateway cache — TorBox was not called.</li>}
      </ul>
    </div>
  );
}
