import { Input } from './Input';
import { fromLocalInput, toLocalInput } from '../../lib/format';
import { Button } from './Button';

export function DateRangePicker({
  from,
  to,
  onChange,
  presets = true,
}: {
  from?: string;
  to?: string;
  onChange: (v: { from?: string; to?: string }) => void;
  presets?: boolean;
}) {
  const setDays = (d: number) => onChange({ from: new Date(Date.now() - d * 86400000).toISOString(), to: undefined });
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input label="From" type="datetime-local" value={toLocalInput(from)} onChange={(e) => onChange({ from: fromLocalInput(e.target.value), to })} />
        <Input label="To" type="datetime-local" value={toLocalInput(to)} onChange={(e) => onChange({ from, to: fromLocalInput(e.target.value) })} />
      </div>
      {presets && (
        <div className="flex flex-wrap gap-1.5">
          {[
            ['1h', 1 / 24],
            ['24h', 1],
            ['7d', 7],
            ['30d', 30],
          ].map(([l, d]) => (
            <Button key={String(l)} size="sm" variant="secondary" onClick={() => setDays(Number(d))}>
              {l}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => onChange({ from: undefined, to: undefined })}>
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}
