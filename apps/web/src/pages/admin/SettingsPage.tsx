import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { api } from '../../lib/api';
import { qk, useApiMutation, useSettings } from '../../lib/queries';
import type { Settings } from '../../lib/types';
import { useAuth } from '../../lib/auth';
import { Button, Card, CardBody, CardHeader, Input, SkeletonText, Switch, Tabs, Textarea } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';

type SectionKey = keyof Settings;
const SECTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: 'branding', label: 'Branding' },
  { key: 'homepage', label: 'Homepage' },
  { key: 'cors', label: 'CORS' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'retention', label: 'Retention' },
  { key: 'privacy', label: 'Privacy' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'docs', label: 'Docs' },
];
const HOME_SECTIONS = ['dropin', 'keys', 'unified', 'permalinks', 'cache', 'hosters', 'automation', 'webhooks', 'observability', 'ratelimits', 'gallery', 'quickstart'];

function SectionForm<K extends SectionKey>({ section, initial, render }: { section: K; initial: Settings[K]; render: (v: Settings[K], set: (p: Partial<Settings[K]>) => void) => React.ReactNode }) {
  const [v, setV] = useState<Settings[K]>(initial);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setV(initial);
    setDirty(false);
  }, [initial]);
  const { canWrite } = useAuth();
  const m = useApiMutation((b: Partial<Settings>) => api.settings.patch(b), { invalidate: [qk.settings, qk.publicConfig], success: 'Settings saved', onSuccess: () => setDirty(false) });
  const set = (p: Partial<Settings[K]>) => {
    setV((prev) => ({ ...prev, ...p }));
    setDirty(true);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate({ [section]: v } as Partial<Settings>);
      }}
      className="space-y-4"
    >
      {render(v, set)}
      <div className="flex justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
        <Button type="button" variant="outline" disabled={!dirty} onClick={() => (setV(initial), setDirty(false))}>
          Reset
        </Button>
        <Button type="submit" disabled={!dirty || !canWrite} loading={m.isPending}>
          Save {SECTIONS.find((s) => s.key === section)?.label.toLowerCase()}
        </Button>
      </div>
    </form>
  );
}

