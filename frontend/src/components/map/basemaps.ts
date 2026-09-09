/**
 * Basemap definitions.
 *
 * Only keyless tile services are used. CARTO's basemaps were dropped because
 * the CDN now watermarks browser requests that carry no API key ("API KEY
 * REQUIRED" across every tile). Esri's World Dark Gray Canvas is the default:
 * dark and low-contrast so thermal markers stay the brightest thing on screen
 * per DESIGN.md. Esri World Imagery gives satellite context for a selected
 * detection, and standard OSM is the fallback for networks that block ArcGIS
 * Online.
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

const ESRI_DARK_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, DeLorme, NAVTEQ';

const ESRI_IMAGERY_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

export const BASEMAPS: Basemap[] = [
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
    description: 'Fallback if ArcGIS Online is unreachable',
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
