import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { SkeletonRows } from './Skeleton';
import { EmptyState } from './EmptyState';
import { Pagination } from './Pagination';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Shown prominently in the mobile card (title). */
  primary?: boolean;
  /** Hidden in the mobile card. */
  hideOnMobile?: boolean;
  className?: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Render trailing per-row actions (a Menu, buttons...). Kept in card header on mobile. */
  actions?: (row: T) => ReactNode;
  pagination?: { page: number; limit: number; total: number; onPage: (p: number) => void; onLimit?: (l: number) => void };
  className?: string;
  dense?: boolean;
  rowClassName?: (row: T) => string | undefined;
}

/**
 * Responsive table: a real <table> from md upwards, a card list below md.
 * Cards show the `primary` column as title, the rest as label/value pairs.
 */
export function DataTable<T>({ columns, rows, rowKey, loading, onRowClick, empty, emptyTitle, emptyDescription, actions, pagination, className, dense, rowClassName }: DataTableProps<T>) {
  const isEmpty = !loading && (!rows || rows.length === 0);
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary && !c.hideOnMobile);
  return (
    <div className={clsx('card overflow-hidden', className)}>
      {loading && !rows ? (
        <SkeletonRows />
      ) : isEmpty ? (
        empty ?? <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="scrollbar-thin hidden overflow-x-auto md:block" aria-busy={loading || undefined}>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-950/60 dark:text-gray-400">
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className={clsx('px-4 py-2.5 font-semibold', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)} style={{ width: c.width }}>
                      {c.header}
                    </th>
                  ))}
                  {actions && (
                    <th scope="col" className="px-4 py-2.5 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className={clsx('divide-y divide-gray-100 dark:divide-gray-800', loading && 'opacity-60')}>
                {rows!.map((r) => (
                  <tr
                    key={rowKey(r)}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick(r)) : undefined}
                    className={clsx(onRowClick && 'cursor-pointer hover:bg-gray-50 focus:bg-gray-50 dark:hover:bg-gray-800/60 dark:focus:bg-gray-800/60', rowClassName?.(r))}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={clsx('px-4 align-middle', dense ? 'py-1.5' : 'py-2.5', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>
                        {c.render(r)}
                      </td>
                    ))}
                    {actions && (
                      <td className="px-4 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end">{actions(r)}</div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile card list */}
          <ul className={clsx('divide-y divide-gray-100 md:hidden dark:divide-gray-800', loading && 'opacity-60')} aria-busy={loading || undefined}>
            {rows!.map((r) => (
              <li key={rowKey(r)} className={clsx('p-4', rowClassName?.(r))}>
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={clsx('min-w-0 flex-1 text-sm font-medium text-gray-900 dark:text-gray-100', onRowClick && 'cursor-pointer')}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    role={onRowClick ? 'button' : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick(r)) : undefined}
                  >
                    {primary.render(r)}
                  </div>
                  {actions && <div className="shrink-0">{actions(r)}</div>}
                </div>
                {rest.length > 0 && (
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm" onClick={onRowClick ? () => onRowClick(r) : undefined}>
                    {rest.map((c) => (
                      <div key={c.key} className="min-w-0">
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{c.header}</dt>
                        <dd className="min-w-0 break-words text-gray-800 dark:text-gray-200">{c.render(r)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {pagination && !isEmpty && <Pagination {...pagination} />}
    </div>
  );
}
