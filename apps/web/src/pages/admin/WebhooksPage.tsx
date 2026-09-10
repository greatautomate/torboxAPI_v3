import { useEffect, useState } from 'react';
import { ChevronDown, MoreHorizontal, Pencil, Plus, RefreshCw, RotateCcw, Send, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { qk, useAllClients, useAllKeys, useApiMutation, useDeliveries, useInbound, useWebhooks } from '../../lib/queries';
import type { WebhookDelivery, WebhookEndpoint } from '../../lib/types';
import { useQueryParams } from '../../lib/hooks/useQueryParams';
import { date, num, relative, splitList } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, CopyField, DataTable, EmptyState, Input, JsonView, Menu, Modal, Select, SkeletonText, StatusBadge, Switch, Tabs, Textarea, type Column } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';
import { SecretReveal } from '../../components/admin/SecretReveal';

const EVENT_TYPES = ['download.created', 'download.progress', 'download.completed', 'download.failed', 'download.deleted', 'download.expired', 'link.generated', 'key.quota_warning', 'key.suspended'];

export function WebhooksPage() {
  const { params, set } = useQueryParams<{ tab?: string; endpointId?: string; status?: string; page?: string }>();
  const tab = (params.tab as 'endpoints' | 'deliveries' | 'inbound') || 'endpoints';
  return (
    <div>
      <PageHeader title="Webhooks" description="Outbound endpoints your consumers receive signed events on, delivery history, and the inbound hook TorBox calls." />
      <Tabs items={[{ key: 'endpoints', label: 'Endpoints' }, { key: 'deliveries', label: 'Deliveries' }, { key: 'inbound', label: 'Inbound (TorBox)' }]} value={tab} onChange={(t) => set({ tab: t, page: undefined })} className="mb-4" />
      {tab === 'endpoints' && <Endpoints onDeliveries={(id) => set({ tab: 'deliveries', endpointId: id })} />}
      {tab === 'deliveries' && <Deliveries />}
      {tab === 'inbound' && <Inbound />}
    </div>
  );
}

