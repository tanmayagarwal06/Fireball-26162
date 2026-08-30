/**
 * Filter model.
 *
 * Pure logic, deliberately free of React so it can be unit-tested directly.
 *
 * ---------------------------------------------------------------------------
 * SERVER-SIDE VS CLIENT-SIDE
 * ---------------------------------------------------------------------------
 * Filters are pushed to the backend wherever the backend genuinely supports
 * them. Two exceptions are applied on the client, both for documented reasons:
 *
 *  1. Persistence. The `min_persistence` query parameter is a no-op because of
 *     the `get_persistence()` defect described in src/domain/persistence.ts.
 *
 *  2. Multi-class selection. The backend's `classification` parameter takes a
 *     single exact-match value. The Stitch design uses a checkbox list, so when
 *     exactly one class is selected we push it to the API, and when several are
 *     selected we fetch unfiltered and narrow on the client. `filterPlacement()`
 *     reports which of the two is in effect so the UI can label it.
 *
 * Every other filter maps one-to-one onto a real backend parameter.
 */
import { CLASSIFICATION_KEYS, parseClassification, type ClassificationKey } from './classification';
import { filterByPersistence, resolvePersistenceDays } from './persistence';
import type { Hotspot, HotspotQuery } from '../types/hotspot';

export interface FilterState {
  /**
   * Classes to include. An empty array and a full array both mean "all",
   * so clearing every checkbox does not produce an empty map.
   */
  classifications: ClassificationKey[];
  /** Inclusive lower bound on risk_score. */
  minRisk: number | null;
  /** Full sensor identifier, e.g. "VIIRS_NOAA20_NRT". */
  satellite: string | null;
  /** Inclusive lower bound on derived persistence, in days. */
  minPersistence: number | null;
  /** Inclusive upper bound on distance_to_industry_km. */
  maxIndustrialDistance: number | null;
  landCover: string | null;
  /** "YYYY-MM-DD". */
  dateFrom: string | null;
  dateTo: string | null;
}

export const DEFAULT_FILTERS: FilterState = {
  classifications: [],
  minRisk: null,
  satellite: null,
  minPersistence: null,
  maxIndustrialDistance: null,
  landCover: null,
  dateFrom: null,
  dateTo: null,
};

/** True when nothing is narrowing the dataset. */
export function isDefaultFilters(filters: FilterState): boolean {
  return countActiveFilters(filters) === 0;
}

/** How many filters are narrowing the result, for the "N active" badge. */
export function countActiveFilters(filters: FilterState): number {
  let count = 0;

  if (isClassificationNarrowing(filters)) count += 1;
  if (filters.minRisk !== null) count += 1;
  if (filters.satellite !== null) count += 1;
  if (filters.minPersistence !== null) count += 1;
  if (filters.maxIndustrialDistance !== null) count += 1;
  if (filters.landCover !== null) count += 1;
  if (filters.dateFrom !== null) count += 1;
  if (filters.dateTo !== null) count += 1;

  return count;
}

/** A class selection only narrows if it is a strict, non-empty subset. */
export function isClassificationNarrowing(filters: FilterState): boolean {
  const selected = filters.classifications.length;
  return selected > 0 && selected < CLASSIFICATION_KEYS.length;
}

export type FilterPlacement = 'server' | 'client' | 'inactive';

/**
 * Where a given filter is actually being applied. Surfaced in the UI so an
 * operator can tell which constraints the backend enforced.
 */
export function filterPlacement(filters: FilterState, key: keyof FilterState): FilterPlacement {
  switch (key) {
    case 'classifications':
      if (!isClassificationNarrowing(filters)) return 'inactive';
      // A single selection maps onto the backend's one-value parameter.
      return filters.classifications.length === 1 ? 'server' : 'client';

    case 'minPersistence':
      // Always client-side until get_persistence() is fixed in app.py.
      return filters.minPersistence === null ? 'inactive' : 'client';

    case 'minRisk':
      return filters.minRisk === null ? 'inactive' : 'server';
    case 'satellite':
      return filters.satellite === null ? 'inactive' : 'server';
    case 'maxIndustrialDistance':
      return filters.maxIndustrialDistance === null ? 'inactive' : 'server';
    case 'landCover':
      return filters.landCover === null ? 'inactive' : 'server';
    case 'dateFrom':
      return filters.dateFrom === null ? 'inactive' : 'server';
    case 'dateTo':
      return filters.dateTo === null ? 'inactive' : 'server';

    default:
      return 'inactive';
  }
}

/**
 * Build the query string parameters for `GET /hotspots`.
 *
 * Only parameters the backend implements and can honour are included:
 * `min_persistence` is intentionally omitted, and `classification` is only sent
 * when a single class is selected.
 */
