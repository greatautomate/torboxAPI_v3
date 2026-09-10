import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { clsx } from 'clsx';

type Kind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: Kind;
  title: string;
  description?: string;
}
interface ToastApi {
  push: (kind: Kind, title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}
const Ctx = createContext<ToastApi | null>(null);
let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (kind: Kind, title: string, description?: string) => {
      const id = seq++;
      setItems((l) => [...l.slice(-4), { id, kind, title, description }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (t, d) => push('success', t, d),
      error: (t, d) => push('error', t, d),
      info: (t, d) => push('info', t, d),
    }),
    [push],
  );
  const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-end"
      >
        {items.map((t) => {
          const Icon = icons[t.kind];
          return (
            <div
              key={t.id}
              role="status"
              className={clsx(
                'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-white p-3 shadow-lg animate-slide-up dark:bg-gray-900',
                t.kind === 'error' && 'border-red-200 dark:border-red-900',
                t.kind === 'success' && 'border-green-200 dark:border-green-900',
                t.kind === 'info' && 'border-gray-200 dark:border-gray-800',
              )}
            >
              <Icon
                className={clsx(
                  'mt-0.5 h-5 w-5 shrink-0',
                  t.kind === 'error' && 'text-red-600',
                  t.kind === 'success' && 'text-green-600',
                  t.kind === 'info' && 'text-accent-600',
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium text-gray-900 dark:text-gray-100">{t.title}</p>
                {t.description && <p className="mt-0.5 break-words text-gray-600 dark:text-gray-400">{t.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="-m-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast outside ToastProvider');
  return v;
}