function Endpoints({ onDeliveries }: { onDeliveries: (id: string) => void }) {
  const wh = useWebhooks();
  const { canWrite } = useAuth();
  const [modal, setModal] = useState<{ open: boolean; item: WebhookEndpoint | null }>({ open: false, item: null });
  const [secret, setSecret] = useState<string | null>(null);
  const [del, setDel] = useState<WebhookEndpoint | null>(null);
  const remove = useApiMutation((id: string) => api.webhooks.remove(id), { invalidate: [qk.webhooks], success: 'Endpoint deleted' });
  const test = useApiMutation((id: string) => api.webhooks.test(id), { invalidate: [['webhooks']], success: 'Test event queued' });
  const rotate = useApiMutation((id: string) => api.webhooks.rotateSecret(id), { onSuccess: (r) => setSecret(r.secret) });
  const toggle = useApiMutation((v: { id: string; active: boolean }) => api.webhooks.update(v.id, { active: v.active }), { invalidate: [qk.webhooks] });

  const columns: Column<WebhookEndpoint>[] = [
    {
      key: 'url',
      header: 'Endpoint',
      primary: true,
      render: (w) => (
        <span className="block min-w-0">
          <span className="block truncate font-mono text-xs" title={w.url}>
            {w.url}
          </span>
          <span className="block text-xs text-gray-500">
            {w.clientName}
            {w.keyId ? ' · key-scoped' : ''}
          </span>
        </span>
      ),
    },
    { key: 'active', header: 'Active', render: (w) => (canWrite ? <Switch checked={w.active} onChange={(v) => toggle.mutate({ id: w.id, active: v })} label={<span className="sr-only">Active</span>} className="min-h-0 py-0" /> : <StatusBadge status={w.active ? 'active' : 'disabled'} />) },
    { key: 'events', header: 'Events', render: (w) => <span className="flex flex-wrap gap-1">{w.events.slice(0, 3).map((e) => <Badge key={e}>{e}</Badge>)}{w.events.length > 3 && <Badge>+{w.events.length - 3}</Badge>}</span>, hideOnMobile: true },
    { key: 'fail', header: 'Failures', align: 'right', render: (w) => <span className={`tabular-nums ${w.failureCount ? 'text-red-600' : ''}`}>{num(w.failureCount)}</span> },
    { key: 'last', header: 'Last delivery', render: (w) => <span className="text-xs text-gray-500">{relative(w.lastDeliveryAt)}</span> },
    { key: 'reason', header: 'Disabled reason', render: (w) => (w.disabledReason ? <span className="text-xs text-red-600">{w.disabledReason}</span> : <span className="text-gray-400">–</span>), hideOnMobile: true },
  ];
  return (
    <div>
      <div className="mb-3 flex justify-end">
        {canWrite && (
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setModal({ open: true, item: null })}>
            Add endpoint
          </Button>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={wh.data?.items}
        rowKey={(w) => w.id}
        loading={wh.isLoading}
        empty={<EmptyState title="No webhook endpoints" description="Endpoints receive signed JSON events (X-TBG-Signature) for downloads and keys." action={canWrite && <Button onClick={() => setModal({ open: true, item: null })}>Add endpoint</Button>} />}
        actions={(w) => (
          <Menu
            trigger={
              <Button variant="ghost" size="icon" aria-label="Endpoint actions">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            }
            items={[
              { label: 'Deliveries', onClick: () => onDeliveries(w.id) },
              { label: 'Send test event', icon: <Send className="h-4 w-4" />, onClick: () => test.mutate(w.id), disabled: !canWrite },
              { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onClick: () => setModal({ open: true, item: w }), disabled: !canWrite },
              { label: 'Rotate secret', icon: <RotateCcw className="h-4 w-4" />, onClick: () => rotate.mutate(w.id), disabled: !canWrite },
              { divider: true, label: '' },
              { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => setDel(w), disabled: !canWrite },
            ]}
          />
        )}
      />
      <EndpointModal open={modal.open} item={modal.item} onClose={() => setModal({ open: false, item: null })} onSecret={setSecret} />
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Webhook signing secret" footer={<Button onClick={() => setSecret(null)}>Done</Button>}>
        {secret && <SecretReveal secret={secret} label="Signing secret" description="Use this to verify the X-TBG-Signature header (HMAC-SHA256 of the raw body). It is shown only once." />}
      </Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger title="Delete endpoint?" description={del?.url} confirmLabel="Delete" onConfirm={() => remove.mutateAsync(del!.id)} />
    </div>
  );
}

function EndpointModal({ open, item, onClose, onSecret }: { open: boolean; item: WebhookEndpoint | null; onClose: () => void; onSecret: (s: string) => void }) {
  const clients = useAllClients();
  const keys = useAllKeys();
  const [f, setF] = useState({ clientId: '', keyId: '', url: '', events: [] as string[], custom: '' });
  useEffect(() => {
    if (open) setF(item ? { clientId: item.clientId, keyId: item.keyId ?? '', url: item.url, events: item.events, custom: '' } : { clientId: '', keyId: '', url: '', events: ['download.completed', 'download.failed'], custom: '' });
  }, [open, item]);
  const create = useApiMutation((b: Parameters<typeof api.webhooks.create>[0]) => api.webhooks.create(b), {
    invalidate: [qk.webhooks],
    onSuccess: (r) => {
      onClose();
      onSecret(r.secret);
    },
  });
  const update = useApiMutation((b: Parameters<typeof api.webhooks.update>[1]) => api.webhooks.update(item!.id, b), { invalidate: [qk.webhooks], success: 'Endpoint updated', onSuccess: onClose });
  const events = [...new Set([...f.events, ...splitList(f.custom)])];
  const valid = /^https?:\/\//.test(f.url) && (!!item || !!f.clientId) && events.length > 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? 'Edit endpoint' : 'Add webhook endpoint'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} loading={create.isPending || update.isPending} onClick={() => (item ? update.mutate({ url: f.url, events, keyId: f.keyId || null }) : create.mutate({ clientId: f.clientId, keyId: f.keyId || undefined, url: f.url, events }))}>
            {item ? 'Save' : 'Create endpoint'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!item && (
          <Select label="Client" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value, keyId: '' })} required>
            <option value="">Select…</option>
            {clients.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Select label="Restrict to key (optional)" value={f.keyId} onChange={(e) => setF({ ...f, keyId: e.target.value })} hint="Only events caused by this key are delivered.">
          <option value="">All keys of the client</option>
          {keys.data?.items.filter((k) => !f.clientId || k.clientId === f.clientId).map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </Select>
        <Input label="URL" type="url" placeholder="https://example.com/hooks/torbox" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} required />
        <fieldset>
          <legend className="label">Events</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2">
            {EVENT_TYPES.map((e) => (
              <Checkbox key={e} label={<span className="font-mono text-xs">{e}</span>} checked={f.events.includes(e)} onChange={() => setF({ ...f, events: f.events.includes(e) ? f.events.filter((x) => x !== e) : [...f.events, e] })} className="min-h-[36px] py-1" />
            ))}
          </div>
          <Textarea label="Additional event types" placeholder="comma separated, e.g. download.* " value={f.custom} onChange={(e) => setF({ ...f, custom: e.target.value })} rows={2} mono />
        </fieldset>
      </div>
    </Modal>
  );
}

