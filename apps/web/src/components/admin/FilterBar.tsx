import { useState, type ReactNode } from 'react';
import { Filter, X } from 'lucide-react';
import { Button, Drawer } from '../ui';

/**
 * Filters render inline (grid) on md+, and collapse into a "Filters" sheet on mobile.
 * `activeCount` shows a badge on the mobile trigger.
 */
export function FilterBar({ children, activeCount = 0, onReset, actions, cols = 4 }: { children: ReactNode; activeCount?: number; onReset?: () => void; actions?: ReactNode; cols?: 3 | 4 | 5 | 6 }) {
  const [open, setOpen] = useState(false);
  const grid = { 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5', 6: 'md:grid-cols-6' }[cols];
  return (
    <div className="mb-4">
      {/* Mobile */}
      <div className="flex flex-wrap items-center gap-2 md:hidden">
        <Button variant="outline" onClick={() => setOpen(true)} leftIcon={<Filter className="h-4 w-4" />} className="min-w-[8rem] flex-1">
          Filters{activeCount > 0 && <span className="ml-1 rounded-full bg-accent-600 px-1.5 text-xs text-white">{activeCount}</span>}
        </Button>
        {onReset && activeCount > 0 && (
          <Button variant="ghost" size="icon" onClick={onReset} aria-label="Reset filters">
            <X className="h-4 w-4" />
          </Button>
        )}
        {actions}
      </div>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
        side="bottom"
        footer={
          <>
            {onReset && (
              <Button variant="outline" onClick={onReset}>
                Reset
              </Button>
            )}
            <Button onClick={() => setOpen(false)}>Apply</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3">{children}</div>
      </Drawer>
      {/* Desktop */}
      <div className="card hidden p-4 md:block">
        <div className={`grid grid-cols-2 gap-3 ${grid}`}>{children}</div>
        {(onReset || actions) && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              {onReset && (
                <Button variant="ghost" size="sm" onClick={onReset} disabled={activeCount === 0} leftIcon={<X className="h-4 w-4" />}>
                  Reset filters
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function countActive(params: Record<string, string | undefined>, ignore: string[] = ['page', 'limit', 'tab']): number {
  return Object.entries(params).filter(([k, v]) => !ignore.includes(k) && v !== undefined && v !== '').length;
}
