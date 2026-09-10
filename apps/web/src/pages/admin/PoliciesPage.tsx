import { useEffect, useMemo, useState } from 'react';
import { Eye, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { qk, useApiMutation, usePolicies, useRoutes, useUpstreams } from '../../lib/queries';
import type { Policy, PolicyInput, Upstream } from '../../lib/types';
import { json, num } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Badge, Button, CodeBlock, ConfirmDialog, DataTable, DescriptionList, EmptyState, Input, Menu, Modal, Progress, Select, Switch, Tabs, Textarea, type Column, type MenuItem } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';

const LIMITS: Array<{ key: keyof Policy['limits']; label: string; hint?: string }> = [
  { key: 'perMinute', label: 'Requests / minute' },
  { key: 'perHour', label: 'Requests / hour' },
  { key: 'perDay', label: 'Requests / day' },
  { key: 'createUncachedPerHour', label: 'Uncached creates / hour', hint: 'Shares TorBox\'s 60/h budget' },
  { key: 'createPerHour', label: 'Creates / hour (any)' },
];
const FEATURES: Array<{ key: keyof Policy['features']; label: string; hint: string }> = [
  { key: 'allowPermalinks', label: 'Permalinks', hint: 'Signed /dl links that hide the key' },
  { key: 'allowStreaming', label: 'Streaming', hint: 'HLS entry at /s/…' },
  { key: 'allowUploads', label: 'Uploads', hint: 'Torrent/NZB file uploads' },
  { key: 'allowSettingsWrite', label: 'Settings write', hint: 'TorBox account settings (dangerous)' },
  { key: 'allowBypassCache', label: 'Bypass cache', hint: 'Consumer may request fresh data' },
  { key: 'allowWebhooks', label: 'Webhooks', hint: 'Register outbound webhook endpoints' },
];
const blank: PolicyInput = {
  name: '',
  description: '',
  limits: { perMinute: 60, perHour: 1000, perDay: 10000, createUncachedPerHour: 10, createPerHour: 30 },
  quotas: { monthlyRequests: 0, monthlyCreates: 0 },
  features: { allowPermalinks: true, allowStreaming: true, allowUploads: true, allowSettingsWrite: false, allowBypassCache: false, allowWebhooks: true },
  cacheTtlOverrides: {},
};

type ModalTab = 'limits' | 'features' | 'cache' | 'preview';