export function SettingsPage() {
  const q = useSettings();
  const [tab, setTab] = useState<SectionKey>('branding');
  const test = useApiMutation(() => api.alerts.test(), { success: 'Test alert sent to the configured webhook' });
  const s = q.data;
  return (
    <div>
      <PageHeader title="Settings" description="Branding, homepage, CORS, maintenance mode, retention, privacy, alerting and docs." />
      <Tabs items={SECTIONS.map((x) => ({ key: x.key, label: x.label }))} value={tab} onChange={setTab} className="mb-4" />
      <Card>
        <CardHeader title={SECTIONS.find((x) => x.key === tab)?.label} />
        <CardBody>
          {!s ? (
            <SkeletonText lines={6} />
          ) : tab === 'branding' ? (
            <SectionForm
              section="branding"
              initial={s.branding}
              render={(v, set) => (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input label="Name" value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
                  <Input label="Tagline" value={v.tagline ?? ''} onChange={(e) => set({ tagline: e.target.value })} />
                  <Input label="Logo URL" type="url" value={v.logoUrl ?? ''} onChange={(e) => set({ logoUrl: e.target.value })} />
                  <Input label="Accent colour" type="text" placeholder="#4f46e5" value={v.accentColor ?? ''} onChange={(e) => set({ accentColor: e.target.value })} />
                  <Input label="Support email" type="email" value={v.supportEmail ?? ''} onChange={(e) => set({ supportEmail: e.target.value })} />
                </div>
              )}
            />
          ) : tab === 'homepage' ? (
            <SectionForm
              section="homepage"
              initial={s.homepage}
              render={(v, set) => (
                <div className="space-y-4">
                  <Switch label="Show public stats" hint="Expose total requests / downloads on the homepage (GET /public/stats)." checked={!!v.showPublicStats} onChange={(b) => set({ showPublicStats: b })} />
                  <Textarea label="Custom intro" value={v.customIntro ?? ''} onChange={(e) => set({ customIntro: e.target.value })} rows={3} hint="Shown under the hero." />
                  <fieldset>
                    <legend className="label">Sections</legend>
                    <div className="grid grid-cols-1 sm:grid-cols-2">
                      {[...new Set([...(s.homepageSections ?? HOME_SECTIONS), ...Object.keys(v.sections ?? {})])].map((id) => (
                        <Switch key={id} label={id} checked={v.sections?.[id] !== false} onChange={(b) => set({ sections: { ...(v.sections ?? {}), [id]: b } })} className="min-h-[40px] py-1" />
                      ))}
                    </div>
                  </fieldset>
                </div>
              )}
            />
          ) : tab === 'cors' ? (
            <SectionForm
              section="cors"
              initial={s.cors}
              render={(v, set) => (
                <Textarea label="Allowed origins" hint="One per line. Use * to allow any origin for the consumer API. Per-key origin allowlists still apply." value={(v.allowedOrigins ?? []).join('\n')} onChange={(e) => set({ allowedOrigins: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} rows={6} mono />
              )}
            />
          ) : tab === 'maintenance' ? (
            <SectionForm
              section="maintenance"
              initial={s.maintenance}
              render={(v, set) => (
                <div className="space-y-2">
                  <Switch label="Maintenance mode" hint="Consumer API returns 503 with the message below. Admin stays reachable." checked={!!v.enabled} onChange={(b) => set({ enabled: b })} />
                  <Switch label="Read-only mode" hint="Allow reads but block creates/deletes toward TorBox." checked={!!v.readOnly} onChange={(b) => set({ readOnly: b })} />
                  <Textarea label="Message" value={v.message ?? ''} onChange={(e) => set({ message: e.target.value })} rows={3} />
                </div>
              )}
            />
          ) : tab === 'retention' ? (
            <SectionForm
              section="retention"
              initial={s.retention}
              render={(v, set) => (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input label="Request logs (days)" type="number" min={1} value={v.requestLogsDays ?? 30} onChange={(e) => set({ requestLogsDays: Number(e.target.value) })} />
                  <Input label="Activity (days)" type="number" min={1} value={v.activityDays ?? 90} onChange={(e) => set({ activityDays: Number(e.target.value) })} />
                  <Input label="Events (days)" type="number" min={1} value={v.eventsDays ?? 30} onChange={(e) => set({ eventsDays: Number(e.target.value) })} />
                  <Input label="Webhook deliveries (days)" type="number" min={1} value={v.webhookDeliveriesDays ?? 14} onChange={(e) => set({ webhookDeliveriesDays: Number(e.target.value) })} />
                </div>
              )}
            />
          ) : tab === 'privacy' ? (
            <SectionForm
              section="privacy"
              initial={s.privacy}
              render={(v, set) => (
                <div>
                  <Switch label="Store full query strings" hint="Off: only the route is logged, not query parameters." checked={!!v.storeFullQuery} onChange={(b) => set({ storeFullQuery: b })} />
                  <Switch label="Truncate IP addresses" hint="Zero the last octet / 80 bits before storing." checked={!!v.truncateIps} onChange={(b) => set({ truncateIps: b })} />
                </div>
              )}
            />
          ) : tab === 'alerts' ? (
            <SectionForm
              section="alerts"
              initial={s.alerts}
              render={(v, set) => (
                <div className="space-y-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <Input label="Alert webhook URL" type="url" placeholder="https://hooks.slack.com/… or Discord webhook" value={v.webhookUrl ?? ''} onChange={(e) => set({ webhookUrl: e.target.value })} className="flex-1" />
                    <Button type="button" variant="outline" leftIcon={<Send className="h-4 w-4" />} onClick={() => test.mutate(undefined)} loading={test.isPending}>
                      Send test
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input label="Error rate threshold (%)" type="number" min={0} max={100} value={v.thresholds?.errorRatePct ?? 10} onChange={(e) => set({ thresholds: { ...v.thresholds, errorRatePct: Number(e.target.value) } })} />
                    <Input label="Budget headroom threshold (%)" type="number" min={0} max={100} value={v.thresholds?.budgetHeadroomPct ?? 20} onChange={(e) => set({ thresholds: { ...v.thresholds, budgetHeadroomPct: Number(e.target.value) } })} hint="Alert when less than this share of a TorBox budget remains." />
                    <Input label="Premium expiring (days)" type="number" min={0} value={v.thresholds?.premiumExpiringDays ?? 7} onChange={(e) => set({ thresholds: { ...v.thresholds, premiumExpiringDays: Number(e.target.value) } })} />
                    <Input label="Quota threshold (%)" type="number" min={0} max={100} value={v.thresholds?.quotaPct ?? 80} onChange={(e) => set({ thresholds: { ...v.thresholds, quotaPct: Number(e.target.value) } })} />
                  </div>
                </div>
              )}
            />
          ) : (
            <SectionForm section="docs" initial={s.docs} render={(v, set) => <Switch label="Public documentation" hint="Serve /docs and /openapi.json without authentication." checked={!!v.public} onChange={(b) => set({ public: b })} />} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
