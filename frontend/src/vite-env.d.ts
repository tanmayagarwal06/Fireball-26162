/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the FastAPI backend. Defaults to http://127.0.0.1:8000. */
  readonly VITE_API_BASE_URL?: string;
  /** Optional CARTO basemap key. Unset = the keyless Esri / OSM basemaps only. */
  readonly VITE_CARTO_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
