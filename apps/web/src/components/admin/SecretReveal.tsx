import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { CodeBlock, CopyField, Tabs } from '../ui';

const DOWNLOAD_READ_SCOPES = ['torrents:read', 'usenet:read', 'webdl:read'];

type Lang = 'curl' | 'js' | 'python';

/** Pick the first call to show based on the key's scopes. */
export function firstCallFor(scopes: string[] | undefined): { path: string; label: string } {
  if (scopes?.some((s) => DOWNLOAD_READ_SCOPES.includes(s))) return { path: '/api/v1/downloads', label: 'List downloads' };
  return { path: '/api/v1/me', label: 'Who am I' };
}

const MIRROR_PATH = '/v1/api/user/me';

export function quickStartSnippets({ secret, origin, scopes, keyName }: { secret: string; origin: string; scopes?: string[]; keyName?: string }): Record<Lang, string> {
  const first = firstCallFor(scopes);
  const firstUrl = `${origin}${first.path}`;
  const mirrorUrl = `${origin}${MIRROR_PATH}`;
  const intro = keyName ? ` (${keyName})` : '';
  return {
    curl: [
      `# ${first.label}${intro}`,
      `curl -H "Authorization: Bearer ${secret}" ${firstUrl}`,
      '',
      `# TorBox-compatible mirror (base ${origin}/v1/api)`,
      `curl -H "Authorization: Bearer ${secret}" ${mirrorUrl}`,
    ].join('\n'),
    js: [
      `const KEY = '${secret}';`,
      `const headers = { Authorization: \`Bearer \${KEY}\` };`,
      '',
      `// ${first.label}${intro}`,
      `const res = await fetch('${firstUrl}', { headers });`,
      `console.log(await res.json());`,
      '',
      `// TorBox-compatible mirror (base ${origin}/v1/api)`,
      `const me = await fetch('${mirrorUrl}', { headers });`,
      `console.log(await me.json());`,
    ].join('\n'),
    python: [
      `import requests`,
      '',
      `KEY = '${secret}'`,
      `headers = {'Authorization': f'Bearer {KEY}'}`,
      '',
      `# ${first.label}${intro}`,
      `res = requests.get('${firstUrl}', headers=headers)`,
      `print(res.json())`,
      '',
      `# TorBox-compatible mirror (base ${origin}/v1/api)`,
      `me = requests.get('${mirrorUrl}', headers=headers)`,
      `print(me.json())`,
    ].join('\n'),
  };
}

const LANG_TABS: Array<{ key: Lang; label: string; language: string; title: string }> = [
  { key: 'curl', label: 'cURL', language: 'bash', title: 'cURL' },
  { key: 'js', label: 'JavaScript', language: 'javascript', title: 'JavaScript (fetch)' },
  { key: 'python', label: 'Python', language: 'python', title: 'Python (requests)' },
];

export interface SecretRevealProps {
  secret: string;
  label?: string;
  description?: string;
  /** Show the quick-start snippets. Implied when `scopes` is provided. */
  curl?: boolean;
  /** Scopes of the created/rotated key; used to pick the first example call. */
  scopes?: string[];
  /** Optional key name shown in snippet comments. */
  keyName?: string;
}

export function SecretReveal({ secret, label = 'Secret', description = 'Copy it now — it will not be shown again.', curl, scopes, keyName }: SecretRevealProps) {
  const origin = window.location.origin;
  const [lang, setLang] = useState<Lang>('curl');
  const showQuickStart = curl || !!scopes;
  const snippets = showQuickStart ? quickStartSnippets({ secret, origin, scopes, keyName }) : null;
  const current = LANG_TABS.find((t) => t.key === lang) ?? LANG_TABS[0];
  const first = firstCallFor(scopes);
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" role="alert">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>{description}</p>
      </div>
      <CopyField label={label} value={secret} secret />
      {snippets && (
        <div className="min-w-0">
          <p className="label">Quick start</p>
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
            First call: <code className="font-mono">GET {first.path}</code>
            {scopes && scopes.length > 0 ? ' (picked from this key’s scopes)' : ''}. The second line uses the TorBox-compatible mirror at <code className="font-mono">/v1/api</code>.
          </p>
          <Tabs items={LANG_TABS.map((t) => ({ key: t.key, label: t.label }))} value={lang} onChange={setLang} variant="pills" className="mb-2" />
          <CodeBlock language={current.language} title={current.title} code={snippets[current.key]} />
        </div>
      )}
    </div>
  );
}
