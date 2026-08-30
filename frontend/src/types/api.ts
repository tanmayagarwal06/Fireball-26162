/**
 * Response shapes for the non-hotspot endpoints of `backend/app.py`.
 * All four exist and were verified against the running server.
 */

/** `GET /health` */
export interface HealthResponse {
  status: string;
  service: string;
  /** Number of records loaded from mock/hotspots.json at server start. */
  hotspots_loaded: number;
}

/** `GET /` */
export interface RootResponse {
  message: string;
  docs: string;
  status: string;
}

/**
 * `GET /statistics`
 *
 * Computed over the *entire* dataset. The endpoint accepts no query parameters,
 * so it cannot reflect the dashboard's active filter state — treat it as the
 * global baseline and compute filtered aggregates from `GET /hotspots`.
 */
export interface StatisticsResponse {
  summary: {
    total_detections: number;
    /** risk_score >= 80. */
    high_risk: number;
    /** Detected on 7 or more days. Reliable since the get_persistence() fix. */
    persistent_sources: number;
    /** `inside_industrial_polygon === true`. */
    industrial_linked: number;
  };

  /** Label -> count. Keys are raw classification labels, e.g. "Gas Flare". */
  classification_distribution: Record<string, number>;

  /** Three buckets: High (>=80), Medium (>=50), Low (<50). */
  risk_distribution: Record<string, number>;

  /**
   * Buckets "1 Day" / "3 Days" / "7+ Days".
   *
   * Note the labels are looser than the boundaries: the backend assigns
   * >= 7 to "7+ Days", >= 3 to "3 Days" and everything else to "1 Day", so
   * "3 Days" actually spans 3-6 days and "1 Day" spans 0-2.
   */
  persistence_distribution: Record<string, number>;

  /** Buckets "Within 500m" / "500m-2km" / ">2km". Null distances are skipped. */
  industrial_proximity: Record<string, number>;
}

/**
 * A single entry from `GET /alerts`.
 *
 * Backend-derived from hotspot records — there is no alert store, no
 * acknowledgement workflow and no delivery mechanism behind this endpoint.
 */
export interface Alert {
  hotspot_id: string;
  classification: string;
  risk_score: number;
  /**
   * NOTE the field name. Despite being called `confidence`, this carries
   * `classification_confidence` scaled to 0-100 — *not* the FIRMS detection
   * confidence that `Hotspot.confidence` holds.
   */
  confidence: number | null;
  location: {
    lat: number;
    lon: number;
  };
  /** Days on which the source was detected. Reliable since the backend fix. */
  persistence_days: number;
  industrial_distance_km: number | null;
  detection_date: string;
  detection_time: string;
  /** One of "NEEDS INVESTIGATION" | "NEW" | "REVIEWED". */
  status: string;
}

/** `GET /alerts` */
export interface AlertListResponse {
  count: number;
  alerts: Alert[];
}

/**
 * Query parameters accepted by `GET /alerts`.
 *
 * A type alias, not an interface, so it carries an implicit index signature and
 * can be handed directly to the client's query serialiser.
 */
export type AlertQuery = {
  /** Inclusive lower bound on risk_score, 0-100. Defaults to 0. */
  min_risk?: number;
  /** Exact, case-insensitive match on classification. */
  classification?: string;
  /** Exact, case-insensitive match on the derived status string. */
  status?: string;
};

/**
 * `GET /hotspots/{id}/explanation`
 *
 * IMPORTANT: this is a deterministic evidence summary assembled from structured
 * fields by `get_hotspot_explanation()`. It is not model output and contains no
 * learned reasoning. The classification engine is not built yet.
 */
export interface ExplanationResponse {
  hotspot_id: string;
  classification: string;
  /** Already scaled to 0-100 by the backend. */
  classification_confidence: number | null;
  risk_score: number;
  supporting_evidence: string[];
  /** Always empty in the current backend implementation. */
  conflicting_evidence: string[];
  uncertainty: string;
  risk_factors: {
    /** FRP in MW. */
    thermal_intensity: number | null;
    persistence_days: number;
    infrastructure_proximity_km: number | null;
    /** 0-100. */
    classification_confidence: number | null;
  };
}
