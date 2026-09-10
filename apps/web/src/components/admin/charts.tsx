import type { ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compact, num } from '../../lib/format';
import { EmptyState } from '../ui';

export const CHART = {
  ok: 'var(--chart-ok)',
  error: 'var(--chart-error)',
  cached: 'var(--chart-cached)',
  grid: 'var(--chart-grid)',
  text: 'var(--chart-text)',
  surface: 'var(--chart-surface)',
};

export const axisProps = { tick: { fill: CHART.text, fontSize: 11 }, axisLine: false as const, tickLine: false as const };
export const gridProps = { stroke: CHART.grid, strokeDasharray: '0', vertical: false };

export function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter = num }: { active?: boolean; payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string }>; label?: string | number; labelFormatter?: (l: string | number) => ReactNode; valueFormatter?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-900">
      <p className="mb-1 font-medium text-gray-900 dark:text-gray-100">{labelFormatter ? labelFormatter(label ?? '') : label}</p>
      <ul className="space-y-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center justify-between gap-4 text-gray-700 dark:text-gray-300">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
              {p.name}
            </span>
            <span className="tabular-nums font-medium">{typeof p.value === 'number' ? valueFormatter(p.value) : p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartFrame({ height = 260, children, empty, title }: { height?: number; children: ReactNode; empty?: boolean; title?: string }) {
  if (empty) return <EmptyState title="No data for this range" className="py-8" />;
  return (
    <div style={{ height }} className="w-full min-w-0" role="img" aria-label={title}>
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

const legendStyle = { fontSize: 12, color: CHART.text };

/** Stacked bars: ok / cached / error. */
export function StackedRequestsChart({ data, xKey, xFormatter, height = 260, series }: { data: Array<Record<string, unknown>>; xKey: string; xFormatter?: (v: string) => string; height?: number; series?: Array<{ key: string; name: string; color: string }> }) {
  const s = series ?? [
    { key: 'ok', name: 'OK', color: CHART.ok },
    { key: 'cached', name: 'Cached', color: CHART.cached },
    { key: 'error', name: 'Errors', color: CHART.error },
  ];
  return (
    <ChartFrame height={height} empty={!data.length} title="Requests over time">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="20%">
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} tickFormatter={xFormatter} {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} tickFormatter={compact} width={48} />
        <Tooltip content={<ChartTooltip labelFormatter={(l) => (xFormatter ? xFormatter(String(l)) : String(l))} />} cursor={{ fill: CHART.grid, opacity: 0.4 }} />
        <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
        {s.map((ser, i) => (
          <Bar key={ser.key} dataKey={ser.key} name={ser.name} stackId="a" fill={ser.color} stroke={CHART.surface} strokeWidth={1} maxBarSize={24} radius={i === s.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

/** Single/multi-series area chart. */
export function AreaSeriesChart({ data, xKey, xFormatter, height = 260, series, stacked }: { data: Array<Record<string, unknown>>; xKey: string; xFormatter?: (v: string) => string; height?: number; series: Array<{ key: string; name: string; color: string }>; stacked?: boolean }) {
  return (
    <ChartFrame height={height} empty={!data.length} title="Usage over time">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} tickFormatter={xFormatter} {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} tickFormatter={compact} width={48} />
        <Tooltip content={<ChartTooltip labelFormatter={(l) => (xFormatter ? xFormatter(String(l)) : String(l))} />} />
        {series.length > 1 && <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />}
        {series.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stackId={stacked ? 'a' : undefined} stroke={s.color} strokeWidth={2} fill={s.color} fillOpacity={0.1} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }} isAnimationActive={false} />
        ))}
      </AreaChart>
    </ChartFrame>
  );
}

/** Horizontal ranked bars (top N list). */
export function RankedBars({ items, max, formatter = num }: { items: Array<{ label: ReactNode; value: number; sub?: ReactNode; href?: string }>; max?: number; formatter?: (n: number) => string }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <EmptyState title="No data" className="py-8" />;
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="min-w-0">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-gray-800 dark:text-gray-200">
              {it.label}
              {it.sub && <span className="ml-1.5 text-xs text-gray-500 dark:text-gray-400">{it.sub}</span>}
            </span>
            <span className="shrink-0 tabular-nums text-gray-600 dark:text-gray-400">{formatter(it.value)}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            <div className="h-full rounded-full bg-accent-600" style={{ width: `${Math.max(2, (it.value / m) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
