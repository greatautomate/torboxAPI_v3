import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Play } from 'lucide-react';
import { api } from '../../lib/api';
import { useAllKeys, useApiMutation } from '../../lib/queries';
import type { PlaygroundResponse } from '../../lib/types';
import { ms, relative } from '../../lib/format';
import { Badge, Button, Card, CardBody, CardHeader, CodeBlock, DescriptionList, EmptyState, Input, JsonView, Select, Tabs, Textarea, httpTone, type BadgeTone } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';

const PRESETS = [
  { label: 'GET /api/v1/me', method: 'GET', path: '/api/v1/me' },
  { label: 'GET /api/v1/status', method: 'GET', path: '/api/v1/status' },
  { label: 'GET /api/v1/downloads', method: 'GET', path: '/api/v1/downloads' },
  { label: 'POST /api/v1/downloads', method: 'POST', path: '/api/v1/downloads', body: '{\n  "magnet": "magnet:?xt=urn:btih:…"\n}' },
  { label: 'POST /api/v1/cache/check', method: 'POST', path: '/api/v1/cache/check', body: '{\n  "hashes": ["…"]\n}' },
  { label: 'GET /v1/api/user/me', method: 'GET', path: '/v1/api/user/me' },
  { label: 'GET /v1/api/torrents/mylist', method: 'GET', path: '/v1/api/torrents/mylist' },
  { label: 'GET /v1/api/torrents/checkcached', method: 'GET', path: '/v1/api/torrents/checkcached', query: '{\n  "hash": "…",\n  "format": "object"\n}' },
];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const KEY_PLACEHOLDER = '<YOUR_KEY>';

type SnippetLang = 'curl' | 'js' | 'python';
const SNIPPET_TABS: Array<{ key: SnippetLang; label: string; language: string; title: string }> = [
  { key: 'curl', label: 'cURL', language: 'bash', title: 'cURL' },
  { key: 'js', label: 'JavaScript', language: 'javascript', title: 'JavaScript (fetch)' },
  { key: 'python', label: 'Python', language: 'python', title: 'Python (requests)' },
];

/** Gateway / rate-limit response headers worth surfacing. Header keys are matched case-insensitively. */
const GATEWAY_HEADERS: Array<{ key: string; label: string; format?: (v: string) => string; tone?: (v: string, all: Record<string, string>) => BadgeTone }> = [
  { key: 'x-ratelimit-limit', label: 'Rate limit' },
  {
    key: 'x-ratelimit-remaining',
    label: 'Remaining',
    tone: (v, all) => {
      const rem = Number(v);
      const lim = Number(all['x-ratelimit-limit']);
      if (!Number.isFinite(rem)) return 'neutral';
      if (rem <= 0) return 'danger';
      if (Number.isFinite(lim) && lim > 0 && rem / lim <= 0.1) return 'warning';
      return 'success';
    },
  },
  { key: 'x-ratelimit-reset', label: 'Resets', format: formatReset },
  { key: 'retry-after', label: 'Retry after', format: (v) => (/^\d+$/.test(v) ? `${v} s` : v), tone: () => 'warning' },
  { key: 'x-tbg-cache', label: 'Cache', tone: (v) => (/hit/i.test(v) ? 'info' : 'neutral') },
  { key: 'x-tbg-request-id', label: 'Request ID' },
];

/** x-ratelimit-reset may be a unix timestamp (seconds or ms), seconds-until-reset, or an ISO date. */
function formatReset(v: string): string {
  if (/^\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (n > 1e12) return `${relative(new Date(n).toISOString())} (${v})`;
    if (n > 1e9) return `${relative(new Date(n * 1000).toISOString())} (${v})`;
    return `in ${Math.round(n)} s`;
  }
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? v : `${relative(v)} (${v})`;
}

function lowerHeaders(h: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h ?? {})) out[k.toLowerCase()] = Array.isArray(v) ? (v as string[]).join(', ') : String(v);
  return out;
}

