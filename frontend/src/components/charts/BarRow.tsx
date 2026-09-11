/**
 * Horizontal bar row.
 *
 * The console's primary chart primitive: a label, a proportional bar and a value.
 * Built from divs rather than a charting library â€” the visualisations here are
 * deliberately restrained, and a chart dependency would bring axes, tooltips and
 * animation the design explicitly rejects.
 *
 * Bars are proportional to the largest value in the set, not to the total, so a
 * dominant category does not flatten everything else into invisibility.
 */
import type { ReactNode } from 'react';

export interface BarRowProps {
  label: string;
  value: number;
  /** Largest value in the set; the bar is scaled against this. */
  max: number;
  /** CSS colour for the fill. */
  color?: string;
  /** Overrides the numeral shown on the right. */
  valueLabel?: ReactNode;
  /** Makes the row a toggle, e.g. to isolate a class. */
  onClick?: () => void;
  active?: boolean;
  title?: string;
  /** Width of the label column. Keep consistent within one chart. */
  labelWidth?: string;
}

export function BarRow({
  label,
  value,
  max,
  color = 'var(--color-primary)',
  valueLabel,
  onClick,
  active = false,
  title,
  labelWidth = '9rem',
}: BarRowProps) {
  // Guard against a zero max, which would produce NaN.
  const ratio = max > 0 ? Math.min(1, value / max) : 0;

  const content = (
    <>
      <span
        className="shrink-0 truncate text-body-sm text-on-surface-variant"
        style={{ width: labelWidth }}
      >
        {label}
      </span>

      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-lowest">
        <span
          className="block h-full rounded-full transition-[width] duration-300"
          style={{ backgroundColor: color, width: `${ratio * 100}%` }}
        />
      </span>

      <span className="w-10 shrink-0 text-right font-mono text-data text-on-surface">
        {valueLabel ?? value}
      </span>
    </>
  );

  if (!onClick) {
    return (
      <div className="flex items-center gap-2" title={title}>
        {content}
      </div>
    );
  }

  return (
    <button
      aria-pressed={active}
      className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-left hover:bg-surface-high ${
        active ? 'bg-surface-high' : ''
      }`}
      onClick={onClick}
      title={title}
      type="button"
    >
      {content}
    </button>
  );
}

/**
 * Bar chart from label/value pairs, scaled to the set's own maximum.
 */
export function BarChart({
  data,
  labelWidth,
  emptyLabel = 'No data',
}: {
  data: Array<{
    key: string;
    label: string;
    value: number;
    color?: string;
    onClick?: () => void;
    active?: boolean;
    title?: string;
  }>;
  labelWidth?: string;
  emptyLabel?: string;
}) {
  if (data.length === 0) {
    return <p className="text-body-sm text-on-surface-variant">{emptyLabel}</p>;
  }

  const max = Math.max(...data.map((entry) => entry.value), 0);

  return (
    <div className="flex flex-col gap-1.5">
      {data.map((entry) => (
        <BarRow
          active={entry.active}
          color={entry.color}
          key={entry.key}
          label={entry.label}
          labelWidth={labelWidth}
          max={max}
          onClick={entry.onClick}
          title={entry.title}
          value={entry.value}
        />
      ))}
    </div>
  );
}
