import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Trash2 } from 'lucide-react';
import { api, type Query } from '../../lib/api';
import { useActivity, useAllClients, useAllKeys, useApiMutation } from '../../lib/queries';
import type { Activity, ActivityKind } from '../../lib/types';
import { date, middleTruncate, num, time, truncate } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Badge, Button, ConfirmDialog, CopyButton, CopyField, DataTable, DateRangePicker, DescriptionList, Drawer, Input, JsonView, Select, Tabs, type Column } from '../ui';
import { FilterBar, countActive } from './FilterBar';
import { useFilters } from './useFilters';

const FILTER_KEYS = ['kind', 'keyId', 'clientId', 'publicId', 'type', 'hash', 'from', 'to', 'q'];
const KIND_TABS: Array<{ key: '' | ActivityKind; label: string }> = [
  { key: '', label: 'All' },
  { key: 'submit', label: 'Submitted links' },
  { key: 'link', label: 'Generated links' },
  { key: 'stream', label: 'Streams' },
  { key: 'control', label: 'Control' },
  { key: 'edit', label: 'Edits' },
];
const kindTone: Record<ActivityKind, 'accent' | 'success' | 'info' | 'warning' | 'neutral'> = { submit: 'accent', link: 'success', stream: 'info', control: 'warning', edit: 'neutral' };

export function activitySummary(a: Activity): string {
  switch (a.kind) {
    case 'submit':
      return a.input?.magnet ?? a.input?.url ?? a.input?.nzbUrl ?? a.input?.fileName ?? a.name ?? '';
    case 'link':
      return a.output?.cdnUrl ?? a.output?.permalink ?? a.name ?? '';
    case 'stream':
      return a.output?.hlsUrl ?? a.name ?? '';
    default:
      return a.action ?? a.name ?? (typeof a.detail === 'string' ? a.detail : '');
  }
}

