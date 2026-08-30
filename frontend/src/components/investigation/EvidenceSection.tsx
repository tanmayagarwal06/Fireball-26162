/**
 * Evidence block.
 *
 * The investigation screen is organised around answering "why was this hotspot
 * classified this way?". Each block covers one evidence axis and carries a
 * strength assessment plus a provenance tag, so the operator can see both what
 * the evidence says and how much of it is measurement versus inference.
 *
 * Strength is a documented frontend heuristic over API fields — never a model
 * output. `PENDING_MODEL` blocks show no value at all rather than a placeholder
 * number, because inventing one would misrepresent the system's capability.
 */
import type { ReactNode } from 'react';
import type { ProvenanceKey } from '../../domain/provenance';
// Strength levels are defined once, alongside the logic that assigns them.
import type { EvidenceStrength } from '../../domain/evidence';
import { Icon } from '../ui/Icon';
import { ProvenanceTag } from '../ui/ProvenanceTag';

const STRENGTH_STYLE: Record<EvidenceStrength, { label: string; className: string }> = {
  strong: { label: 'Strong', className: 'border-primary/40 bg-primary/10 text-primary' },
  moderate: {
    label: 'Moderate',
    className: 'border-outline-variant bg-surface-high text-on-surface-variant',
  },
  weak: { label: 'Weak', className: 'border-tertiary/40 bg-tertiary/10 text-tertiary' },
  absent: { label: 'Not present', className: 'border-outline-variant text-outline' },
  unavailable: { label: 'No data', className: 'border-outline-variant text-outline' },
};

export interface EvidenceSectionProps {
  title: string;
  icon: string;
  strength: EvidenceStrength;
  provenance: ProvenanceKey;
  /** One-line reading of what this evidence indicates. */
  interpretation: string;
  /** Supporting measurements. */
  children?: ReactNode;
  /** Explains how `strength` was determined, shown on hover. */
  strengthBasis?: string;
}

export function EvidenceSection({
  title,
  icon,
  strength,
  provenance,
  interpretation,
  children,
  strengthBasis,
}: EvidenceSectionProps) {
  const style = STRENGTH_STYLE[strength];

  return (
    <section className="border border-outline-variant bg-surface-container">
      <header className="flex items-center gap-2 border-b border-outline-variant bg-surface-low px-compact py-1">
        <h3 className="flex min-w-0 items-center gap-1.5 text-label uppercase text-on-surface">
          <Icon name={icon} size={14} />
          <span className="truncate">{title}</span>
        </h3>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <ProvenanceTag provenance={provenance} />
          <span
            className={`border px-1 text-[9px] font-bold uppercase leading-[14px] tracking-[0.06em] ${style.className}`}
            title={strengthBasis ?? 'Frontend assessment derived from API fields.'}
          >
            {style.label}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-2 p-compact">
        <p className="text-body-sm text-on-surface-variant">{interpretation}</p>
        {children}
      </div>
    </section>
  );
}

/** Compact label/value pair for use inside an evidence block. */
export function EvidenceRow({
  label,
  value,
  emphasis = false,
  title,
}: {
  label: string;
  value: ReactNode;
  emphasis?: boolean;
  title?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3" title={title}>
      <span className="shrink-0 text-body-sm text-on-surface-variant">{label}</span>
      <span
        className={`min-w-0 truncate text-right font-mono text-data ${
          emphasis ? 'text-on-surface' : 'text-on-surface-variant'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