export function PoliciesPage() {
  const pol = usePolicies();
  const { canWrite } = useAuth();
  const [modal, setModal] = useState<{ open: boolean; item: Policy | null; tab: ModalTab }>({ open: false, item: null, tab: 'limits' });
  const openModal = (item: Policy | null, tab: ModalTab = 'limits') => setModal({ open: true, item, tab });
  const [del, setDel] = useState<Policy | null>(null);
  const remove = useApiMutation((id: string) => api.policies.remove(id), { invalidate: [qk.policies], success: 'Policy deleted' });
  const makeDefault = useApiMutation((id: string) => api.policies.makeDefault(id), { invalidate: [qk.policies], success: 'Default policy updated' });

  const columns: Column<Policy>[] = [
    {
      key: 'name',
      header: 'Policy',
      primary: true,
      render: (p) => (
        <span className="block min-w-0">
          <span className="flex items-center gap-2 font-medium">
            {p.name}
            {p.isDefault && <Badge tone="accent">default</Badge>}
          </span>
          {p.description && <span className="block truncate text-xs text-gray-500">{p.description}</span>}
        </span>
      ),
    },
    { key: 'lim', header: 'Rate limits', render: (p) => <span className="text-xs tabular-nums">{num(p.limits.perMinute)}/min · {num(p.limits.perHour)}/h · {num(p.limits.perDay)}/d</span> },
    { key: 'creates', header: 'Creates', render: (p) => <span className="text-xs tabular-nums">{num(p.limits.createUncachedPerHour)} uncached/h · {num(p.limits.createPerHour)}/h</span>, hideOnMobile: true },
    { key: 'quota', header: 'Monthly quota', render: (p) => <span className="text-xs tabular-nums">{p.quotas.monthlyRequests ? num(p.quotas.monthlyRequests) : '∞'} req · {p.quotas.monthlyCreates ? num(p.quotas.monthlyCreates) : '∞'} creates</span> },
    { key: 'feat', header: 'Features', render: (p) => <span className="flex flex-wrap gap-1">{FEATURES.filter((f) => p.features[f.key]).map((f) => <Badge key={f.key}>{f.label}</Badge>)}</span>, hideOnMobile: true },
    { key: 'keys', header: 'Keys', align: 'right', render: (p) => <span className="tabular-nums">{num(p.keysCount)}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Policies"
        description="Reusable bundles of rate limits, monthly quotas, feature toggles and cache TTL overrides."
        actions={
          canWrite && (
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => openModal(null)}>
              New policy
            </Button>
          )
        }
      />
      <DataTable
        columns={columns}
        rows={pol.data?.items}
        rowKey={(p) => p.id}
        loading={pol.isLoading}
        onRowClick={(p) => openModal(p, canWrite ? 'limits' : 'preview')}
        empty={<EmptyState title="No policies" description="Create a policy to control limits for your keys." action={canWrite && <Button onClick={() => openModal(null)}>New policy</Button>} />}
        actions={(p) => {
          const items: MenuItem[] = [{ label: 'Preview', icon: <Eye className="h-4 w-4" />, onClick: () => openModal(p, 'preview') }];
          if (canWrite) {
            items.push(
              { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onClick: () => openModal(p) },
              { label: 'Make default', icon: <Star className="h-4 w-4" />, onClick: () => makeDefault.mutate(p.id), disabled: p.isDefault },
              { divider: true, label: '' },
              { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => setDel(p), disabled: p.keysCount > 0 || p.isDefault },
            );
          }
          return (
            <Menu
              trigger={
                <Button variant="ghost" size="icon" aria-label={`Actions for ${p.name}`}>
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              }
              items={items}
            />
          );
        }}
      />
      <PolicyModal open={modal.open} item={modal.item} initialTab={modal.tab} onClose={() => setModal((m) => ({ ...m, open: false }))} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger title={`Delete policy ${del?.name}?`} description="Only policies with no keys attached can be deleted." confirmLabel="Delete" onConfirm={() => remove.mutateAsync(del!.id)} />
    </div>
  );
}

