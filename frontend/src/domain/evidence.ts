/**
 * Evidence assessment.
 *
 * Turns raw hotspot fields into the six evidence axes the investigation screen
 * presents. Every threshold here is an explicit, documented frontend heuristic —
 * this is emphatically NOT a model, and the UI labels it as derived.
 *
 * The thresholds are chosen to line up with boundaries the backend already uses
 * (the 0.5 km and 2 km proximity bands from `/statistics`, the 7-day persistence
 * line) so the investigation view never contradicts the analytics view.
 *
 * When the classification engine arrives it will supply real feature attribution
 * and these heuristics should be replaced, not extended. The consuming component
 * reads `EvidenceAssessment[]`, so swapping the source is a local change.
 */
import { parseClassification, type ClassificationKey } from './classification';
import { resolvePersistenceDays, PERSISTENCE_THRESHOLD_DAYS } from './persistence';
import { toPercentScale } from './format';
import type { ProvenanceKey } from './provenance';
import type { Hotspot } from '../types/hotspot';

export type EvidenceStrength = 'strong' | 'moderate' | 'weak' | 'absent' | 'unavailable';

export type EvidenceAxis =
  | 'THERMAL'
  | 'TEMPORAL'
  | 'SPATIAL'
  | 'INFRASTRUCTURE'
  | 'LAND_COVER'
  | 'MODEL_CONFIDENCE';

export interface EvidenceMeasurement {
  label: string;
  value: string;
  emphasis?: boolean;
}

export interface EvidenceAssessment {
  axis: EvidenceAxis;
  title: string;
  icon: string;
  strength: EvidenceStrength;
  provenance: ProvenanceKey;
  /** Plain-language reading of the evidence. */
  interpretation: string;
  /** Explains how `strength` was reached. Surfaced as a tooltip. */
  strengthBasis: string;
  measurements: EvidenceMeasurement[];
}

/* -------------------------------------------------------------------------- */
/* Thresholds                                                                 */
/* -------------------------------------------------------------------------- */

/** FRP in MW. Derived from the spread present in the dataset (38.9 - 231.8 MW). */
export const FRP_STRONG_MW = 150;
export const FRP_MODERATE_MW = 60;

/** Brightness temperature in Kelvin. */
export const BRIGHTNESS_STRONG_K = 1100;
export const BRIGHTNESS_MODERATE_K = 900;

/** Proximity bands, matching the backend's own /statistics buckets. */
export const PROXIMITY_STRONG_KM = 0.5;
export const PROXIMITY_MODERATE_KM = 2;
export const PROXIMITY_WEAK_KM = 5;

/** Classification confidence on a 0-100 scale. */
export const CONFIDENCE_STRONG_PCT = 85;
export const CONFIDENCE_MODERATE_PCT = 65;

/**
 * Land-cover classes that are consistent with each thermal class.
 *
 * Used to judge whether land cover supports or contradicts the classification.
 * Compared case-insensitively against `land_cover_class`.
 */
const CONSISTENT_LAND_COVER: Record<ClassificationKey, string[]> = {
  WILDFIRE: ['forest', 'tree cover', 'shrubland', 'grassland'],
  AGRICULTURAL_BURNING: ['cropland'],
  INDUSTRIAL_FIRE: ['industrial', 'built-up'],
  GAS_FLARE: ['industrial', 'built-up', 'bare / sparse vegetation'],
  PERSISTENT_THERMAL_SOURCE: ['industrial', 'built-up'],
  // Unknown has no expected land cover, so nothing can confirm or contradict it.
  UNKNOWN: [],
};

/* -------------------------------------------------------------------------- */
/* Assessment                                                                 */
/* -------------------------------------------------------------------------- */

export function assessEvidence(hotspot: Hotspot): EvidenceAssessment[] {
  return [
    assessThermal(hotspot),
    assessTemporal(hotspot),
    assessSpatial(hotspot),
    assessInfrastructure(hotspot),
    assessLandCover(hotspot),
    assessModelConfidence(hotspot),
  ];
}

