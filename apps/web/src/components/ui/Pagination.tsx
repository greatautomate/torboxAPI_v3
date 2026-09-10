import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

export function Pagination({ page, limit, total, onPage, onLimit }: { page: number; limit: number; total: number; onPage: (p: number) => void; onLimit?: (l: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(total, page * limit);
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm text-gray-600 sm:flex-row dark:border-gray-800 dark:text-gray-400">
      <div className="flex items-center gap-3">
        <span className="tabular-nums">
          {start}–{end} of {total.toLocaleString()}
        </span>
        {onLimit && (
          <label className="flex items-center gap-1.5">
            <span className="sr-only">Rows per page</span>
            <select value={limit} onChange={(e) => onLimit(Number(e.target.value))} className="input min-h-[36px] w-auto py-1 pr-7 text-xs" aria-label="Rows per page">
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onPage(page - 1)} disabled={page <= 1} leftIcon={<ChevronLeft className="h-4 w-4" />} aria-label="Previous page">
          Prev
        </Button>
        <span className="tabular-nums">
          {page} / {pages}
        </span>
        <Button size="sm" variant="outline" onClick={() => onPage(page + 1)} disabled={page >= pages} rightIcon={<ChevronRight className="h-4 w-4" />} aria-label="Next page">
          Next
        </Button>
      </div>
    </div>
  );
}