function parseJson(s: string): { value?: unknown; error?: string } {
  if (!s.trim()) return { value: undefined };
  try {
    return { value: JSON.parse(s) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Build the absolute URL the gateway would receive for the composed request. */
function composeUrl(path: string, query: Record<string, unknown> | undefined): string {
  const url = new URL(path || '/', window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) if (v != null && v !== '') url.searchParams.set(k, String(v));
  return url.toString();
}

const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
const jsq = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const pyq = jsq;

function buildSnippets(req: { method: string; url: string; headers: Record<string, string>; body: unknown }): Record<SnippetLang, string> {
  const hasBody = req.body !== undefined && req.method !== 'GET';
  const bodyJson = hasBody ? JSON.stringify(req.body, null, 2) : null;
  const extra = Object.entries(req.headers).filter(([k]) => k.toLowerCase() !== 'authorization');

  // cURL
  const curlLines = [`curl -X ${req.method} ${shq(req.url)}`, `  -H ${shq(`Authorization: Bearer ${KEY_PLACEHOLDER}`)}`];
  for (const [k, v] of extra) curlLines.push(`  -H ${shq(`${k}: ${v}`)}`);
  if (bodyJson) {
    if (!extra.some(([k]) => k.toLowerCase() === 'content-type')) curlLines.push(`  -H 'Content-Type: application/json'`);
    curlLines.push(`  -d ${shq(bodyJson)}`);
  }
  const curl = curlLines.join(' \\\n');

  // JavaScript (fetch)
  const jsHeaders = [`    Authorization: \`Bearer \${KEY}\``, ...extra.map(([k, v]) => `    ${jsq(k)}: ${jsq(v)}`)];
  if (bodyJson && !extra.some(([k]) => k.toLowerCase() === 'content-type')) jsHeaders.push(`    'Content-Type': 'application/json'`);
  const js = [
    `const KEY = ${jsq(KEY_PLACEHOLDER)};`,
    '',
    `const res = await fetch(${jsq(req.url)}, {`,
    `  method: ${jsq(req.method)},`,
    `  headers: {`,
    jsHeaders.join(',\n'),
    `  },`,
    ...(bodyJson ? [`  body: JSON.stringify(${bodyJson.replace(/\n/g, '\n  ')}),`] : []),
    `});`,
    `console.log(res.status, await res.json());`,
  ].join('\n');

  // Python (requests)
  const pyHeaders = [`    'Authorization': f'Bearer {KEY}'`, ...extra.map(([k, v]) => `    ${pyq(k)}: ${pyq(v)}`)];
  const py = [
    `import requests`,
    '',
    `KEY = ${pyq(KEY_PLACEHOLDER)}`,
    `headers = {`,
    pyHeaders.join(',\n'),
    `}`,
    ...(bodyJson ? [`payload = ${bodyJson.replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None')}`] : []),
    '',
    `res = requests.request(${pyq(req.method)}, ${pyq(req.url)}, headers=headers${bodyJson ? ', json=payload' : ''})`,
    `print(res.status_code, res.json())`,
  ].join('\n');

  return { curl, js, python: py };
}

export function PlaygroundPage() {
  const [sp] = useSearchParams();
  const keys = useAllKeys();
  const [keyId, setKeyId] = useState(sp.get('keyId') ?? '');
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/api/v1/me');
  const [query, setQuery] = useState('');
  const [headers, setHeaders] = useState('');
  const [body, setBody] = useState('');
  const [res, setRes] = useState<PlaygroundResponse | null>(null);
  const [snippetTab, setSnippetTab] = useState<SnippetLang>('curl');
  const m = useApiMutation((b: Parameters<typeof api.playground>[0]) => api.playground(b), { onSuccess: setRes });
  const pq = parseJson(query);
  const ph = parseJson(headers);
  const pb = parseJson(body);
  const pathOk = path.startsWith('/v1/api/') || path.startsWith('/api/v1/');
  const canSend = !!keyId && pathOk && !pq.error && !ph.error && !pb.error;
  const send = () => m.mutate({ keyId, method, path, query: pq.value as Record<string, unknown> | undefined, headers: ph.value as Record<string, string> | undefined, body: pb.value });

  const selectedKey = keys.data?.items.find((k) => k.id === keyId);
  const preselectedMissing = !!sp.get('keyId') && keys.data && !selectedKey;
  // Keep the preselected key visible even if it is not active so the admin sees why it may fail.
  const keyOptions = keys.data?.items.filter((k) => k.status === 'active' || k.id === keyId) ?? [];

  const snippets = useMemo(() => {
    if (!pathOk || pq.error || ph.error || pb.error) return null;
    const url = composeUrl(path, pq.value as Record<string, unknown> | undefined);
    return buildSnippets({ method, url, headers: (ph.value as Record<string, string> | undefined) ?? {}, body: pb.value });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, path, query, headers, body, pathOk]);
  const snippetMeta = SNIPPET_TABS.find((t) => t.key === snippetTab) ?? SNIPPET_TABS[0];

  const lh = useMemo(() => lowerHeaders(res?.headers), [res]);
  const gatewayItems = GATEWAY_HEADERS.filter((h) => lh[h.key] !== undefined && lh[h.key] !== '');

  return (
    <div>
      <PageHeader title="Playground" description="Send requests through the gateway as one of your keys. Great for checking scopes and policies before handing a key out." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Request" />
          <CardBody className="space-y-4">
            <Select label="API key" value={keyId} onChange={(e) => setKeyId(e.target.value)} required hint={selectedKey && selectedKey.status !== 'active' ? `This key is ${selectedKey.status}; requests will be rejected.` : undefined}>
              <option value="">Select a key…</option>
              {keyOptions.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} ({k.clientName}) · {k.prefix}…{k.last4}
                  {k.status !== 'active' ? ` · ${k.status}` : ''}
                </option>
              ))}
            </Select>
            {preselectedMissing && (
              <p className="text-xs text-amber-700 dark:text-amber-300" role="status">
                The key from the link was not found. Pick another one.
              </p>
            )}
            {selectedKey && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                <Link to={`/admin/keys/${selectedKey.id}`} className="text-accent-600 hover:underline">
                  {selectedKey.name}
                </Link>{' '}
                · {selectedKey.scopes.length} scopes · policy {selectedKey.policyName}
              </p>
            )}
            <div>
              <p className="label">Presets</p>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <Button key={p.label} size="sm" variant="secondary" onClick={() => (setMethod(p.method), setPath(p.path), setBody(p.body ?? ''), setQuery(p.query ?? ''))}>
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[130px_1fr]">
              <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
              <Input label="Path" value={path} onChange={(e) => setPath(e.target.value)} className="font-mono" error={!pathOk ? 'Path must start with /api/v1/ or /v1/api/' : undefined} />
            </div>
            <Textarea label="Query (JSON object)" value={query} onChange={(e) => setQuery(e.target.value)} rows={3} mono error={pq.error} placeholder='{ "limit": 10 }' />
            <Textarea label="Headers (JSON object)" value={headers} onChange={(e) => setHeaders(e.target.value)} rows={2} mono error={ph.error} placeholder='{ "X-Debug": "1" }' />
            <Textarea label="Body (JSON)" value={body} onChange={(e) => setBody(e.target.value)} rows={6} mono error={pb.error} disabled={method === 'GET'} />
            <Button onClick={send} disabled={!canSend} loading={m.isPending} leftIcon={<Play className="h-4 w-4" />} className="w-full sm:w-auto">
              Send
            </Button>
            {snippets && (
              <div className="min-w-0">
                <p className="label">Code for this request</p>
                <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                  Generated from the form above. Replace <code className="font-mono">{KEY_PLACEHOLDER}</code> with the consumer's secret.
                </p>
                <Tabs items={SNIPPET_TABS.map((t) => ({ key: t.key, label: t.label }))} value={snippetTab} onChange={setSnippetTab} variant="pills" className="mb-2" />
                <CodeBlock code={snippets[snippetMeta.key]} language={snippetMeta.language} title={snippetMeta.title} maxHeight="320px" />
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Response"
            actions={
              res && (
                <>
                  <Badge tone={httpTone(res.status)}>HTTP {res.status}</Badge>
                  <Badge title="Round-trip through the gateway">{ms(res.durationMs)}</Badge>
                </>
              )
            }
          />
          <CardBody className="space-y-4">
            {!res ? (
              <EmptyState title="No response yet" description="Pick a key and send a request." className="py-10" />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Status</span>
                  <Badge tone={httpTone(res.status)}>HTTP {res.status}</Badge>
                  <span className="text-gray-600 dark:text-gray-400">in</span>
                  <span className="tabular-nums font-medium">{ms(res.durationMs)}</span>
                </div>
                {gatewayItems.length > 0 && (
                  <section aria-labelledby="gw-headers" className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/60">
                    <h4 id="gw-headers" className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Rate limit &amp; gateway headers
                    </h4>
                    <DescriptionList
                      cols={2}
                      items={gatewayItems.map((h) => {
                        const raw = lh[h.key];
                        const text = h.format ? h.format(raw) : raw;
                        const tone = h.tone?.(raw, lh);
                        return {
                          label: h.label,
                          value: tone ? (
                            <Badge tone={tone} className="max-w-full">
                              <span className="truncate">{text}</span>
                            </Badge>
                          ) : (
                            <span className="break-all font-mono text-xs">{text}</span>
                          ),
                          full: h.key === 'x-tbg-request-id',
                        };
                      })}
                    />
                    {lh['x-tbg-request-id'] && (
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        <Link to={`/admin/logs?requestId=${encodeURIComponent(lh['x-tbg-request-id'])}`} className="text-accent-600 hover:underline">
                          Find this request in the logs
                        </Link>
                      </p>
                    )}
                  </section>
                )}
                <div>
                  <p className="label">Body</p>
                  <JsonView value={res.body} maxHeight="50vh" />
                </div>
                <details>
                  <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-medium sm:min-h-0 sm:py-0">All response headers ({Object.keys(res.headers ?? {}).length})</summary>
                  <JsonView value={res.headers} maxHeight="240px" className="mt-2" />
                </details>
                {res.curl && (
                  <div>
                    <p className="label">cURL (as sent by the server)</p>
                    <CodeBlock code={res.curl} language="bash" />
                  </div>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
