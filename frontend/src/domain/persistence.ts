/**
 * Temporal persistence.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS
 * ---------------------------------------------------------------------------
 * `get_persistence()` in backend/app.py is defective:
 *
 *     if hotspot.get("persistence_7d"): return 7
 *     if hotspot.get("persistence_3d"): return 3
 *     ...
 *
 * `persistence_7d` is an integer day count, not a boolean. Every record in
 * mock/hotspots.json has a non-zero value, so the helper returns 7 for all of
 * them. Verified against the running server:
 *
 *   GET /statistics -> persistence_distribution {"1 Day":0,"3 Days":0,"7+ Days":11}
 *                   -> summary.persistent_sources = 11
 *   GET /hotspots?min_persistence=7 -> count 11  (should be 2)
 *
 * The true `persistence_7d` values across the dataset are
 * 7, 1, 5, 2, 3, 6, 2, 4, 1, 2, 7 — so only H001 and H011 are genuinely
 * 7-day persistent.
 *
 * Per the project constraints the backend is not being modified, so persistence
 * is resolved and filtered on the client. When `get_persistence()` is fixed,
 * `filterByPersistence()` can be deleted and `min_persistence` passed straight
 * through to the API instead.
 *
 * Anything rendered from this module is DERIVED data, not raw API data, and
 * should be labelled as such via `Provenance.DERIVED`.
 */
import type { Hotspot } from '../types/hotspot';

/** A source detected on this many days or more is treated as persistent. */
export const PERSISTENCE_THRESHOLD_DAYS = 7;

/**
 * Number of days the source was actually detected.
 *
 * `persistence_7d` is the widest look-back window and therefore the most
 * complete count, so it is preferred; the narrower windows are fallbacks for
 * records that lack it.
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

/**
 * Client-side replacement for the broken `min_persistence` query parameter.
 * Records with no persistence data at all are excluded, matching how the backend
 * drops null distances in its own proximity filter.
 */
export function filterByPersistence(hotspots: Hotspot[], minDays: number | undefined): Hotspot[] {
  if (minDays === undefined || minDays <= 0) return hotspots;

  return hotspots.filter((hotspot) => {
    const days = resolvePersistenceDays(hotspot);
    return days !== null && days >= minDays;
  });
}
