/**
 * Domain unit tests.
 *
 * Coverage is aimed at the decisions that would silently produce wrong numbers on
 * screen: the persistence workaround, risk banding and its reconciliation with the
 * backend, query serialisation, and the classification mapping.
 *
 * Deliberately no component rendering tests. The valuable, fragile logic is here
 * in pure functions; asserting on JSX structure would mostly test Tailwind
 * classnames and break on every layout tweak.
 */
import { describe, expect, it } from 'vitest';

import {
  CLASSIFICATIONS,
  CLASSIFICATION_KEYS,
  fromModelCode,
  getClassification,
  isRecognisedClassification,
  parseClassification,
} from './classification';
import {
  BACKEND_HIGH_RISK_THRESHOLD,
  RISK_LEVEL_LIST,
  isHighRisk,
  resolveRiskLevel,
} from './risk';
import {
  PERSISTENCE_THRESHOLD_DAYS,
  isPersistent,
  resolvePersistenceBand,
  resolvePersistenceDays,
} from './persistence';
import {
  DEFAULT_FILTERS,
  applyClientFilters,
  countActiveFilters,
  filterPlacement,
  sortHotspots,
  toHotspotQuery,
  type FilterState,
} from './filters';
import {
  classificationCounts,
  detectionsByHour,
  persistenceCounts,
  proximityCounts,
  riskCounts,
  summarise,
  thermalPoints,
} from './aggregate';
import { assessEvidence, summariseEvidence } from './evidence';
import { detectionAgeHours, enrichAlerts, formatAge, sortAlerts, statusMeta } from './alerts';
import { SAVED_QUERIES, runQuery } from './queries';
import {
  formatAcqDate,
  formatCoordinates,
  formatDays,
  formatKm,
  formatRatioAsPercent,
  toPercentScale,
} from './format';
import { buildQueryString } from '../api/client';

import { H001, H002, H003, H004, H005, H011, SAMPLE } from '../test/fixtures';
import type { Alert } from '../types/api';

/* -------------------------------------------------------------------------- */

describe('classification', () => {
  it('maps every backend label onto a canonical key', () => {
    expect(parseClassification('Gas Flare')).toBe('GAS_FLARE');
    expect(parseClassification('Agricultural Burning')).toBe('AGRICULTURAL_BURNING');
    expect(parseClassification('Industrial Fire')).toBe('INDUSTRIAL_FIRE');
    expect(parseClassification('Wildfire')).toBe('WILDFIRE');
    expect(parseClassification('Persistent Thermal Source')).toBe('PERSISTENT_THERMAL_SOURCE');
    expect(parseClassification('Unknown')).toBe('UNKNOWN');
  });

  it('is tolerant of case and separator differences', () => {
    expect(parseClassification('gas flare')).toBe('GAS_FLARE');
    expect(parseClassification('GAS_FLARE')).toBe('GAS_FLARE');
    expect(parseClassification('  Gas-Flare  ')).toBe('GAS_FLARE');
  });

  it('collapses unknown and missing values to UNKNOWN without throwing', () => {
    expect(parseClassification(null)).toBe('UNKNOWN');
    expect(parseClassification(undefined)).toBe('UNKNOWN');
    expect(parseClassification('')).toBe('UNKNOWN');
    expect(parseClassification('Volcanic Vent')).toBe('UNKNOWN');
  });

  it('distinguishes a real Unknown from an unrecognised label', () => {
    // Both resolve to UNKNOWN, but only one was actually in the vocabulary.
    expect(isRecognisedClassification('Unknown')).toBe(true);
    expect(isRecognisedClassification('Volcanic Vent')).toBe(false);
  });

  it('assigns the model codes the classifier will emit, 0 through 5', () => {
    expect(CLASSIFICATIONS.WILDFIRE.code).toBe(0);
    expect(CLASSIFICATIONS.AGRICULTURAL_BURNING.code).toBe(1);
    expect(CLASSIFICATIONS.INDUSTRIAL_FIRE.code).toBe(2);
    expect(CLASSIFICATIONS.GAS_FLARE.code).toBe(3);
    expect(CLASSIFICATIONS.PERSISTENT_THERMAL_SOURCE.code).toBe(4);
    expect(CLASSIFICATIONS.UNKNOWN.code).toBe(5);
  });

  it('round-trips model codes back to definitions', () => {
    for (const key of CLASSIFICATION_KEYS) {
      const definition = CLASSIFICATIONS[key];
      expect(fromModelCode(definition.code).key).toBe(key);
    }
  });

  it('degrades an out-of-range model code to UNKNOWN instead of throwing', () => {
    expect(fromModelCode(99).key).toBe('UNKNOWN');
    expect(fromModelCode(-1).key).toBe('UNKNOWN');
  });

  it('resolves fixtures to the expected classes', () => {
    expect(getClassification(H001.classification).key).toBe('GAS_FLARE');
    expect(getClassification(H011.classification).key).toBe('PERSISTENT_THERMAL_SOURCE');
  });
});

