import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdmins, useAudit } from '../../lib/queries';
import type { AuditEntry } from '../../lib/types';
import { useQueryParams } from '../../lib/hooks/useQueryParams';
import { date, time } from '../../lib/format';
import { Badge, DataTable, DateRangePicker, Drawer, Input, JsonView, Select, type Column } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';
import { FilterBar, countActive } from '../../components/admin/FilterBar';

function flatten(v: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (v === null || v === undefined) return out;
  if (typeof v !== 'object' || Array.isArray(v)) {
    out[prefix || '(value)'] = JSON.stringify(v);
    return out;
  }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (val && typeof val === 'object' && !Array.isArray(val)) flatten(val, key, out);
    else out[key] = JSON.stringify(val);
  }
  return out;
}

const ID_LIKE = /^(?:[0-9a-f]{24}|[A-Za-z0-9_-]{8,32})$/;
const TARGET_ROUTES: Array<{ prefix: string; to: (target: string) => string; needsId: boolean }> = [
  { prefix: 'keys.', to: (t) => `/admin/keys/${encodeURIComponent(t)}`, needsId: true },
  { prefix: 'clients.', to: (t) => `/admin/clients/${encodeURIComponent(t)}`, needsId: true },
  { prefix: 'downloads.', to: (t) => `/admin/downloads?id=${encodeURIComponent(t)}`, needsId: true },
  { prefix: 'policies.', to: () => '/admin/policies', needsId: false },
  { prefix: 'upstreams.', to: () => '/admin/upstreams', needsId: false },
  { prefix: 'webhooks.', to: () => '/admin/webhooks', needsId: false },
  { prefix: 'admins.', to: () => '/admin/admins', needsId: false },
];

/** Where an audit target can be opened in the dashboard, if anywhere. */
export function auditTargetHref(action: string, target: string | null | undefined): string | null {
  if (!target) return null;
  const r = TARGET_ROUTES.find((x) => action.startsWith(x.prefix));
  if (!r) return null;
  if (r.needsId && !ID_LIKE.test(target)) return null;
  return r.to(target);
}

function AuditTarget({ entry, className }: { entry: AuditEntry; className?: string }) {
  if (!entry.target) return null;
  const href = auditTargetHref(entry.action, entry.target);
  if (!href) return <span className={className}>{entry.target}</span>;
  return (
    <Link to={href} className={`${className ?? ''} text-accent-600 hover:underline`} onClick={(e) => e.stopPropagation()} title={`Open ${entry.target}`}>
      {entry.target}
    </Link>
  );
}

export function DiffView({ before, after }: { before: unknown; after: unknown }) {
  const rows = useMemo(() => {
    const b = flatten(before);
    const a = flatten(after);
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
    return keys.map((k) => ({ k, b: b[k], a: a[k], changed: b[k] !== a[k] }));
  }, [before, after]);
  if (!rows.length) return <p className="text-sm text-gray-500">No structured before/after data.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 text-xs dark:border-gray-800">
      <table className="w-full">
        <thead className="bg-gray-50 text-left dark:bg-gray-950/60">
          <tr>
            <th className="px-3 py-2 font-semibold">Field</th>
            <th className="px-3 py-2 font-semibold">Before</th>
            <th className="px-3 py-2 font-semibold">After</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((r) => (
            <tr key={r.k} className={r.changed ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}>
              <td className="px-3 py-1.5 align-top font-mono">{r.k}</td>
              <td className={`max-w-[200px] break-all px-3 py-1.5 align-top font-mono ${r.changed ? 'text-red-700 line-through dark:text-red-400' : 'text-gray-500'}`}>{r.b ?? '–'}</td>
              <td className={`max-w-[200px] break-all px-3 py-1.5 align-top font-mono ${r.changed ? 'text-green-700 dark:text-green-400' : 'text-gray-500'}`}>{r.a ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditPage() {
  const { params, set, reset, page } = useQueryParams<{ adminId?: string; action?: string; from?: string; to?: string; page?: string }>();
  const limit = 50;
  const q = useAudit({ adminId: params.adminId, action: params.action, from: params.from, to: params.to, page, limit });
  const admins = useAdmins();
  const [sel, setSel] = useState<AuditEntry | null>(null);
  const cols: Column<AuditEntry>[] = [
    { key: 'ts', header: 'Time', render: (a) => <span className="whitespace-nowrap tabular-nums text-gray-600 dark:text-gray-400" title={date(a.ts)}>{time(a.ts)}</span>, width: '110px' },
    { key: 'action', header: 'Action', primary: true, render: (a) => <span className="flex min-w-0 items-center gap-2"><Badge tone="accent">{a.action}</Badge><AuditTarget entry={a} className="truncate font-mono text-xs text-gray-500" /></span> },
    { key: 'admin', header: 'Admin', render: (a) => <span className="truncate text-sm">{a.adminEmail}</span> },
    { key: 'ip', header: 'IP', render: (a) => <span className="font-mono text-xs">{a.ip}</span>, hideOnMobile: true },
  ];
  return (
    <div>
      <PageHeader title="Audit log" description="Every change made through this dashboard, with before/after snapshots." />
      <FilterBar activeCount={countActive(params)} onReset={reset} cols={4}>
        <div className="col-span-2">
          <DateRangePicker from={params.from} to={params.to} onChange={(v) => set({ from: v.from, to: v.to })} presets={false} />
        </div>
        <Select label="Admin" value={params.adminId ?? ''} onChange={(e) => set({ adminId: e.target.value })}>
          <option value="">Anyone</option>
          {admins.data?.items.map((a) => (
            <option key={a.id} value={a.id}>
              {a.email}
            </option>
          ))}
        </Select>
        <Input label="Action" placeholder="key.create, settings.update…" value={params.action ?? ''} onChange={(e) => set({ action: e.target.value })} />
      </FilterBar>
      <DataTable columns={cols} rows={q.data?.items} rowKey={(a) => a.id} loading={q.isLoading} onRowClick={setSel} dense emptyTitle="No audit entries" pagination={{ page, limit, total: q.data?.total ?? 0, onPage: (p) => set({ page: p }, false) }} />
      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel?.action} description={sel ? `${sel.adminEmail} · ${date(sel.ts)} · ${sel.ip}` : undefined} width="xl">
        {sel && (
          <div className="space-y-5">
            {sel.target && (
              <p className="font-mono text-xs">
                target: <AuditTarget entry={sel} />
              </p>
            )}
            <div>
              <p className="label">Changes</p>
              <DiffView before={sel.before} after={sel.after} />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <p className="label">Before</p>
                <JsonView value={sel.before ?? null} maxHeight="300px" />
              </div>
              <div>
                <p className="label">After</p>
                <JsonView value={sel.after ?? null} maxHeight="300px" />
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
