import type { HTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
const tones: Record<BadgeTone, string> = {
  neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  accent: 'bg-accent-50 text-accent-700 dark:bg-accent-950 dark:text-accent-300',
  success: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
  warning: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  danger: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  info: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
};

export function Badge({ tone = 'neutral', className, children, dot, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)} {...rest}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function statusTone(status: string | null | undefined): BadgeTone {
  switch ((status ?? '').toLowerCase()) {
    case 'active':
    case 'delivered':
    case 'ok':
    case 'completed':
    case 'success':
    case 'seeding':
    case 'cached':
      return 'success';
    case 'degraded':
    case 'suspended':
    case 'pending':
    case 'paused':
    case 'stalled':
    case 'warning':
    case 'queued':
      return 'warning';
    case 'disabled':
    case 'revoked':
    case 'failed':
    case 'dead':
    case 'error':
    case 'critical':
      return 'danger';
    case 'downloading':
    case 'uploading':
    case 'info':
      return 'info';
    default:
      return 'neutral';
  }
}
export function StatusBadge({ status, children }: { status: string | null | undefined; children?: ReactNode }) {
  return (
    <Badge tone={statusTone(status)} dot>
      {children ?? status ?? '–'}
    </Badge>
  );
}
export function httpTone(status: number | null | undefined): BadgeTone {
  if (!status) return 'neutral';
  if (status < 300) return 'success';
  if (status < 400) return 'info';
  if (status < 500) return 'warning';
  return 'danger';
}
