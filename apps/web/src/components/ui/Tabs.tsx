import type { ReactNode } from 'react';
import { clsx } from 'clsx';

export interface TabItem<K extends string = string> {
  key: K;
  label: ReactNode;
  count?: number;
}
export function Tabs<K extends string>({ items, value, onChange, className, variant = 'underline' }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; className?: string; variant?: 'underline' | 'pills' }) {
  return (
    <div role="tablist" aria-orientation="horizontal" className={clsx('scrollbar-thin -mx-1 flex gap-1 overflow-x-auto px-1', variant === 'underline' && 'border-b border-gray-200 dark:border-gray-800', className)}>
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className={clsx(
              'flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap px-3 text-sm font-medium transition-colors',
              variant === 'underline' &&
                (active
                  ? '-mb-px border-b-2 border-accent-600 text-accent-700 dark:text-accent-300'
                  : 'border-b-2 border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'),
              variant === 'pills' &&
                (active ? 'rounded-lg bg-accent-50 text-accent-700 dark:bg-accent-950 dark:text-accent-300' : 'rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'),
            )}
          >
            {it.label}
            {it.count !== undefined && <span className="rounded-full bg-gray-100 px-1.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
