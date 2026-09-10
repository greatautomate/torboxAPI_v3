import { useMemo, useState } from 'react';
import { Bell, BellOff, KeyRound, MoreHorizontal, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { qk, useApiMutation, useOverview, useUpstreamDetails, useUpstreams } from '../../lib/queries';
import type { Upstream, UpstreamLimits, UpstreamStatus } from '../../lib/types';
import { bytes, date, num, ratioPct, relative } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Badge, Button, ConfirmDialog, DataTable, DescriptionList, Drawer, EmptyState, Input, JsonView, Menu, Modal, Progress, Select, SkeletonText, StatusBadge, Switch, Tabs, type Column } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';
import { AreaSeriesChart, CHART } from '../../components/admin/charts';

const LIMIT_FIELDS: Array<{ key: keyof UpstreamLimits; label: string; hint: string }> = [
  { key: 'perMinute', label: 'Requests per minute', hint: 'TorBox allows 300/min per account' },
  { key: 'createUncachedPerHour', label: 'Uncached torrent creates / hour', hint: 'TorBox: 60/h' },
  { key: 'createUsenetPerHour', label: 'Usenet creates / hour', hint: 'TorBox: 60/h' },
  { key: 'createWebdlPerHour', label: 'Web download creates / hour', hint: 'TorBox: 60/h' },
];

const BUDGETS: Array<{ key: 'perMinute' | 'uncachedPerHour' | 'usenetPerHour' | 'webdlPerHour'; label: string }> = [
  { key: 'perMinute', label: 'Requests / minute' },
  { key: 'uncachedPerHour', label: 'Uncached torrents / hour' },
  { key: 'usenetPerHour', label: 'Usenet / hour' },
  { key: 'webdlPerHour', label: 'Web downloads / hour' },
];
const WEBHOOK_ENDPOINT = 'PUT /v1/api/user/settings/editsettings';
const TEST_NOTIFICATION_ENDPOINT = 'POST /v1/api/notifications/test';

/** Confirmation for flipping TorBox's webhook_url on an account; names the upstream call. */
function WebhookConfirm({ target, onClose, onConfirm, loading }: { target: { account: Upstream; enabled: boolean } | null; onClose: () => void; onConfirm: (t: { account: Upstream; enabled: boolean }) => Promise<unknown>; loading?: boolean }) {
  return (
    <ConfirmDialog
      open={!!target}
      onClose={onClose}
      title={target?.enabled ? `Enable TorBox webhook on ${target?.account.label}?` : `Disable TorBox webhook on ${target?.account.label}?`}
      description={
        <>
          <span className="block">{target?.enabled ? "TorBox's webhook_url for this account is set to this gateway's inbound receiver so download events arrive in real time." : "TorBox's webhook_url for this account is cleared; the gateway falls back to the reconciler for download events."}</span>
          <span className="mt-1 block text-xs text-gray-500">
            Upstream call: <code className="font-mono">{WEBHOOK_ENDPOINT}</code> (changes the account's settings on TorBox).
          </span>
        </>
      }
      confirmLabel={target?.enabled ? 'Enable webhook' : 'Disable webhook'}
      loading={loading}
      onConfirm={() => (target ? onConfirm(target) : undefined)}
    />
  );
}

function LimitsFields({ value, onChange }: { value: Partial<UpstreamLimits>; onChange: (v: Partial<UpstreamLimits>) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {LIMIT_FIELDS.map((f) => (
        <Input key={f.key} label={f.label} hint={f.hint} type="number" min={0} inputMode="numeric" value={value[f.key] ?? ''} onChange={(e) => onChange({ ...value, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) })} />
      ))}
    </div>
  );
}

