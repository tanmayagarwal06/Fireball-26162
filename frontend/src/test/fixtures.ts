/**
 * Test fixtures.
 *
 * Records copied verbatim from mock/hotspots.json so the tests assert against the
 * exact data the backend serves. If the mock dataset changes, these should be
 * updated to match rather than adjusted to keep tests passing.
 */
import type { Hotspot } from '../types/hotspot';

/** H001 — the 7-day persistent gas flare beside an oil and gas facility. */
export const H001: Hotspot = {
  id: 'H001',
  lat: 28.6139,
  lon: 77.209,
  acq_date: '2026-08-27',
  acq_time: '12:30',
  satellite: 'VIIRS_NOAA20_NRT',
  brightness_temperature: 1240.5,
  frp: 182.4,
  confidence: 92,
  day_night: 'D',
  persistence_1d: 1,
  persistence_3d: 3,
  persistence_7d: 7,
  distance_to_industry_km: 0.42,
  inside_industrial_polygon: true,
  nearest_facility_type: 'Oil & Gas',
  land_cover_class: 'Built-up',
  hotspot_density: 12,
  classification: 'Gas Flare',
  classification_confidence: 0.91,
  risk_score: 87,
  evidence: ['Detected on 7 consecutive days'],
};

/**
 * H002 — agricultural burning, one detection day.
 *
 * The critical fixture for the persistence defect: `persistence_7d` is 1, which
 * the backend's truthiness check misreads as 7.
 */
export const H002: Hotspot = {
  id: 'H002',
  lat: 28.7041,
  lon: 77.1025,
  acq_date: '2026-08-27',
  acq_time: '13:10',
  satellite: 'VIIRS_SNPP_NRT',
  brightness_temperature: 890.2,
  frp: 64.7,
  confidence: 81,
  day_night: 'D',
  persistence_1d: 1,
  persistence_3d: 1,
  persistence_7d: 1,
  distance_to_industry_km: 8.7,
  inside_industrial_polygon: false,
  nearest_facility_type: null,
  land_cover_class: 'Cropland',
  hotspot_density: 4,
  classification: 'Agricultural Burning',
  classification_confidence: 0.84,
  risk_score: 43,
  evidence: ['Located within cropland'],
};

/** H003 — critical industrial fire inside an industrial polygon. */
export const H003: Hotspot = {
  id: 'H003',
  lat: 28.4595,
  lon: 77.0266,
  acq_date: '2026-08-27',
  acq_time: '14:05',
  satellite: 'VIIRS_NOAA20_NRT',
  brightness_temperature: 1085.7,
  frp: 231.8,
  confidence: 95,
  day_night: 'D',
  persistence_1d: 1,
  persistence_3d: 3,
  persistence_7d: 5,
  distance_to_industry_km: 0.8,
  inside_industrial_polygon: true,
  nearest_facility_type: 'Manufacturing',
  land_cover_class: 'Built-up',
  hotspot_density: 18,
  classification: 'Industrial Fire',
  classification_confidence: 0.88,
  risk_score: 94,
  evidence: ['Very high FRP'],
};

/** H004 — wildfire in forest, far from industry. */
export const H004: Hotspot = {
  id: 'H004',
  lat: 28.5355,
  lon: 77.391,
  acq_date: '2026-08-27',
  acq_time: '15:20',
  satellite: 'MODIS_NRT',
  brightness_temperature: 760.4,
  frp: 42.3,
  confidence: 76,
  day_night: 'D',
  persistence_1d: 1,
  persistence_3d: 2,
  persistence_7d: 2,
  distance_to_industry_km: 14.2,
  inside_industrial_polygon: false,
  nearest_facility_type: null,
  land_cover_class: 'Forest',
  hotspot_density: 7,
  classification: 'Wildfire',
  classification_confidence: 0.79,
  risk_score: 68,
  evidence: ['Located in forest land cover'],
};

/** H005 — unknown classification, low confidence. */
export const H005: Hotspot = {
  id: 'H005',
  lat: 28.4089,
  lon: 77.3178,
  acq_date: '2026-08-27',
  acq_time: '16:45',
  satellite: 'VIIRS_SNPP_NRT',
  brightness_temperature: 970.1,
  frp: 97.6,
  confidence: 63,
  day_night: 'D',
  persistence_1d: 1,
  persistence_3d: 2,
  persistence_7d: 3,
  distance_to_industry_km: 3.1,
  inside_industrial_polygon: false,
  nearest_facility_type: 'Warehouse',
  land_cover_class: 'Built-up',
  hotspot_density: 9,
  classification: 'Unknown',
  classification_confidence: 0.51,
  risk_score: 56,
  evidence: ['Conflicting spatial and thermal evidence'],
};

/** H008 — highest-risk record in the dataset, night overpass. */
export const H008: Hotspot = {
  id: 'H008',
  lat: 28.32,
  lon: 76.92,
  acq_date: '2026-08-27',
  acq_time: '20:40',
  satellite: 'VIIRS_SNPP_NRT',
  brightness_temperature: 1045.3,
  frp: 198.7,
  confidence: 94,
  day_night: 'N',
  persistence_1d: 1,
  persistence_3d: 3,
  persistence_7d: 4,
  distance_to_industry_km: 1.2,
  inside_industrial_polygon: true,
  nearest_facility_type: 'Chemical Plant',
  land_cover_class: 'Industrial',
  hotspot_density: 15,
  classification: 'Industrial Fire',
  classification_confidence: 0.93,
  risk_score: 96,
  evidence: ['Very high FRP'],
};

/** H011 — the other genuinely 7-day persistent source. */
export const H011: Hotspot = {
  id: 'H011',
  lat: 28.68,
  lon: 77.28,
  acq_date: '2026-08-27',
  acq_time: '23:30',
  satellite: 'VIIRS_NOAA20_NRT',
  brightness_temperature: 1005.4,
  frp: 88.5,
  confidence: 90,
  day_night: 'N',
  persistence_1d: 1,
  persistence_3d: 3,
  persistence_7d: 7,
  distance_to_industry_km: 5.6,
  inside_industrial_polygon: false,
  nearest_facility_type: 'Power Plant',
  land_cover_class: 'Built-up',
  hotspot_density: 14,
  classification: 'Persistent Thermal Source',
  classification_confidence: 0.89,
  risk_score: 74,
  evidence: ['Detected consistently for 7 days'],
};

/** A representative subset spanning every classification and risk band. */
export const SAMPLE: Hotspot[] = [H001, H002, H003, H004, H005, H008, H011];
