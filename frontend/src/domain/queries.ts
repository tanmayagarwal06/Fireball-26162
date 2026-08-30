/**
 * Saved investigation queries.
 *
 * The AI Investigator screen is a structured evidence workstation, not a chat
 * interface. There is no language model connected, so instead of faking free-text
 * understanding, this module defines a set of real, named investigations — each
 * one an explicit conjunction of predicates over API fields.
 *
 * Every query is fully explainable by construction: because a match requires all
 * clauses to pass, the clause list *is* the reason the record matched. That gives
 * the operator a genuine "why was this returned?" answer today, using the same
 * shape a model would later populate with learned reasoning.
 *
 * Pure functions over Hotspot, so directly unit-testable.
 */
import { parseClassification } from './classification';
import { resolvePersistenceDays, PERSISTENCE_THRESHOLD_DAYS } from './persistence';
import { toPercentScale } from './format';
import { assessEvidence } from './evidence';
import { BACKEND_HIGH_RISK_THRESHOLD } from './risk';
import type { Hotspot } from '../types/hotspot';

/** A single testable condition, stated in operator language. */
export interface QueryClause {
  /** Human-readable condition, shown as the reason a record matched. */
  label: string;
  test: (hotspot: Hotspot) => boolean;
}

export interface SavedQuery {
  id: string;
  /** Short name for the query list. */
  label: string;
  /** The operational question this query answers. */
  question: string;
  icon: string;
  /** All clauses must pass for a record to match. */
  clauses: QueryClause[];
  /** Why an analyst would run this. */
  rationale: string;
}

/** Facility types treated as hydrocarbon infrastructure. */
const HYDROCARBON_FACILITIES = ['oil & gas', 'refinery', 'chemical plant'];