function assessThermal(hotspot: Hotspot): EvidenceAssessment {
  const { frp, brightness_temperature: brightness } = hotspot;

  let strength: EvidenceStrength = 'unavailable';
  let interpretation = 'No thermal measurements are available for this detection.';

  if (typeof frp === 'number' || typeof brightness === 'number') {
    const highFrp = typeof frp === 'number' && frp >= FRP_STRONG_MW;
    const highBrightness = typeof brightness === 'number' && brightness >= BRIGHTNESS_STRONG_K;
    const moderateFrp = typeof frp === 'number' && frp >= FRP_MODERATE_MW;
    const moderateBrightness =
      typeof brightness === 'number' && brightness >= BRIGHTNESS_MODERATE_K;

    if (highFrp || highBrightness) {
      strength = 'strong';
      interpretation =
        'High radiative power and temperature, consistent with sustained high-energy combustion rather than a transient burn.';
    } else if (moderateFrp || moderateBrightness) {
      strength = 'moderate';
      interpretation =
        'Moderate thermal output. Intensity alone does not separate the candidate classes here.';
    } else {
      strength = 'weak';
      interpretation =
        'Low thermal output, more typical of small or short-lived burning than industrial activity.';
    }
  }

  return {
    axis: 'THERMAL',
    title: 'Thermal evidence',
    icon: 'thermostat',
    strength,
    provenance: 'API',
    interpretation,
    strengthBasis: `Strong at FRP >= ${FRP_STRONG_MW} MW or brightness >= ${BRIGHTNESS_STRONG_K} K; moderate at >= ${FRP_MODERATE_MW} MW or >= ${BRIGHTNESS_MODERATE_K} K.`,
    measurements: [
      {
        label: 'Fire radiative power',
        value: typeof frp === 'number' ? `${frp.toFixed(1)} MW` : '—',
        emphasis: true,
      },
      {
        label: 'Brightness temperature',
        value: typeof brightness === 'number' ? `${brightness.toFixed(1)} K` : '—',
        emphasis: true,
      },
      {
        label: 'Detection confidence (FIRMS)',
        value: typeof hotspot.confidence === 'number' ? `${hotspot.confidence}%` : '—',
      },
      {
        label: 'Overpass',
        value: hotspot.day_night === 'D' ? 'Day' : hotspot.day_night === 'N' ? 'Night' : '—',
      },
    ],
  };
}

function assessTemporal(hotspot: Hotspot): EvidenceAssessment {
  const days = resolvePersistenceDays(hotspot);

  let strength: EvidenceStrength = 'unavailable';
  let interpretation = 'No persistence data is recorded for this detection.';

  if (days !== null) {
    if (days >= PERSISTENCE_THRESHOLD_DAYS) {
      strength = 'strong';
      interpretation = `Detected on ${days} days. Sustained repetition at a fixed location points to a continuous source such as a flare or industrial process, not a wildfire.`;
    } else if (days >= 3) {
      strength = 'moderate';
      interpretation = `Detected on ${days} days. Some repetition, but short of the ${PERSISTENCE_THRESHOLD_DAYS}-day threshold for a persistent source.`;
    } else {
      strength = 'weak';
      interpretation = `Detected on ${days} day${days === 1 ? '' : 's'}. Consistent with a transient event such as crop-residue burning.`;
    }
  }

  return {
    axis: 'TEMPORAL',
    title: 'Temporal evidence',
    icon: 'schedule',
    strength,
    // The day count is an API field; only the strength banding is derived.
    provenance: 'API',
    interpretation,
    strengthBasis: `Strong at ${PERSISTENCE_THRESHOLD_DAYS}+ days, moderate at 3-6 days, weak below 3. Day count read from persistence_7d; the banding is a console heuristic.`,
    measurements: [
      { label: 'Days detected', value: days !== null ? String(days) : '—', emphasis: true },
      { label: '7-day window', value: hotspot.persistence_7d?.toString() ?? '—' },
      { label: '3-day window', value: hotspot.persistence_3d?.toString() ?? '—' },
      { label: '1-day window', value: hotspot.persistence_1d?.toString() ?? '—' },
    ],
  };
}

