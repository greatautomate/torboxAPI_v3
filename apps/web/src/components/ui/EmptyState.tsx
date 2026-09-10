import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { clsx } from 'clsx';

export function EmptyState({ title = 'Nothing here yet', description, action, icon, className }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500" aria-hidden>
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <h3 className="mt-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <EmptyState
      title="Something went wrong"
      description={message ?? 'The request failed.'}
      action={
        onRetry && (
          <button type="button" onClick={onRetry} className="text-sm font-medium text-accent-600 hover:underline">
            Try again
          </button>
        )
      }
    />
  );
}
