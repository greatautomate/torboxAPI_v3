import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, ArrowLeft, ArrowRight, Ban, Check, Eye, FlaskConical, KeyRound, MoreHorizontal, Pause, Pencil, Play, Plus, RefreshCw, RotateCcw, ScrollText, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { qk, useAllClients, useApiMutation, useKey, useKeys, usePolicies, useScopes, useUpstreams } from '../../lib/queries';
import type { ApiKey, KeyDetail, KeyInput } from '../../lib/types';
import { useQueryParams } from '../../lib/hooks/useQueryParams';
import { useDebounce } from '../../lib/hooks/useDebounce';
import { date, dateShort, fromLocalInput, num, relative, splitList, toLocalInput } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, DataTable, DescriptionList, EmptyState, ErrorState, Input, Menu, Modal, Progress, Select, SkeletonCard, SkeletonText, StatTile, StatusBadge, Tabs, Textarea, type Column } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';
import { FilterBar, countActive } from '../../components/admin/FilterBar';
import { AreaSeriesChart, CHART } from '../../components/admin/charts';
import { SecretReveal } from '../../components/admin/SecretReveal';
import { LogsView } from '../../components/admin/LogsView';
import { ActivityView } from '../../components/admin/ActivityView';
import { clsx } from 'clsx';

type KeyStatusAction = 'suspend' | 'resume' | 'revoke';
const ACTION_DONE: Record<KeyStatusAction, string> = { suspend: 'Key suspended', resume: 'Key resumed', revoke: 'Key revoked' };

/** True while a rotated key's previous secret is still accepted. */
function graceActive(k: Pick<ApiKey, 'graceUntil'> | null | undefined): boolean {
  return !!k?.graceUntil && new Date(k.graceUntil).getTime() > Date.now();
}

