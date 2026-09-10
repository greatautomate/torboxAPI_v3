import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, BookOpen, CornerDownLeft, Download, ExternalLink, KeyRound, Moon, Plus, Radio, ScrollText, Search, Sun, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { NAV } from './nav';
import { api } from '../../lib/api';
import { useTheme } from '../../lib/hooks/useTheme';
import { useAuth } from '../../lib/auth';

interface Item {
  id: string;
  label: ReactNode;
  text: string; // used for filtering
  hint?: string;
  group: string;
  icon: ReactNode;
  run: () => void;
}

function useDebounced<T>(value: T, delay = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/**
 * ⌘K / Ctrl+K command palette: jump to any page, run quick actions and search
 * keys, clients, logs, activity, downloads and events from anywhere in the admin.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const { canWrite } = useAuth();
  const { isDark, toggle } = useTheme();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dq = useDebounced(q.trim(), 200);
  const remote = dq.length >= 2 && open;
  const keys = useQuery({ queryKey: ['palette', 'keys', dq], queryFn: () => api.keys.list({ q: dq, limit: 5 }), enabled: remote, staleTime: 30_000 });
  const clients = useQuery({ queryKey: ['palette', 'clients', dq], queryFn: () => api.clients.list({ q: dq, limit: 5 }), enabled: remote, staleTime: 30_000 });

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const go = (to: string) => {
    onClose();
    nav(to);
  };

  const items = useMemo<Item[]>(() => {
    const term = q.trim();
    const lc = term.toLowerCase();
    const out: Item[] = [];
    for (const g of NAV) {
      for (const it of g.items) {
        out.push({ id: `nav:${it.to}`, label: it.label, text: `${it.label} ${g.title ?? ''}`.toLowerCase(), hint: it.to, group: g.title ? `Go to · ${g.title}` : 'Go to', icon: <it.icon className="h-4 w-4" aria-hidden />, run: () => go(it.to) });
      }
    }
    if (canWrite) out.push({ id: 'act:newkey', label: 'Create API key', text: 'create new api key', group: 'Actions', icon: <Plus className="h-4 w-4" aria-hidden />, run: () => go('/admin/keys/new') });
    out.push({ id: 'act:theme', label: isDark ? 'Switch to light theme' : 'Switch to dark theme', text: 'theme dark light switch toggle', group: 'Actions', icon: isDark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />, run: () => { toggle(); onClose(); } });
    out.push({ id: 'act:docs', label: 'Open API docs', text: 'open api docs swagger openapi', group: 'Actions', icon: <BookOpen className="h-4 w-4" aria-hidden />, run: () => { window.open('/docs', '_blank'); onClose(); } });
    out.push({ id: 'act:home', label: 'Open homepage', text: 'open homepage public site', group: 'Actions', icon: <ExternalLink className="h-4 w-4" aria-hidden />, run: () => { window.open('/', '_blank'); onClose(); } });

    const filtered = lc ? out.filter((i) => i.text.includes(lc)) : out;
    if (!term) return filtered;

    const enc = encodeURIComponent(term);
    const searches: Item[] = [
      { id: 'q:logs', label: <>Search request logs for <b>“{term}”</b></>, text: '', group: 'Search', icon: <ScrollText className="h-4 w-4" aria-hidden />, run: () => go(`/admin/logs?q=${enc}`) },
      { id: 'q:activity', label: <>Search activity for <b>“{term}”</b></>, text: '', group: 'Search', icon: <Activity className="h-4 w-4" aria-hidden />, run: () => go(`/admin/activity?q=${enc}`) },
      { id: 'q:keys', label: <>Find API keys matching <b>“{term}”</b></>, text: '', group: 'Search', icon: <KeyRound className="h-4 w-4" aria-hidden />, run: () => go(`/admin/keys?q=${enc}`) },
      { id: 'q:clients', label: <>Find clients matching <b>“{term}”</b></>, text: '', group: 'Search', icon: <Users className="h-4 w-4" aria-hidden />, run: () => go(`/admin/clients?q=${enc}`) },
      { id: 'q:downloads', label: <>Find download <b>“{term}”</b> (name, hash or public id)</>, text: '', group: 'Search', icon: <Download className="h-4 w-4" aria-hidden />, run: () => go(`/admin/downloads?q=${enc}`) },
      { id: 'q:events', label: <>Events for public id <b>“{term}”</b></>, text: '', group: 'Search', icon: <Radio className="h-4 w-4" aria-hidden />, run: () => go(`/admin/events?publicId=${enc}`) },
    ];
    const hits: Item[] = [];
    for (const k of keys.data?.items ?? []) hits.push({ id: `key:${k.id}`, label: k.name, text: '', hint: `${k.clientName} · ${k.prefix}… · ${k.status}`, group: 'API keys', icon: <KeyRound className="h-4 w-4" aria-hidden />, run: () => go(`/admin/keys/${k.id}`) });
    for (const c of clients.data?.items ?? []) hits.push({ id: `client:${c.id}`, label: c.name, text: '', hint: `${c.keysCount} keys · ${c.status}`, group: 'Clients', icon: <Users className="h-4 w-4" aria-hidden />, run: () => go(`/admin/clients/${c.id}`) });
    return [...hits, ...filtered, ...searches];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, keys.data, clients.data, canWrite, isDark]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const el = listRef.current?.querySelectorAll('[data-active="true"]')?.[0] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[active]?.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup = '';
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[max(4rem,env(safe-area-inset-top))] sm:pt-24" role="presentation">
      <div className="absolute inset-0 bg-gray-900/50 animate-fade-in dark:bg-black/70" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 animate-slide-up dark:bg-gray-900 dark:ring-white/10">
        <div className="flex items-center gap-2 border-b border-gray-200 px-3 dark:border-gray-800">
          <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `palette-${items[active].id}` : undefined}
            aria-autocomplete="list"
            placeholder="Jump to a page, search keys, clients, logs, downloads…"
            className="min-h-[52px] w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
          />
          <kbd className="hidden rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 sm:inline dark:border-gray-700 dark:text-gray-400">esc</kbd>
        </div>
        <ul id="palette-list" ref={listRef} role="listbox" className="max-h-[min(60dvh,420px)] overflow-y-auto py-2 scrollbar-thin">
          {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-500">Nothing matches “{q}”.</li>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.id} role="presentation">
                {header && <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{header}</p>}
                <button
                  type="button"
                  id={`palette-${it.id}`}
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => it.run()}
                  className={clsx('flex min-h-[44px] w-full items-center gap-3 px-4 text-left text-sm', i === active ? 'bg-accent-50 text-accent-700 dark:bg-accent-950/60 dark:text-accent-200' : 'text-gray-700 dark:text-gray-200')}
                >
                  <span className={clsx('shrink-0', i === active ? 'text-accent-600 dark:text-accent-300' : 'text-gray-400')}>{it.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="hidden max-w-[40%] truncate text-xs text-gray-400 sm:inline">{it.hint}</span>}
                  {i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-2 text-[11px] text-gray-400 dark:border-gray-800 dark:text-gray-500">
          <span>
            <kbd className="rounded border border-gray-200 px-1 dark:border-gray-700">↑</kbd> <kbd className="rounded border border-gray-200 px-1 dark:border-gray-700">↓</kbd> to navigate · <kbd className="rounded border border-gray-200 px-1 dark:border-gray-700">↵</kbd> to open
          </span>
          <span className="hidden sm:inline">
            <kbd className="rounded border border-gray-200 px-1 dark:border-gray-700">⌘K</kbd> / <kbd className="rounded border border-gray-200 px-1 dark:border-gray-700">Ctrl K</kbd> anywhere · <kbd className="rounded border border-gray-200 px-1 dark:border-gray-700">/</kbd> focuses search
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
