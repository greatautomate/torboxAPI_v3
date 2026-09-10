import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';

export interface MenuItem {
  label: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

export function Menu({ trigger, items, align = 'right', label = 'Actions' }: { trigger: ReactNode; items: MenuItem[]; align?: 'left' | 'right'; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block text-left">
      <div onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={label} role="button" tabIndex={-1}>
        {trigger}
      </div>
      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute z-40 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg animate-fade-in dark:border-gray-700 dark:bg-gray-900',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((it, i) =>
            it.divider ? (
              <div key={i} className="my-1 border-t border-gray-200 dark:border-gray-800" role="separator" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
                className={clsx(
                  'flex w-full min-h-[40px] items-center gap-2 px-3 py-2 text-left text-sm disabled:opacity-50',
                  it.danger ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800',
                )}
              >
                {it.icon}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
