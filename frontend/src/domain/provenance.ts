/**
 * Data provenance.
 *
 * The brief requires the console to visibly distinguish three kinds of value:
 * what the API actually returned, what the frontend computed, and what is
 * waiting on the classification engine. Encoding that as a first-class concept
 * means every screen can label its values consistently and no placeholder can
 * silently pass itself off as a real measurement.
 */

export const PROVENANCE_KEYS = ['API', 'DERIVED', 'PENDING_MODEL'] as const;

export type ProvenanceKey = (typeof PROVENANCE_KEYS)[number];

export interface ProvenanceDefinition {
  key: ProvenanceKey;
  /** Short tag rendered next to a value or section heading. */
  tag: string;
  /** Tooltip text explaining where the value came from. */
  description: string;
}

export const PROVENANCE: Record<ProvenanceKey, ProvenanceDefinition> = {
  API: {
    key: 'API',
    tag: 'API',
    description: 'Returned directly by the backend from the hotspot dataset.',
  },
  DERIVED: {
    key: 'DERIVED',
    tag: 'DERIVED',
    description:
      'Computed in the frontend from API fields. The calculation is documented in src/domain.',
  },
  PENDING_MODEL: {
    key: 'PENDING_MODEL',
    tag: 'AWAITING MODEL',
    description:
      'Requires the classification engine, which is not implemented yet. No value is shown because none exists.',
  },
};