function PolicyModal({ open, item, initialTab = 'limits', onClose }: { open: boolean; item: Policy | null; initialTab?: ModalTab; onClose: () => void }) {
  const { canWrite } = useAuth();
  const [f, setF] = useState<PolicyInput>(blank);
  const [tab, setTab] = useState<ModalTab>('limits');
  const routes = useRoutes();
  const groups = [...new Set((routes.data?.items ?? []).map((r) => r.group))].sort();
  const [newGroup, setNewGroup] = useState('');
  const [newTtl, setNewTtl] = useState('');
  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setF(item ? { name: item.name, description: item.description ?? '', limits: { ...item.limits }, quotas: { ...item.quotas }, features: { ...item.features }, cacheTtlOverrides: { ...(item.cacheTtlOverrides ?? {}) } } : structuredClone(blank));
    }
  }, [open, item, initialTab]);
  const create = useApiMutation((b: PolicyInput) => api.policies.create(b), { invalidate: [qk.policies], success: 'Policy created', onSuccess: onClose });
  const update = useApiMutation((b: PolicyInput) => api.policies.update(item!.id, b), { invalidate: [qk.policies], success: 'Policy updated', onSuccess: onClose });
  const numField = (v: string) => Math.max(0, Number(v) || 0);
  const ro = !canWrite;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? (ro ? item.name : `Edit ${item.name}`) : 'New policy'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {ro ? 'Close' : 'Cancel'}
          </Button>
          {!ro && (
            <Button onClick={() => (item ? update.mutate(f) : create.mutate(f))} loading={create.isPending || update.isPending} disabled={!f.name.trim()}>
              {item ? 'Save' : 'Create policy'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required data-autofocus disabled={ro} />
        <Textarea label="Description" value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} disabled={ro} />
        <Tabs
          items={[
            { key: 'limits', label: 'Limits & quotas' },
            { key: 'features', label: 'Features' },
            { key: 'cache', label: 'Cache TTL overrides', count: Object.keys(f.cacheTtlOverrides).length },
            { key: 'preview', label: 'Preview & simulator' },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'limits' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {LIMITS.map((l) => (
                <Input key={l.key} label={l.label} hint={l.hint} type="number" min={0} inputMode="numeric" value={f.limits[l.key]} onChange={(e) => setF({ ...f, limits: { ...f.limits, [l.key]: numField(e.target.value) } })} disabled={ro} />
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Monthly requests quota" hint="0 = unlimited" type="number" min={0} inputMode="numeric" value={f.quotas.monthlyRequests} onChange={(e) => setF({ ...f, quotas: { ...f.quotas, monthlyRequests: numField(e.target.value) } })} disabled={ro} />
              <Input label="Monthly creates quota" hint="0 = unlimited" type="number" min={0} inputMode="numeric" value={f.quotas.monthlyCreates} onChange={(e) => setF({ ...f, quotas: { ...f.quotas, monthlyCreates: numField(e.target.value) } })} disabled={ro} />
            </div>
          </div>
        )}
        {tab === 'features' && (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {FEATURES.map((ft) => (
              <Switch key={ft.key} label={ft.label} hint={ft.hint} checked={f.features[ft.key]} onChange={(v) => setF({ ...f, features: { ...f.features, [ft.key]: v } })} disabled={ro} />
            ))}
          </div>
        )}
        {tab === 'cache' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">Override the default cache TTL (seconds) per route group. 0 disables caching for that group.</p>
            {Object.entries(f.cacheTtlOverrides).length === 0 && <p className="text-sm text-gray-400">No overrides.</p>}
            <ul className="space-y-2">
              {Object.entries(f.cacheTtlOverrides).map(([g, ttl]) => (
                <li key={g} className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-gray-100 px-2 py-2 font-mono text-xs dark:bg-gray-800">{g}</code>
                  <Input aria-label={`TTL for ${g}`} type="number" min={0} className="w-28" value={ttl} onChange={(e) => setF({ ...f, cacheTtlOverrides: { ...f.cacheTtlOverrides, [g]: numField(e.target.value) } })} disabled={ro} />
                  {!ro && (
                    <Button variant="ghost" size="icon" aria-label={`Remove ${g}`} onClick={() => { const c = { ...f.cacheTtlOverrides }; delete c[g]; setF({ ...f, cacheTtlOverrides: c }); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {!ro && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                {groups.length ? (
                  <Select label="Route group" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} className="flex-1">
                    <option value="">Select…</option>
                    {groups.filter((g) => !(g in f.cacheTtlOverrides)).map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input label="Route group" placeholder="e.g. torrents.list" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} className="flex-1" />
                )}
                <Input label="TTL (s)" type="number" min={0} value={newTtl} onChange={(e) => setNewTtl(e.target.value)} className="sm:w-32" />
                <Button variant="secondary" disabled={!newGroup || newTtl === ''} onClick={() => { setF({ ...f, cacheTtlOverrides: { ...f.cacheTtlOverrides, [newGroup]: numField(newTtl) } }); setNewGroup(''); setNewTtl(''); }}>
                  Add
                </Button>
              </div>
            )}
          </div>
        )}
        {tab === 'preview' && <PreviewTab f={f} />}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Preview & simulator
// ---------------------------------------------------------------------------

const orInf = (n: number) => (n > 0 ? num(n) : '∞');

function PreviewTab({ f }: { f: PolicyInput }) {
  const upstreams = useUpstreams();
  const accounts = useMemo(() => {
    const list = (upstreams.data?.items ?? []).filter((u) => u.status !== 'disabled');
    return list.sort((a, b) => (a.status === b.status ? a.label.localeCompare(b.label) : a.status === 'active' ? -1 : 1));
  }, [upstreams.data]);
  const [accountId, setAccountId] = useState('');
  const account: Upstream | undefined = accounts.find((u) => u.id === accountId) ?? accounts[0];

  const meShape = {
    budgets: {
      perMinute: { used: 0, limit: f.limits.perMinute, resetAt: '<end of current minute>' },
      perHour: { used: 0, limit: f.limits.perHour, resetAt: '<end of current hour>' },
      perDay: { used: 0, limit: f.limits.perDay, resetAt: '<end of current UTC day>' },
      createUncachedPerHour: { used: 0, limit: f.limits.createUncachedPerHour, resetAt: '<end of current hour>' },
    },
    usage: { month: { requests: 0, creates: 0 }, quotas: { monthlyRequests: f.quotas.monthlyRequests, monthlyCreates: f.quotas.monthlyCreates } },
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Effective limits</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400">Updates live from the fields above. 0 means unlimited and is shown as ∞.</p>
        <DescriptionList
          cols={3}
          items={[
            { label: 'Requests / minute', value: <span className="tabular-nums">{orInf(f.limits.perMinute)}</span> },
            { label: 'Requests / hour', value: <span className="tabular-nums">{orInf(f.limits.perHour)}</span> },
            { label: 'Requests / day', value: <span className="tabular-nums">{orInf(f.limits.perDay)}</span> },
            { label: 'Uncached creates / hour', value: <span className="tabular-nums">{orInf(f.limits.createUncachedPerHour)}</span> },
            { label: 'Creates / hour (any)', value: <span className="tabular-nums">{orInf(f.limits.createPerHour)}</span> },
            { label: 'Monthly quota', value: <span className="tabular-nums">{orInf(f.quotas.monthlyRequests)} req · {orInf(f.quotas.monthlyCreates)} creates</span> },
            {
              label: 'Features',
              full: true,
              value: (
                <span className="flex flex-wrap gap-1">
                  {FEATURES.map((ft) => (
                    <Badge key={ft.key} tone={f.features[ft.key] ? 'success' : 'neutral'} dot>
                      {ft.label} {f.features[ft.key] ? 'on' : 'off'}
                    </Badge>
                  ))}
                </span>
              ),
            },
          ]}
        />
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Against the upstream budget</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">How much of one TorBox account a single key on this policy can consume.</p>
          </div>
          {accounts.length > 1 && (
            <Select aria-label="Upstream account" value={account?.id ?? ''} onChange={(e) => setAccountId(e.target.value)} className="sm:w-56">
              {accounts.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                  {u.status !== 'active' ? ` (${u.status})` : ''}
                </option>
              ))}
            </Select>
          )}
        </div>
        {upstreams.isLoading ? (
          <p className="text-sm text-gray-400">Loading upstream accounts…</p>
        ) : !account ? (
          <EmptyState title="No upstream account" description="Add a TorBox account under Upstreams to compare this policy against its budget." />
        ) : (
          <BudgetComparison f={f} account={account} />
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">What the consumer sees</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Excerpt of <code className="font-mono">GET /api/v1/me</code> for a fresh key on this policy.
        </p>
        <CodeBlock code={json(meShape)} language="json" title="GET /api/v1/me → data.budgets / data.usage" maxHeight="16rem" />
      </section>

      <Simulator limits={f.limits} />
    </div>
  );
}

function BudgetComparison({ f, account }: { f: PolicyInput; account: Upstream }) {
  const rows: Array<{ label: string; policy: number; cap: number; capHint?: string }> = [
    { label: 'Requests / minute', policy: f.limits.perMinute, cap: account.limits.perMinute },
    { label: 'Uncached creates / hour', policy: f.limits.createUncachedPerHour, cap: account.limits.createUncachedPerHour },
    { label: 'Creates / hour (any)', policy: f.limits.createPerHour, cap: Math.min(account.limits.createUsenetPerHour, account.limits.createWebdlPerHour), capHint: 'min(usenet, webdl)' },
  ];
  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {rows.map((r) => {
          const share = r.cap > 0 && r.policy > 0 ? (r.policy / r.cap) * 100 : null;
          const exceeds = r.cap > 0 && r.policy > r.cap;
          const keys = r.cap <= 0 ? '∞' : r.policy <= 0 ? null : Math.floor(r.cap / r.policy);
          return (
            <li key={r.label} className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                <span className="font-medium text-gray-900 dark:text-gray-100">{r.label}</span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                  <span className="tabular-nums">
                    policy {orInf(r.policy)} · account cap {orInf(r.cap)}
                    {r.capHint && <span className="text-gray-400"> ({r.capHint})</span>}
                  </span>
                  {share !== null && <Badge tone={exceeds ? 'danger' : share >= 50 ? 'warning' : 'neutral'}>{share >= 1000 ? `${Math.round(share / 100)}×` : `${share.toFixed(share < 10 ? 1 : 0)}%`}</Badge>}
                </span>
              </div>
              <Progress value={r.policy > 0 ? r.policy : r.cap} max={r.cap} showValue={false} />
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                {keys === null ? (
                  <span>Unlimited per key: a single key can drain this account's budget on its own.</span>
                ) : keys === '∞' ? (
                  <span>Account cap is unlimited; the policy limit is the only ceiling.</span>
                ) : (
                  <span>
                    ≈ <strong className="tabular-nums text-gray-900 dark:text-gray-100">{num(keys)}</strong> {keys === 1 ? 'key' : 'keys'} at full speed saturate this account
                  </span>
                )}
                {exceeds && <Badge tone="warning">Exceeds account cap — a key can never reach its own limit</Badge>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-950 dark:text-sky-300">
        The gateway's global limiter still protects <span className="font-medium">{account.label}</span>: shared upstream budgets are checked on every request regardless of the policy, so an over-generous policy results in 429s with <code className="font-mono">scope: "global"</code> rather than an exhausted TorBox account.
      </p>
    </div>
  );
}

// ---- simulator ------------------------------------------------------------

type SimWindow = 'minute' | 'hour' | 'day';
const WINDOW_MS: Record<SimWindow, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000 };
const MAX_SIM_LINES = 20_000;
const MAX_BLOCKS = 600;

interface SimRequest { t: number; label: string }
interface SimOutcome extends SimRequest { i: number; ok: boolean; rule?: string; retryAfter?: number }
interface SimResult {
  requests: SimOutcome[];
  accepted: number;
  throttled: number;
  first: SimOutcome | null;
  spanMs: number;
  rules: string[];
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const clockLabel = (msOfDay: number) => {
  const s = Math.floor(msOfDay / 1000);
  return `${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}.${pad(Math.floor(msOfDay % 1000), 3)}`;
};

/** Parse a single line. Returns null for an unparseable line; `undefined` for a blank one. */
function parseLine(raw: string): SimRequest | null | undefined {
  const s = raw.trim().replace(/[,;]+$/, '');
  if (!s) return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    const t = n > 100_000 ? Math.round(n) : Math.round(n * 1000);
    return { t, label: `+${(t / 1000).toFixed(3)} s` };
  }
  const m = /^(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(s);
  if (m) {
    const t = ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number((m[4] ?? '0').padEnd(3, '0'));
    return { t, label: clockLabel(t) };
  }
  const d = Date.parse(s);
  if (!Number.isNaN(d)) {
    const local = new Date(d);
    return { t: d, label: `${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}.${pad(local.getMilliseconds(), 3)}` };
  }
  return null;
}

function parseTimestamps(text: string): { requests: SimRequest[]; skipped: number; truncated: boolean } {
  const lines = text.split(/\r?\n/);
  const requests: SimRequest[] = [];
  let skipped = 0;
  let truncated = false;
  for (const line of lines) {
    const r = parseLine(line);
    if (r === undefined) continue;
    if (r === null) { skipped++; continue; }
    if (requests.length >= MAX_SIM_LINES) { truncated = true; break; }
    requests.push(r);
  }
  return { requests, skipped, truncated };
}

/**
 * Mirrors RateLimiter.consume(): fixed windows keyed by floor(t / size) with a two-bucket sliding correction
 * (previous bucket weighted by the remaining fraction of the current one). A request is throttled when
 * current + floor(previous × fraction) ≥ limit for any applicable window; throttled requests consume nothing.
 */
function simulate(input: SimRequest[], limits: Policy['limits']): SimResult {
  const sorted = [...input].sort((a, b) => a.t - b.t);
  const spanMs = sorted.length ? sorted[sorted.length - 1].t - sorted[0].t : 0;
  const rules: Array<{ name: string; window: SimWindow; limit: number }> = [{ name: 'perMinute', window: 'minute', limit: limits.perMinute }];
  if (spanMs > WINDOW_MS.minute) rules.push({ name: 'perHour', window: 'hour', limit: limits.perHour });
  if (spanMs > WINDOW_MS.hour) rules.push({ name: 'perDay', window: 'day', limit: limits.perDay });
  const active = rules.filter((r) => r.limit > 0);
  const counts = new Map<string, number>();
  let accepted = 0;
  let throttled = 0;
  let first: SimOutcome | null = null;
  const requests: SimOutcome[] = sorted.map((r, i) => {
    for (const rule of active) {
      const size = WINDOW_MS[rule.window];
      const start = Math.floor(r.t / size) * size;
      const cur = counts.get(`${rule.window}:${start}`) ?? 0;
      const prev = counts.get(`${rule.window}:${start - size}`) ?? 0;
      const frac = (size - (r.t - start)) / size;
      if (cur + Math.floor(prev * frac) >= rule.limit) {
        throttled++;
        const out: SimOutcome = { ...r, i, ok: false, rule: rule.name, retryAfter: Math.max(1, Math.ceil((start + size - r.t) / 1000)) };
        first ??= out;
        return out;
      }
    }
    for (const rule of active) {
      const size = WINDOW_MS[rule.window];
      const key = `${rule.window}:${Math.floor(r.t / size) * size}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    accepted++;
    return { ...r, i, ok: true };
  });
  return { requests, accepted, throttled, first, spanMs, rules: rules.map((r) => `${r.name}${r.limit > 0 ? ` ${num(r.limit)}` : ' ∞'}`) };
}

function Simulator({ limits }: { limits: Policy['limits'] }) {
  const [text, setText] = useState('');
  const [n, setN] = useState(100);
  const parsed = useMemo(() => parseTimestamps(text), [text]);
  const result = useMemo(() => (parsed.requests.length ? simulate(parsed.requests, limits) : null), [parsed, limits]);
  const count = Math.min(5000, Math.max(1, Math.floor(n) || 1));

  const genEven = () => setText(Array.from({ length: count }, (_, i) => ((i * 60) / count).toFixed(3)).join('\n'));
  const genBurst = () => setText(Array.from({ length: count }, () => '0').join('\n'));

  const spanSec = result ? Math.ceil(result.spanMs / 1000) : 0;
  const histogram = useMemo(() => {
    if (!result || spanSec > 120) return null;
    const t0 = Math.floor(result.requests[0].t / 1000) * 1000;
    const rows = Array.from({ length: Math.floor((result.requests[result.requests.length - 1].t - t0) / 1000) + 1 }, () => ({ ok: 0, ko: 0 }));
    for (const r of result.requests) {
      const b = rows[Math.floor((r.t - t0) / 1000)];
      if (r.ok) b.ok++;
      else b.ko++;
    }
    const max = Math.max(1, ...rows.map((r) => r.ok + r.ko));
    return { rows, max };
  }, [result, spanSec]);

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Simulator</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Paste request timestamps (one per line) to see which would be throttled by this policy. Model: fixed minute/hour/day windows with a two-bucket sliding correction (count = current window + previous window × remaining fraction), throttled when count ≥ limit — the same maths as the gateway limiter.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <Textarea
          label="Timestamps"
          hint="ISO-8601 (2026-09-10T12:00:00.250Z), HH:MM:SS[.mmm], or plain numbers (seconds; treated as milliseconds when > 100000). Offsets start at a window boundary."
          mono
          rows={8}
          spellCheck={false}
          placeholder={'0\n0.5\n1.0\n12:00:01.250\n2026-09-10T12:00:02Z'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="space-y-2">
          <Input label="N requests" type="number" min={1} max={5000} inputMode="numeric" value={n} onChange={(e) => setN(Number(e.target.value))} />
          <Button variant="secondary" className="w-full" onClick={genEven}>
            Evenly {num(count)} over 60 s
          </Button>
          <Button variant="secondary" className="w-full" onClick={genBurst}>
            Burst of {num(count)} at t=0
          </Button>
          {text && (
            <Button variant="ghost" className="w-full" onClick={() => setText('')}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {!result ? (
        <p className="text-sm text-gray-400">{text.trim() ? `No valid timestamps found (${num(parsed.skipped)} line${parsed.skipped === 1 ? '' : 's'} skipped).` : 'Paste timestamps or use a generator to run the simulation.'}</p>
      ) : (
        <div className="space-y-3" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone="success" dot>
              {num(result.accepted)} accepted
            </Badge>
            <Badge tone={result.throttled ? 'danger' : 'neutral'} dot>
              {num(result.throttled)} throttled
            </Badge>
            <span className="text-gray-500 dark:text-gray-400">
              {num(result.requests.length)} requests over {spanSec <= 60 ? `${(result.spanMs / 1000).toFixed(result.spanMs < 10_000 ? 1 : 0)} s` : spanSec <= 3600 ? `${Math.round(spanSec / 60)} min` : `${(spanSec / 3600).toFixed(1)} h`} · windows applied: {result.rules.join(', ')}
            </span>
            {parsed.skipped > 0 && <Badge tone="warning">{num(parsed.skipped)} invalid line{parsed.skipped === 1 ? '' : 's'} skipped</Badge>}
            {parsed.truncated && <Badge tone="warning">Only the first {num(MAX_SIM_LINES)} timestamps were simulated</Badge>}
          </div>

          {result.first ? (
            <DescriptionList
              cols={3}
              items={[
                { label: 'First throttled', value: <span className="tabular-nums">request #{num(result.first.i + 1)} at {result.first.label}</span> },
                { label: 'Limit hit', value: <code className="font-mono text-xs">{result.first.rule}</code> },
                { label: 'Retry-After', value: <span className="tabular-nums">{num(result.first.retryAfter)} s until the window resets</span> },
              ]}
            />
          ) : (
            <p className="text-sm text-green-700 dark:text-green-400">Every request would be accepted.</p>
          )}

          <Timeline requests={result.requests} />

          {histogram && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Per second</p>
              <ol className="scrollbar-thin max-h-48 space-y-0.5 overflow-y-auto pr-1">
                {histogram.rows.map((row, s) => (
                  <li key={s} className="flex items-center gap-2 text-xs tabular-nums">
                    <span className="w-12 shrink-0 text-right text-gray-500 dark:text-gray-400">+{s}s</span>
                    <span className="flex h-3 flex-1 overflow-hidden rounded-sm bg-gray-100 dark:bg-gray-800" role="img" aria-label={`${row.ok} accepted, ${row.ko} throttled`}>
                      <span className="h-full bg-accent-500" style={{ width: `${(row.ok / histogram.max) * 100}%` }} />
                      <span className="h-full bg-red-500" style={{ width: `${(row.ko / histogram.max) * 100}%` }} />
                    </span>
                    <span className="w-16 shrink-0 text-gray-600 dark:text-gray-400">
                      {row.ok}
                      {row.ko ? <span className="text-red-600 dark:text-red-400"> / {row.ko}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Timeline({ requests }: { requests: SimOutcome[] }) {
  const blocks = useMemo(() => {
    if (requests.length <= MAX_BLOCKS) return requests.map((r) => ({ from: r.i, to: r.i, ok: r.ok ? 1 : 0, ko: r.ok ? 0 : 1, title: `#${r.i + 1} ${r.label} — ${r.ok ? 'accepted' : `throttled (${r.rule})`}` }));
    const size = Math.ceil(requests.length / MAX_BLOCKS);
    const out: Array<{ from: number; to: number; ok: number; ko: number; title: string }> = [];
    for (let s = 0; s < requests.length; s += size) {
      const chunk = requests.slice(s, s + size);
      const ko = chunk.filter((r) => !r.ok).length;
      out.push({ from: s, to: s + chunk.length - 1, ok: chunk.length - ko, ko, title: `#${s + 1}–#${s + chunk.length} (${chunk[0].label} → ${chunk[chunk.length - 1].label}): ${chunk.length - ko} accepted, ${ko} throttled` });
    }
    return out;
  }, [requests]);
  const aggregated = requests.length > MAX_BLOCKS;
  const throttled = requests.filter((r) => !r.ok).length;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
        <span className="font-medium">Timeline</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-accent-500" aria-hidden /> accepted
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-red-500" aria-hidden /> throttled
          </span>
          {aggregated && <span className="text-gray-400">{Math.ceil(requests.length / MAX_BLOCKS)} requests per block</span>}
        </span>
      </div>
      <div
        tabIndex={0}
        role="img"
        aria-label={`${requests.length} requests in time order: ${requests.length - throttled} accepted, ${throttled} throttled${requests.find((r) => !r.ok) ? `, first throttled at request ${requests.find((r) => !r.ok)!.i + 1}` : ''}`}
        className="flex h-8 w-full gap-px overflow-hidden rounded-md bg-gray-100 p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:bg-gray-800"
      >
        {blocks.map((b) => (
          <span key={b.from} title={b.title} className={`h-full min-w-[1px] flex-1 rounded-[1px] ${b.ko === 0 ? 'bg-accent-500' : b.ok === 0 ? 'bg-red-500' : 'bg-gradient-to-t from-red-500 to-accent-500'}`} />
        ))}
      </div>
    </div>
  );
}
