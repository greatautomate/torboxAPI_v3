import { Check, Copy } from 'lucide-react';
import { clsx } from 'clsx';
import { useCopy } from '../../lib/hooks/useCopy';

export function CopyButton({ text, className, label = 'Copy' }: { text: string; className?: string; label?: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(text)}
      aria-label={copied ? 'Copied' : label}
      className={clsx(
        'inline-flex h-9 min-w-[36px] shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
        className,
      )}
    >
      {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
      <span className="hidden sm:inline">{copied ? 'Copied' : label}</span>
    </button>
  );
}

export function CopyField({ value, label, mono = true, className, secret }: { value: string; label?: string; mono?: boolean; className?: string; secret?: boolean }) {
  return (
    <div className={clsx('min-w-0', className)}>
      {label && <p className="label">{label}</p>}
      <div className="flex items-center gap-1 rounded-lg border border-gray-300 bg-gray-50 p-1 pl-3 dark:border-gray-700 dark:bg-gray-950">
        <code className={clsx('min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1.5 text-sm scrollbar-thin', mono && 'font-mono', secret && 'select-all')} title={value}>
          {value}
        </code>
        <CopyButton text={value} />
      </div>
    </div>
  );
}
