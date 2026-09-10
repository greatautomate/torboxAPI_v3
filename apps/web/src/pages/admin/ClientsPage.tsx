import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MoreHorizontal, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useApiMutation, useClient, useClients, usePolicies } from '../../lib/queries';
import type { ApiKey, Client, ClientStatus } from '../../lib/types';
import { useQueryParams } from '../../lib/hooks/useQueryParams';
import { useDebounce } from '../../lib/hooks/useDebounce';
import { date, dateShort, num, relative } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, DescriptionList, EmptyState, ErrorState, Input, Menu, Modal, Select, SkeletonCard, SkeletonText, StatTile, StatusBadge, Textarea, type Column } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';
import { AreaSeriesChart, CHART } from '../../components/admin/charts';
import { useEffect } from 'react';

interface ClientForm {
  name: string;
  contactEmail: string;
  notes: string;
  defaultPolicyId: string;
  status: ClientStatus;
}
const empty: ClientForm = { name: '', contactEmail: '', notes: '', defaultPolicyId: '', status: 'active' };

export function ClientFormModal({ item, open, onClose }: { item: Client | null; open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<ClientForm>(empty);
  const policies = usePolicies();
  useEffect(() => {
    if (open) setForm(item ? { name: item.name, contactEmail: item.contactEmail ?? '', notes: item.notes ?? '', defaultPolicyId: item.defaultPolicyId ?? '', status: item.status } : empty);
  }, [item, open]);
  const create = useApiMutation((b: ClientForm) => api.clients.create({ name: b.name, contactEmail: b.contactEmail || undefined, notes: b.notes || undefined, defaultPolicyId: b.defaultPolicyId || undefined }), {
    invalidate: [['clients']],
    success: 'Client created',
    onSuccess: onClose,
  });
  const update = useApiMutation((b: ClientForm) => api.clients.update(item!.id, { name: b.name, contactEmail: b.contactEmail, notes: b.notes, defaultPolicyId: b.defaultPolicyId || null, status: b.status }), {
    invalidate: [['clients']],
    success: 'Client updated',
    onSuccess: onClose,
  });
  const busy = create.isPending || update.isPending;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? `Edit ${item.name}` : 'New client'}
      description="A client is a consumer of your gateway — a person, app or team — that owns one or more API keys."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="client-form" loading={busy} disabled={!form.name.trim()}>
            {item ? 'Save' : 'Create client'}
          </Button>
        </>
      }
    >
      <form
        id="client-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          item ? update.mutate(form) : create.mutate(form);
        }}
      >
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-autofocus />
        <Input label="Contact email" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
        <Select label="Default policy" value={form.defaultPolicyId} onChange={(e) => setForm({ ...form, defaultPolicyId: e.target.value })} hint="Pre-selected when creating keys for this client.">
          <option value="">Gateway default</option>
          {policies.data?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </Select>
        {item && (
          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ClientStatus })} hint="Suspending a client blocks all of its keys.">
            <option value="active">active</option>
            <option value="suspended">suspended</option>
          </Select>
        )}
        <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
      </form>
    </Modal>
  );
}