export function toHotspotQuery(filters: FilterState): HotspotQuery {
  const query: HotspotQuery = {};

  if (filters.classifications.length === 1) {
    const key = filters.classifications[0];
    // Send the backend's own label so its case-insensitive match succeeds.
    query.classification = classificationApiLabel(key);
  }

  if (filters.minRisk !== null) query.min_risk = filters.minRisk;
  if (filters.satellite !== null) query.satellite = filters.satellite;
  if (filters.maxIndustrialDistance !== null) {
    query.max_industrial_distance = filters.maxIndustrialDistance;
  }
  if (filters.landCover !== null) query.land_cover = filters.landCover;
  if (filters.dateFrom !== null) query.date_from = filters.dateFrom;
  if (filters.dateTo !== null) query.date_to = filters.dateTo;

  return query;
}

/**
 * Apply the filters the backend could not.
 *
 * Runs after the API response. When a single class is selected the backend has
 * already filtered it, so re-applying here is a harmless no-op.
 */
export function applyClientFilters(hotspots: Hotspot[], filters: FilterState): Hotspot[] {
  let result = hotspots;

  if (isClassificationNarrowing(filters)) {
    const allowed = new Set(filters.classifications);
    result = result.filter((hotspot) => allowed.has(parseClassification(hotspot.classification)));
  }

  if (filters.minPersistence !== null) {
    result = filterByPersistence(result, filters.minPersistence);
  }

  return result;
}

/** Imported lazily to keep this module free of the definitions table. */
function classificationApiLabel(key: ClassificationKey): string {
  return CLASSIFICATION_API_LABELS[key];
}

/**
 * Duplicated deliberately as a flat lookup so this module stays a leaf in the
 * dependency graph. Kept honest by the unit test that asserts it matches
 * CLASSIFICATIONS.
 */
const CLASSIFICATION_API_LABELS: Record<ClassificationKey, string> = {
  WILDFIRE: 'Wildfire',
  AGRICULTURAL_BURNING: 'Agricultural Burning',
  INDUSTRIAL_FIRE: 'Industrial Fire',
  GAS_FLARE: 'Gas Flare',
  PERSISTENT_THERMAL_SOURCE: 'Persistent Thermal Source',
  UNKNOWN: 'Unknown',
};

/* -------------------------------------------------------------------------- */
/* Discrete option sets for the filter controls                               */
/* -------------------------------------------------------------------------- */

export interface FilterOption<T> {
  label: string;
  value: T;
}

/** Risk thresholds offered in the UI, aligned with the risk bands. */
export const MIN_RISK_OPTIONS: FilterOption<number | null>[] = [
  { label: 'Any risk', value: null },
  { label: 'Medium and above (50+)', value: 50 },
  { label: 'High and above (80+)', value: 80 },
  { label: 'Critical only (90+)', value: 90 },
];

/** Persistence thresholds, matching the derived persistence bands. */
export const MIN_PERSISTENCE_OPTIONS: FilterOption<number | null>[] = [
  { label: 'Any persistence', value: null },
  { label: '2+ days', value: 2 },
  { label: '4+ days', value: 4 },
  { label: '7+ days (persistent)', value: 7 },
];

/** Industrial proximity bands, matching the backend's /statistics buckets. */
export const MAX_INDUSTRIAL_DISTANCE_OPTIONS: FilterOption<number | null>[] = [
  { label: 'Any distance', value: null },
  { label: 'Within 500 m', value: 0.5 },
  { label: 'Within 2 km', value: 2 },
  { label: 'Within 5 km', value: 5 },
];

/** Sort orders offered on list and table views. Applied on the client. */
export const SORT_OPTIONS = [
  { label: 'Highest risk', value: 'risk-desc' },
  { label: 'Lowest risk', value: 'risk-asc' },
  { label: 'Most persistent', value: 'persistence-desc' },
  { label: 'Highest FRP', value: 'frp-desc' },
  { label: 'Nearest infrastructure', value: 'proximity-asc' },
  { label: 'Most recent', value: 'recent-desc' },
  { label: 'Hotspot ID', value: 'id-asc' },
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]['value'];

/** Sort a hotspot list. Nulls always sort last regardless of direction. */
export function sortHotspots(hotspots: Hotspot[], key: SortKey): Hotspot[] {
  const sorted = [...hotspots];

  const nullsLast = (a: number | null, b: number | null, ascending: boolean): number => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return ascending ? a - b : b - a;
  };

  switch (key) {
    case 'risk-desc':
      return sorted.sort((a, b) => b.risk_score - a.risk_score);
    case 'risk-asc':
      return sorted.sort((a, b) => a.risk_score - b.risk_score);
    case 'persistence-desc':
      return sorted.sort((a, b) =>
        nullsLast(resolvePersistenceDays(a), resolvePersistenceDays(b), false),
      );
    case 'frp-desc':
      return sorted.sort((a, b) => nullsLast(a.frp, b.frp, false));
    case 'proximity-asc':
      return sorted.sort((a, b) =>
        nullsLast(a.distance_to_industry_km, b.distance_to_industry_km, true),
      );
    case 'recent-desc':
      return sorted.sort((a, b) =>
        `${b.acq_date} ${b.acq_time}`.localeCompare(`${a.acq_date} ${a.acq_time}`),
      );
    case 'id-asc':
      return sorted.sort((a, b) => a.id.localeCompare(b.id));
    default:
      return sorted;
  }
}
