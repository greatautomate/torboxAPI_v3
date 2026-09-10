import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useApiMutation, useEvents, useUpstreams } from '../../lib/queries';
import type { GatewayEvent } from '../../lib/types';
import { useQueryParams } from '../../lib/hooks/useQueryParams';
import { date, num, time, truncate } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Badge, Button, ConfirmDialog, DataTable, DateRangePicker, Drawer, Input, JsonView, Select, type Column } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';
import { FilterBar, countActive } from '../../components/admin/FilterBar';

export function EventsPage() {
  const { params, set, reset, page } = useQueryParams<{ type?: string; publicId?: string; upstreamId?: string; from?: string; to?: string; page?: string }>();
  const limit = 50;
  const q = useEvents({ type: params.type, publicId: params.publicId, upstreamId: params.upstreamId, from: params.from, to: params.to, page, limit });
  const ups = useUpstreams();
  const { isOwner } = useAuth();
  const [sel, setSel] = useState<GatewayEvent | null>(null);
  const [clear, setClear] = useState(false);
  const del = useApiMutation((b: Parameters<typeof api.events.clear>[0]) => api.events.clear(b), { invalidate: [['events']], success: (r) => `Deleted ${num(r.deleted)} events` });
  const filtersOnly = { type: params.type, publicId: params.publicId, upstreamId: params.upstreamId, from: params.from, to: params.to };
  const hasClearFilter = !!(params.from || params.to || params.type);
  const clearBody: Parameters<typeof api.events.clear>[0] = hasClearFilter ? { from: params.from, to: params.to, type: params.type || undefined } : { all: true };
  const clearDescription = hasClearFilter
    ? `Events${params.type ? ` of type "${params.type}"` : ''}${params.from || params.to ? ' inside the selected date range' : ''} will be deleted.${params.publicId || params.upstreamId ? ' The public ID and upstream filters are not applied to the clear.' : ''}`
    : 'All events will be deleted.';

  const cols: Column<GatewayEvent>[] = [
    { key: 'ts', header: 'Time', render: (e) => <span className="whitespace-nowrap tabular-nums text-gray-600 dark:text-gray-400">{time(e.ts)}</span>, width: '110px' },
    { key: 'type', header: 'Type', primary: true, render: (e) => <span className="flex items-center gap-2"><Badge tone="accent">{e.type}</Badge><span className="truncate text-sm">{truncate(e.downloadName, 48)}</span></span> },
    { key: 'pid', header: 'Public ID', render: (e) => (e.publicId ? <Link to={`/admin/downloads?id=${e.publicId}`} className="font-mono text-xs text-accent-600 hover:underline" onClick={(ev) => ev.stopPropagation()}>{e.publicId}</Link> : <span className="text-gray-400">–</span>) },
    { key: 'src', header: 'Source', render: (e) => <Badge tone={e.source === 'webhook' ? 'success' : 'neutral'}>{e.source}</Badge> },
    { key: 'up', header: 'Upstream', render: (e) => <span className="text-xs text-gray-500">{ups.data?.items.find((u) => u.id === e.upstreamAccountId)?.label ?? e.upstreamAccountId ?? '–'}</span>, hideOnMobile: true },
  ];
  return (
    <div>
      <PageHeader title="Events" description="Download lifecycle events from TorBox webhooks and the reconciler — the source for consumer webhooks and /api/v1/events." />
      <FilterBar
        activeCount={countActive(params)}
        onReset={reset}
        cols={4}
        actions={
          <>
            <Button variant="outline" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={() => window.open(api.events.exportUrl(filtersOnly, 'csv'), '_blank')}>
              Export CSV
            </Button>
            <Button variant="outline" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={() => window.open(api.events.exportUrl(filtersOnly, 'json'), '_blank')}>
              Export JSON
            </Button>
            {isOwner && (
              <Button variant="danger" size="sm" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setClear(true)}>
                Clear events
              </Button>
            )}
          </>
        }
      >
        <div className="col-span-2">
          <DateRangePicker from={params.from} to={params.to} onChange={(v) => set({ from: v.from, to: v.to })} presets={false} />
        </div>
        <Input label="Type" placeholder="download.completed" value={params.type ?? ''} onChange={(e) => set({ type: e.target.value })} />
        <Input label="Public ID" value={params.publicId ?? ''} onChange={(e) => set({ publicId: e.target.value })} />
        <Select label="Upstream" value={params.upstreamId ?? ''} onChange={(e) => set({ upstreamId: e.target.value })}>
          <option value="">All accounts</option>
          {ups.data?.items.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </Select>
      </FilterBar>
      <DataTable columns={cols} rows={q.data?.items} rowKey={(e) => e.id} loading={q.isLoading} onRowClick={setSel} dense emptyTitle="No events" emptyDescription="Enable the TorBox webhook on an upstream account to receive events in real time." pagination={{ page, limit, total: q.data?.total ?? 0, onPage: (p) => set({ page: p }, false) }} />
      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel?.type} description={sel ? `${date(sel.ts)} · ${sel.source}` : undefined}>
        {sel && (
          <div className="space-y-4">
            {sel.downloadName && <p className="text-sm font-medium">{sel.downloadName}</p>}
            <JsonView value={sel.payload} />
          </div>
        )}
      </Drawer>
      <ConfirmDialog open={clear} onClose={() => setClear(false)} danger title="Clear events?" description={clearDescription} confirmLabel="Clear" onConfirm={() => del.mutateAsync(clearBody)} />
    </div>
  );
}