/* -------------------------------------------------------------------------- */

describe('risk banding', () => {
  it('bands scores at the documented boundaries', () => {
    expect(resolveRiskLevel(100).key).toBe('CRITICAL');
    expect(resolveRiskLevel(90).key).toBe('CRITICAL');
    expect(resolveRiskLevel(89).key).toBe('HIGH');
    expect(resolveRiskLevel(80).key).toBe('HIGH');
    expect(resolveRiskLevel(79).key).toBe('MEDIUM');
    expect(resolveRiskLevel(50).key).toBe('MEDIUM');
    expect(resolveRiskLevel(49).key).toBe('LOW');
    expect(resolveRiskLevel(0).key).toBe('LOW');
  });

  it('treats missing or non-finite scores as LOW rather than crashing', () => {
    expect(resolveRiskLevel(null).key).toBe('LOW');
    expect(resolveRiskLevel(undefined).key).toBe('LOW');
    expect(resolveRiskLevel(Number.NaN).key).toBe('LOW');
  });

  it('reconciles Critical + High with the backend high-risk threshold', () => {
    // This invariant is why the console can show four bands without contradicting
    // the backend's three-band /statistics output.
    const counts = riskCounts(SAMPLE);
    const consoleHighRisk = counts.CRITICAL + counts.HIGH;
    const backendHighRisk = SAMPLE.filter(
      (hotspot) => hotspot.risk_score >= BACKEND_HIGH_RISK_THRESHOLD,
    ).length;

    expect(consoleHighRisk).toBe(backendHighRisk);
  });

  it('orders bands most severe first', () => {
    expect(RISK_LEVEL_LIST.map((level) => level.key)).toEqual([
      'CRITICAL',
      'HIGH',
      'MEDIUM',
      'LOW',
    ]);
  });

  it('matches the backend definition of high risk', () => {
    expect(isHighRisk(80)).toBe(true);
    expect(isHighRisk(79)).toBe(false);
    expect(isHighRisk(null)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe('persistence', () => {
  it('reads the real day count, not the look-back window length', () => {
    // Regression guard for the get_persistence() defect, which returned 7 for
    // H002 because persistence_7d is a truthy 1. Both backend and frontend must
    // report the count; if either regresses, this fails.
    expect(resolvePersistenceDays(H002)).toBe(1);
    expect(resolvePersistenceDays(H001)).toBe(7);
    expect(resolvePersistenceDays(H003)).toBe(5);
    expect(resolvePersistenceDays(H004)).toBe(2);
  });

  it('applies the persistence threshold at exactly the documented boundary', () => {
    // Guards against the threshold constant and the predicate drifting apart.
    const atThreshold = { ...H002, persistence_7d: PERSISTENCE_THRESHOLD_DAYS };
    const belowThreshold = { ...H002, persistence_7d: PERSISTENCE_THRESHOLD_DAYS - 1 };

    expect(isPersistent(atThreshold)).toBe(true);
    expect(isPersistent(belowThreshold)).toBe(false);
  });

  it('identifies only genuinely persistent sources', () => {
    expect(isPersistent(H001)).toBe(true);
    expect(isPersistent(H011)).toBe(true);
    expect(isPersistent(H002)).toBe(false);
    expect(isPersistent(H003)).toBe(false);
  });

  it('finds exactly two persistent sources in the sample, not all of them', () => {
    const persistent = SAMPLE.filter(isPersistent);
    expect(persistent.map((hotspot) => hotspot.id)).toEqual(['H001', 'H011']);
  });

  it('falls back through narrower windows when the widest is absent', () => {
    expect(resolvePersistenceDays({ ...H001, persistence_7d: null })).toBe(3);
    expect(resolvePersistenceDays({ ...H001, persistence_7d: null, persistence_3d: null })).toBe(1);
  });

  it('returns null when no persistence data exists at all', () => {
    const bare = { ...H001, persistence_7d: null, persistence_3d: null, persistence_1d: null };
    expect(resolvePersistenceDays(bare)).toBeNull();
    expect(isPersistent(bare)).toBe(false);
  });

  it('bands persistence correctly', () => {
    expect(resolvePersistenceBand(H001)?.key).toBe('PERSISTENT');
    expect(resolvePersistenceBand(H003)?.key).toBe('EXTENDED');
    expect(resolvePersistenceBand(H004)?.key).toBe('SHORT');
    expect(resolvePersistenceBand(H002)?.key).toBe('SINGLE_DAY');
  });
});

/* -------------------------------------------------------------------------- */

describe('filters', () => {
  it('sends no parameters when nothing is filtered', () => {
    expect(toHotspotQuery(DEFAULT_FILTERS)).toEqual({});
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
  });

  it('pushes a single class selection to the backend', () => {
    const filters: FilterState = { ...DEFAULT_FILTERS, classifications: ['GAS_FLARE'] };

    expect(toHotspotQuery(filters).classification).toBe('Gas Flare');
    expect(filterPlacement(filters, 'classifications')).toBe('server');
  });

  it('withholds classification from the query when several classes are selected', () => {
    // The backend accepts one value, so a multi-select must be applied client-side.
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      classifications: ['GAS_FLARE', 'WILDFIRE'],
    };

    expect(toHotspotQuery(filters).classification).toBeUndefined();
    expect(filterPlacement(filters, 'classifications')).toBe('client');
  });

  it('treats a full selection as no filter at all', () => {
    const filters: FilterState = { ...DEFAULT_FILTERS, classifications: [...CLASSIFICATION_KEYS] };

    expect(countActiveFilters(filters)).toBe(0);
    expect(filterPlacement(filters, 'classifications')).toBe('inactive');
    expect(applyClientFilters(SAMPLE, filters)).toHaveLength(SAMPLE.length);
  });

  it('sends min_persistence to the backend now that the parameter works', () => {
    const filters: FilterState = { ...DEFAULT_FILTERS, minPersistence: 7 };

    expect(toHotspotQuery(filters).min_persistence).toBe(7);
    expect(filterPlacement(filters, 'minPersistence')).toBe('server');
  });

  it('leaves persistence narrowing to the backend, not applyClientFilters', () => {
    // The only client-side filter left is a multi-class selection.
    const filters: FilterState = { ...DEFAULT_FILTERS, minPersistence: 7 };

    expect(applyClientFilters(SAMPLE, filters)).toHaveLength(SAMPLE.length);
  });

  it('maps the remaining filters onto real backend parameter names', () => {
    const filters: FilterState = {
      classifications: [],
      minRisk: 80,
      satellite: 'MODIS_NRT',
      minPersistence: 4,
      maxIndustrialDistance: 2,
      landCover: 'Forest',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
    };

    expect(toHotspotQuery(filters)).toEqual({
      min_risk: 80,
      min_persistence: 4,
      satellite: 'MODIS_NRT',
      max_industrial_distance: 2,
      land_cover: 'Forest',
      date_from: '2026-08-01',
      date_to: '2026-08-31',
    });
    expect(countActiveFilters(filters)).toBe(7);
  });

  it('applies multi-class narrowing on the client', () => {
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      classifications: ['WILDFIRE', 'UNKNOWN'],
    };

    expect(applyClientFilters(SAMPLE, filters).map((h) => h.id)).toEqual(['H004', 'H005']);
  });

  it('sorts without mutating the input array', () => {
    const original = [...SAMPLE];
    const sorted = sortHotspots(SAMPLE, 'risk-desc');

    expect(sorted[0].id).toBe('H008');
    expect(SAMPLE).toEqual(original);
  });

  it('sorts nulls last regardless of direction', () => {
    const withNull = [{ ...H001, frp: null }, H003];
    expect(sortHotspots(withNull, 'frp-desc').map((h) => h.id)).toEqual(['H003', 'H001']);

    const withNullDistance = [{ ...H001, distance_to_industry_km: null }, H003];
    expect(sortHotspots(withNullDistance, 'proximity-asc').map((h) => h.id)).toEqual([
      'H003',
      'H001',
    ]);
  });
});

/* -------------------------------------------------------------------------- */

describe('query serialisation', () => {
  it('produces an empty string when there is nothing to send', () => {
    expect(buildQueryString(undefined)).toBe('');
    expect(buildQueryString({})).toBe('');
  });

  it('omits null, undefined and blank values so unset filters send nothing', () => {
    expect(
      buildQueryString({ a: null, b: undefined, c: '', d: '   ' }),
    ).toBe('');
  });

  it('keeps zero and false, which are meaningful values', () => {
    // min_risk=0 is a legitimate filter; dropping it would be a bug.
    expect(buildQueryString({ min_risk: 0 })).toBe('?min_risk=0');
    expect(buildQueryString({ flag: false })).toBe('?flag=false');
  });

  it('percent-encodes values that would otherwise break the URL', () => {
    expect(buildQueryString({ classification: 'Gas Flare' })).toBe('?classification=Gas+Flare');
    expect(buildQueryString({ facility: 'Oil & Gas' })).toBe('?facility=Oil+%26+Gas');
  });
});

/* -------------------------------------------------------------------------- */

describe('aggregation', () => {
  it('summarises the sample consistently with its parts', () => {
    const summary = summarise(SAMPLE);

    expect(summary.total).toBe(7);
    expect(summary.critical + summary.high + summary.medium + summary.low).toBe(7);
    expect(summary.highRiskTotal).toBe(summary.critical + summary.high);
    expect(summary.persistent).toBe(2);
    expect(summary.industrialLinked).toBe(3);
    expect(summary.unclassified).toBe(1);
    expect(summary.nightDetections).toBe(2);
  });

  it('counts high-risk detections near infrastructure', () => {
    // H001 (87, 0.42 km), H003 (94, 0.8 km), H008 (96, 1.2 km) qualify.
    // H011 (74) is too low-risk; H004 is too far.
    expect(summarise(SAMPLE).highRiskNearInfrastructure).toBe(3);
  });

  it('returns all six classes even when some have no records', () => {
    const counts = classificationCounts([H001]);

    expect(Object.keys(counts)).toHaveLength(6);
    expect(counts.GAS_FLARE).toBe(1);
    expect(counts.WILDFIRE).toBe(0);
  });

  it('produces persistence counts that total the record count', () => {
    const counts = persistenceCounts(SAMPLE);
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);

    expect(total).toBe(SAMPLE.length);
    expect(counts.PERSISTENT).toBe(2);
  });

  it('buckets proximity on the backend boundaries and reports missing data', () => {
    const counts = proximityCounts(SAMPLE);

    // H001 0.42 km is the only one within 500 m.
    expect(counts.within500m).toBe(1);
    // H003 0.8 km and H008 1.2 km fall in the middle band.
    expect(counts.from500mTo2km).toBe(2);
    expect(counts.unknown).toBe(0);

    expect(proximityCounts([{ ...H001, distance_to_industry_km: null }]).unknown).toBe(1);
  });

  it('bins detections by acquisition hour', () => {
    const hours = detectionsByHour(SAMPLE);

    expect(hours).toHaveLength(24);
    expect(hours[12]).toBe(1); // H001 at 12:30
    expect(hours[23]).toBe(1); // H011 at 23:30
    expect(hours.reduce((sum, value) => sum + value, 0)).toBe(SAMPLE.length);
  });

  it('drops scatter points missing either axis', () => {
    expect(thermalPoints(SAMPLE)).toHaveLength(SAMPLE.length);
    expect(thermalPoints([{ ...H001, frp: null }])).toHaveLength(0);
    expect(thermalPoints([{ ...H001, brightness_temperature: null }])).toHaveLength(0);
  });

  it('reports null averages for an empty list rather than NaN', () => {
    const summary = summarise([]);

    expect(summary.total).toBe(0);
    expect(summary.meanRisk).toBeNull();
    expect(summary.meanFrp).toBeNull();
    expect(summary.maxFrp).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('evidence assessment', () => {
  it('produces all six axes for any record', () => {
    const axes = assessEvidence(H001).map((assessment) => assessment.axis);

    expect(axes).toEqual([
      'THERMAL',
      'TEMPORAL',
      'SPATIAL',
      'INFRASTRUCTURE',
      'LAND_COVER',
      'MODEL_CONFIDENCE',
    ]);
  });

  it('rates a persistent flare beside infrastructure as strongly supported', () => {
    const byAxis = new Map(assessEvidence(H001).map((a) => [a.axis, a]));

    expect(byAxis.get('THERMAL')?.strength).toBe('strong');
    expect(byAxis.get('TEMPORAL')?.strength).toBe('strong');
    expect(byAxis.get('SPATIAL')?.strength).toBe('strong');
    expect(byAxis.get('INFRASTRUCTURE')?.strength).toBe('strong');
    expect(byAxis.get('MODEL_CONFIDENCE')?.strength).toBe('strong');
  });

  it('rates remote single-day cropland burning as weakly supported industrially', () => {
    const byAxis = new Map(assessEvidence(H002).map((a) => [a.axis, a]));

    expect(byAxis.get('TEMPORAL')?.strength).toBe('weak');
    expect(byAxis.get('SPATIAL')?.strength).toBe('absent');
    expect(byAxis.get('INFRASTRUCTURE')?.strength).toBe('absent');
    // Cropland is consistent with agricultural burning, so land cover supports it.
    expect(byAxis.get('LAND_COVER')?.strength).toBe('strong');
  });

  it('flags land cover that contradicts the assigned class', () => {
    const mislabelled = { ...H004, classification: 'Industrial Fire' };
    const landCover = assessEvidence(mislabelled).find((a) => a.axis === 'LAND_COVER');

    // Forest is not consistent with an industrial fire.
    expect(landCover?.strength).toBe('weak');
  });

  it('reports no expectation for an unresolved class', () => {
    const landCover = assessEvidence(H005).find((a) => a.axis === 'LAND_COVER');
    expect(landCover?.strength).toBe('moderate');
  });

  it('marks missing measurements as unavailable rather than weak', () => {
    const bare = { ...H001, frp: null, brightness_temperature: null };
    const thermal = assessEvidence(bare).find((a) => a.axis === 'THERMAL');

    expect(thermal?.strength).toBe('unavailable');
  });

  it('tallies axes into a summary that totals six', () => {
    const summary = summariseEvidence(assessEvidence(H001));
    const total =
      summary.strong + summary.moderate + summary.conflicting + summary.unavailable;

    expect(total).toBe(6);
  });
});

/* -------------------------------------------------------------------------- */

describe('alerts', () => {
  const alertFor = (hotspot: typeof H001, status: string, persistenceDays: number): Alert => ({
    hotspot_id: hotspot.id,
    classification: hotspot.classification,
    risk_score: hotspot.risk_score,
    confidence: 91,
    location: { lat: hotspot.lat, lon: hotspot.lon },
    persistence_days: persistenceDays,
    industrial_distance_km: hotspot.distance_to_industry_km,
    detection_date: hotspot.acq_date,
    detection_time: hotspot.acq_time,
    status,
  });

  it('maps backend status values to display metadata', () => {
    expect(statusMeta('NEEDS INVESTIGATION').label).toBe('Needs investigation');
    expect(statusMeta('new').label).toBe('New');
    expect(statusMeta('REVIEWED').label).toBe('Reviewed');
  });

  it('does not invent metadata for an unrecognised status', () => {
    expect(statusMeta('ESCALATED').label).toBe('ESCALATED');
  });

  it('takes persistence from the payload now that the backend reports it correctly', () => {
    const enriched = enrichAlerts([alertFor(H002, 'REVIEWED', 1)], [H002]);

    expect(enriched[0].persistenceDays).toBe(1);
  });

  it('falls back to the hotspot record when the payload omits persistence', () => {
    const alert = { ...alertFor(H002, 'REVIEWED', 1), persistence_days: undefined } as never;
    const enriched = enrichAlerts([alert], [H002]);

    expect(enriched[0].persistenceDays).toBe(1);
  });

  it('tolerates an alert whose hotspot is not loaded', () => {
    const enriched = enrichAlerts([alertFor(H001, 'NEW', 7)], []);

    expect(enriched[0].hotspot).toBeNull();
    // Persistence still resolves, because it comes from the payload.
    expect(enriched[0].persistenceDays).toBe(7);
    // These genuinely require the join and stay null.
    expect(enriched[0].insideIndustrialPolygon).toBeNull();
    expect(enriched[0].landCover).toBeNull();
  });

  it('computes detection age from the timestamp', () => {
    const now = new Date(2026, 7, 27, 18, 30);
    // H001 was acquired at 12:30 the same day.
    expect(detectionAgeHours('2026-08-27', '12:30', now)).toBeCloseTo(6, 5);
  });

  it('returns null for an unparseable date instead of a misleading zero', () => {
    expect(detectionAgeHours('not-a-date', '12:30')).toBeNull();
    expect(detectionAgeHours(null, '12:30')).toBeNull();
  });

  it('defaults a missing time to midnight rather than failing', () => {
    const now = new Date(2026, 7, 27, 6, 0);
    expect(detectionAgeHours('2026-08-27', null, now)).toBeCloseTo(6, 5);
  });

  it('labels future timestamps as future, since the mock data is dated ahead', () => {
    expect(formatAge(-5)).toBe('in 5 h');
    expect(formatAge(6)).toBe('6 h ago');
    expect(formatAge(0.5)).toBe('30 min ago');
    expect(formatAge(72)).toBe('3 d ago');
    expect(formatAge(null)).toBe('—');
  });

  it('sorts by persistence descending', () => {
    const alerts = enrichAlerts(
      [alertFor(H002, 'REVIEWED', 1), alertFor(H001, 'NEW', 7)],
      [H001, H002],
    );
    const sorted = sortAlerts(alerts, 'persistence-desc');

    expect(sorted.map((entry) => entry.alert.hotspot_id)).toEqual(['H001', 'H002']);
  });
});

/* -------------------------------------------------------------------------- */

describe('saved investigation queries', () => {
  it('requires every clause to pass', () => {
    const query = SAVED_QUERIES.find((q) => q.id === 'persistent-industrial');
    expect(query).toBeDefined();

    const result = runQuery(query!, SAMPLE);

    // H001: 7 days and 0.42 km — matches.
    // H011: 7 days but 5.6 km — fails proximity.
    // H003: 0.8 km but only 5 days — fails persistence.
    expect(result.matches.map((match) => match.hotspot.id)).toEqual(['H001']);
    expect(result.evaluated).toBe(SAMPLE.length);
  });

  it('reports the clauses that caused a match, for explainability', () => {
    const query = SAVED_QUERIES.find((q) => q.id === 'persistent-industrial')!;
    const result = runQuery(query, SAMPLE);

    expect(result.matches[0].matchedClauses).toHaveLength(query.clauses.length);
    expect(result.matches[0].matchedClauses[0]).toContain('7');
  });

  it('finds high-risk detections inside industrial polygons', () => {
    const query = SAVED_QUERIES.find((q) => q.id === 'high-risk-industrial')!;
    const result = runQuery(query, SAMPLE);

    expect(result.matches.map((m) => m.hotspot.id)).toEqual(['H008', 'H003', 'H001']);
  });

  it('identifies hydrocarbon flare candidates', () => {
    const query = SAVED_QUERIES.find((q) => q.id === 'flare-candidates')!;
    const result = runQuery(query, SAMPLE);

    // H001 (Oil & Gas, 7 d, 0.42 km) and H008 (Chemical Plant, 4 d, 1.2 km).
    expect(result.matches.map((m) => m.hotspot.id)).toEqual(['H008', 'H001']);
  });

  it('surfaces unresolved and low-confidence records', () => {
    expect(
      runQuery(SAVED_QUERIES.find((q) => q.id === 'unresolved')!, SAMPLE).matches.map(
        (m) => m.hotspot.id,
      ),
    ).toEqual(['H005']);

    expect(
      runQuery(SAVED_QUERIES.find((q) => q.id === 'low-confidence')!, SAMPLE).matches.map(
        (m) => m.hotspot.id,
      ),
    ).toEqual(['H005']);
  });

  it('returns an empty match list rather than throwing on no data', () => {
    for (const query of SAVED_QUERIES) {
      const result = runQuery(query, []);
      expect(result.matches).toEqual([]);
      expect(result.evaluated).toBe(0);
    }
  });

  it('orders results by descending risk', () => {
    for (const query of SAVED_QUERIES) {
      const scores = runQuery(query, SAMPLE).matches.map((m) => m.hotspot.risk_score);
      const descending = [...scores].sort((a, b) => b - a);
      expect(scores).toEqual(descending);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('formatting', () => {
  it('formats coordinates with hemisphere notation', () => {
    expect(formatCoordinates(28.6139, 77.209)).toBe('28.6139° N, 77.2090° E');
    expect(formatCoordinates(-12.5, -60.25)).toBe('12.5000° S, 60.2500° W');
  });

  it('formats dates without a timezone shift', () => {
    // new Date('2026-08-27') parses as UTC midnight and can render as the 26th
    // in negative offsets, so the formatter parses the string by hand.
    expect(formatAcqDate('2026-08-27')).toBe('27 AUG 2026');
    expect(formatAcqDate('2026-01-01')).toBe('01 JAN 2026');
  });

  it('passes through a date it cannot parse instead of showing a placeholder', () => {
    expect(formatAcqDate('27/08/2026')).toBe('27/08/2026');
  });

  it('handles confidence arriving on either scale', () => {
    // /hotspots returns 0-1; /alerts and /explanation return 0-100.
    expect(formatRatioAsPercent(0.91)).toBe('91%');
    expect(formatRatioAsPercent(91)).toBe('91%');
    expect(toPercentScale(0.91)).toBeCloseTo(91, 5);
    expect(toPercentScale(91)).toBe(91);
    expect(toPercentScale(null)).toBeNull();
  });

  it('renders a visible placeholder for every missing value', () => {
    expect(formatKm(null)).toBe('—');
    expect(formatDays(null)).toBe('—');
    expect(formatCoordinates(null, null)).toBe('—');
    expect(formatRatioAsPercent(null)).toBe('—');
  });

  it('pluralises day counts', () => {
    expect(formatDays(1)).toBe('1 day');
    expect(formatDays(7)).toBe('7 days');
  });
});