export function ClientsPage() {
  const { params, set, page } = useQueryParams<{ q?: string; page?: string }>();
  const [q, setQ] = useState(params.q ?? '');
  const dq = useDebounce(q, 300);
  useEffect(() => {
    if ((dq || undefined) !== params.q) set({ q: dq || undefined });
  }, [dq, params.q, set]);
  const limit = 50;
  const clients = useClients({ q: params.q, page, limit });
  const nav = useNavigate();
  const { canWrite } = useAuth();
  const [modal, setModal] = useState<{ open: boolean; item: Client | null }>({ open: false, item: null });
  const [del, setDel] = useState<Client | null>(null);
  const [resetTarget, setResetTarget] = useState<Client | null>(null);
  const policies = usePolicies();
  const policyName = (id: string | null) => (id ? policies.data?.items.find((p) => p.id === id)?.name ?? id : null);
  const remove = useApiMutation((id: string) => api.clients.remove(id), { invalidate: [['clients'], ['keys']], success: 'Client deleted and its keys revoked' });
  const resetUsage = useApiMutation((id: string) => api.clients.resetUsage(id), { invalidate: [['clients'], ['keys'], ['analytics']], success: (r) => `Usage counters reset for ${num(r.keys)} key${r.keys === 1 ? '' : 's'}` });

  const columns: Column<Client>[] = [
    {
      key: 'name',
      header: 'Client',
      primary: true,
      render: (c) => (
        <span className="block min-w-0">
          <Link to={`/admin/clients/${c.id}`} className="block truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {c.name}
          </Link>
          <span className="block truncate text-xs text-gray-500">{c.contactEmail ?? '–'}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
    { key: 'policy', header: 'Default policy', render: (c) => (c.defaultPolicyId ? <span className="truncate text-xs" title={c.defaultPolicyId}>{policyName(c.defaultPolicyId)}</span> : <span className="text-xs text-gray-400">Gateway default</span>), hideOnMobile: true },
    { key: 'keys', header: 'Keys', align: 'right', render: (c) => <span className="tabular-nums">{num(c.keysCount)}</span> },
    { key: 'req', header: 'Requests (30d)', align: 'right', render: (c) => <span className="tabular-nums">{num(c.requests30d)}</span> },
    { key: 'created', header: 'Created', render: (c) => <span className="text-xs text-gray-500">{date(c.createdAt, { dateStyle: 'medium' })}</span>, hideOnMobile: true },
  ];

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Consumers of your gateway. Each client owns keys and can have a default policy."
        actions={
          canWrite && (
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setModal({ open: true, item: null })}>
              New client
            </Button>
          )
        }
      />
      <div className="mb-4 max-w-md">
        <Input aria-label="Search clients" placeholder="Search by name or email…" value={q} onChange={(e) => setQ(e.target.value)} leftIcon={<Search className="h-4 w-4" />} />
      </div>
      <DataTable
        columns={columns}
        rows={clients.data?.items}
        rowKey={(c) => c.id}
        loading={clients.isLoading}
        onRowClick={(c) => nav(`/admin/clients/${c.id}`)}
        empty={<EmptyState title="No clients" description="Create a client, then issue API keys for it." action={canWrite && <Button onClick={() => setModal({ open: true, item: null })}>New client</Button>} />}
        actions={(c) =>
          canWrite && (
            <Menu
              trigger={
                <Button variant="ghost" size="icon" aria-label={`Actions for ${c.name}`}>
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              }
              items={[
                { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onClick: () => setModal({ open: true, item: c }) },
                { label: 'Create key', icon: <Plus className="h-4 w-4" />, onClick: () => nav(`/admin/keys/new?clientId=${c.id}`) },
                { label: 'Reset usage counters', icon: <RotateCcw className="h-4 w-4" />, onClick: () => setResetTarget(c), disabled: !c.keysCount },
                { divider: true, label: '' },
                { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => setDel(c) },
              ]}
            />
          )
        }
        pagination={{ page, limit, total: clients.data?.total ?? 0, onPage: (p) => set({ page: p }, false) }}
      />
      <ClientFormModal open={modal.open} item={modal.item} onClose={() => setModal({ open: false, item: null })} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger title={`Delete ${del?.name}?`} description={`All ${del?.keysCount ?? 0} keys owned by this client will be revoked immediately.`} confirmLabel="Delete client" onConfirm={() => remove.mutateAsync(del!.id)} />
      <ConfirmDialog
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title={`Reset usage counters for ${resetTarget?.name}?`}
        description={`This resets the current month's quota counters (requests and creates) to zero for all ${resetTarget?.keysCount ?? 0} keys owned by this client. Rate-limit buckets and historical analytics are not affected.`}
        confirmLabel="Reset counters"
        onConfirm={() => resetUsage.mutateAsync(resetTarget!.id)}
      />
    </div>
  );
}

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const q = useClient(id);
  const nav = useNavigate();
  const { canWrite } = useAuth();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const policies = usePolicies();
  const remove = useApiMutation((i: string) => api.clients.remove(i), { invalidate: [['clients'], ['keys']], success: 'Client deleted', onSuccess: () => nav('/admin/clients') });
  const resetUsage = useApiMutation((i: string) => api.clients.resetUsage(i), { invalidate: [['clients'], ['keys'], ['analytics']], success: (r) => `Usage counters reset for ${num(r.keys)} key${r.keys === 1 ? '' : 's'}` });
  const d = q.data;
  const defaultPolicy = d?.client.defaultPolicyId ? policies.data?.items.find((p) => p.id === d.client.defaultPolicyId) : undefined;

  const keyCols: Column<ApiKey>[] = [
    {
      key: 'name',
      header: 'Key',
      primary: true,
      render: (k) => (
        <Link to={`/admin/keys/${k.id}`} className="block min-w-0 hover:underline">
          <span className="block truncate font-medium">{k.name}</span>
          <span className="block font-mono text-xs text-gray-500">
            {k.prefix}…{k.last4}
          </span>
        </Link>
      ),
    },
    { key: 'status', header: 'Status', render: (k) => <StatusBadge status={k.status} /> },
    { key: 'policy', header: 'Policy', render: (k) => k.policyName ?? '–', hideOnMobile: true },
    { key: 'req', header: 'Requests (30d)', align: 'right', render: (k) => <span className="tabular-nums">{num(k.requests30d)}</span> },
    { key: 'used', header: 'Last used', render: (k) => <span className="text-xs text-gray-500">{relative(k.lastUsedAt)}</span> },
  ];

  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />;
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Clients', to: '/admin/clients' }, { label: d?.client.name ?? '…' }]}
        title={d ? d.client.name : <SkeletonText lines={1} className="w-48" />}
        description={d?.client.contactEmail ?? undefined}
        actions={
          canWrite &&
          d && (
            <>
              <Button variant="outline" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>
                Edit
              </Button>
              <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => nav(`/admin/keys/new?clientId=${d.client.id}`)}>
                New key
              </Button>
              <Button variant="outline" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={() => setResetOpen(true)} disabled={!d.keys.length}>
                Reset usage
              </Button>
              <Button variant="danger" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setDel(true)}>
                Delete
              </Button>
            </>
          )
        }
      />
      {q.isLoading || !d ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Status" value={<StatusBadge status={d.client.status} />} />
            <StatTile label="Keys" value={num(d.client.keysCount)} />
            <StatTile label="Requests this month" value={num(d.usage.month.requests)} />
            <StatTile label="Creates this month" value={num(d.usage.month.creates)} hint="downloads submitted" />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Daily usage" description="Requests and errors per day" />
              <CardBody>
                <AreaSeriesChart data={d.usage.daily} xKey="d" xFormatter={dateShort} series={[{ key: 'requests', name: 'Requests', color: CHART.ok }, { key: 'errors', name: 'Errors', color: CHART.error }]} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Details" />
              <CardBody>
                <DescriptionList
                  cols={1}
                  items={[
                    { label: 'Contact', value: d.client.contactEmail ?? '–' },
                    { label: 'Default policy', value: d.client.defaultPolicyId ? <Link to="/admin/policies" className="text-accent-600 hover:underline" title={d.client.defaultPolicyId}>{defaultPolicy?.name ?? d.client.defaultPolicyId}</Link> : 'Gateway default' },
                    { label: 'Created', value: date(d.client.createdAt) },
                    { label: 'Notes', value: d.client.notes ? <span className="whitespace-pre-wrap">{d.client.notes}</span> : '–' },
                  ]}
                />
              </CardBody>
            </Card>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">
              API keys <Badge className="ml-1">{d.keys.length}</Badge>
            </h3>
            <DataTable columns={keyCols} rows={d.keys} rowKey={(k) => k.id} onRowClick={(k) => nav(`/admin/keys/${k.id}`)} empty={<EmptyState title="No keys yet" action={canWrite && <Button onClick={() => nav(`/admin/keys/new?clientId=${d.client.id}`)}>Create the first key</Button>} />} />
          </div>
        </div>
      )}
      <ClientFormModal open={edit} item={d?.client ?? null} onClose={() => (setEdit(false), q.refetch())} />
      <ConfirmDialog open={del} onClose={() => setDel(false)} danger title={`Delete ${d?.client.name}?`} description="All keys of this client will be revoked." confirmLabel="Delete client" onConfirm={() => remove.mutateAsync(id)} />
      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={`Reset usage counters for ${d?.client.name}?`}
        description={`This resets the current month's quota counters (requests and creates) to zero for all ${d?.keys.length ?? 0} keys owned by this client. Rate-limit buckets and historical analytics are not affected.`}
        confirmLabel="Reset counters"
        onConfirm={() => resetUsage.mutateAsync(id)}
      />
    </div>
  );
}
