/**
 * Alert presentation logic.
 *
 * `GET /alerts` is real and is what this screen reads. What it is *not* is an
 * alert system: the backend recomputes the list from hotspot records on every
 * request, with no store, no acknowledgement state and no delivery. The UI must
 * not imply otherwise, so there are no "acknowledge" or "dispatch" affordances
 * anywhere in this module.
 *
 * Two things are derived here rather than taken from the response:
 *
 *  - Severity band, using the shared four-level risk scale, because the backend
 *    has no notion of Critical.
 *  - Event age, because the response carries a detection timestamp but no age.
 *
 * Each alert is also joined back to its hotspot record, because the alert payload
 * omits land cover, facility type and the industrial-polygon flag. The join used
 * to be the only trustworthy source of persistence too, since `get_persistence()`
 * reported 7 for every record; that is fixed, so `persistence_days` is now taken
 * from the response and the join is only a fallback.
 */
import { resolveRiskLevel, type RiskLevelDefinition } from './risk';
import { resolvePersistenceDays } from './persistence';
import type { Alert } from '../types/api';
import type { Hotspot } from '../types/hotspot';

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Status values the backend can emit, from `get_alert_status()`:
 * risk >= 90 -> NEEDS INVESTIGATION, >= 80 -> NEW, otherwise REVIEWED.
 *
 * Note this makes status a pure function of risk — it is not a workflow state and
 * cannot be changed by an operator. The UI says so.
 */
export interface AlertStatusMeta {
  value: string;
  label: string;
  colorVar: string;
  description: string;
}

export const ALERT_STATUS_META: AlertStatusMeta[] = [
  {
    value: 'NEEDS INVESTIGATION',
    label: 'Needs investigation',
    colorVar: '--color-error',
    description: 'Assigned by the backend to any detection scoring 90 or above.',
  },
  {
    value: 'NEW',
    label: 'New',
    colorVar: '--color-on-surface',
    description: 'Assigned by the backend to detections scoring 80 to 89.',
  },
  {
    value: 'REVIEWED',
    label: 'Reviewed',
    colorVar: '--color-on-surface-variant',
    description:
      'Assigned by the backend to detections below 80. Not an indication that a human reviewed it.',
  },
];

export function statusMeta(status: string): AlertStatusMeta {
  const normalised = status.trim().toUpperCase();
  return (
    ALERT_STATUS_META.find((meta) => meta.value === normalised) ?? {
      value: normalised,
      label: status,
      colorVar: '--color-on-surface-variant',
      description: 'Status value not recognised by the console.',
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Severity and age                                                           */
/* -------------------------------------------------------------------------- */

export function alertSeverity(alert: Alert): RiskLevelDefinition {
  return resolveRiskLevel(alert.risk_score);
}

/**
 * Age of the detection in hours, relative to now.
 *
 * Built from the plain date and time strings in UTC-agnostic fashion: the values
 * carry no timezone, so they are treated as local wall-clock time. Returns null
 * when the date cannot be parsed, rather than a misleading zero.
 */
export function detectionAgeHours(
  detectionDate: string | null,
  detectionTime: string | null,
  now: Date = new Date(),
): number | null {
  if (!detectionDate) return null;

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(detectionDate.trim());
  if (!dateMatch) return null;

  const [, year, month, day] = dateMatch;

  let hours = 0;
  let minutes = 0;

  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec((detectionTime ?? '').trim());
  if (timeMatch) {
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2]);
  }

  const detected = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    hours,
    minutes,
    0,
    0,
  );

  if (Number.isNaN(detected.getTime())) return null;

  return (now.getTime() - detected.getTime()) / 3_600_000;
}

/**
 * Human-readable age. Negative ages are reported as such rather than clamped,
 * because the mock dataset is dated in 2026 and a future timestamp is a real
 * signal that the data is synthetic.
 */
export function formatAge(ageHours: number | null): string {
  if (ageHours === null) return '—';

  const future = ageHours < 0;
  const magnitude = Math.abs(ageHours);

  let text: string;
  if (magnitude < 1) {
    const minutes = Math.round(magnitude * 60);
    text = `${minutes} min`;
  } else if (magnitude < 48) {
    text = `${Math.floor(magnitude)} h`;
  } else {
    text = `${Math.floor(magnitude / 24)} d`;
  }

  return future ? `in ${text}` : `${text} ago`;
}