function Deliveries() {
  const { params, set, page } = useQueryParams<{ endpointId?: string; status?: string; page?: string }>();
  const limit = 50;
  const q = useDeliveries({ endpointId: params.endpointId, status: params.status, page, limit });
  const wh = useWebhooks();
  const { canWrite } = useAuth();
  const [sel, setSel] = useState<WebhookDelivery | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const redeliver = useApiMutation((id: string) => api.webhooks.redeliver(id), { invalidate: [['webhooks', 'deliveries']], success: 'Redelivery queued' });
  const clearBody: Parameters<typeof api.webhooks.clearDeliveries>[0] = params.endpointId || params.status ? { endpointId: params.endpointId || undefined, status: params.status || undefined } : { all: true };
  const clear = useApiMutation((b: Parameters<typeof api.webhooks.clearDeliveries>[0]) => api.webhooks.clearDeliveries(b), {
    invalidate: [['webhooks', 'deliveries']],
    success: (r) => `Deleted ${num(r.deleted)} deliver${r.deleted === 1 ? 'y' : 'ies'}`,
    onSuccess: () => {
      setClearOpen(false);
      set({ page: undefined }, false);
    },
  });
  const selectedEndpointUrl = params.endpointId ? wh.data?.items.find((w) => w.id === params.endpointId)?.url ?? params.endpointId : null;
  const cols: Column<WebhookDelivery>[] = [
    { key: 'event', header: 'Event', primary: true, render: (d) => <span className="block min-w-0"><span className="block font-mono text-xs">{d.event}</span><span className="block truncate text-xs text-gray-500">{wh.data?.items.find((w) => w.id === d.endpointId)?.url ?? d.endpointId}</span></span> },
    { key: 'status', header: 'Status', render: (d) => <StatusBadge status={d.status} /> },
    { key: 'attempts', header: 'Attempts', align: 'right', render: (d) => <span className="tabular-nums">{d.attempts}</span> },
    { key: 'resp', header: 'Last response', render: (d) => (d.lastResponse ? <span className="text-xs tabular-nums">HTTP {d.lastResponse.status}</span> : <span className="text-gray-400">–</span>), hideOnMobile: true },
    { key: 'next', header: 'Next attempt', render: (d) => <span className="text-xs text-gray-500">{d.nextAttemptAt ? relative(d.nextAttemptAt) : '–'}</span>, hideOnMobile: true },
    { key: 'created', header: 'Created', render: (d) => <span className="text-xs text-gray-500">{date(d.createdAt)}</span> },
  ];
  return (
    <div>
      <div className="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
        <Select label="Endpoint" value={params.endpointId ?? ''} onChange={(e) => set({ endpointId: e.target.value })}>
          <option value="">All endpoints</option>
          {wh.data?.items.map((w) => (
            <option key={w.id} value={w.id}>
              {w.url}
            </option>
          ))}
        </Select>
        <Select label="Status" value={params.status ?? ''} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Any</option>
          {['pending', 'delivered', 'failed', 'dead'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        {canWrite && (
          <div className="flex items-end">
            <Button variant="danger" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setClearOpen(true)} disabled={!q.data?.total} className="w-full lg:w-auto">
              Clear deliveries
            </Button>
          </div>
        )}
      </div>
      <DataTable
        columns={cols}
        rows={q.data?.items}
        rowKey={(d) => d.id}
        loading={q.isLoading}
        onRowClick={setSel}
        emptyTitle="No deliveries"
        actions={(d) =>
          canWrite && d.status !== 'pending' ? (
            <Button size="sm" variant="outline" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => redeliver.mutate(d.id)} loading={redeliver.isPending && redeliver.variables === d.id}>
              Redeliver
            </Button>
          ) : null
        }
        pagination={{ page, limit, total: q.data?.total ?? 0, onPage: (p) => set({ page: p }, false) }}
      />
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel?.event} description={sel ? `${sel.status} · ${sel.attempts} attempt(s) · created ${date(sel.createdAt)}` : undefined} size="lg">
        {sel && (
          <div className="space-y-3">
            <p className="text-sm">Delivered: {sel.deliveredAt ? date(sel.deliveredAt) : 'not yet'}</p>
            <div>
              <p className="label">Request payload</p>
              {sel.payload === undefined ? <p className="text-sm text-gray-500">Payload not stored for this delivery.</p> : <JsonView value={sel.payload} maxHeight="300px" />}
            </div>
            <div>
              <p className="label">Last response {sel.lastResponse ? `(HTTP ${sel.lastResponse.status})` : ''}</p>
              <pre className="scrollbar-thin max-h-72 overflow-auto rounded-lg bg-gray-950 p-3 font-mono text-xs text-gray-100">{sel.lastResponse?.body || '(empty)'}</pre>
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        danger
        title="Clear webhook deliveries?"
        confirmLabel="Clear deliveries"
        loading={clear.isPending}
        description={
          clearBody.all
            ? `This permanently deletes all ${num(q.data?.total ?? 0)} delivery records (pending deliveries included). Endpoints are not affected.`
            : `This permanently deletes ${num(q.data?.total ?? 0)} delivery records matching the current filters${selectedEndpointUrl ? ` · endpoint ${selectedEndpointUrl}` : ''}${params.status ? ` · status "${params.status}"` : ''}. Endpoints are not affected.`
        }
        onConfirm={() => clear.mutateAsync(clearBody)}
      />
    </div>
  );
}

function Inbound() {
  const q = useInbound();
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <SkeletonText lines={6} />;
  const d = q.data;
  if (!d) return <EmptyState title="Inbound status unavailable" />;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Inbound webhook URLs" description="One receiver URL per upstream account. Configure it on the TorBox account (or use the webhook toggle on the upstream account page) so download events arrive instantly." />
        <CardBody className="space-y-3">
          {d.byAccount.map((a) => (
            <div key={a.accountId}>
              <p className="mb-1 text-xs font-medium text-gray-500">{a.label}</p>
              <CopyField value={a.url} />
            </div>
          ))}
          {!d.byAccount.length && <p className="text-sm text-gray-500">Add an upstream account to get a receiver URL.</p>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Per-account status" />
        <CardBody className="p-0">
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {d.byAccount.map((a) => (
              <li key={a.accountId} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{a.label}</span>
                  {a.configured ? <Badge tone="success">configured</Badge> : <Badge tone="warning">not configured</Badge>}
                </div>
                <div className="text-xs text-gray-500">
                  {num(a.received24h)} received / {num(a.parseFailures24h)} parse failures (24h) · last {relative(a.lastReceivedAt)}
                </div>
              </li>
            ))}
            {!d.byAccount.length && <li className="px-4 py-6 text-center text-sm text-gray-500">No upstream accounts.</li>}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Recent payloads" description="Raw webhook bodies received from TorBox" />
        <CardBody className="p-0">
          {!d.recent.length ? (
            <EmptyState title="Nothing received yet" className="py-8" />
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {d.recent.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60" aria-expanded={open === r.id}>
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      {r.parsed ? <Badge tone="success">parsed</Badge> : <Badge tone="danger">unparsed</Badge>}
                      <span className="truncate font-mono text-xs">{r.eventType ?? 'unknown'}</span>
                      <span className="hidden text-xs text-gray-500 sm:inline">{d.byAccount.find((a) => a.accountId === r.accountId)?.label ?? r.accountId}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500">
                      {date(r.ts)}
                      <ChevronDown className={`h-4 w-4 transition-transform ${open === r.id ? 'rotate-180' : ''}`} aria-hidden />
                    </span>
                  </button>
                  {open === r.id && (
                    <div className="px-4 pb-4">
                      <JsonView value={r.raw} maxHeight="300px" />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
