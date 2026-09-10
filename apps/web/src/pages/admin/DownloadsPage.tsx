import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Link2, MoreHorizontal, PlayCircle, Radio, Search, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAllKeys, useApiMutation, useDownload, useDownloads, useUpstreams } from '../../lib/queries';
import type { Download, DownloadAction, DownloadFile, DownloadType, StreamInfo } from '../../lib/types';
import { useQueryParams } from '../../lib/hooks/useQueryParams';
import { useDebounce } from '../../lib/hooks/useDebounce';
import { bytes, date, duration, num, pct, relative, speed } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Badge, Button, ConfirmDialog, CopyField, DataTable, DescriptionList, Drawer, EmptyState, Input, Menu, Modal, Progress, Select, SkeletonText, StatusBadge, Switch, Tabs, useToast, type Column } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';
import { FilterBar, countActive } from '../../components/admin/FilterBar';
import { activitySummary } from '../../components/admin/ActivityView';
import { useEffect } from 'react';

const ACTIONS: Array<{ action: DownloadAction; label: string; danger?: boolean }> = [
  { action: 'start', label: 'Start' },
  { action: 'resume', label: 'Resume' },
  { action: 'pause', label: 'Pause' },
  { action: 'reannounce', label: 'Reannounce' },
  { action: 'stop_seeding', label: 'Stop seeding' },
  { action: 'delete', label: 'Delete', danger: true },
];
const STATES = ['downloading', 'uploading', 'completed', 'cached', 'paused', 'stalled', 'queued', 'failed', 'error'];

/** TorBox endpoints the gateway calls on behalf of each admin action, so confirmations can name them. */
const CONTROL_ENDPOINT: Record<DownloadType, string> = {
  torrent: 'POST /v1/api/torrents/controltorrent',
  usenet: 'POST /v1/api/usenet/controlusenetdownload',
  webdl: 'POST /v1/api/webdl/controlwebdownload',
};
const LINK_ENDPOINT: Record<DownloadType, string> = {
  torrent: 'GET /v1/api/torrents/requestdl',
  usenet: 'GET /v1/api/usenet/requestdl',
  webdl: 'GET /v1/api/webdl/requestdl',
};
const STREAM_ENDPOINT = 'POST /v1/api/stream/createstream';
const controlEndpoint = (type: DownloadType | undefined) => (type ? CONTROL_ENDPOINT[type] : 'the TorBox control endpoint');
const isVideo = (f: DownloadFile) => (f.mimetype ?? '').toLowerCase().startsWith('video/');

