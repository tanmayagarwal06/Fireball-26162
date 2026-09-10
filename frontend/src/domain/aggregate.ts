/**
 * Aggregations over a hotspot list.
 *
 * All frontend-derived, all computed from whatever list is passed in — so the
 * same functions serve the dashboard's filtered KPI ribbon and the analytics
 * screen's distributions without either having to reimplement the maths.
 *
 * Bucket boundaries mirror the backend's own where equivalents exist
 * (`/statistics` proximity bands, the risk >= 80 high-risk line), so filtered
 * figures stay comparable with the unfiltered baseline.
 *
 * Pure and side-effect free, therefore directly unit-testable.
 */
import {
  CLASSIFICATION_KEYS,
  parseClassification,
  type ClassificationKey,
} from './classification';
import { RISK_LEVEL_KEYS, resolveRiskLevel, isHighRisk, type RiskLevelKey } from './risk';
import {
  PERSISTENCE_BAND_KEYS,
  isPersistent,
  resolvePersistenceBand,
  resolvePersistenceDays,
  type PersistenceBandKey,
} from './persistence';
import type { Hotspot } from '../types/hotspot';

/** Generic label -> count map, ordered by descending count. */
export interface CountEntry {
  key: string;
  label: string;
  value: number;
}

function toSortedEntries(counts: Map<string, number>): CountEntry[] {
  return [...counts.entries()]
    .map(([key, value]) => ({ key, label: key, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function tally(values: Array<string | null | undefined>, fallback = 'Unspecified'): CountEntry[] {
  const counts = new Map<string, number>();

  for (const value of values) {
    const key = String(value ?? '').trim() || fallback;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return toSortedEntries(counts);
}

/* -------------------------------------------------------------------------- */
/* Headline summary                                                           */
/* -------------------------------------------------------------------------- */

export interface HotspotSummary {
  total: number;
  critical: number;
  high: number;
  /** Critical + high. Comparable with the backend's `high_risk`. */
  highRiskTotal: number;
  medium: number;
  low: number;
  /** Derived persistence >= 7 days. */
  persistent: number;
  /** inside_industrial_polygon === true. */
  industrialLinked: number;
  /** Classified as Unknown — the queue needing human attention. */
  unclassified: number;
  /** Detections within 500 m of industrial infrastructure. */
  within500m: number;
  /** High-risk AND within 2 km of infrastructure: the headline operational risk. */
  highRiskNearInfrastructure: number;
  meanRisk: number | null;
  maxFrp: number | null;
  meanFrp: number | null;
  maxBrightness: number | null;
  nightDetections: number;
}

export function summarise(hotspots: Hotspot[]): HotspotSummary {
  const total = hotspots.length;

  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let persistent = 0;
  let industrialLinked = 0;
  let unclassified = 0;
  let within500m = 0;
  let highRiskNear = 0;
  let nightDetections = 0;

  let riskSum = 0;
  let frpSum = 0;
  let frpCount = 0;
  let maxFrp: number | null = null;
  let maxBrightness: number | null = null;

  for (const hotspot of hotspots) {
    switch (resolveRiskLevel(hotspot.risk_score).key) {
      case 'CRITICAL':
        critical += 1;
        break;
      case 'HIGH':
        high += 1;
        break;
      case 'MEDIUM':
        medium += 1;
        break;
      case 'LOW':
        low += 1;
        break;
    }

    if (isPersistent(hotspot)) persistent += 1;
    if (hotspot.inside_industrial_polygon) industrialLinked += 1;
    if (parseClassification(hotspot.classification) === 'UNKNOWN') unclassified += 1;
    if (hotspot.day_night === 'N') nightDetections += 1;

    const distance = hotspot.distance_to_industry_km;
    if (typeof distance === 'number') {
      if (distance <= 0.5) within500m += 1;
      if (distance <= 2 && isHighRisk(hotspot.risk_score)) highRiskNear += 1;
    }

    riskSum += hotspot.risk_score;

    if (typeof hotspot.frp === 'number') {
      frpSum += hotspot.frp;
      frpCount += 1;
      maxFrp = maxFrp === null ? hotspot.frp : Math.max(maxFrp, hotspot.frp);
    }

    if (typeof hotspot.brightness_temperature === 'number') {
      maxBrightness =
        maxBrightness === null
          ? hotspot.brightness_temperature
          : Math.max(maxBrightness, hotspot.brightness_temperature);
    }
  }

  return {
    total,
    critical,
    high,
    highRiskTotal: critical + high,
    medium,
    low,
    persistent,
    industrialLinked,
    unclassified,
    within500m,
    highRiskNearInfrastructure: highRiskNear,
    meanRisk: total > 0 ? riskSum / total : null,
    maxFrp,
    meanFrp: frpCount > 0 ? frpSum / frpCount : null,
    maxBrightness,
    nightDetections,
  };
}

/* -------------------------------------------------------------------------- */
/* Distributions                                                              */
/* -------------------------------------------------------------------------- */

/** Counts per class, always returning all six in model-code order. */
export function classificationCounts(hotspots: Hotspot[]): Record<ClassificationKey, number> {
  const counts = Object.fromEntries(
    CLASSIFICATION_KEYS.map((key) => [key, 0]),
  ) as Record<ClassificationKey, number>;

  for (const hotspot of hotspots) {
    counts[parseClassification(hotspot.classification)] += 1;
  }

  return counts;
}

/** Counts per risk band, always returning all four, most severe first. */
export function riskCounts(hotspots: Hotspot[]): Record<RiskLevelKey, number> {
  const counts = Object.fromEntries(RISK_LEVEL_KEYS.map((key) => [key, 0])) as Record<
    RiskLevelKey,
    number
  >;

  for (const hotspot of hotspots) {
    counts[resolveRiskLevel(hotspot.risk_score).key] += 1;
  }

  return counts;
}

/**
 * Counts per derived persistence band.
 *
 * Records with no persistence data are excluded rather than defaulted, so the
 * bands never imply a duration the data does not support.
 */
export function persistenceCounts(hotspots: Hotspot[]): Record<PersistenceBandKey, number> {
  const counts = Object.fromEntries(PERSISTENCE_BAND_KEYS.map((key) => [key, 0])) as Record<
    PersistenceBandKey,
    number
  >;

  for (const hotspot of hotspots) {
    const band = resolvePersistenceBand(hotspot);
    if (band) counts[band.key] += 1;
  }

  return counts;
}

/** Proximity bands matching the backend's `/statistics` buckets exactly. */
export interface ProximityCounts {
  within500m: number;
  from500mTo2km: number;
  beyond2km: number;
  /** Records with no distance recorded, reported rather than hidden. */
  unknown: number;
}

export function proximityCounts(hotspots: Hotspot[]): ProximityCounts {
  const counts: ProximityCounts = {
    within500m: 0,
    from500mTo2km: 0,
    beyond2km: 0,
    unknown: 0,
  };

  for (const hotspot of hotspots) {
    const distance = hotspot.distance_to_industry_km;

    if (typeof distance !== 'number') {
      counts.unknown += 1;
    } else if (distance <= 0.5) {
      counts.within500m += 1;
    } else if (distance <= 2) {
      counts.from500mTo2km += 1;
    } else {
      counts.beyond2km += 1;
    }
  }

  return counts;
}

export function satelliteCounts(hotspots: Hotspot[]): CountEntry[] {
  return tally(hotspots.map((hotspot) => hotspot.satellite));
}

export function landCoverCounts(hotspots: Hotspot[]): CountEntry[] {
  return tally(hotspots.map((hotspot) => hotspot.land_cover_class));
}

/** Nearest-facility types. Records with no facility are labelled explicitly. */
export function facilityCounts(hotspots: Hotspot[]): CountEntry[] {
  return tally(
    hotspots.map((hotspot) => hotspot.nearest_facility_type),
    'No facility nearby',
  );
}

export function dayNightCounts(hotspots: Hotspot[]): { day: number; night: number; unknown: number } {
  let day = 0;
  let night = 0;
  let unknown = 0;

  for (const hotspot of hotspots) {
    if (hotspot.day_night === 'D') day += 1;
    else if (hotspot.day_night === 'N') night += 1;
    else unknown += 1;
  }

  return { day, night, unknown };
}

/**
 * Detections per acquisition date, ascending.
 *
 * Returns one entry for the current dataset because every record shares a single
 * date. Callers must check the length and degrade rather than drawing a
 * one-point trend line as though it were a series.
 */
export function detectionsByDate(hotspots: Hotspot[]): CountEntry[] {
  const counts = new Map<string, number>();

  for (const hotspot of hotspots) {
    const key = hotspot.acq_date || 'Unknown date';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, value]) => ({ key, label: key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Detections per hour of the acquisition time, for the 24-hour distribution.
 *
 * This is a distribution across a single day, not a trend over days, and must be
 * labelled as such.
 */
export function detectionsByHour(hotspots: Hotspot[]): number[] {
  const hours = new Array<number>(24).fill(0);

  for (const hotspot of hotspots) {
    const match = /^(\d{1,2}):/.exec(hotspot.acq_time ?? '');
    if (!match) continue;

    const hour = Number(match[1]);
    if (hour >= 0 && hour < 24) hours[hour] += 1;
  }

  return hours;
}

/** The n highest-risk records, for the priority list. */
export function topByRisk(hotspots: Hotspot[], limit: number): Hotspot[] {
  return [...hotspots].sort((a, b) => b.risk_score - a.risk_score).slice(0, limit);
}

/**
 * Thermal scatter points, for the FRP-versus-brightness plot. Records missing
 * either axis are dropped, since a scatter point needs both.
 */
export interface ThermalPoint {
  id: string;
  frp: number;
  brightness: number;
  classification: ClassificationKey;
  riskScore: number;
  persistenceDays: number | null;
}

export function thermalPoints(hotspots: Hotspot[]): ThermalPoint[] {
  const points: ThermalPoint[] = [];

  for (const hotspot of hotspots) {
    if (typeof hotspot.frp !== 'number') continue;
    if (typeof hotspot.brightness_temperature !== 'number') continue;

    points.push({
      id: hotspot.id,
      frp: hotspot.frp,
      brightness: hotspot.brightness_temperature,
      classification: parseClassification(hotspot.classification),
      riskScore: hotspot.risk_score,
      persistenceDays: resolvePersistenceDays(hotspot),
    });
  }

  return points;
}
