/**
 * Label-over-value readout, the smallest repeating unit of the console.
 *
 * Used in the KPI ribbon, the investigation evidence panels and the alert
 * context strip. Numeric values render in JetBrains Mono per the design system.
 */
import type { ReactNode } from 'react';
import type { ProvenanceKey } from '../../domain/provenance';
import { ProvenanceTag } from './ProvenanceTag';

export interface MetricProps {
  label: string;
  /** Pre-formatted value. Use the helpers in src/domain/format.ts. */
  value: ReactNode;
  /** Secondary line beneath the value, e.g. a unit or qualifier. */
  hint?: string;
  /** Render the value in Inter rather than JetBrains Mono. */
  text?: boolean;
  size?: 'sm' | 'lg';
  /** CSS colour for the value, normally a var() from the token set. */
  valueColor?: string;
  /** Marks where the value came from: API, derived, or awaiting the model. */
  provenance?: ProvenanceKey;
  className?: string;
}

export function Metric({
  label,
  value,
  hint,
  text = false,
  size = 'sm',
  valueColor,
  provenance,
  className,
}: MetricProps) {
  const valueClasses = [
    text ? 'text-body-sm' : 'font-mono',
    text ? '' : size === 'lg' ? 'text-data-lg' : 'text-data',
    'truncate',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`flex min-w-0 flex-col gap-0.5${className ? ` ${className}` : ''}`}>
      <div className="flex items-center gap-1.5">
        <span className="truncate text-label uppercase text-on-surface-variant">{label}</span>
        {provenance ? <ProvenanceTag provenance={provenance} /> : null}
      </div>
      <span className={valueClasses} style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
      {hint ? <span className="truncate text-body-sm text-on-surface-variant">{hint}</span> : null}
    </div>
  );
}
