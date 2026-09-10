import { clsx } from 'clsx';
import { ratioPct } from '../../lib/format';

export function Progress({ value, max, label, showValue = true, className, tone }: { value: number; max: number; label?: string; showValue?: boolean; className?: string; tone?: 'auto' | 'accent' }) {
  const pct = ratioPct(value, max);
  const color = tone === 'accent' || !max ? 'bg-accent-600' : pct >= 90 ? 'bg-red-600' : pct >= 75 ? 'bg-amber-500' : 'bg-accent-600';
  return (
    <div className={clsx('min-w-0', className)}>
      {(label || showValue) && (
        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-400">
          {label && <span className="truncate">{label}</span>}
          {showValue && (
            <span className="shrink-0 tabular-nums">
              {value.toLocaleString()} / {max ? max.toLocaleString() : '∞'}
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max || undefined}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
      >
        <div className={clsx('h-full rounded-full transition-[width]', color)} style={{ width: `${max ? pct : 0}%` }} />
      </div>
    </div>
  );
}