export function DownloadsPage() {
  const { params, set, reset, page } = useQueryParams<{ upstreamId?: string; type?: string; state?: string; q?: string; live?: string; page?: string; id?: string }>();
  const [q, setQ] = useState(params.q ?? '');
  const dq = useDebounce(q);
  useEffect(() => {
    if ((dq || undefined) !== params.q) set({ q: dq || undefined });
  }, [dq, params.q, set]);
  const live = params.live === 'true';
  const limit = 50;
  const query = useMemo(() => ({ upstreamId: params.upstreamId, type: params.type, state: params.state, q: params.q, page, limit, live: live ? 'true' : undefined }), [params.upstreamId, params.type, params.state, params.q, page, live]);
  const dl = useDownloads(query, live);
  const ups = useUpstreams();
  const { canWrite } = useAuth();
  const [confirm, setConfirm] = useState<{ d: Download; action: DownloadAction } | null>(null);
  const [bulk, setBulk] = useState(false);
  const act = useApiMutation((v: { id: string; action: DownloadAction }) => api.downloads.action(v.id, v.action), { invalidate: [['downloads']], success: (_r, v) => `Action "${v.action}" sent` });

  const columns: Column<Download>[] = [
    {
      key: 'name',
      header: 'Download',
      primary: true,
      render: (d) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium" title={d.name}>
            {d.name}
            {d.missing && <Badge tone="warning" className="ml-2 align-middle">missing upstream</Badge>}
          </span>
          <span className="block truncate font-mono text-xs text-gray-500">
            {d.publicId} · {d.type}
            {d.upstreamLabel ? ` · ${d.upstreamLabel}` : ''}
          </span>
        </span>
      ),
    },
    { key: 'state', header: 'State', render: (d) => <StatusBadge status={d.state}>{d.state}</StatusBadge> },
    { key: 'progress', header: 'Progress', render: (d) => <Progress value={Math.round((d.progress ?? 0) * (d.progress <= 1 ? 100 : 1))} max={100} showValue={false} tone="accent" className="min-w-[100px]" label={pct(d.progress <= 1 ? d.progress * 100 : d.progress, 0)} /> },
    { key: 'size', header: 'Size', align: 'right', render: (d) => <span className="tabular-nums">{bytes(d.size)}</span> },
    { key: 'speed', header: 'Speed', align: 'right', render: (d) => <span className="text-xs tabular-nums">{d.active ? `↓ ${speed(d.downloadSpeed)}` : '–'}</span>, hideOnMobile: true },
    { key: 'peers', header: 'S/P', align: 'right', render: (d) => <span className="text-xs tabular-nums">{d.seeds ?? '–'}/{d.peers ?? '–'}</span>, hideOnMobile: true },
    { key: 'by', header: 'Created by', render: (d) => (d.createdByKeyId ? <Link to={`/admin/keys/${d.createdByKeyId}`} className="truncate text-accent-600 hover:underline" onClick={(e) => e.stopPropagation()}>{d.createdByKeyName ?? d.createdByKeyId}</Link> : <span className="text-xs text-gray-400">–</span>), hideOnMobile: true },
    { key: 'created', header: 'Added', render: (d) => <span className="text-xs text-gray-500" title={date(d.createdAt)}>{relative(d.createdAt)}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Downloads"
        description="Everything currently on your upstream TorBox accounts: torrents, usenet and web downloads."
        actions={
          <>
            <Switch checked={live} onChange={(v) => set({ live: v ? 'true' : undefined }, false)} label={<span className="flex items-center gap-1 text-sm"><Radio className={`h-4 w-4 ${live ? 'text-green-600' : ''}`} aria-hidden /> Live</span>} className="min-h-0 py-0" />
            {canWrite && (
              <Button variant="danger" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setBulk(true)}>
                Bulk delete
              </Button>
            )}
          </>
        }
      />
      <FilterBar activeCount={countActive(params, ['page', 'limit', 'live', 'id'])} onReset={() => (setQ(''), reset())} cols={4}>
        <Input label="Search" placeholder="name, hash, public id" value={q} onChange={(e) => setQ(e.target.value)} leftIcon={<Search className="h-4 w-4" />} />
        <Select label="Upstream" value={params.upstreamId ?? ''} onChange={(e) => set({ upstreamId: e.target.value })}>
          <option value="">All accounts</option>
          {ups.data?.items.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </Select>
        <Select label="Type" value={params.type ?? ''} onChange={(e) => set({ type: e.target.value })}>
          <option value="">Any type</option>
          <option value="torrent">torrent</option>
          <option value="usenet">usenet</option>
          <option value="webdl">webdl</option>
        </Select>
        <Select label="State" value={params.state ?? ''} onChange={(e) => set({ state: e.target.value })}>
          <option value="">Any state</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={dl.data?.items}
        rowKey={(d) => d.publicId}
        loading={dl.isLoading}
        onRowClick={(d) => set({ id: d.publicId }, false)}
        empty={<EmptyState title="No downloads" description="Downloads submitted through the gateway or directly on TorBox will show up here." />}
        actions={(d) =>
          canWrite &&
          !d.missing && (
            <Menu
              trigger={
                <Button variant="ghost" size="icon" aria-label={`Actions for ${d.name}`}>
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              }
              items={ACTIONS.map((a) => ({ label: a.label, danger: a.danger, onClick: () => setConfirm({ d, action: a.action }) }))}
            />
          )
        }
        pagination={{ page, limit, total: dl.data?.total ?? 0, onPage: (p) => set({ page: p }, false) }}
      />
      <DownloadDrawer publicId={params.id ?? null} live={live} onClose={() => set({ id: undefined }, false)} onAction={(d, action) => setConfirm({ d, action })} />
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        danger={confirm?.action === 'delete'}
        title={`${ACTIONS.find((a) => a.action === confirm?.action)?.label} "${confirm?.d.name}"?`}
        description={
          <>
            <span className="block">{confirm?.action === 'delete' ? 'The download is removed from the TorBox account. Generated permalinks will stop working.' : `Send "${confirm?.action}" to TorBox for this ${confirm?.d.type}.`}</span>
            <span className="mt-1 block text-xs text-gray-500">
              Upstream call{confirm?.d.upstreamLabel ? ` on ${confirm.d.upstreamLabel}` : ''}: <code className="font-mono">{controlEndpoint(confirm?.d.type)}</code>
            </span>
          </>
        }
        confirmLabel={ACTIONS.find((a) => a.action === confirm?.action)?.label ?? 'Confirm'}
        onConfirm={() => act.mutateAsync({ id: confirm!.d.publicId, action: confirm!.action })}
      />
      <BulkDeleteModal open={bulk} onClose={() => setBulk(false)} />
    </div>
  );
}

