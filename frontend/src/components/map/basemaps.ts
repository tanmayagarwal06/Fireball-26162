/**
 * Basemap definitions.
 *
 * Every option here works without an account except CARTO, whose CDN now
 * watermarks browser requests that carry no API key ("API KEY REQUIRED" on
 * every tile). CARTO's dark basemaps are therefore offered only when
 * `VITE_CARTO_API_KEY` is set (frontend/.env.local); otherwise Esri's World
 * Dark Gray Canvas is the default. Both are dark and low-contrast so thermal
 * markers stay the brightest thing on screen per DESIGN.md. Esri World Imagery
 * gives satellite context for a selected detection and standard OSM is the
 * fallback for networks that block the other CDNs.
 *
 * Attribution is mandatory for all of them and is rendered by Leaflet's own
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

const ESRI_DARK_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, DeLorme, NAVTEQ';

const ESRI_IMAGERY_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

/** Optional CARTO key; an empty or missing value disables the CARTO layers entirely. */
const CARTO_API_KEY = (import.meta.env.VITE_CARTO_API_KEY ?? '').trim();

const CARTO_BASEMAPS: Basemap[] = CARTO_API_KEY
  ? [
      {
        id: 'carto-dark',
        label: 'Dark (CARTO)',
        description: 'Dark basemap with place labels',
        url: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_API_KEY)}`,
        attribution: CARTO_ATTRIBUTION,
        subdomains: 'abcd',
        maxZoom: 20,
      },
      {
        id: 'carto-dark-nolabels',
        label: 'Dark, no labels (CARTO)',
        description: 'Minimal basemap for uncluttered data reading',
        url: `https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_API_KEY)}`,
        attribution: CARTO_ATTRIBUTION,
        subdomains: 'abcd',
        maxZoom: 20,
      },
    ]
  : [];

export const BASEMAPS: Basemap[] = [
  ...CARTO_BASEMAPS,
  {
    id: 'esri-dark',
    label: 'Dark',
    description: 'Dark grey canvas with place labels (Esri, keyless)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: ESRI_DARK_ATTRIBUTION,
    maxZoom: 16,
  },
  {
    id: 'esri-imagery',
    label: 'Satellite',
    description: 'World imagery for ground context around a detection',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: ESRI_IMAGERY_ATTRIBUTION,
    maxZoom: 19,
  },
  {
    id: 'osm',
    label: 'OSM standard',
    description: 'Fallback if the other tile CDNs are unreachable',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTRIBUTION,
    maxZoom: 19,
  },
];

export const DEFAULT_BASEMAP = BASEMAPS[0];

/**
 * Fallback view when the dataset is empty and there are no bounds to fit.
 * Centred on India as a whole, which is the pipeline's coverage area.
 */
export const FALLBACK_CENTER: [number, number] = [22.5, 79.0];
export const FALLBACK_ZOOM = 5;

/** Padding applied when fitting the map to the data, in pixels. */
export const FIT_PADDING: [number, number] = [48, 48];

/** Zoom used when focusing a single hotspot. */
export const FOCUS_ZOOM = 13;