export const SAVED_QUERIES: SavedQuery[] = [
  {
    id: 'persistent-industrial',
    label: 'Persistent sources near industry',
    question: 'Which persistent thermal sources sit close to industrial infrastructure?',
    icon: 'factory',
    rationale:
      'A source that burns continuously beside mapped industry is far more likely to be a flare or an industrial process than a wildfire. This is the core case the platform exists to identify.',
    clauses: [
      {
        label: `Detected on ${PERSISTENCE_THRESHOLD_DAYS} or more days`,
        test: (hotspot) => {
          const days = resolvePersistenceDays(hotspot);
          return days !== null && days >= PERSISTENCE_THRESHOLD_DAYS;
        },
      },
      {
        label: 'Within 2 km of industrial infrastructure',
        test: (hotspot) =>
          typeof hotspot.distance_to_industry_km === 'number' &&
          hotspot.distance_to_industry_km <= 2,
      },
    ],
  },
  {
    id: 'high-risk-industrial',
    label: 'High-risk industrial events',
    question: 'Which high-risk detections fall inside mapped industrial areas?',
    icon: 'priority_high',
    rationale:
      'High thermal risk inside an industrial polygon is the combination most likely to need an emergency response, as opposed to a routine flare.',
    clauses: [
      {
        label: `Risk score of ${BACKEND_HIGH_RISK_THRESHOLD} or above`,
        test: (hotspot) => hotspot.risk_score >= BACKEND_HIGH_RISK_THRESHOLD,
      },
      {
        label: 'Inside a mapped industrial polygon',
        test: (hotspot) => hotspot.inside_industrial_polygon === true,
      },
    ],
  },
  {
    id: 'flare-candidates',
    label: 'Gas flare candidates',
    question: 'Which detections show the signature of routine hydrocarbon flaring?',
    icon: 'gas_meter',
    rationale:
      'Flares are steady, hot and co-located with hydrocarbon infrastructure. Separating them from genuine fires prevents wasted emergency response.',
    clauses: [
      {
        label: 'Detected on 4 or more days',
        test: (hotspot) => {
          const days = resolvePersistenceDays(hotspot);
          return days !== null && days >= 4;
        },
      },
      {
        label: 'Nearest facility is hydrocarbon infrastructure',
        test: (hotspot) =>
          typeof hotspot.nearest_facility_type === 'string' &&
          HYDROCARBON_FACILITIES.includes(hotspot.nearest_facility_type.trim().toLowerCase()),
      },
      {
        label: 'Within 2 km of that facility',
        test: (hotspot) =>
          typeof hotspot.distance_to_industry_km === 'number' &&
          hotspot.distance_to_industry_km <= 2,
      },
    ],
  },
  {
    id: 'unresolved',
    label: 'Unresolved classifications',
    question: 'Which detections could not be classified and need human review?',
    icon: 'help',
    rationale:
      'The unknown queue is where the classification engine will add the most value. Reviewing it now establishes the baseline it has to beat.',
    clauses: [
      {
        label: 'Classified as Unknown',
        test: (hotspot) => parseClassification(hotspot.classification) === 'UNKNOWN',
      },
    ],
  },
  {
    id: 'low-confidence',
    label: 'Low-confidence classifications',
    question: 'Which classifications are weakly supported enough to warrant a second look?',
    icon: 'question_mark',
    rationale:
      'A confident label on thin evidence is more dangerous than an explicit unknown. These records are the audit set.',
    clauses: [
      {
        label: 'Recorded classification confidence below 65%',
        test: (hotspot) => {
          const confidence = toPercentScale(hotspot.classification_confidence);
          return confidence !== null && confidence < 65;
        },
      },
    ],
  },
  {
    id: 'conflicting-land-cover',
    label: 'Conflicting land-cover evidence',
    question: 'Where does land cover disagree with the assigned classification?',
    icon: 'rule',
    rationale:
      'A wildfire label on built-up land, or an industrial label on cropland, points to a classification error or a mislabelled land-cover tile. Either is worth catching.',
    clauses: [
      {
        label: 'Land-cover evidence assessed as weak or absent',
        test: (hotspot) => {
          const landCover = assessEvidence(hotspot).find(
            (assessment) => assessment.axis === 'LAND_COVER',
          );
          return landCover?.strength === 'weak' || landCover?.strength === 'absent';
        },
      },
    ],
  },
  {
    id: 'remote-high-energy',
    label: 'High-energy events away from industry',
    question: 'Which intense detections are far from any industrial infrastructure?',
    icon: 'local_fire_department',
    rationale:
      'High radiative power with no industry nearby is the wildfire signature. These are the detections that should reach disaster-management teams rather than industrial regulators.',
    clauses: [
      {
        label: 'Fire radiative power of 100 MW or more',
        test: (hotspot) => typeof hotspot.frp === 'number' && hotspot.frp >= 100,
      },
      {
        label: 'More than 5 km from industrial infrastructure',
        test: (hotspot) =>
          typeof hotspot.distance_to_industry_km === 'number' &&
          hotspot.distance_to_industry_km > 5,
      },
    ],
  },
  {
    id: 'night-industrial',
    label: 'Night-time industrial anomalies',
    question: 'Which industrial-area detections occurred on a night overpass?',
    icon: 'nightlight',
    rationale:
      'Night detections avoid solar contamination, so a night-time industrial hotspot is a cleaner thermal measurement and a stronger persistence signal.',
    clauses: [
      { label: 'Night overpass', test: (hotspot) => hotspot.day_night === 'N' },
      {
        label: 'Inside a mapped industrial polygon',
        test: (hotspot) => hotspot.inside_industrial_polygon === true,
      },
    ],
  },
];

export interface QueryMatch {
  hotspot: Hotspot;
  /** Clause labels that were satisfied — the reason this record matched. */
  matchedClauses: string[];
}

export interface QueryResult {
  query: SavedQuery;
  matches: QueryMatch[];
  /** Records examined, so a zero result is distinguishable from no data. */
  evaluated: number;
}

/** Run a saved query. A record matches only when every clause passes. */
export function runQuery(query: SavedQuery, hotspots: Hotspot[]): QueryResult {
  const matches: QueryMatch[] = [];

  for (const hotspot of hotspots) {
    const passed: string[] = [];
    let allPassed = true;

    for (const clause of query.clauses) {
      if (clause.test(hotspot)) {
        passed.push(clause.label);
      } else {
        allPassed = false;
        break;
      }
    }

    if (allPassed) {
      matches.push({ hotspot, matchedClauses: passed });
    }
  }

  // Highest risk first: the operator's natural triage order.
  matches.sort((a, b) => b.hotspot.risk_score - a.hotspot.risk_score);

  return { query, matches, evaluated: hotspots.length };
}

export function findQuery(id: string): SavedQuery | undefined {
  return SAVED_QUERIES.find((query) => query.id === id);
}