// ---------------------------------------------------------------- rotate flow (shared by list + detail)
/** Grace-period confirm dialog followed by a one-time reveal of the new secret. */
function RotateKeyFlow({ target, onClose, invalidate }: { target: ApiKey | null; onClose: () => void; invalidate: ReadonlyArray<readonly unknown[]> }) {
  const [grace, setGrace] = useState('0');
  const [result, setResult] = useState<{ key: ApiKey; secret: string } | null>(null);
  useEffect(() => {
    if (target) setGrace('0');
  }, [target]);
  const rotate = useApiMutation((v: { key: ApiKey; grace: number }) => api.keys.rotate(v.key.id, v.grace || undefined), {
    invalidate,
    onSuccess: (d, v) => setResult({ key: v.key, secret: d.secret }),
  });
  return (
    <>
      <ConfirmDialog
        open={!!target}
        onClose={onClose}
        title={target ? `Rotate secret for ${target.name}?` : 'Rotate secret?'}
        description="A new secret is generated. Optionally keep the old one valid for a grace period so the consumer can switch without downtime."
        confirmLabel="Rotate"
        onConfirm={() => (target ? rotate.mutateAsync({ key: target, grace: Number(grace) || 0 }) : undefined)}
      >
        <Input label="Grace period (minutes)" type="number" min={0} max={10080} inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} hint="0 = the old secret stops working immediately. Max 10080 (7 days)." />
      </ConfirmDialog>
      <Modal open={!!result} onClose={() => setResult(null)} title={result ? `New secret for ${result.key.name}` : 'New secret'} size="md" footer={<Button onClick={() => setResult(null)}>Done</Button>}>
        {result && <SecretReveal secret={result.secret} label="API key secret" scopes={result.key.scopes} keyName={result.key.name} description="This is the only time the new secret is shown. Update the consumer before the grace period ends." />}
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- list
export function KeysPage() {
  const { params, set, reset, page } = useQueryParams<{ clientId?: string; status?: string; q?: string; page?: string }>();
  const [q, setQ] = useState(params.q ?? '');
  const dq = useDebounce(q);
  useEffect(() => {
    if ((dq || undefined) !== params.q) set({ q: dq || undefined });
  }, [dq, params.q, set]);
  const limit = 50;
  const keys = useKeys({ clientId: params.clientId, status: params.status, q: params.q, page, limit });
  const clients = useAllClients();
  const nav = useNavigate();
  const { canWrite } = useAuth();
  const [rotateTarget, setRotateTarget] = useState<ApiKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const action = useApiMutation((v: { id: string; a: KeyStatusAction }) => api.keys.action(v.id, v.a), { invalidate: [['keys']], success: (_d, v) => ACTION_DONE[v.a] });

  const rowActions = (k: ApiKey) => {
    const revoked = k.status === 'revoked';
    return (
      <Menu
        label={`Actions for ${k.name}`}
        trigger={
          <Button variant="ghost" size="icon" aria-label={`Actions for ${k.name}`}>
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        }
        items={[
          { label: 'View details', icon: <Eye className="h-4 w-4" />, onClick: () => nav(`/admin/keys/${k.id}`) },
          { label: 'View logs', icon: <ScrollText className="h-4 w-4" />, onClick: () => nav(`/admin/logs?keyId=${k.id}`) },
          { label: 'View activity', icon: <Activity className="h-4 w-4" />, onClick: () => nav(`/admin/activity?keyId=${k.id}`) },
          { label: 'Open in Playground', icon: <FlaskConical className="h-4 w-4" />, onClick: () => nav(`/admin/playground?keyId=${k.id}`), disabled: revoked },
          ...(canWrite && !revoked
            ? [
                { divider: true, label: '' },
                { label: 'Rotate…', icon: <RefreshCw className="h-4 w-4" />, onClick: () => setRotateTarget(k) },
                k.status === 'suspended'
                  ? { label: 'Resume', icon: <Play className="h-4 w-4" />, onClick: () => action.mutate({ id: k.id, a: 'resume' }) }
                  : { label: 'Suspend', icon: <Pause className="h-4 w-4" />, onClick: () => action.mutate({ id: k.id, a: 'suspend' }) },
                { label: 'Revoke…', icon: <Ban className="h-4 w-4" />, danger: true, onClick: () => setRevokeTarget(k) },
              ]
            : []),
        ]}
      />
    );
  };

  const columns: Column<ApiKey>[] = [
    {
      key: 'name',
      header: 'Key',
      primary: true,
      render: (k) => (
        <span className="block min-w-0">
          <Link to={`/admin/keys/${k.id}`} className="block truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {k.name}
          </Link>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-xs text-gray-500">
              {k.prefix}…{k.last4}
            </span>
            {k.mode === 'test' && <Badge tone="info">test</Badge>}
            {graceActive(k) && (
              <Badge tone="warning" title={`Previous secret still valid until ${date(k.graceUntil)}`}>
                grace
              </Badge>
            )}
          </span>
        </span>
      ),
    },
    { key: 'client', header: 'Client', render: (k) => <Link to={`/admin/clients/${k.clientId}`} className="truncate text-accent-600 hover:underline" onClick={(e) => e.stopPropagation()}>{k.clientName}</Link> },
    { key: 'status', header: 'Status', render: (k) => <StatusBadge status={k.status} /> },
    { key: 'policy', header: 'Policy', render: (k) => <span className="text-sm">{k.policyName ?? '–'}</span>, hideOnMobile: true },
    { key: 'scopes', header: 'Scopes', render: (k) => <span className="text-xs text-gray-500">{k.scopes.length} scopes</span>, hideOnMobile: true },
    { key: 'req', header: 'Requests (30d)', align: 'right', render: (k) => <span className="tabular-nums">{num(k.requests30d)}</span> },
    { key: 'used', header: 'Last used', render: (k) => <span className="text-xs text-gray-500" title={k.lastUsedIp ?? ''}>{relative(k.lastUsedAt)}</span> },
    { key: 'exp', header: 'Expires', render: (k) => (k.expiresAt ? <span className={clsx('text-xs', new Date(k.expiresAt) < new Date() ? 'text-red-600' : 'text-gray-500')}>{date(k.expiresAt, { dateStyle: 'medium' })}</span> : <span className="text-xs text-gray-400">never</span>), hideOnMobile: true },
  ];

  return (
    <div>
      <PageHeader
        title="API keys"
        description="Gateway keys (tbg_live_…) you hand to consumers. Each has scopes, a policy and optional pinning."
        actions={
          canWrite && (
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => nav('/admin/keys/new')}>
              Create key
            </Button>
          )
        }
      />
      <FilterBar activeCount={countActive(params)} onReset={() => (setQ(''), reset())} cols={3}>
        <Input label="Search" placeholder="name or prefix" value={q} onChange={(e) => setQ(e.target.value)} leftIcon={<Search className="h-4 w-4" />} />
        <Select label="Client" value={params.clientId ?? ''} onChange={(e) => set({ clientId: e.target.value })}>
          <option value="">All clients</option>
          {clients.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select label="Status" value={params.status ?? ''} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Any status</option>
          <option value="active">active</option>
          <option value="suspended">suspended</option>
          <option value="revoked">revoked</option>
        </Select>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={keys.data?.items}
        rowKey={(k) => k.id}
        loading={keys.isLoading}
        onRowClick={(k) => nav(`/admin/keys/${k.id}`)}
        actions={rowActions}
        empty={<EmptyState icon={<KeyRound className="h-6 w-6" />} title="No API keys" description="Create a key to let a consumer call the gateway." action={canWrite && <Button onClick={() => nav('/admin/keys/new')}>Create key</Button>} />}
        pagination={{ page, limit, total: keys.data?.total ?? 0, onPage: (p) => set({ page: p }, false) }}
      />
      <RotateKeyFlow target={rotateTarget} onClose={() => setRotateTarget(null)} invalidate={[['keys']]} />
      <ConfirmDialog
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        danger
        title={revokeTarget ? `Revoke ${revokeTarget.name}?` : 'Revoke this key?'}
        description="The consumer will immediately receive 401 responses. This cannot be undone."
        confirmLabel="Revoke"
        onConfirm={() => (revokeTarget ? action.mutateAsync({ id: revokeTarget.id, a: 'revoke' }) : undefined)}
      />
    </div>
  );
}

// ---------------------------------------------------------------- scope picker
function ScopePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const scopes = useScopes();
  const groups = useMemo(() => {
    const m = new Map<string, NonNullable<typeof scopes.data>['items']>();
    for (const s of scopes.data?.items ?? []) {
      if (!m.has(s.group)) m.set(s.group, []);
      m.get(s.group)!.push(s);
    }
    return [...m.entries()];
  }, [scopes.data]);
  const toggle = (s: string) => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  const presets = scopes.data?.presets ?? {};
  const presetActive = (list: string[]) => list.length === value.length && list.every((s) => value.includes(s));
  if (scopes.isLoading) return <SkeletonText lines={6} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Presets</span>
        {Object.entries(presets).map(([name, list]) => (
          <Button key={name} size="sm" variant={presetActive(list) ? 'primary' : 'outline'} onClick={() => onChange([...list])}>
            {name}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => onChange([])}>
          Clear
        </Button>
        <span className="ml-auto text-xs text-gray-500">{value.length} selected</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {groups.map(([group, items]) => {
          const all = items.every((i) => value.includes(i.scope));
          return (
            <fieldset key={group} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <legend className="flex items-center gap-2 px-1 text-sm font-semibold">
                {group}
                <button type="button" className="text-xs font-normal text-accent-600 hover:underline" onClick={() => onChange(all ? value.filter((v) => !items.some((i) => i.scope === v)) : [...new Set([...value, ...items.map((i) => i.scope)])])}>
                  {all ? 'none' : 'all'}
                </button>
              </legend>
              {items.map((s) => (
                <Checkbox key={s.scope} label={<span className="font-mono text-xs">{s.scope}</span>} hint={s.description} checked={value.includes(s.scope)} onChange={() => toggle(s.scope)} className="min-h-[40px] py-1" />
              ))}
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- key form (shared by wizard + edit)
interface KeyFormState {
  name: string;
  clientId: string;
  scopes: string[];
  policyId: string;
  upstreamAccountId: string;
  allowedIps: string;
  allowedOrigins: string;
  expiresAt: string;
  metadata: string;
}
function toInput(f: KeyFormState): KeyInput {
  let metadata: Record<string, unknown> | null = null;
  if (f.metadata.trim()) metadata = JSON.parse(f.metadata) as Record<string, unknown>;
  return {
    name: f.name.trim(),
    clientId: f.clientId,
    scopes: f.scopes,
    policyId: f.policyId || null,
    upstreamAccountId: f.upstreamAccountId || null,
    allowedIps: splitList(f.allowedIps),
    allowedOrigins: splitList(f.allowedOrigins),
    expiresAt: fromLocalInput(f.expiresAt) ?? null,
    metadata,
  };
}
function fromKey(k: ApiKey): KeyFormState {
  return {
    name: k.name,
    clientId: k.clientId,
    scopes: k.scopes,
    policyId: k.policyId ?? '',
    upstreamAccountId: k.upstreamAccountId ?? '',
    allowedIps: k.allowedIps.join(', '),
    allowedOrigins: k.allowedOrigins.join(', '),
    expiresAt: toLocalInput(k.expiresAt),
    metadata: k.metadata && Object.keys(k.metadata).length ? JSON.stringify(k.metadata, null, 2) : '',
  };
}
function metadataError(s: string): string | undefined {
  if (!s.trim()) return undefined;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? undefined : 'Must be a JSON object';
  } catch {
    return 'Invalid JSON';
  }
}

const STEPS = ['Name', 'Client', 'Scopes', 'Policy', 'Upstream', 'Restrictions', 'Expiry', 'Metadata', 'Review'] as const;

export function KeyCreatePage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const clients = useAllClients();
  const policies = usePolicies();
  const upstreams = useUpstreams();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<KeyFormState>({ name: '', clientId: sp.get('clientId') ?? '', scopes: [], policyId: '', upstreamAccountId: '', allowedIps: '', allowedOrigins: '', expiresAt: '', metadata: '' });
  const [result, setResult] = useState<{ key: ApiKey; secret: string } | null>(null);
  const scopesMeta = useScopes();
  const create = useApiMutation((b: KeyInput) => api.keys.create(b), { invalidate: [['keys'], ['clients']], onSuccess: (d) => setResult(d) });

  useEffect(() => {
    // default scopes and policy once meta loads
    if (scopesMeta.data && f.scopes.length === 0) {
      const defaults = scopesMeta.data.items.filter((s) => s.default).map((s) => s.scope);
      if (defaults.length) setF((p) => ({ ...p, scopes: defaults }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopesMeta.data]);
  useEffect(() => {
    if (!f.policyId && policies.data) {
      const client = clients.data?.items.find((c) => c.id === f.clientId);
      const def = client?.defaultPolicyId ?? policies.data.items.find((p) => p.isDefault)?.id ?? '';
      if (def) setF((p) => ({ ...p, policyId: def }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policies.data, clients.data, f.clientId]);

  const metaErr = metadataError(f.metadata);
  const valid: boolean[] = [!!f.name.trim(), !!f.clientId, f.scopes.length > 0, true, true, true, true, !metaErr, true];
  const set = (patch: Partial<KeyFormState>) => setF((p) => ({ ...p, ...patch }));
  const client = clients.data?.items.find((c) => c.id === f.clientId);
  const policy = policies.data?.items.find((p) => p.id === f.policyId);
  const upstream = upstreams.data?.items.find((u) => u.id === f.upstreamAccountId);

  if (result) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader breadcrumbs={[{ label: 'API keys', to: '/admin/keys' }, { label: 'New key' }]} title="Key created" description={`${result.key.name} for ${result.key.clientName}`} />
        <Card>
          <CardBody className="space-y-5">
            <SecretReveal secret={result.secret} label="API key secret" scopes={result.key.scopes} keyName={result.key.name} description="This is the only time the full secret is shown. Store it in your consumer's secret manager now." />
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => nav('/admin/keys')}>
                Back to keys
              </Button>
              <Button variant="outline" leftIcon={<FlaskConical className="h-4 w-4" />} onClick={() => nav(`/admin/playground?keyId=${result.key.id}`)}>
                Try in Playground
              </Button>
              <Button onClick={() => nav(`/admin/keys/${result.key.id}`)}>Open key details</Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader breadcrumbs={[{ label: 'API keys', to: '/admin/keys' }, { label: 'New key' }]} title="Create API key" description="A gateway key your consumer will use instead of your TorBox key." />
      <ol className="scrollbar-thin mb-4 flex gap-1 overflow-x-auto pb-1" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => i <= step && setStep(i)}
              disabled={i > step}
              aria-current={i === step ? 'step' : undefined}
              className={clsx('flex min-h-[36px] items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium', i === step ? 'bg-accent-600 text-white' : i < step ? 'bg-accent-50 text-accent-700 dark:bg-accent-950 dark:text-accent-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800')}
            >
              {i < step && <Check className="h-3 w-3" aria-hidden />}
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>
      <Card>
        <CardBody className="min-h-[280px] space-y-4">
          {step === 0 && <Input label="Key name" placeholder="e.g. Plex server, Alice's Stremio" value={f.name} onChange={(e) => set({ name: e.target.value })} hint="Shown in logs and analytics. Not visible to the consumer." required autoFocus />}
          {step === 1 && (
            <>
              <Select label="Client" value={f.clientId} onChange={(e) => set({ clientId: e.target.value, policyId: '' })} required>
                <option value="">Select a client…</option>
                {clients.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              {clients.data && clients.data.items.length === 0 && (
                <p className="text-sm text-gray-600">
                  You have no clients yet.{' '}
                  <Link to="/admin/clients" className="text-accent-600 hover:underline">
                    Create one first
                  </Link>
                  .
                </p>
              )}
            </>
          )}
          {step === 2 && <ScopePicker value={f.scopes} onChange={(scopes) => set({ scopes })} />}
          {step === 3 && (
            <>
              <Select label="Policy" value={f.policyId} onChange={(e) => set({ policyId: e.target.value })} hint="Rate limits, quotas and feature toggles.">
                <option value="">Gateway default</option>
                {policies.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </Select>
              {policy && (
                <DescriptionList
                  cols={3}
                  items={[
                    { label: 'Per minute', value: num(policy.limits.perMinute) },
                    { label: 'Per hour', value: num(policy.limits.perHour) },
                    { label: 'Per day', value: num(policy.limits.perDay) },
                    { label: 'Monthly requests', value: num(policy.quotas.monthlyRequests) || '∞' },
                    { label: 'Monthly creates', value: num(policy.quotas.monthlyCreates) || '∞' },
                    { label: 'Features', value: Object.entries(policy.features).filter(([, v]) => v).map(([k]) => k.replace('allow', '')).join(', ') || 'none' },
                  ]}
                />
              )}
            </>
          )}
          {step === 4 && (
            <Select label="Upstream account" value={f.upstreamAccountId} onChange={(e) => set({ upstreamAccountId: e.target.value })} hint="Pin this key to one TorBox account, or let the gateway balance by weight.">
              <option value="">Automatic (weighted)</option>
              {upstreams.data?.items.map((u) => (
                <option key={u.id} value={u.id} disabled={u.status === 'disabled'}>
                  {u.label} ({u.status})
                </option>
              ))}
            </Select>
          )}
          {step === 5 && (
            <>
              <Textarea label="Allowed IPs / CIDRs" placeholder="203.0.113.7, 198.51.100.0/24" value={f.allowedIps} onChange={(e) => set({ allowedIps: e.target.value })} hint="Comma or newline separated. Empty = any IP." rows={3} mono />
              <Textarea label="Allowed origins" placeholder="https://app.example.com, chrome-extension://abc…" value={f.allowedOrigins} onChange={(e) => set({ allowedOrigins: e.target.value })} hint="Browser Origin header allowlist for CORS requests. Empty = any." rows={3} mono />
            </>
          )}
          {step === 6 && <Input label="Expires at" type="datetime-local" value={f.expiresAt} onChange={(e) => set({ expiresAt: e.target.value })} hint="Leave empty for a key that never expires." />}
          {step === 7 && <Textarea label="Metadata (JSON)" placeholder={'{ "device": "shield-tv", "owner": "alice" }'} value={f.metadata} onChange={(e) => set({ metadata: e.target.value })} error={metaErr} hint="Free-form object stored with the key." rows={6} mono />}
          {step === 8 && (
            <DescriptionList
              items={[
                { label: 'Name', value: f.name },
                { label: 'Client', value: client?.name ?? f.clientId },
                { label: 'Scopes', value: <span className="flex flex-wrap gap-1">{f.scopes.map((s) => <Badge key={s}>{s}</Badge>)}</span>, full: true },
                { label: 'Policy', value: policy?.name ?? 'Client default / gateway default' },
                { label: 'Upstream', value: upstream?.label ?? 'Automatic (active default account)' },
                { label: 'Allowed IPs', value: splitList(f.allowedIps).join(', ') || 'any' },
                { label: 'Allowed origins', value: splitList(f.allowedOrigins).join(', ') || 'any' },
                { label: 'Expires', value: f.expiresAt ? date(fromLocalInput(f.expiresAt)) : 'never' },
                { label: 'Metadata', value: f.metadata.trim() ? <code className="text-xs">{f.metadata}</code> : '–', full: true },
              ]}
            />
          )}
        </CardBody>
        <div className="sticky bottom-0 z-10 -mx-3 flex items-center justify-between gap-2 rounded-b-xl border-t border-gray-200 bg-white/95 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:bg-white sm:px-4 sm:pb-3 sm:backdrop-blur-0 dark:border-gray-800 dark:bg-gray-900/95 sm:dark:bg-gray-900">
          <Button variant="outline" onClick={() => (step === 0 ? nav('/admin/keys') : setStep(step - 1))} leftIcon={<ArrowLeft className="h-4 w-4" />}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!valid[step]} rightIcon={<ArrowRight className="h-4 w-4" />}>
              Next
            </Button>
          ) : (
            <Button onClick={() => create.mutate(toInput(f))} loading={create.isPending} disabled={valid.some((v) => !v)} leftIcon={<KeyRound className="h-4 w-4" />}>
              Create key
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- edit modal
function KeyEditModal({ item, open, onClose }: { item: ApiKey; open: boolean; onClose: () => void }) {
  const [f, setF] = useState<KeyFormState>(() => fromKey(item));
  useEffect(() => {
    if (open) setF(fromKey(item));
  }, [item, open]);
  const policies = usePolicies();
  const upstreams = useUpstreams();
  const metaErr = metadataError(f.metadata);
  const m = useApiMutation((b: Partial<KeyInput>) => api.keys.update(item.id, b), { invalidate: [['keys']], success: 'Key updated', onSuccess: onClose });
  const [tab, setTab] = useState<'general' | 'scopes' | 'restrictions'>('general');
  const submit = () => {
    const input = toInput(f);
    delete input.clientId;
    m.mutate(input);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${item.name}`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={m.isPending} disabled={!f.name.trim() || !!metaErr || f.scopes.length === 0}>
            Save changes
          </Button>
        </>
      }
    >
      <Tabs items={[{ key: 'general', label: 'General' }, { key: 'scopes', label: 'Scopes', count: f.scopes.length }, { key: 'restrictions', label: 'Restrictions' }]} value={tab} onChange={setTab} className="mb-4" />
      {tab === 'general' && (
        <div className="space-y-4">
          <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          <Select label="Policy" value={f.policyId} onChange={(e) => setF({ ...f, policyId: e.target.value })}>
            <option value="">Gateway default</option>
            {policies.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select label="Upstream account" value={f.upstreamAccountId} onChange={(e) => setF({ ...f, upstreamAccountId: e.target.value })}>
            <option value="">Automatic (weighted)</option>
            {upstreams.data?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </Select>
          <Input label="Expires at" type="datetime-local" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} hint="Empty = never." />
          <Textarea label="Metadata (JSON)" value={f.metadata} onChange={(e) => setF({ ...f, metadata: e.target.value })} error={metaErr} rows={4} mono />
        </div>
      )}
      {tab === 'scopes' && <ScopePicker value={f.scopes} onChange={(scopes) => setF({ ...f, scopes })} />}
      {tab === 'restrictions' && (
        <div className="space-y-4">
          <Textarea label="Allowed IPs / CIDRs" value={f.allowedIps} onChange={(e) => setF({ ...f, allowedIps: e.target.value })} hint="Comma or newline separated. Empty = any." rows={3} mono />
          <Textarea label="Allowed origins" value={f.allowedOrigins} onChange={(e) => setF({ ...f, allowedOrigins: e.target.value })} hint="Empty = any." rows={3} mono />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- detail
const BUCKETS: Array<{ key: keyof KeyDetail['buckets']; label: string }> = [
  { key: 'perMinute', label: 'Requests / minute' },
  { key: 'perHour', label: 'Requests / hour' },
  { key: 'perDay', label: 'Requests / day' },
  { key: 'createUncachedPerHour', label: 'Uncached creates / hour' },
  { key: 'createPerHour', label: 'Creates / hour' },
];

export function KeyDetailPage() {
  const { id = '' } = useParams();
  const q = useKey(id);
  const nav = useNavigate();
  const { canWrite } = useAuth();
  const [tab, setTab] = useState<'usage' | 'logs' | 'activity'>('usage');
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState<null | 'revoke' | 'reset-usage' | 'reset-limits' | 'rotate'>(null);
  const inv = useMemo(() => [qk.key(id), ['keys']], [id]);
  const action = useApiMutation((a: 'suspend' | 'resume' | 'revoke' | 'reset-usage' | 'reset-limits') => api.keys.action(id, a), { invalidate: inv, success: (_d, a) => `Key ${a.replace('-', ' ')} done` });
  const d = q.data;
  const k = d?.key;
  const fixed = useMemo(() => ({ keyId: id }), [id]);
  const inGrace = graceActive(k);

  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />;
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'API keys', to: '/admin/keys' }, { label: k?.name ?? '…' }]}
        title={
          k ? (
            <span className="flex flex-wrap items-center gap-2">
              {k.name} <StatusBadge status={k.status} />
              {k.mode === 'test' && <Badge tone="info">test</Badge>}
              {inGrace && <Badge tone="warning">grace period</Badge>}
            </span>
          ) : (
            <SkeletonText lines={1} className="w-48" />
          )
        }
        description={k ? <span className="font-mono">{k.prefix}…{k.last4}</span> : undefined}
        actions={
          k && (
            <>
              <Button variant="outline" leftIcon={<FlaskConical className="h-4 w-4" />} onClick={() => nav(`/admin/playground?keyId=${k.id}`)} disabled={k.status === 'revoked'}>
                Open in Playground
              </Button>
              {canWrite && (
                <>
                  <Button variant="outline" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)} disabled={k.status === 'revoked'}>
                    Edit
                  </Button>
                  <Button variant="outline" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => setConfirm('rotate')} disabled={k.status === 'revoked'}>
                    Rotate
                  </Button>
                  {k.status === 'active' && (
                    <Button variant="outline" leftIcon={<Pause className="h-4 w-4" />} onClick={() => action.mutate('suspend')}>
                      Suspend
                    </Button>
                  )}
                  {k.status === 'suspended' && (
                    <Button variant="outline" leftIcon={<Play className="h-4 w-4" />} onClick={() => action.mutate('resume')}>
                      Resume
                    </Button>
                  )}
                  <Menu
                    trigger={
                      <Button variant="outline" size="icon" aria-label="More actions">
                        <MoreHorizontal className="h-5 w-5" />
                      </Button>
                    }
                    items={[
                      { label: 'View logs', icon: <ScrollText className="h-4 w-4" />, onClick: () => nav(`/admin/logs?keyId=${k.id}`) },
                      { label: 'View activity', icon: <Activity className="h-4 w-4" />, onClick: () => nav(`/admin/activity?keyId=${k.id}`) },
                      { divider: true, label: '' },
                      { label: 'Reset usage counters', icon: <RotateCcw className="h-4 w-4" />, onClick: () => setConfirm('reset-usage') },
                      { label: 'Reset rate-limit buckets', icon: <RotateCcw className="h-4 w-4" />, onClick: () => setConfirm('reset-limits') },
                      { divider: true, label: '' },
                      { label: 'Revoke key', icon: <Ban className="h-4 w-4" />, danger: true, onClick: () => setConfirm('revoke'), disabled: k.status === 'revoked' },
                    ]}
                  />
                </>
              )}
            </>
          )
        }
      />
      {k && inGrace && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" role="status">
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            Previous secret still valid until <time dateTime={k.graceUntil ?? undefined}>{date(k.graceUntil)}</time> ({relative(k.graceUntil)}). Consumers can switch to the new secret in the meantime.
          </p>
        </div>
      )}
      {!d || !k ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Key information" />
              <CardBody>
                <DescriptionList
                  cols={2}
                  items={[
                    { label: 'Client', value: <Link to={`/admin/clients/${k.clientId}`} className="text-accent-600 hover:underline">{k.clientName}</Link> },
                    { label: 'Policy', value: k.policyName ?? 'Gateway default' },
                    { label: 'Upstream account', value: k.upstreamLabel ?? 'Automatic' },
                    { label: 'Expires', value: k.expiresAt ? date(k.expiresAt) : 'never' },
                    { label: 'Last used', value: k.lastUsedAt ? `${relative(k.lastUsedAt)} from ${k.lastUsedIp ?? '?'}` : 'never' },
                    { label: 'Created', value: date(k.createdAt) },
                    { label: 'Allowed IPs', value: k.allowedIps.length ? k.allowedIps.join(', ') : 'any' },
                    { label: 'Allowed origins', value: k.allowedOrigins.length ? k.allowedOrigins.join(', ') : 'any' },
                    { label: 'Scopes', value: <span className="flex flex-wrap gap-1">{k.scopes.map((s) => <Badge key={s}>{s}</Badge>)}</span>, full: true },
                    ...(k.metadata && Object.keys(k.metadata).length ? [{ label: 'Metadata', value: <pre className="overflow-x-auto rounded bg-gray-50 p-2 font-mono text-xs dark:bg-gray-950">{JSON.stringify(k.metadata, null, 2)}</pre>, full: true }] : []),
                  ]}
                />
              </CardBody>
            </Card>
            <div className="space-y-3">
              <StatTile label="Today" value={num(d.usage.today.requests)} hint={`${num(d.usage.today.errors)} errors`} />
              <StatTile label="Requests (30d)" value={num(k.requests30d)} />
              <Card>
                <CardBody className="space-y-3">
                  <Progress label="Monthly requests" value={d.usage.month.requests} max={d.usage.month.quotaRequests} />
                  <Progress label="Monthly creates" value={d.usage.month.creates} max={d.usage.month.quotaCreates} />
                </CardBody>
              </Card>
            </div>
          </div>

          <Tabs items={[{ key: 'usage', label: 'Usage' }, { key: 'logs', label: 'Request logs' }, { key: 'activity', label: 'Activity' }]} value={tab} onChange={setTab} />
          {tab === 'usage' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader title="Daily usage" description="Requests, cache hits and errors" />
                <CardBody>
                  <AreaSeriesChart data={d.usage.daily} xKey="d" xFormatter={dateShort} series={[{ key: 'requests', name: 'Requests', color: CHART.ok }, { key: 'cacheHits', name: 'Cache hits', color: CHART.cached }, { key: 'errors', name: 'Errors', color: CHART.error }]} />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Live buckets" description="Current rate-limit windows" />
                <CardBody className="space-y-3">
                  {BUCKETS.map((b) => {
                    const v = d.buckets[b.key];
                    if (!v) return null;
                    return (
                      <div key={b.key}>
                        <Progress label={b.label} value={v.used} max={v.limit} />
                        {v.resetAt && (
                          <p className="mt-1 text-right text-[11px] text-gray-500 dark:text-gray-400">
                            Resets <time dateTime={v.resetAt} title={date(v.resetAt)}>{relative(v.resetAt)}</time>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            </div>
          )}
          {tab === 'logs' && <LogsView fixed={fixed} embedded />}
          {tab === 'activity' && <ActivityView fixed={fixed} embedded />}
        </div>
      )}

      {k && <KeyEditModal item={k} open={edit} onClose={() => setEdit(false)} />}
      <ConfirmDialog open={confirm === 'revoke'} onClose={() => setConfirm(null)} danger title="Revoke this key?" description="The consumer will immediately receive 401 responses. This cannot be undone." confirmLabel="Revoke" onConfirm={() => action.mutateAsync('revoke')} />
      <ConfirmDialog open={confirm === 'reset-usage'} onClose={() => setConfirm(null)} title="Reset usage counters?" description="Monthly request and create counters for this key will be set to zero." confirmLabel="Reset usage" onConfirm={() => action.mutateAsync('reset-usage')} />
      <ConfirmDialog open={confirm === 'reset-limits'} onClose={() => setConfirm(null)} title="Reset rate-limit buckets?" description="Clears the per-minute/hour/day windows so the key can call again right now." confirmLabel="Reset limits" onConfirm={() => action.mutateAsync('reset-limits')} />
      <RotateKeyFlow target={confirm === 'rotate' && k ? k : null} onClose={() => setConfirm(null)} invalidate={inv} />
      {k?.status === 'revoked' && <p className="mt-4 text-xs text-gray-500">This key is revoked. Create a new one for {k.clientName} from <button className="text-accent-600 hover:underline" onClick={() => nav(`/admin/keys/new?clientId=${k.clientId}`)}>here</button>.</p>}
    </div>
  );
}
