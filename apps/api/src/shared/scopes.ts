export type ScopeDef = { scope: string; group: string; description: string; default: boolean };

export const SCOPES: ScopeDef[] = [
  { scope: 'general', group: 'General', description: 'Status, TorBox stats, changelogs, speedtest files, magnet→torrent conversion, Usenet server info', default: true },
  { scope: 'torrents:read', group: 'Torrents', description: 'List torrents, cache checks, torrent info, export magnet/file, view torrent queue', default: true },
  { scope: 'torrents:write', group: 'Torrents', description: 'Add torrents (magnet/file), control (delete/reannounce/resume/stop seeding), edit, control queue', default: false },
  { scope: 'usenet:read', group: 'Usenet', description: 'List Usenet downloads and cache checks', default: false },
  { scope: 'usenet:write', group: 'Usenet', description: 'Add NZBs/links, control and edit Usenet downloads', default: false },
  { scope: 'usenet:provider', group: 'Usenet', description: 'Read/reset the operator\'s TorBox news-server (NNTP) credentials — sensitive, Pro plan', default: false },
  { scope: 'webdl:read', group: 'Web downloads', description: 'List web/debrid downloads, cache checks, hoster catalogue', default: true },
  { scope: 'webdl:write', group: 'Web downloads', description: 'Add web links, control and edit web downloads', default: false },
  { scope: 'downloads:link', group: 'Links', description: 'Generate CDN download links (requestdl) and signed permalinks', default: true },
  { scope: 'stream', group: 'Streaming', description: 'Create HLS streams for video files (Pro plan upstream)', default: false },
  { scope: 'rss:read', group: 'RSS', description: 'List RSS feeds and feed items', default: false },
  { scope: 'rss:write', group: 'RSS', description: 'Add, modify and control RSS feeds (Pro plan upstream)', default: false },
  { scope: 'notifications:read', group: 'Notifications', description: 'Read the upstream account notifications (JSON/RSS)', default: false },
  { scope: 'notifications:write', group: 'Notifications', description: 'Clear notifications, send test notification', default: false },
  { scope: 'user:read', group: 'Account', description: 'Redacted upstream account info, stats, subscriptions, transactions', default: false },
  { scope: 'user:pii', group: 'Account', description: 'Unmask email/customer fields in user/me', default: false },
  { scope: 'user:settings', group: 'Account', description: 'Edit upstream account settings (allow-listed fields only) — dangerous', default: false },
  { scope: 'integrations:read', group: 'Integrations', description: 'View cloud upload jobs and linked OAuth providers', default: false },
  { scope: 'integrations:write', group: 'Integrations', description: 'Queue cloud uploads (Google Drive, Dropbox, OneDrive, GoFile, 1Fichier, Pixeldrain), cancel jobs', default: false },
  { scope: 'webhooks', group: 'Events', description: 'Self-service webhook subscriptions and the /api/v1/events feed', default: false },
];

export const SCOPE_PRESETS: Record<string, string[]> = {
  readonly: ['general', 'torrents:read', 'usenet:read', 'webdl:read', 'downloads:link', 'user:read'],
  full: SCOPES.map((s) => s.scope).filter((s) => !['usenet:provider', 'user:settings', 'user:pii'].includes(s)),
  media: ['general', 'torrents:read', 'torrents:write', 'usenet:read', 'usenet:write', 'webdl:read', 'webdl:write', 'downloads:link', 'stream', 'webhooks'],
};

export const ALL_SCOPES = new Set(SCOPES.map((s) => s.scope));
export function hasScope(granted: string[], required: string | string[] | null): boolean {
  if (!required) return true;
  const req = Array.isArray(required) ? required : [required];
  return req.some((r) => granted.includes(r));
}