export function UpstreamsPage() {
  const ups = useUpstreams();
  const { isOwner, canWrite } = useAuth();
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState<Upstream | null>(null);
  const [rotate, setRotate] = useState<Upstream | null>(null);
  const [del, setDel] = useState<Upstream | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [webhookTarget, setWebhookTarget] = useState<{ account: Upstream; enabled: boolean } | null>(null);
  const inv = [qk.upstreams, ['overview']];

  const verify = useApiMutation((id: string) => api.upstreams.verify(id), { invalidate: inv, success: (d) => `Verified ${d.label}` });
  const remove = useApiMutation((id: string) => api.upstreams.remove(id), { invalidate: inv, success: 'Upstream account deleted' });
  const webhook = useApiMutation((v: { id: string; enabled: boolean }) => api.upstreams.webhook(v.id, v.enabled), { invalidate: inv, success: (_d, v) => (v.enabled ? `TorBox webhook configured (${WEBHOOK_ENDPOINT})` : `TorBox webhook disabled (${WEBHOOK_ENDPOINT})`) });
  const testNotif = useApiMutation((id: string) => api.upstreams.testNotification(id), { success: `Test notification requested via ${TEST_NOTIFICATION_ENDPOINT}` });

  const columns: Column<Upstream>[] = [
    {
      key: 'label',
      header: 'Account',
      primary: true,
      render: (u) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium">{u.label}</span>
          <span className="block truncate font-mono text-xs text-gray-500">
            {u.fingerprint} · {u.emailMasked ?? 'email hidden'}
          </span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (u) => <StatusBadge status={u.status} /> },
    { key: 'plan', header: 'Plan', render: (u) => <span className="text-sm">{u.planName ?? (u.plan !== null ? String(u.plan) : '–')}</span> },
    { key: 'exp', header: 'Premium expires', render: (u) => <span className="text-xs">{u.premiumExpiresAt ? date(u.premiumExpiresAt, { dateStyle: 'medium' }) : '–'}</span>, hideOnMobile: true },
    { key: 'keys', header: 'Keys', align: 'right', render: (u) => <span className="tabular-nums">{num(u.keysCount)}</span> },
    { key: 'weight', header: 'Weight', align: 'right', render: (u) => <span className="tabular-nums">{u.weight}</span>, hideOnMobile: true },
    { key: 'webhook', header: 'Webhook', render: (u) => (u.webhookConfigured ? <Badge tone="success">configured</Badge> : <Badge>off</Badge>) },
    { key: 'verified', header: 'Verified', render: (u) => <span className="text-xs text-gray-500" title={date(u.lastVerifiedAt)}>{relative(u.lastVerifiedAt)}</span>, hideOnMobile: true },
    { key: 'err', header: 'Last error', render: (u) => (u.lastError ? <span className="truncate text-xs text-red-600" title={u.lastError}>{u.lastError}</span> : <span className="text-gray-400">–</span>), hideOnMobile: true },
  ];

  return (
    <div>
      <PageHeader
        title="Upstream accounts"
        description="TorBox API keys the gateway proxies to. Keys are encrypted at rest and never shown again."
        actions={
          isOwner && (
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdd(true)}>
              Add account
            </Button>
          )
        }
      />
      <DataTable
        columns={columns}
        rows={ups.data?.items}
        rowKey={(u) => u.id}
        loading={ups.isLoading}
        onRowClick={(u) => setDetails(u.id)}
        empty={<EmptyState title="No upstream accounts" description="Add your TorBox API key to start issuing gateway keys." action={isOwner && <Button onClick={() => setAdd(true)}>Add account</Button>} />}
        actions={(u) => (
          <Menu
            trigger={
              <Button variant="ghost" size="icon" aria-label={`Actions for ${u.label}`}>
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            }
            items={[
              { label: 'Details', onClick: () => setDetails(u.id) },
              { label: 'Verify with TorBox', icon: <RefreshCw className="h-4 w-4" />, onClick: () => verify.mutate(u.id), disabled: !canWrite },
              { label: 'Edit', onClick: () => setEdit(u), disabled: !isOwner },
              { label: 'Rotate API key', icon: <KeyRound className="h-4 w-4" />, onClick: () => setRotate(u), disabled: !isOwner },
              { divider: true, label: '' },
              { label: u.webhookConfigured ? 'Disable TorBox webhook' : 'Enable TorBox webhook', icon: u.webhookConfigured ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />, onClick: () => setWebhookTarget({ account: u, enabled: !u.webhookConfigured }), disabled: !isOwner },
              { label: 'Send test notification', icon: <Send className="h-4 w-4" />, onClick: () => testNotif.mutate(u.id), disabled: !canWrite },
              { divider: true, label: '' },
              { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => setDel(u), disabled: !isOwner },
            ]}
          />
        )}
      />

      <AddUpstreamModal open={add} onClose={() => setAdd(false)} />
      <EditUpstreamModal item={edit} onClose={() => setEdit(null)} />
      <RotateModal item={rotate} onClose={() => setRotate(null)} />
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        danger
        title={`Delete ${del?.label}?`}
        description={del?.keysCount ? `${del.keysCount} gateway keys are pinned to this account. Re-assign them first, otherwise the request fails with HAS_KEYS.` : 'The stored TorBox API key will be destroyed. This cannot be undone.'}
        confirmLabel="Delete account"
        onConfirm={() => remove.mutateAsync(del!.id)}
      />
      <WebhookConfirm target={webhookTarget} onClose={() => setWebhookTarget(null)} loading={webhook.isPending} onConfirm={(t) => webhook.mutateAsync({ id: t.account.id, enabled: t.enabled }).then(() => setWebhookTarget(null))} />
      <UpstreamDetailsDrawer id={details} onClose={() => setDetails(null)} />
    </div>
  );
}

function AddUpstreamModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [limits, setLimits] = useState<Partial<UpstreamLimits>>({});
  const m = useApiMutation((b: Parameters<typeof api.upstreams.create>[0]) => api.upstreams.create(b), {
    invalidate: [qk.upstreams, ['overview']],
    success: (d) => `Account "${d.label}" verified and added`,
    onSuccess: () => {
      setLabel('');
      setApiKey('');
      setLimits({});
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add upstream account"
      description="We verify the key with TorBox (GET /user/me) before saving. It is stored encrypted and never displayed again."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-upstream" loading={m.isPending} disabled={!label || !apiKey}>
            Verify and add
          </Button>
        </>
      }
    >
      <form
        id="add-upstream"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const clean = Object.fromEntries(Object.entries(limits).filter(([, v]) => v !== undefined)) as Partial<UpstreamLimits>;
          m.mutate({ label, apiKey: apiKey.trim(), limits: Object.keys(clean).length ? clean : undefined });
        }}
      >
        <Input label="Label" placeholder="Main TorBox account" value={label} onChange={(e) => setLabel(e.target.value)} required data-autofocus />
        <Input label="TorBox API key" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required autoComplete="off" spellCheck={false} className="font-mono" hint="Find it at torbox.app → Settings → API." />
        <details className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <summary className="cursor-pointer text-sm font-medium">Custom budget limits (optional)</summary>
          <div className="mt-3">
            <LimitsFields value={limits} onChange={setLimits} />
          </div>
        </details>
      </form>
    </Modal>
  );
}

function EditUpstreamModal({ item, onClose }: { item: Upstream | null; onClose: () => void }) {
  const [form, setForm] = useState<{ label: string; status: UpstreamStatus; weight: number; limits: Partial<UpstreamLimits> } | null>(null);
  const cur = useMemo(() => (item ? (form && form.label !== undefined ? form : { label: item.label, status: item.status, weight: item.weight, limits: { ...item.limits } }) : null), [item, form]);
  const m = useApiMutation((v: { id: string; body: Parameters<typeof api.upstreams.update>[1] }) => api.upstreams.update(v.id, v.body), {
    invalidate: [qk.upstreams, ['overview']],
    success: 'Upstream account updated',
    onSuccess: () => {
      setForm(null);
      onClose();
    },
  });
  if (!item || !cur) return null;
  const set = (patch: Partial<typeof cur>) => setForm({ ...cur, ...patch });
  return (
    <Modal
      open={!!item}
      onClose={() => (setForm(null), onClose())}
      title={`Edit ${item.label}`}
      footer={
        <>
          <Button variant="outline" onClick={() => (setForm(null), onClose())}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate({ id: item.id, body: { label: cur.label, status: cur.status, weight: cur.weight, limits: cur.limits } })} loading={m.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Label" value={cur.label} onChange={(e) => set({ label: e.target.value })} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Status" value={cur.status} onChange={(e) => set({ status: e.target.value as UpstreamStatus })} hint="Disabled accounts receive no traffic.">
            <option value="active">active</option>
            <option value="degraded">degraded</option>
            <option value="disabled">disabled</option>
          </Select>
          <Input label="Weight" type="number" min={0} value={cur.weight} onChange={(e) => set({ weight: Number(e.target.value) })} hint="Relative share for keys without a pinned account." />
        </div>
        <div>
          <p className="label">Budget limits</p>
          <LimitsFields value={cur.limits} onChange={(limits) => set({ limits })} />
        </div>
      </div>
    </Modal>
  );
}

function RotateModal({ item, onClose }: { item: Upstream | null; onClose: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const m = useApiMutation((v: { id: string; apiKey: string }) => api.upstreams.rotate(v.id, v.apiKey), {
    invalidate: [qk.upstreams],
    success: 'API key rotated and verified',
    onSuccess: () => {
      setApiKey('');
      onClose();
    },
  });
  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={`Rotate key for ${item?.label}`}
      description="Paste the new TorBox API key. It is verified before replacing the stored one; gateway keys keep working."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => item && m.mutate({ id: item.id, apiKey: apiKey.trim() })} loading={m.isPending} disabled={!apiKey}>
            Rotate
          </Button>
        </>
      }
    >
      <Input label="New TorBox API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" data-autofocus />
    </Modal>
  );
}

function UpstreamDetailsDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useUpstreamDetails(id);
  const ov = useOverview(24);
  const [tab, setTab] = useState<'account' | 'stats' | 'notifications'>('account');
  const [webhookTarget, setWebhookTarget] = useState<{ account: Upstream; enabled: boolean } | null>(null);
  const { isOwner, canWrite } = useAuth();
  const clear = useApiMutation((i: string) => api.upstreams.clearNotifications(i), { invalidate: [qk.upstreamDetails(id ?? '')], success: 'Notifications cleared' });
  const webhook = useApiMutation((v: { id: string; enabled: boolean }) => api.upstreams.webhook(v.id, v.enabled), { invalidate: [qk.upstreams, qk.upstreamDetails(id ?? ''), ['overview']], success: `Webhook setting updated (${WEBHOOK_ENDPOINT})` });
  const test = useApiMutation((i: string) => api.upstreams.testNotification(i), { success: `Test notification requested via ${TEST_NOTIFICATION_ENDPOINT}` });
  const d = q.data;
  const liveBudgets = d ? ov.data?.upstream.find((u) => u.id === d.account.id)?.budgets : undefined;
  const bw = useMemo(() => {
    const rows = (d?.stats?.bandwidth ?? []) as Array<Record<string, unknown>>;
    return rows.map((r) => {
      const t = String(r.date ?? r.day ?? r.d ?? r.t ?? r.created_at ?? '');
      const down = Number(r.download ?? r.downloaded ?? r.bytes_downloaded ?? r.down ?? 0);
      const up = Number(r.upload ?? r.uploaded ?? r.bytes_uploaded ?? r.up ?? 0);
      return { t, download: down, upload: up };
    });
  }, [d]);
  return (
    <Drawer open={!!id} onClose={onClose} title={d?.account.label ?? 'Account details'} description={d ? `${d.account.fingerprint} · ${d.account.planName ?? ''}` : undefined} width="xl">
      {q.isLoading || !d ? (
        <SkeletonText lines={8} />
      ) : (
        <div className="space-y-4">
          <Tabs items={[{ key: 'account', label: 'Account' }, { key: 'stats', label: 'Stats' }, { key: 'notifications', label: 'Notifications', count: d.notifications?.length }]} value={tab} onChange={setTab} />
          {tab === 'account' && (
            <div className="space-y-5">
              <DescriptionList
                items={[
                  { label: 'Status', value: <StatusBadge status={d.account.status} /> },
                  { label: 'Plan', value: d.account.planName ?? String(d.account.plan ?? '–') },
                  { label: 'Email', value: d.account.emailMasked ?? '–' },
                  { label: 'Premium expires', value: date(d.account.premiumExpiresAt) },
                  { label: 'Weight', value: d.account.weight },
                  { label: 'Keys pinned', value: d.account.keysCount },
                  { label: 'Last verified', value: date(d.account.lastVerifiedAt) },
                  { label: 'Created', value: date(d.account.createdAt) },
                  { label: 'Last error', value: d.account.lastError ? <span className="text-red-600">{d.account.lastError}</span> : '–', full: true },
                ]}
              />
              <div>
                <p className="label">Budget limits</p>
                <DescriptionList cols={2} items={LIMIT_FIELDS.map((f) => ({ label: f.label, value: num(d.account.limits?.[f.key]) }))} />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="label mb-0">Live budgets</p>
                  <span className="text-xs text-gray-500">{ov.isFetching ? 'refreshing…' : 'refreshes every minute'}</span>
                </div>
                {ov.isLoading ? (
                  <SkeletonText lines={4} />
                ) : !liveBudgets ? (
                  <p className="text-sm text-gray-500">{ov.isError ? `Unavailable: ${ov.error.message}` : 'No live budget data for this account yet.'}</p>
                ) : (
                  <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                    {BUDGETS.map((b) => {
                      const v = liveBudgets[b.key];
                      const p = ratioPct(v.used, v.limit);
                      return <Progress key={b.key} label={`${b.label} (${p}%)`} value={v.used} max={v.limit} />;
                    })}
                  </div>
                )}
              </div>
              <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <Switch
                  checked={d.account.webhookConfigured}
                  onChange={(v) => setWebhookTarget({ account: d.account, enabled: v })}
                  disabled={!isOwner || webhook.isPending}
                  label="TorBox webhook"
                  hint={
                    <>
                      Points TorBox's webhook_url at this gateway so download events arrive in real time. Toggling calls <code className="font-mono">{WEBHOOK_ENDPOINT}</code> on TorBox.
                    </>
                  }
                />
                <Button size="sm" variant="outline" leftIcon={<Send className="h-4 w-4" />} onClick={() => test.mutate(d.account.id)} loading={test.isPending} disabled={!canWrite}>
                  Send test notification
                </Button>
                <p className="text-xs text-gray-500">
                  Asks TorBox to send a test notification to this account via <code className="font-mono">{TEST_NOTIFICATION_ENDPOINT}</code>; it shows up in the Notifications tab (and via the webhook, if configured).
                </p>
              </div>
              <div>
                <p className="label">TorBox user (redacted)</p>
                <JsonView value={d.me} maxHeight="280px" />
              </div>
            </div>
          )}
          {tab === 'stats' && (
            <div className="space-y-4">
              {bw.length ? (
                <div>
                  <p className="label">Bandwidth</p>
                  <AreaSeriesChart data={bw} xKey="t" xFormatter={(v) => (v.length > 10 ? date(v, { month: 'short', day: 'numeric' }) : v)} series={[{ key: 'download', name: 'Download', color: CHART.ok }, { key: 'upload', name: 'Upload', color: CHART.cached }]} />
                  <p className="mt-1 text-xs text-gray-500">Values as reported by TorBox; hover for exact numbers ({bytes(bw.reduce((a, b) => a + b.download, 0))} downloaded in range).</p>
                </div>
              ) : (
                <EmptyState title="No bandwidth data" className="py-6" />
              )}
              <div>
                <p className="label">General</p>
                <JsonView value={d.stats?.general ?? {}} maxHeight="300px" />
              </div>
            </div>
          )}
          {tab === 'notifications' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button size="sm" variant="outline" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => clear.mutate(d.account.id)} loading={clear.isPending} disabled={!canWrite || !d.notifications?.length}>
                  Clear all
                </Button>
              </div>
              {!d.notifications?.length ? (
                <EmptyState title="No notifications" description="TorBox account notifications will appear here." className="py-6" />
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {d.notifications.map((n, i) => (
                    <li key={String(n.id ?? i)} className="py-3">
                      <p className="text-sm font-medium">{String(n.title ?? 'Notification')}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">{String(n.message ?? '')}</p>
                      {n.created_at && <p className="mt-1 text-xs text-gray-400">{date(String(n.created_at))}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      <WebhookConfirm target={webhookTarget} onClose={() => setWebhookTarget(null)} loading={webhook.isPending} onConfirm={(t) => webhook.mutateAsync({ id: t.account.id, enabled: t.enabled }).then(() => setWebhookTarget(null))} />
    </Drawer>
  );
}
