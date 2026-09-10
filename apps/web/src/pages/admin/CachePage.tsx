import { useState } from 'react';
import { Database, Percent, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { qk, useApiMutation, useCacheStats, useUpstreams } from '../../lib/queries';
import { bytes, num, pct } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, Select, SkeletonCard, StatTile, type Column } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';

type Group = NonNullable<ReturnType<typeof useCacheStats>['data']>['byGroup'][number];

export function CachePage() {
  const stats = useCacheStats();
  const ups = useUpstreams();
  const { canWrite } = useAuth();
  const [purge, setPurge] = useState<{ group?: string; upstreamId?: string } | null>(null);
  const [upstreamSel, setUpstreamSel] = useState('');
  const m = useApiMutation((b: { group?: string; upstreamId?: string }) => api.cache.purge(b), { invalidate: [qk.cache], success: (r) => `Purged ${num(r.deleted)} cache entries` });
  const d = stats.data;
  const cols: Column<Group>[] = [
    { key: 'group', header: 'Route group', primary: true, render: (g) => <span className="font-mono text-xs">{g.group}</span> },
    { key: 'entries', header: 'Entries', align: 'right', render: (g) => <span className="tabular-nums">{num(g.entries)}</span> },
    { key: 'hits', header: 'Hits', align: 'right', render: (g) => <span className="tabular-nums">{num(g.hits)}</span> },
    { key: 'misses', header: 'Misses', align: 'right', render: (g) => <span className="tabular-nums">{num(g.misses)}</span> },
    { key: 'rate', header: 'Hit rate', align: 'right', render: (g) => <span className="tabular-nums">{g.hits + g.misses ? pct((g.hits / (g.hits + g.misses)) * 100, 0) : '–'}</span> },
  ];
  return (
    <div>
      <PageHeader
        title="Cache"
        description="Responses cached in front of TorBox to save its rate limits. Purge when consumers need fresh data."
        actions={
          canWrite && (
            <Button variant="danger" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setPurge({})}>
              Purge everything
            </Button>
          )
        }
      />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.isLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <StatTile label="Entries" value={num(d?.entries)} icon={<Database className="h-5 w-5" />} tone="accent" />
            <StatTile label="Size" value={bytes(d?.bytes)} icon={<Database className="h-5 w-5" />} />
            <StatTile label="Hit rate (24h)" value={pct(d?.hitRate24h)} icon={<Percent className="h-5 w-5" />} tone="success" />
          </>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold">By route group</h3>
          <DataTable columns={cols} rows={d?.byGroup} rowKey={(g) => g.group} loading={stats.isLoading} emptyTitle="Cache is empty" actions={(g) => (canWrite ? <Button size="sm" variant="outline" onClick={() => setPurge({ group: g.group })}>Purge</Button> : null)} />
        </div>
        <Card>
          <CardHeader title="Purge by upstream" description="Drop cached responses that came from one TorBox account." />
          <CardBody className="space-y-3">
            <Select label="Upstream account" value={upstreamSel} onChange={(e) => setUpstreamSel(e.target.value)}>
              <option value="">Select…</option>
              {ups.data?.items.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </Select>
            <Button variant="outline" disabled={!upstreamSel || !canWrite} onClick={() => setPurge({ upstreamId: upstreamSel })} className="w-full">
              Purge for this account
            </Button>
          </CardBody>
        </Card>
      </div>
      <ConfirmDialog open={!!purge} onClose={() => setPurge(null)} danger title="Purge cache?" description={purge?.group ? `All cached entries in group "${purge.group}" will be removed.` : purge?.upstreamId ? 'All cached entries for the selected upstream account will be removed.' : 'The entire response cache will be cleared. Consumers will hit TorBox directly until it warms up again.'} confirmLabel="Purge" onConfirm={() => m.mutateAsync(purge ?? {})} />
    </div>
  );
}
