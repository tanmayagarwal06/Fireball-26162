/**
 * Temporal persistence.
 *
 * Reads the number of days a source was detected from the raw hotspot record and
 * bands it for display. `backend/app.py`'s `get_persistence()` now applies the
 * same rule, so the two agree — this module exists to band and format the value
 * for the UI, and to resolve it for records the console holds locally without
 * re-querying the API.
 *
 * Historical note: this module previously carried a client-side filtering
 * workaround, because `get_persistence()` tested its integer day-count fields
 * for truthiness and returned the look-back window length instead of the count.
 * That returned 7 for every record. The backend is fixed and the workaround has
 * been removed; persistence filtering is now served by `?min_persistence=`.
 */
import type { Hotspot } from '../types/hotspot';

/** A source detected on this many days or more is treated as persistent. */
export const PERSISTENCE_THRESHOLD_DAYS = 7;

/**
 * Number of days the source was actually detected.
 *
 * `persistence_7d` is the widest look-back window and therefore the most
 * complete count, so it is preferred; the narrower windows are fallbacks for
 * records that lack it. Mirrors `get_persistence()` in backend/app.py, except
 * that a total absence of data yields null here rather than the backend's 0, so
 * the UI can distinguish "not recorded" from "zero days".
 */
export function resolvePersistenceDays(hotspot: Hotspot): number | null {
  const candidates = [hotspot.persistence_7d, hotspot.persistence_3d, hotspot.persistence_1d];

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function isPersistent(hotspot: Hotspot): boolean {
  const days = resolvePersistenceDays(hotspot);
  return days !== null && days >= PERSISTENCE_THRESHOLD_DAYS;
}

export const PERSISTENCE_BAND_KEYS = ['SINGLE_DAY', 'SHORT', 'EXTENDED', 'PERSISTENT'] as const;

export type PersistenceBandKey = (typeof PERSISTENCE_BAND_KEYS)[number];

export interface PersistenceBand {
  key: PersistenceBandKey;
  label: string;
  /** Inclusive lower bound in days. */
  minDays: number;
}

export const PERSISTENCE_BANDS: Record<PersistenceBandKey, PersistenceBand> = {
  PERSISTENT: { key: 'PERSISTENT', label: '7+ days', minDays: 7 },
  EXTENDED: { key: 'EXTENDED', label: '4-6 days', minDays: 4 },
  SHORT: { key: 'SHORT', label: '2-3 days', minDays: 2 },
  SINGLE_DAY: { key: 'SINGLE_DAY', label: '1 day', minDays: 0 },
};

/** Ordered longest-lived first. */
export const PERSISTENCE_BAND_LIST: PersistenceBand[] = [
  PERSISTENCE_BANDS.PERSISTENT,
  PERSISTENCE_BANDS.EXTENDED,
  PERSISTENCE_BANDS.SHORT,
  PERSISTENCE_BANDS.SINGLE_DAY,
];

export function resolvePersistenceBand(hotspot: Hotspot): PersistenceBand | null {
  const days = resolvePersistenceDays(hotspot);
  if (days === null) return null;
  return PERSISTENCE_BAND_LIST.find((band) => days >= band.minDays) ?? PERSISTENCE_BANDS.SINGLE_DAY;
}
