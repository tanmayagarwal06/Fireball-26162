/**
 * Small tag marking where a value came from.
 *
 * Keeping this visible everywhere is what stops the prototype from overstating
 * itself: a reviewer can tell at a glance which numbers the backend produced,
 * which the frontend computed, and which are still waiting on the model.
 */
import { PROVENANCE, type ProvenanceKey } from '../../domain/provenance';

export interface ProvenanceTagProps {
  provenance: ProvenanceKey;
  className?: string;
}

const TONE: Record<ProvenanceKey, string> = {
  API: 'border-outline-variant text-on-surface-variant',
  DERIVED: 'border-outline-variant text-outline',
  PENDING_MODEL: 'border-tertiary/40 text-tertiary',
};

export function ProvenanceTag({ provenance, className }: ProvenanceTagProps) {
  const definition = PROVENANCE[provenance];

  return (
    <span
      className={`inline-flex shrink-0 items-center border px-1 text-[9px] font-bold uppercase leading-[14px] tracking-[0.06em] ${TONE[provenance]}${
        className ? ` ${className}` : ''
      }`}
      title={definition.description}
    >
      {definition.tag}
    </span>
  );
}