export function ActivityView({ fixed = {}, embedded = false }: { fixed?: Partial<Record<string, string>>; embedded?: boolean }) {
  const f = useFilters(embedded);
  const { params, set, reset, page, limit } = f;
  const { isOwner } = useAuth();
  const filtersOnly: Query = useMemo(() => {
    const q: Query = {};
    for (const k of FILTER_KEYS) if (params[k]) q[k] = params[k];
    Object.assign(q, fixed);
    return q;
  }, [params, fixed]);
  const query: Query = useMemo(() => ({ ...filtersOnly, page, limit }), [filtersOnly, page, limit]);

  const act = useActivity(query);
  const keys = useAllKeys();
  const clients = useAllClients();
  const [selected, setSelected] = useState<Activity | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const clear = useApiMutation((b: Parameters<typeof api.activity.clear>[0]) => api.activity.clear(b), { invalidate: [['activity']], success: (d) => `Deleted ${num(d.deleted)} activity entries` });

  const openClear = async () => {
    setCounting(true);
    setClearOpen(true);
    try {
      setCount((await api.activity.count(filtersOnly)).count);
    } catch {
      setCount(null);
    } finally {
      setCounting(false);
    }
  };
  const doClear = async () => {
    const hasFilter = Object.keys(filtersOnly).length > 0;
    await clear.mutateAsync(hasFilter ? { kind: filtersOnly.kind as string | undefined, keyId: filtersOnly.keyId as string | undefined, clientId: filtersOnly.clientId as string | undefined, from: filtersOnly.from as string | undefined, to: filtersOnly.to as string | undefined } : { all: true });
  };

  const columns: Column<Activity>[] = [
    { key: 'ts', header: 'Time', render: (r) => <span className="whitespace-nowrap tabular-nums text-gray-600 dark:text-gray-400">{time(r.ts)}</span>, width: '110px' },
    { key: 'kind', header: 'Kind', render: (r) => <Badge tone={kindTone[r.kind]}>{r.kind}</Badge>, width: '90px' },
    {
      key: 'what',
      header: 'Detail',
      primary: true,
      render: (r) => {
        const s = activitySummary(r);
        const isUrl = /^(https?:|magnet:)/i.test(s);
        return (
          <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 truncate font-mono text-xs" title={s}>
              {r.kind === 'link' || r.kind === 'stream' ? middleTruncate(s, 56) : truncate(s, 72)}
            </span>
            {isUrl && <CopyButton text={s} className="h-7 min-w-[28px] px-1" label="" />}
            {r.kind === 'link' && r.output?.zip && <Badge>zip</Badge>}
            {r.kind === 'link' && r.output?.fileId !== undefined && <Badge>file {String(r.output.fileId)}</Badge>}
          </span>
        );
      },
    },
    { key: 'name', header: 'Name', render: (r) => <span className="truncate text-xs" title={r.name ?? ''}>{truncate(r.name, 40) || '–'}</span>, hideOnMobile: true },
    { key: 'type', header: 'Type', render: (r) => <span className="text-xs text-gray-500">{r.type ?? '–'}</span>, width: '80px' },
    ...(fixed.keyId ? [] : [{ key: 'key', header: 'Key', render: (r: Activity) => (r.keyId ? <Link to={`/admin/keys/${r.keyId}`} className="text-accent-600 hover:underline" onClick={(e) => e.stopPropagation()}>{r.keyName ?? r.keyId}</Link> : <span className="text-gray-400">–</span>) }]),
    { key: 'ok', header: 'Result', render: (r) => (r.success ? <Badge tone="success">ok</Badge> : <Badge tone="danger">{r.error ?? 'failed'}</Badge>), width: '90px' },
  ];

  const kind = (params.kind ?? '') as '' | ActivityKind;
  const active = countActive(params, ['page', 'limit', 'kind']);
  const actions = (
    <>
      <Button variant="outline" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={() => window.open(api.activity.exportUrl(filtersOnly, 'csv'), '_blank')}>
        CSV
      </Button>
      <Button variant="outline" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={() => window.open(api.activity.exportUrl(filtersOnly, 'json'), '_blank')}>
        JSON
      </Button>
      {isOwner && (
        <Button variant="danger" size="sm" leftIcon={<Trash2 className="h-4 w-4" />} onClick={openClear}>
          Clear
        </Button>
      )}
    </>
  );

  return (
    <div>
      <Tabs items={KIND_TABS.map((t) => ({ key: t.key, label: t.label }))} value={kind} onChange={(k) => set({ kind: k || undefined })} className="mb-4" />
      <FilterBar activeCount={active} onReset={reset} actions={actions} cols={4}>
        <div className="col-span-2">
          <DateRangePicker from={params.from} to={params.to} onChange={(v) => set({ from: v.from, to: v.to })} presets={false} />
        </div>
        <Input label="Search" placeholder="name, url, magnet…" value={params.q ?? ''} onChange={(e) => set({ q: e.target.value })} />
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
        {!fixed.keyId && !fixed.clientId && (
          <Select label="Client" value={params.clientId ?? ''} onChange={(e) => set({ clientId: e.target.value })}>
            <option value="">All clients</option>
            {clients.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Select label="Type" value={params.type ?? ''} onChange={(e) => set({ type: e.target.value })}>
          <option value="">Any type</option>
          <option value="torrent">torrent</option>
          <option value="usenet">usenet</option>
          <option value="webdl">webdl</option>
        </Select>
        {!fixed.publicId && <Input label="Public ID" value={params.publicId ?? ''} onChange={(e) => set({ publicId: e.target.value })} />}
        <Input label="Hash" value={params.hash ?? ''} onChange={(e) => set({ hash: e.target.value })} />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={act.data?.items}
        rowKey={(r) => r.id}
        loading={act.isLoading || act.isFetching}
        onRowClick={setSelected}
        dense
        emptyTitle="No activity"
        emptyDescription="Submitted links, generated CDN links, streams and control actions will show up here."
        pagination={{ page, limit, total: act.data?.total ?? 0, onPage: (p) => set({ page: p }, false), onLimit: (l) => set({ limit: l }) }}
      />

      <ActivityDrawer item={selected} onClose={() => setSelected(null)} />

      <ConfirmDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={doClear}
        danger
        title="Clear activity?"
        confirmLabel={count !== null ? `Delete ${num(count)} entries` : 'Delete'}
        loading={counting}
        description={counting ? 'Counting matching entries…' : count === null ? 'Could not count matching entries. Continue anyway?' : `${num(count)} activity ${count === 1 ? 'entry' : 'entries'} match the current filters and will be permanently deleted.`}
      />
    </div>
  );
}

export function ActivityDrawer({ item, onClose }: { item: Activity | null; onClose: () => void }) {
  return (
    <Drawer open={!!item} onClose={onClose} title={item ? `${item.kind} · ${item.name ?? item.publicId ?? ''}` : ''} description={item ? date(item.ts, { dateStyle: 'medium', timeStyle: 'medium' }) : undefined}>
      {item && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Badge tone={kindTone[item.kind]}>{item.kind}</Badge>
            {item.type && <Badge>{item.type}</Badge>}
            {item.success ? <Badge tone="success">success</Badge> : <Badge tone="danger">{item.error ?? 'failed'}</Badge>}
            {item.action && <Badge tone="warning">{item.action}</Badge>}
          </div>
          {item.kind === 'submit' && item.input && (
            <div className="space-y-3">
              {item.input.magnet && <CopyField label="Magnet" value={item.input.magnet} />}
              {item.input.url && <CopyField label="URL" value={item.input.url} />}
              {item.input.nzbUrl && <CopyField label="NZB URL" value={item.input.nzbUrl} />}
              {item.input.fileName && <DescriptionList items={[{ label: 'File', value: item.input.fileName }, { label: 'Size', value: item.input.fileSize ? `${item.input.fileSize} bytes` : '–' }]} />}
            </div>
          )}
          {(item.kind === 'link' || item.kind === 'stream') && item.output && (
            <div className="space-y-3">
              {item.output.cdnUrl && <CopyField label="CDN URL" value={item.output.cdnUrl} />}
              {item.output.permalink && <CopyField label="Permalink" value={item.output.permalink} />}
              {item.output.hlsUrl && <CopyField label="HLS URL" value={item.output.hlsUrl} />}
              <DescriptionList
                items={[
                  { label: 'File ID', value: item.output.fileId !== undefined ? String(item.output.fileId) : '–' },
                  { label: 'Zip', value: item.output.zip ? 'yes' : 'no' },
                  { label: 'Expires', value: date(item.output.expiresAt) },
                ]}
                cols={3}
              />
            </div>
          )}
          <DescriptionList
            items={[
              { label: 'Key', value: item.keyId ? <Link to={`/admin/keys/${item.keyId}`} className="text-accent-600 hover:underline">{item.keyName ?? item.keyId}</Link> : '–' },
              { label: 'Client', value: item.clientId ? <Link to={`/admin/clients/${item.clientId}`} className="text-accent-600 hover:underline">{item.clientName ?? item.clientId}</Link> : '–' },
              { label: 'Public ID', value: item.publicId ? <Link to={`/admin/downloads?q=${item.publicId}`} className="font-mono text-xs text-accent-600 hover:underline">{item.publicId}</Link> : '–' },
              { label: 'TorBox ID', value: item.torboxId !== null ? String(item.torboxId) : '–' },
              { label: 'Hash', value: item.hash ? <span className="break-all font-mono text-xs">{item.hash}</span> : '–', full: true },
              { label: 'IP', value: item.ip ?? '–' },
              { label: 'Upstream account', value: item.upstreamAccountId ?? '–' },
            ]}
          />
          {item.detail && (
            <div>
              <p className="label">Detail</p>
              <JsonView value={item.detail} maxHeight="200px" />
            </div>
          )}
          <div>
            <p className="label">Raw</p>
            <JsonView value={item} maxHeight="320px" />
          </div>
        </div>
      )}
    </Drawer>
  );
}
