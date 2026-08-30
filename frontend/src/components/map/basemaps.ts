/**
 * Basemap definitions.
 *
 * CARTO's dark basemaps are the default: they are keyless, high-contrast and
 * built for exactly this kind of data overlay, which keeps thermal markers as
 * the brightest thing on screen per DESIGN.md. Standard OSM is offered as a
 * fallback for networks that block the CARTO CDN.
 *
 * Attribution is mandatory for all three and is rendered by Leaflet's own
 * attribution control — do not remove it.
 */

export interface Basemap {
  id: string;
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
  subdomains?: string;
  /** Short note shown in the layer picker. */
  description: string;
}

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`;

export const BASEMAPS: Basemap[] = [
  {
    id: 'carto-dark',
    label: 'Dark',
    description: 'Dark basemap with place labels',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION,
    subdomains: 'abcd',
    maxZoom: 20,
  },
  {
    id: 'carto-dark-nolabels',
    label: 'Dark (no labels)',
    description: 'Minimal basemap for uncluttered data reading',
    url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION,
    subdomains: 'abcd',
    maxZoom: 20,
  },
  {
    id: 'osm',
    label: 'OSM standard',
    description: 'Fallback if the CARTO CDN is unreachable',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTRIBUTION,
    maxZoom: 19,
  },
];

export const DEFAULT_BASEMAP = BASEMAPS[0];

/**
 * Fallback view when the dataset is empty and there are no bounds to fit.
 * Centred on the National Capital Region, which is where the mock data sits.
 */
export const FALLBACK_CENTER: [number, number] = [28.6139, 77.209];
export const FALLBACK_ZOOM = 8;

/** Padding applied when fitting the map to the data, in pixels. */
export const FIT_PADDING: [number, number] = [48, 48];

/** Zoom used when focusing a single hotspot. */
export const FOCUS_ZOOM = 13;
