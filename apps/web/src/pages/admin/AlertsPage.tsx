import { AlertTriangle, Bell, BellOff, CheckCheck, Info, Send, ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { useAlerts, useApiMutation } from '../../lib/queries';
import type { Alert } from '../../lib/types';
import { useQueryParams } from '../../lib/hooks/useQueryParams';
import { date, relative } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Badge, Button, DataTable, JsonView, Menu, Tabs, type Column } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';
import { useState } from 'react';
import { Drawer } from '../../components/ui';
import { clsx } from 'clsx';

const sevIcon = { info: Info, warning: AlertTriangle, critical: ShieldAlert };
const sevTone = { info: 'info', warning: 'warning', critical: 'danger' } as const;
const SNOOZE_OPTIONS: Array<{ hours: number; label: string }> = [
  { hours: 1, label: '1 hour' },
  { hours: 24, label: '24 hours' },
  { hours: 24 * 7, label: '7 days' },
];
const isSnoozed = (a: Alert) => !!a.snoozedUntil && new Date(a.snoozedUntil).getTime() > Date.now();

export function AlertsPage() {
  const { params, set, page } = useQueryParams<{ unread?: string; page?: string }>();
  const limit = 50;
  const q = { page, limit, unread: params.unread === 'true' ? 'true' : undefined };
  const alerts = useAlerts(q);
  const { canWrite } = useAuth();
  const [selected, setSelected] = useState<Alert | null>(null);
  const inv = [['alerts'], ['overview']] as const;
  const read = useApiMutation((id: string) => api.alerts.read(id), { invalidate: inv });
  const readAll = useApiMutation(() => api.alerts.readAll(), { invalidate: inv, success: 'All alerts marked as read' });
  const test = useApiMutation(() => api.alerts.test(), { invalidate: inv, success: 'Test alert sent' });
  const snooze = useApiMutation((v: { id: string; hours: number }) => api.alerts.snooze(v.id, v.hours), {
    invalidate: [['alerts']],
    success: (r) => `Snoozed until ${date(r.snoozedUntil)}`,
    onSuccess: (r, v) => setSelected((s) => (s && s.id === v.id ? { ...s, snoozedUntil: r.snoozedUntil } : s)),
  });

  const columns: Column<Alert>[] = [
    {
      key: 'title',
      header: 'Alert',
      primary: true,
      render: (a) => {
        const Icon = sevIcon[a.severity] ?? Info;
        return (
          <span className="flex min-w-0 items-start gap-3">
            <span className={clsx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', a.severity === 'critical' && 'bg-red-50 text-red-600 dark:bg-red-950', a.severity === 'warning' && 'bg-amber-50 text-amber-600 dark:bg-amber-950', a.severity === 'info' && 'bg-sky-50 text-sky-600 dark:bg-sky-950')}>
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="flex min-w-0 items-center gap-2">
                <span className={clsx('truncate text-sm', !a.readAt && 'font-semibold')}>{a.title}</span>
                {isSnoozed(a) && (
                  <Badge tone="neutral" className="shrink-0" title={date(a.snoozedUntil)}>
                    snoozed until {date(a.snoozedUntil, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </Badge>
                )}
              </span>
              <span className="block truncate text-xs text-gray-500">{a.message}</span>
            </span>
          </span>
        );
      },
    },
    { key: 'sev', header: 'Severity', render: (a) => <Badge tone={sevTone[a.severity] ?? 'neutral'}>{a.severity}</Badge>, width: '100px' },
    { key: 'type', header: 'Type', render: (a) => <span className="font-mono text-xs">{a.type}</span>, hideOnMobile: true },
    { key: 'at', header: 'When', render: (a) => <span className="whitespace-nowrap text-xs text-gray-500" title={date(a.createdAt)}>{relative(a.createdAt)}</span>, width: '120px' },
    { key: 'read', header: 'Read', render: (a) => (a.readAt ? <span className="text-xs text-gray-400">read</span> : <Badge tone="accent">unread</Badge>), width: '80px' },
  ];

  return (
    <div>
      <PageHeader
        title="Alerts"
        description="Budget headroom, error spikes, expiring plans and quota warnings."
        actions={
          canWrite && (
            <>
              <Button variant="outline" leftIcon={<Send className="h-4 w-4" />} onClick={() => test.mutate(undefined)} loading={test.isPending}>
                Send test alert
              </Button>
              <Button variant="secondary" leftIcon={<CheckCheck className="h-4 w-4" />} onClick={() => readAll.mutate(undefined)} loading={readAll.isPending}>
                Mark all read
              </Button>
            </>
          )
        }
      />
      <Tabs variant="pills" className="mb-4" items={[{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }]} value={params.unread === 'true' ? 'unread' : 'all'} onChange={(k) => set({ unread: k === 'unread' ? 'true' : undefined })} />
      <DataTable
        columns={columns}
        rows={alerts.data?.items}
        rowKey={(a) => a.id}
        loading={alerts.isLoading}
        onRowClick={(a) => {
          setSelected(a);
          if (!a.readAt && canWrite) read.mutate(a.id);
        }}
        actions={(a) =>
          canWrite ? (
            <span className="flex items-center justify-end gap-1">
              {!a.readAt && (
                <Button size="sm" variant="ghost" onClick={() => read.mutate(a.id)}>
                  Mark read
                </Button>
              )}
              <Menu
                label={`Snooze ${a.title}`}
                trigger={
                  <Button size="sm" variant="ghost" leftIcon={<BellOff className="h-4 w-4" />} loading={snooze.isPending && snooze.variables?.id === a.id}>
                    Snooze
                  </Button>
                }
                items={SNOOZE_OPTIONS.map((o) => ({ label: o.label, onClick: () => snooze.mutate({ id: a.id, hours: o.hours }) }))}
              />
            </span>
          ) : null
        }
        empty={<div className="flex flex-col items-center py-12 text-center"><Bell className="h-8 w-8 text-gray-300" aria-hidden /><p className="mt-2 text-sm font-medium">No alerts</p><p className="text-xs text-gray-500">You will be notified about budgets, errors and expiring plans.</p></div>}
        pagination={{ page, limit, total: alerts.data?.total ?? 0, onPage: (p) => set({ page: p }, false) }}
      />
      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.title} description={selected ? date(selected.createdAt) : undefined} width="md">
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone={sevTone[selected.severity]}>{selected.severity}</Badge>
              <Badge>{selected.type}</Badge>
              {isSnoozed(selected) && <Badge tone="neutral">snoozed until {date(selected.snoozedUntil)}</Badge>}
            </div>
            {canWrite && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500">Snooze:</span>
                {SNOOZE_OPTIONS.map((o) => (
                  <Button key={o.hours} size="sm" variant="outline" onClick={() => snooze.mutate({ id: selected.id, hours: o.hours })} loading={snooze.isPending && snooze.variables?.id === selected.id && snooze.variables?.hours === o.hours}>
                    {o.label}
                  </Button>
                ))}
              </div>
            )}
            <p className="text-sm text-gray-700 dark:text-gray-300">{selected.message}</p>
            {selected.meta && Object.keys(selected.meta).length > 0 && (
              <div>
                <p className="label">Details</p>
                <JsonView value={selected.meta} maxHeight="300px" />
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
