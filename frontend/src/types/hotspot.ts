/**
 * Hotspot record shape.
 *
 * Derived field-by-field from the live responses of `backend/app.py` and the
 * records in `mock/hotspots.json`. Nothing here is speculative: if a field is
 * listed, the backend returns it today.
 *
 * The backend performs no serialisation of its own — it echoes the raw JSON
 * objects straight out of mock/hotspots.json — so this interface is effectively
 * the mock data schema. Optional/nullable markers reflect what the data
 * actually contains (e.g. `nearest_facility_type` is null for 4 of 11 records).
 */
export interface Hotspot {
  /** Stable record identifier, e.g. "H001". Path parameter for /hotspots/{id}. */
  id: string;

  /** WGS84 decimal degrees. */
  lat: number;
  lon: number;

  /** Acquisition date, "YYYY-MM-DD". Used by the date_from / date_to filters. */
  acq_date: string;
  /** Acquisition time, "HH:MM". */
  acq_time: string;

  /**
   * Full sensor identifier, e.g. "VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT",
   * "MODIS_NRT". The backend `satellite` filter is an exact case-insensitive
   * match on this whole string, so a value like "VIIRS" will match nothing.
   */
  satellite: string;

  /**
   * Brightness temperature in Kelvin.
   *
   * Present on every record in the current mock dataset, but nullable: real FIRMS
   * granules do omit these fields, and the consuming code already guards for it
   * (see `thermalPoints()` in src/domain/aggregate.ts, which exists to drop
   * records missing either thermal axis).
   */
  brightness_temperature: number | null;
  /** Fire Radiative Power in megawatts. Nullable for the same reason. */
  frp: number | null;

  /**
   * FIRMS *detection* confidence, 0-100 integer.
   * Not to be confused with `classification_confidence` below.
   */
  confidence: number;

  /** "D" = daytime overpass, "N" = nighttime overpass. */
  day_night: DayNight;

  /**
   * Number of days the source was detected within each look-back window.
   * These are day counts, not booleans: a record with `persistence_7d: 1` was
   * seen on one day out of seven.
   *
   * Prefer `resolvePersistenceDays()` from src/domain/persistence.ts over reading
   * these directly, so the window-preference rule stays in one place.
   */
  persistence_1d: number | null;
  persistence_3d: number | null;
  persistence_7d: number | null;

  /** Great-circle distance to the nearest industrial feature, in km. */
  distance_to_industry_km: number | null;
  /** True when the detection falls inside a mapped industrial polygon (OSM). */
  inside_industrial_polygon: boolean;
  /** Facility type of the nearest industrial feature; null when none is near. */
  nearest_facility_type: string | null;

  /** Land-cover class label. Exact-match target of the `land_cover` filter. */
  land_cover_class: string | null;

  /** Count of co-located detections; a clustering signal. */
  hotspot_density: number | null;

  /**
   * Current thermal class as a human-readable label, e.g. "Gas Flare".
   * Parse with `parseClassification()` rather than comparing strings.
   */
  classification: string;

  /**
   * Confidence in the *classification*, expressed 0-1 in the mock data.
   * `/hotspots` and `/hotspots/{id}` return the raw 0-1 float; `/alerts` and
   * `/hotspots/{id}/explanation` return the same value already scaled to 0-100.
   */
  classification_confidence: number | null;

  /** Composite operational risk score, 0-100. */
  risk_score: number;

  /**
   * Pre-authored evidence strings from the mock dataset. These are human-written
   * justifications, not model output.
   */
  evidence: string[];
}

export type DayNight = 'D' | 'N';

/** Response envelope of `GET /hotspots`. */
export interface HotspotListResponse {
  count: number;
  hotspots: Hotspot[];
}

/**
 * Query parameters accepted by `GET /hotspots`.
 *
 * This mirrors the signature of `get_hotspots()` in backend/app.py exactly.
 * No filter is listed here that the backend does not implement.
 */
/*
 * Declared as a type alias rather than an interface so it carries an implicit
 * index signature and can be passed straight to the client's query serialiser.
 * TypeScript does not grant interfaces that implicit signature.
 */
export type HotspotQuery = {
  /** Exact, case-insensitive match on `classification`. */
  classification?: string;
  /** Inclusive lower bound on `risk_score`. Backend validates 0-100. */
  min_risk?: number;
  /** Exact, case-insensitive match on the full `satellite` identifier. */
  satellite?: string;
  /**
   * Inclusive lower bound on persistence in days, compared against the number of
   * days the source was actually detected.
   *
   * This parameter was previously a no-op: `get_persistence()` returned the
   * look-back window length rather than the day count, so it matched every
   * record. Fixed in backend/app.py and verified against the live API —
   * ?min_persistence= now returns 11 / 9 / 5 / 2 for thresholds 1 / 2 / 4 / 7.
   */
  min_persistence?: number;
  /** Inclusive upper bound on `distance_to_industry_km`; drops null distances. */
  max_industrial_distance?: number;
  /** Exact, case-insensitive match on `land_cover_class`. */
  land_cover?: string;
  /** Inclusive lower bound on `acq_date`, "YYYY-MM-DD" (string comparison). */
  date_from?: string;
  /** Inclusive upper bound on `acq_date`, "YYYY-MM-DD" (string comparison). */
  date_to?: string;
};
