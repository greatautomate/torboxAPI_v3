import { clsx } from 'clsx';
import { CopyButton } from './CopyField';

export function CodeBlock({ code, language, className, title, maxHeight }: { code: string; language?: string; className?: string; title?: string; maxHeight?: string }) {
  return (
    <div className={clsx('relative min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-950 text-gray-100 dark:border-gray-800', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-gray-800 px-3 py-1.5">
        <span className="truncate text-xs text-gray-400">{title ?? language ?? 'code'}</span>
        <CopyButton text={code} className="text-gray-300 hover:bg-gray-800" />
      </div>
      <pre className="scrollbar-thin overflow-x-auto p-4 text-[13px] leading-relaxed" style={{ maxHeight }}>
        <code className="font-mono" data-language={language}>
          {code}
        </code>
      </pre>
    </div>
  );
}

export function JsonView({ value, className, maxHeight = '60vh' }: { value: unknown; className?: string; maxHeight?: string }) {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return <CodeBlock code={text ?? 'null'} language="json" className={className} maxHeight={maxHeight} />;
}