function assessSpatial(hotspot: Hotspot): EvidenceAssessment {
  const distance = hotspot.distance_to_industry_km;

  let strength: EvidenceStrength = 'unavailable';
  let interpretation = 'No distance to industrial infrastructure is recorded.';

  if (typeof distance === 'number') {
    if (distance <= PROXIMITY_STRONG_KM) {
      strength = 'strong';
      interpretation = `Only ${distance.toFixed(2)} km from mapped industrial infrastructure — close enough that an industrial origin is the leading explanation.`;
    } else if (distance <= PROXIMITY_MODERATE_KM) {
      strength = 'moderate';
      interpretation = `${distance.toFixed(2)} km from industrial infrastructure. Nearby, but not close enough to attribute the source on proximity alone.`;
    } else if (distance <= PROXIMITY_WEAK_KM) {
      strength = 'weak';
      interpretation = `${distance.toFixed(2)} km from the nearest industrial feature. Proximity offers little support for an industrial origin.`;
    } else {
      strength = 'absent';
      interpretation = `${distance.toFixed(2)} km from any mapped industrial feature. Spatial context argues against an industrial source.`;
    }
  }

  return {
    axis: 'SPATIAL',
    title: 'Spatial evidence',
    icon: 'location_on',
    strength,
    provenance: 'API',
    interpretation,
    strengthBasis: `Strong within ${PROXIMITY_STRONG_KM} km, moderate within ${PROXIMITY_MODERATE_KM} km, weak within ${PROXIMITY_WEAK_KM} km. Bands match the backend's /statistics buckets.`,
    measurements: [
      {
        label: 'Distance to industry',
        value: typeof distance === 'number' ? `${distance.toFixed(2)} km` : '—',
        emphasis: true,
      },
      { label: 'Latitude', value: `${hotspot.lat.toFixed(4)}°` },
      { label: 'Longitude', value: `${hotspot.lon.toFixed(4)}°` },
      {
        label: 'Co-located detections',
        value: hotspot.hotspot_density !== null ? String(hotspot.hotspot_density) : '—',
      },
    ],
  };
}

function assessInfrastructure(hotspot: Hotspot): EvidenceAssessment {
  const inside = hotspot.inside_industrial_polygon;
  const facility = hotspot.nearest_facility_type;
  const distance = hotspot.distance_to_industry_km;

  let strength: EvidenceStrength;
  let interpretation: string;

  if (inside) {
    strength = 'strong';
    interpretation = `Falls inside a mapped industrial polygon${
      facility ? ` associated with ${facility.toLowerCase()}` : ''
    }. OpenStreetMap context directly supports an industrial attribution.`;
  } else if (facility && typeof distance === 'number' && distance <= PROXIMITY_MODERATE_KM) {
    strength = 'moderate';
    interpretation = `Outside any industrial polygon, but ${distance.toFixed(2)} km from ${facility.toLowerCase()}. Suggestive without being conclusive.`;
  } else if (facility) {
    strength = 'weak';
    interpretation = `Nearest mapped facility is ${facility.toLowerCase()}, too distant to attribute the detection to it.`;
  } else {
    strength = 'absent';
    interpretation =
      'No industrial facility is mapped nearby. Infrastructure context does not support an industrial origin.';
  }

  return {
    axis: 'INFRASTRUCTURE',
    title: 'Infrastructure evidence',
    icon: 'factory',
    strength,
    provenance: 'API',
    interpretation,
    strengthBasis:
      'Strong when inside a mapped industrial polygon; moderate when a facility lies within 2 km; absent when no facility is mapped.',
    measurements: [
      {
        label: 'Inside industrial polygon',
        value: inside ? 'Yes' : 'No',
        emphasis: true,
      },
      { label: 'Nearest facility type', value: facility ?? 'None mapped', emphasis: Boolean(facility) },
      {
        label: 'Distance',
        value: typeof distance === 'number' ? `${distance.toFixed(2)} km` : '—',
      },
    ],
  };
}