function DownloadDrawer({ publicId, live, onClose, onAction }: { publicId: string | null; live: boolean; onClose: () => void; onAction: (d: Download, a: DownloadAction) => void }) {
  const q = useDownload(publicId, live);
  const { canWrite } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'files' | 'history' | 'raw'>('files');
  const [links, setLinks] = useState<Record<string, string>>({});
  const [streams, setStreams] = useState<Record<string, StreamInfo>>({});
  useEffect(() => {
    setLinks({});
    setStreams({});
  }, [publicId]);
  const link = useApiMutation((v: { fileId?: number | string; zip?: boolean }) => api.downloads.link(publicId!, v), {
    onSuccess: (r, v) => setLinks((l) => ({ ...l, [v.zip ? 'zip' : String(v.fileId)]: r.url })),
  });
  const stream = useApiMutation((v: { fileId: number | string }) => api.downloads.stream(publicId!, { fileId: Number(v.fileId) }), {
    silent: true,
    onSuccess: (r, v) => setStreams((m) => ({ ...m, [String(v.fileId)]: r })),
    onError: (e) => {
      if (e.code === 'PLAN_RESTRICTED_FEATURE') toast.error('Streaming requires a TorBox Pro upstream', e.message);
      else toast.error(e.message || 'Could not create stream', `${STREAM_ENDPOINT} · ${e.code}`);
    },
  });
  const d = q.data?.download;
  const idx = q.data?.index;
  const missing = d?.missing === true;
  const files = d?.files ?? [];
  const tags = d?.tags ?? [];
  const canTouchUpstream = canWrite && !missing;
  const fileCols: Column<DownloadFile>[] = [
    { key: 'name', header: 'File', primary: true, render: (f) => <span className="block truncate font-mono text-xs" title={f.name}>{f.shortName || f.name}</span> },
    { key: 'size', header: 'Size', align: 'right', render: (f) => <span className="tabular-nums text-xs">{bytes(f.size)}</span> },
    { key: 'mime', header: 'Type', render: (f) => <span className="text-xs text-gray-500">{f.mimetype ?? '–'}</span>, hideOnMobile: true },
  ];
  return (
    <Drawer open={!!publicId} onClose={onClose} title={d?.name ?? 'Download'} description={d ? `${d.type} · ${d.publicId}${d.upstreamLabel ? ` · ${d.upstreamLabel}` : ''}` : undefined} width="xl">
      {!d ? (
        <SkeletonText lines={8} />
      ) : (
        <div className="space-y-5">
          {missing && (
            <div role="status" className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="font-medium">This item is no longer on TorBox</p>
                <p className="mt-0.5 text-xs opacity-90">TorBox actions and links are unavailable; the gateway keeps the index record and its history.</p>
                {idx && (idx.firstSeenAt || idx.lastSeenAt || idx.deletedAt) && (
                  <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                    {idx.firstSeenAt && (
                      <div>
                        <dt className="opacity-75">First seen</dt>
                        <dd className="font-medium">{date(idx.firstSeenAt)}</dd>
                      </div>
                    )}
                    {idx.lastSeenAt && (
                      <div>
                        <dt className="opacity-75">Last seen</dt>
                        <dd className="font-medium">{date(idx.lastSeenAt)}</dd>
                      </div>
                    )}
                    {idx.deletedAt && (
                      <div>
                        <dt className="opacity-75">Deleted</dt>
                        <dd className="font-medium">{date(idx.deletedAt)}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={d.state} />
            {missing && <Badge tone="warning">missing upstream</Badge>}
            {d.cached && <Badge tone="accent">cached</Badge>}
            {d.active && <Badge tone="info">active</Badge>}
            {tags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
          <Progress label={`${d.rawState} · ${pct(d.progress <= 1 ? d.progress * 100 : d.progress, 0)}`} value={Math.round(d.progress <= 1 ? d.progress * 100 : d.progress)} max={100} showValue={false} tone="accent" />
          <DescriptionList
            cols={3}
            items={[
              { label: 'Size', value: bytes(d.size) },
              { label: 'Download', value: speed(d.downloadSpeed) },
              { label: 'Upload', value: speed(d.uploadSpeed) },
              { label: 'ETA', value: d.eta ? duration(d.eta) : '–' },
              { label: 'Seeds / peers', value: `${d.seeds ?? '–'} / ${d.peers ?? '–'}` },
              { label: 'Ratio', value: d.ratio?.toFixed(2) ?? '–' },
              { label: 'TorBox ID', value: String(d.torboxId) },
              { label: 'Upstream', value: d.upstreamLabel ? <span title={d.upstreamAccountId}>{d.upstreamLabel}</span> : d.upstreamAccountId },
              { label: 'Created by', value: d.createdByKeyId ? <Link to={`/admin/keys/${d.createdByKeyId}`} className="text-accent-600 hover:underline">{d.createdByKeyName ?? d.createdByKeyId}</Link> : '–' },
              { label: 'Added', value: date(d.createdAt) },
              { label: 'Updated', value: date(d.updatedAt) },
              { label: 'Expires', value: date(d.expiresAt) },
              { label: 'Hash', value: d.hash ? <span className="break-all font-mono text-xs">{d.hash}</span> : '–', full: true },
            ]}
          />
          {canTouchUpstream && (
            <div>
              <div className="flex flex-wrap gap-2">
                {ACTIONS.map((a) => (
                  <Button key={a.action} size="sm" variant={a.danger ? 'danger' : 'outline'} onClick={() => onAction(d, a.action)}>
                    {a.label}
                  </Button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-gray-500">
                Control actions call <code className="font-mono">{CONTROL_ENDPOINT[d.type]}</code> on TorBox.
              </p>
            </div>
          )}
          <Tabs items={[{ key: 'files', label: 'Files', count: files.length }, { key: 'history', label: 'History', count: q.data?.history?.length }, { key: 'raw', label: 'Raw' }]} value={tab} onChange={setTab} />
          {tab === 'files' && (
            <div className="space-y-3">
              {canTouchUpstream && files.length > 0 && (
                <p className="text-xs text-gray-500">
                  "Get link" calls <code className="font-mono">{LINK_ENDPOINT[d.type]}</code>; "Open stream" calls <code className="font-mono">{STREAM_ENDPOINT}</code> on TorBox.
                </p>
              )}
              {files.length > 1 && canTouchUpstream && (
                <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">All files as zip</span>
                    <Button size="sm" variant="secondary" leftIcon={<Link2 className="h-4 w-4" />} onClick={() => link.mutate({ zip: true })} loading={link.isPending && link.variables?.zip === true}>
                      Get link
                    </Button>
                  </div>
                  {links.zip && <CopyField value={links.zip} />}
                </div>
              )}
              <DataTable
                columns={fileCols}
                rows={files}
                rowKey={(f) => String(f.id)}
                dense
                emptyTitle={missing ? 'No file list retained' : 'No files yet'}
                actions={(f) =>
                  canTouchUpstream ? (
                    <span className="flex items-center justify-end gap-1">
                      {isVideo(f) && (
                        <Button size="sm" variant="outline" leftIcon={<PlayCircle className="h-4 w-4" />} onClick={() => stream.mutate({ fileId: f.id })} loading={stream.isPending && stream.variables?.fileId === f.id}>
                          Open stream
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" leftIcon={<Link2 className="h-4 w-4" />} onClick={() => link.mutate({ fileId: f.id })} loading={link.isPending && link.variables?.fileId === f.id}>
                        Get link
                      </Button>
                    </span>
                  ) : null
                }
              />
              {Object.entries(links)
                .filter(([k]) => k !== 'zip')
                .map(([fid, url]) => (
                  <CopyField key={fid} label={`Link for file ${fid}`} value={url} />
                ))}
              {Object.entries(streams).map(([fid, si]) => {
                const f = files.find((x) => String(x.id) === fid);
                return (
                  <div key={`stream-${fid}`} className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium" title={si.name ?? f?.name ?? undefined}>
                        HLS stream · {si.name ?? f?.shortName ?? f?.name ?? `file ${fid}`}
                      </span>
                      <a href={si.hlsUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-sm font-medium text-accent-600 hover:underline sm:min-h-0">
                        Open <ExternalLink className="h-4 w-4" aria-hidden />
                      </a>
                    </div>
                    <CopyField value={si.hlsUrl} />
                    <p className="text-xs text-gray-500">
                      {si.isTranscoding ? 'TorBox is transcoding this file right now; the playlist may buffer or return 404 until segments are ready.' : si.needsTranscoding ? 'This file needs transcoding; TorBox will start it when the stream is first requested.' : 'Ready to play; no transcoding required.'}
                      {si.mimetype ? ` · ${si.mimetype}` : ''}
                      {si.presignedToken ? ' · presigned' : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
          {tab === 'history' && (
            <ol className="relative space-y-4 border-l border-gray-200 pl-5 dark:border-gray-800">
              {!q.data?.history?.length && <p className="text-sm text-gray-500">No recorded activity.</p>}
              {(q.data?.history ?? []).map((h) => (
                <li key={h.id} className="relative">
                  <span className={`absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-white dark:border-gray-900 ${h.success ? 'bg-accent-600' : 'bg-red-600'}`} aria-hidden />
                  <p className="text-xs text-gray-500">{date(h.ts, { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  <p className="text-sm">
                    <Badge className="mr-1">{h.kind}</Badge>
                    {h.action && <span className="font-medium">{h.action} </span>}
                    <span className="text-gray-600 dark:text-gray-400">
                      by {h.keyName ?? 'unknown'}
                      {h.error && <span className="text-red-600"> · {h.error}</span>}
                    </span>
                  </p>
                  {activitySummary(h) && <p className="mt-0.5 truncate font-mono text-xs text-gray-500" title={activitySummary(h)}>{activitySummary(h)}</p>}
                </li>
              ))}
            </ol>
          )}
          {tab === 'raw' && <pre className="scrollbar-thin max-h-[50vh] overflow-auto rounded-lg bg-gray-950 p-3 font-mono text-xs text-gray-100">{JSON.stringify(d, null, 2)}</pre>}
        </div>
      )}
    </Drawer>
  );
}

function BulkDeleteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ups = useUpstreams();
  const keys = useAllKeys();
  const [f, setF] = useState({ upstreamId: '', olderThanDays: '', createdByKeyId: '', state: '' });
  const [confirm, setConfirm] = useState(false);
  const m = useApiMutation((b: Parameters<typeof api.downloads.bulkDelete>[0]) => api.downloads.bulkDelete(b), {
    invalidate: [['downloads']],
    success: (r) => `Deleted ${num(r.deleted)} downloads`,
    onSuccess: () => {
      setConfirm(false);
      onClose();
    },
  });
  const body = { upstreamId: f.upstreamId, olderThanDays: f.olderThanDays ? Number(f.olderThanDays) : undefined, createdByKeyId: f.createdByKeyId || undefined, state: f.state || undefined };
  return (
    <>
      <Modal
        open={open && !confirm}
        onClose={onClose}
        title="Bulk delete downloads"
        description="Remove many downloads from a TorBox account at once. Narrow the selection with the optional filters."
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" disabled={!f.upstreamId} onClick={() => setConfirm(true)}>
              Continue
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select label="Upstream account" value={f.upstreamId} onChange={(e) => setF({ ...f, upstreamId: e.target.value })} required>
            <option value="">Select…</option>
            {ups.data?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </Select>
          <Input label="Older than (days)" type="number" min={0} value={f.olderThanDays} onChange={(e) => setF({ ...f, olderThanDays: e.target.value })} hint="Optional" />
          <Select label="Created by key" value={f.createdByKeyId} onChange={(e) => setF({ ...f, createdByKeyId: e.target.value })}>
            <option value="">Any key</option>
            {keys.data?.items.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name} ({k.clientName})
              </option>
            ))}
          </Select>
          <Select label="State" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>
            <option value="">Any state</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      </Modal>
      <ConfirmDialog open={open && confirm} onClose={() => setConfirm(false)} danger title="Delete matching downloads?" description={
          <>
            <span className="block">{`Downloads on "${ups.data?.items.find((u) => u.id === f.upstreamId)?.label}"${f.olderThanDays ? ` older than ${f.olderThanDays} days` : ''}${f.state ? ` in state ${f.state}` : ''}${f.createdByKeyId ? ' created by the selected key' : ''} will be removed from TorBox. This cannot be undone.`}</span>
            <span className="mt-1 block text-xs text-gray-500">
              One delete call per item via <code className="font-mono">{CONTROL_ENDPOINT.torrent}</code>, <code className="font-mono">{CONTROL_ENDPOINT.usenet}</code> or <code className="font-mono">{CONTROL_ENDPOINT.webdl}</code> depending on type.
            </span>
          </>
        } confirmLabel="Delete downloads" onConfirm={() => m.mutateAsync(body)} />
    </>
  );
}