/* -------------------------------------------------------------------------- */
/* Enrichment                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * An alert joined to its source hotspot.
 *
 * The join supplies the fields the alert payload omits: land cover, facility type
 * and the industrial-polygon flag.
 */
export interface EnrichedAlert {
  alert: Alert;
  /** Null when the hotspot is not in the currently loaded dataset. */
  hotspot: Hotspot | null;
  severity: RiskLevelDefinition;
  status: AlertStatusMeta;
  ageHours: number | null;
  /** From the alert payload, falling back to the hotspot record. */
  persistenceDays: number | null;
  insideIndustrialPolygon: boolean | null;
  landCover: string | null;
  facilityType: string | null;
}

export function enrichAlerts(
  alerts: Alert[],
  hotspots: Hotspot[],
  now: Date = new Date(),
): EnrichedAlert[] {
  const byId = new Map(hotspots.map((hotspot) => [hotspot.id, hotspot]));

  return alerts.map((alert) => {
    const hotspot = byId.get(alert.hotspot_id) ?? null;

    return {
      alert,
      hotspot,
      severity: alertSeverity(alert),
      status: statusMeta(alert.status),
      ageHours: detectionAgeHours(alert.detection_date, alert.detection_time, now),
      // Prefer the payload; fall back to the record when the alert omits it or
      // the hotspot list is the only thing loaded.
      persistenceDays:
        typeof alert.persistence_days === 'number'
          ? alert.persistence_days
          : hotspot
            ? resolvePersistenceDays(hotspot)
            : null,
      insideIndustrialPolygon: hotspot ? hotspot.inside_industrial_polygon : null,
      landCover: hotspot?.land_cover_class ?? null,
      facilityType: hotspot?.nearest_facility_type ?? null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Sorting                                                                    */
/* -------------------------------------------------------------------------- */

export const ALERT_SORT_OPTIONS = [
  { label: 'Highest risk', value: 'risk-desc' },
  { label: 'Most persistent', value: 'persistence-desc' },
  { label: 'Nearest infrastructure', value: 'proximity-asc' },
  { label: 'Most recent', value: 'recent-desc' },
  { label: 'Oldest', value: 'recent-asc' },
  { label: 'Hotspot ID', value: 'id-asc' },
] as const;

export type AlertSortKey = (typeof ALERT_SORT_OPTIONS)[number]['value'];

export function sortAlerts(alerts: EnrichedAlert[], key: AlertSortKey): EnrichedAlert[] {
  const sorted = [...alerts];

  const nullsLast = (a: number | null, b: number | null, ascending: boolean): number => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return ascending ? a - b : b - a;
  };

  const timestamp = (entry: EnrichedAlert): string =>
    `${entry.alert.detection_date} ${entry.alert.detection_time}`;

  switch (key) {
    case 'risk-desc':
      return sorted.sort((a, b) => b.alert.risk_score - a.alert.risk_score);
    case 'persistence-desc':
      return sorted.sort((a, b) => nullsLast(a.persistenceDays, b.persistenceDays, false));
    case 'proximity-asc':
      return sorted.sort((a, b) =>
        nullsLast(a.alert.industrial_distance_km, b.alert.industrial_distance_km, true),
      );
    case 'recent-desc':
      return sorted.sort((a, b) => timestamp(b).localeCompare(timestamp(a)));
    case 'recent-asc':
      return sorted.sort((a, b) => timestamp(a).localeCompare(timestamp(b)));
    case 'id-asc':
      return sorted.sort((a, b) => a.alert.hotspot_id.localeCompare(b.alert.hotspot_id));
    default:
      return sorted;
  }
}

/** Counts per severity band, for the summary strip. */
export function alertSeverityCounts(alerts: EnrichedAlert[]): Record<string, number> {
  const counts: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };

  for (const entry of alerts) {
    counts[entry.severity.key] += 1;
  }

  return counts;
}
