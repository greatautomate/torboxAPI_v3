import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Skeleton } from './Skeleton';

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  loading,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx('card flex items-start gap-3 p-4', className)}>
      {icon && (
        <div
          className={clsx(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            tone === 'neutral' && 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
            tone === 'accent' && 'bg-accent-50 text-accent-600 dark:bg-accent-950 dark:text-accent-300',
            tone === 'success' && 'bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-300',
            tone === 'warning' && 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300',
            tone === 'danger' && 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300',
          )}
          aria-hidden
        >
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
        {loading ? <Skeleton className="mt-1.5 h-7 w-20" /> : <p className="mt-0.5 truncate text-2xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">{value}</p>}
        {hint && <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
      </div>
    </div>
  );
}
