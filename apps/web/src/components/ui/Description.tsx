import type { ReactNode } from 'react';
import { clsx } from 'clsx';

export function DescriptionList({ items, className, cols = 2 }: { items: Array<{ label: ReactNode; value: ReactNode; full?: boolean }>; className?: string; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={clsx('grid gap-x-4 gap-y-3 text-sm', cols === 1 && 'grid-cols-1', cols === 2 && 'grid-cols-1 sm:grid-cols-2', cols === 3 && 'grid-cols-1 sm:grid-cols-3', className)}>
      {items.map((it, i) => (
        <div key={i} className={clsx('min-w-0', it.full && 'sm:col-span-full')}>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{it.label}</dt>
          <dd className="mt-0.5 min-w-0 break-words text-gray-900 dark:text-gray-100">{it.value ?? '–'}</dd>
        </div>
      ))}
    </dl>
  );
}