function assessLandCover(hotspot: Hotspot): EvidenceAssessment {
  const landCover = hotspot.land_cover_class;
  const classification = parseClassification(hotspot.classification);

  let strength: EvidenceStrength = 'unavailable';
  let interpretation = 'No land-cover class is recorded for this location.';

  if (landCover) {
    const expected = CONSISTENT_LAND_COVER[classification];
    const normalised = String(landCover).trim().toLowerCase();

    if (expected.length === 0) {
      strength = 'moderate';
      interpretation = `Land cover is ${String(landCover).toLowerCase()}. With the class unresolved there is no expected land cover to compare against.`;
    } else if (expected.includes(normalised)) {
      strength = 'strong';
      interpretation = `Land cover is ${String(landCover).toLowerCase()}, which is consistent with the assigned class and reinforces it.`;
    } else {
      strength = 'weak';
      interpretation = `Land cover is ${String(landCover).toLowerCase()}, which is not typical for the assigned class. This is a point of conflict worth reviewing.`;
    }
  }

  return {
    axis: 'LAND_COVER',
    title: 'Land-cover evidence',
    icon: 'terrain',
    strength,
    provenance: 'DERIVED',
    interpretation,
    strengthBasis:
      'Compares the recorded land-cover class against the classes typically associated with the assigned thermal class. Frontend heuristic.',
    measurements: [
      { label: 'Land cover class', value: landCover ?? '—', emphasis: true },
      {
        label: 'Consistent with class',
        value:
          landCover === null
            ? '—'
            : CONSISTENT_LAND_COVER[classification].length === 0
              ? 'No expectation'
              : CONSISTENT_LAND_COVER[classification].includes(String(landCover).trim().toLowerCase())
                ? 'Yes'
                : 'No',
      },
    ],
  };
}

function assessModelConfidence(hotspot: Hotspot): EvidenceAssessment {
  const confidence = toPercentScale(hotspot.classification_confidence);

  let strength: EvidenceStrength = 'unavailable';
  let interpretation =
    'No classification confidence is recorded. The classification engine is not yet integrated.';

  if (confidence !== null) {
    if (confidence >= CONFIDENCE_STRONG_PCT) {
      strength = 'strong';
      interpretation = `The dataset records ${confidence.toFixed(0)}% confidence in this classification. Note this is a stored value, not live model output.`;
    } else if (confidence >= CONFIDENCE_MODERATE_PCT) {
      strength = 'moderate';
      interpretation = `Recorded confidence is ${confidence.toFixed(0)}%. Treat the classification as provisional.`;
    } else {
      strength = 'weak';
      interpretation = `Recorded confidence is only ${confidence.toFixed(0)}%. The evidence does not clearly favour one class; manual review is warranted.`;
    }
  }

  return {
    axis: 'MODEL_CONFIDENCE',
    title: 'Classification confidence',
    icon: 'psychology',
    strength,
    provenance: 'API',
    interpretation,
    strengthBasis: `Strong at >= ${CONFIDENCE_STRONG_PCT}%, moderate at >= ${CONFIDENCE_MODERATE_PCT}%. Value is stored in the dataset, not produced by a live model.`,
    measurements: [
      {
        label: 'Recorded confidence',
        value: confidence !== null ? `${confidence.toFixed(0)}%` : '—',
        emphasis: true,
      },
      { label: 'Assigned class', value: hotspot.classification },
    ],
  };
}

/**
 * Count of axes at each strength, for the header summary.
 * Gives the operator a one-glance read on how well-supported the call is.
 */
export function summariseEvidence(assessments: EvidenceAssessment[]): {
  strong: number;
  moderate: number;
  conflicting: number;
  unavailable: number;
} {
  let strong = 0;
  let moderate = 0;
  let conflicting = 0;
  let unavailable = 0;

  for (const assessment of assessments) {
    switch (assessment.strength) {
      case 'strong':
        strong += 1;
        break;
      case 'moderate':
        moderate += 1;
        break;
      case 'weak':
      case 'absent':
        conflicting += 1;
        break;
      case 'unavailable':
        unavailable += 1;
        break;
    }
  }

  return { strong, moderate, conflicting, unavailable };
}
