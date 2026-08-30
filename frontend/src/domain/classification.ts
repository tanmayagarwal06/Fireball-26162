/**
 * The canonical thermal classification model.
 *
 * This is the single place where class identity, labels, colours and the numeric
 * codes of the future ML model are defined. Never compare raw classification
 * strings elsewhere in the codebase — call `parseClassification()` and switch on
 * the returned key.
 *
 * The numeric codes match the target label set of the classification engine that
 * will be integrated later:
 *
 *   0 = Wildfire
 *   1 = Agricultural burning
 *   2 = Industrial fire
 *   3 = Gas flare
 *   4 = Persistent thermal source
 *   5 = Unknown
 *
 * When the model lands it will emit these codes; `fromModelCode()` is the entry
 * point that will need no changes.
 */

export const CLASSIFICATION_KEYS = [
  'WILDFIRE',
  'AGRICULTURAL_BURNING',
  'INDUSTRIAL_FIRE',
  'GAS_FLARE',
  'PERSISTENT_THERMAL_SOURCE',
  'UNKNOWN',
] as const;

export type ClassificationKey = (typeof CLASSIFICATION_KEYS)[number];

export interface ClassificationDefinition {
  key: ClassificationKey;
  /** Numeric label used by the future ML model. */
  code: 0 | 1 | 2 | 3 | 4 | 5;
  /** Label exactly as the backend emits it, for round-tripping into filters. */
  apiLabel: string;
  /** Full label for detail views and legends. */
  label: string;
  /** Abbreviated label for dense tables and narrow panels. */
  shortLabel: string;
  /** CSS custom property carrying this class's colour. */
  colorVar: string;
  /** Material Symbols ligature used to represent the class. */
  icon: string;
}

/**
 * Colours follow stitch/screen-3-analytics/code.html, the only Stitch palette
 * that defines all six classes consistently. Screens 1 and 2 used two other,
 * mutually incompatible palettes covering only four classes each.
 */
export const CLASSIFICATIONS: Record<ClassificationKey, ClassificationDefinition> = {
  WILDFIRE: {
    key: 'WILDFIRE',
    code: 0,
    apiLabel: 'Wildfire',
    label: 'Wildfire',
    shortLabel: 'Wildfire',
    colorVar: '--color-class-wildfire',
    icon: 'local_fire_department',
  },
  AGRICULTURAL_BURNING: {
    key: 'AGRICULTURAL_BURNING',
    code: 1,
    apiLabel: 'Agricultural Burning',
    label: 'Agricultural Burning',
    shortLabel: 'Ag-Burning',
    colorVar: '--color-class-agricultural',
    icon: 'agriculture',
  },
  INDUSTRIAL_FIRE: {
    key: 'INDUSTRIAL_FIRE',
    code: 2,
    apiLabel: 'Industrial Fire',
    label: 'Industrial Fire',
    shortLabel: 'Industrial',
    colorVar: '--color-class-industrial',
    icon: 'factory',
  },
  GAS_FLARE: {
    key: 'GAS_FLARE',
    code: 3,
    apiLabel: 'Gas Flare',
    label: 'Gas Flare',
    shortLabel: 'Gas Flare',
    colorVar: '--color-class-gas-flare',
    icon: 'gas_meter',
  },
  PERSISTENT_THERMAL_SOURCE: {
    key: 'PERSISTENT_THERMAL_SOURCE',
    code: 4,
    apiLabel: 'Persistent Thermal Source',
    label: 'Persistent Thermal Source',
    shortLabel: 'Persistent',
    colorVar: '--color-class-persistent',
    icon: 'schedule',
  },
  UNKNOWN: {
    key: 'UNKNOWN',
    code: 5,
    apiLabel: 'Unknown',
    label: 'Unknown',
    shortLabel: 'Unknown',
    colorVar: '--color-class-unknown',
    icon: 'help',
  },
};

/** Definitions in model-code order, for legends and distribution charts. */
export const CLASSIFICATION_LIST: ClassificationDefinition[] = CLASSIFICATION_KEYS.map(
  (key) => CLASSIFICATIONS[key],
);

/** Lookup table built once, keyed by normalised API label. */
const BY_NORMALISED_LABEL = new Map<string, ClassificationKey>(
  CLASSIFICATION_LIST.map((definition) => [normalise(definition.apiLabel), definition.key]),
);

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

/**
 * Resolve a backend classification string to a canonical key.
 * Unrecognised or missing values collapse to UNKNOWN, matching how the backend
 * itself defaults absent classifications in `/statistics`.
 */
export function parseClassification(raw: string | null | undefined): ClassificationKey {
  if (!raw) return 'UNKNOWN';
  return BY_NORMALISED_LABEL.get(normalise(raw)) ?? 'UNKNOWN';
}

/** True when the backend value mapped onto a known class rather than falling back. */
export function isRecognisedClassification(raw: string | null | undefined): boolean {
  return Boolean(raw) && BY_NORMALISED_LABEL.has(normalise(raw as string));
}

/** Full definition for a backend classification string. */
export function getClassification(raw: string | null | undefined): ClassificationDefinition {
  return CLASSIFICATIONS[parseClassification(raw)];
}

/**
 * Entry point for the future ML model, which will emit integer labels 0-5.
 * Out-of-range codes resolve to UNKNOWN rather than throwing, so an unexpected
 * model output degrades visibly instead of crashing the console.
 */
export function fromModelCode(code: number): ClassificationDefinition {
  const match = CLASSIFICATION_LIST.find((definition) => definition.code === code);
  return match ?? CLASSIFICATIONS.UNKNOWN;
}

/** The colour for a class, as a CSS `var()` expression. */
export function classificationColor(key: ClassificationKey): string {
  return `var(${CLASSIFICATIONS[key].colorVar})`;
}
