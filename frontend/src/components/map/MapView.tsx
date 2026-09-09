/**
 * The primary map surface.
 *
 * Real Leaflet, real tiles, real pan and zoom. The map is the dominant element of
 * the dashboard per DESIGN.md, so this component owns nothing but the map and its
 * overlays — filters and detail panels live outside it.
 *
 * Marker clustering is deliberately absent. The dataset is 11 records; a cluster
 * plugin would add a dependency and hide individual points for no benefit. If the
 * backend later serves thousands of hotspots, add clustering here and nowhere else.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LatLngBounds, type Map as LeafletMap } from 'leaflet';
import { MapContainer, Marker, ScaleControl, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import {
  BASEMAPS,
  DEFAULT_BASEMAP,
  FALLBACK_CENTER,
  FALLBACK_ZOOM,
  FIT_PADDING,
  FOCUS_ZOOM,
  type Basemap,
} from './basemaps';
import { createHotspotIcon } from './markerIcon';
import { MapLegend } from './MapLegend';
import { getClassification } from '../../domain/classification';
import { resolveRiskLevel } from '../../domain/risk';
import { resolvePersistenceDays } from '../../domain/persistence';
import { formatCoordinates, formatDays, formatFrp } from '../../domain/format';
import { Icon } from '../ui/Icon';
import type { Hotspot } from '../../types/hotspot';

/** What drives marker colour. Both are legitimate operator views. */
export type MarkerColorMode = 'classification' | 'risk';

export interface MapViewProps {
  hotspots: Hotspot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Hide the legend when the surrounding screen already shows one. */
  showLegend?: boolean;
  /** Extra overlays drawn inside the map pane, e.g. a proximity buffer. */
  children?: React.ReactNode;
  /** Focus a single hotspot on mount rather than fitting all of them. */
  focusId?: string | null;
  /** Disable interaction for small inset maps. */
  interactive?: boolean;
  /**
   * Re-fetch the hotspot data. Omit to hide the control entirely rather than
   * showing a button that does nothing.
   */
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** Time of the last successful load, shown beside the refresh control. */
  lastLoadedAt?: Date | null;
  className?: string;
}

export function MapView({
  hotspots,
  selectedId,
  onSelect,
  showLegend = true,
  children,
  focusId = null,
  interactive = true,
  onRefresh,
  isRefreshing = false,
  lastLoadedAt = null,
  className,
}: MapViewProps) {
  const [basemap, setBasemap] = useState<Basemap>(DEFAULT_BASEMAP);
  const [colorMode, setColorMode] = useState<MarkerColorMode>('classification');
  const [layerPickerOpen, setLayerPickerOpen] = useState(false);
  const mapRef = useRef<LeafletMap | null>(null);

  const bounds = useMemo(() => computeBounds(hotspots), [hotspots]);

  const fitToData = useCallback(() => {
    const map = mapRef.current;
    if (!map || !bounds) return;

    // A single point has zero-area bounds, which fitBounds cannot resolve.
    if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
      map.setView(bounds.getCenter(), FOCUS_ZOOM);
      return;
    }

    map.fitBounds(bounds, { padding: FIT_PADDING });
  }, [bounds]);

  return (
    <div className={`relative min-h-0 min-w-0 flex-1${className ? ` ${className}` : ''}`}>
      <MapContainer
        attributionControl
        boxZoom={interactive}
        center={FALLBACK_CENTER}
        className="absolute inset-0 size-full"
        doubleClickZoom={interactive}
        dragging={interactive}
        keyboard={interactive}
        ref={mapRef}
        scrollWheelZoom={interactive}
        zoom={FALLBACK_ZOOM}
        zoomControl={false}
      >
        <TileLayer
          attribution={basemap.attribution}
          key={basemap.id}
          maxZoom={basemap.maxZoom}
          url={basemap.url}
          {...(basemap.subdomains ? { subdomains: basemap.subdomains } : {})}
        />

        {interactive ? <ScaleControl imperial={false} position="bottomleft" /> : null}

        <ViewController bounds={bounds} focusId={focusId} hotspots={hotspots} />

        {hotspots.map((hotspot) => (
          <HotspotMarker
            colorMode={colorMode}
            hotspot={hotspot}
            key={hotspot.id}
            onSelect={onSelect}
            selected={hotspot.id === selectedId}
          />
        ))}

        {children}
      </MapContainer>

      {interactive ? (
        <>
          <MapToolbar
            colorMode={colorMode}
            isRefreshing={isRefreshing}
            lastLoadedAt={lastLoadedAt}
            layerPickerOpen={layerPickerOpen}
            onFit={fitToData}
            onRefresh={onRefresh}
            onSetBasemap={setBasemap}
            onSetColorMode={setColorMode}
            onToggleLayerPicker={() => setLayerPickerOpen((open) => !open)}
            activeBasemapId={basemap.id}
            canFit={bounds !== null}
            mapRef={mapRef}
          />

          {showLegend ? <MapLegend colorMode={colorMode} /> : null}
        </>
      ) : null}

      {hotspots.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
          <p className="border border-outline-variant bg-surface-lowest/90 px-3 py-2 text-label uppercase text-on-surface-variant">
            No hotspots match the current filters
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Bounding box of the supplied hotspots, or null when there are none. */
function computeBounds(hotspots: Hotspot[]): LatLngBounds | null {
  if (hotspots.length === 0) return null;

  const bounds = new LatLngBounds([]);
  for (const hotspot of hotspots) {
    bounds.extend([hotspot.lat, hotspot.lon]);
  }

  return bounds.isValid() ? bounds : null;
}

/**
 * Drives the viewport imperatively.
 *
 * Fits the data once on first load, then leaves the operator's pan and zoom
 * alone — a map that re-centres itself every time a filter changes is hostile.
 * The exception is `focusId`, used by the investigation screen to open on a
 * specific hotspot.
 */
function ViewController({
  bounds,
  focusId,
  hotspots,
}: {
  bounds: LatLngBounds | null;
  focusId: string | null;
  hotspots: Hotspot[];
}) {
  const map = useMap();
  const hasFitted = useRef(false);

  useEffect(() => {
    if (focusId) {
      const target = hotspots.find((hotspot) => hotspot.id === focusId);
      if (target) {
        map.setView([target.lat, target.lon], FOCUS_ZOOM);
        hasFitted.current = true;
      }
      return;
    }

    if (hasFitted.current || !bounds) return;

    if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
      map.setView(bounds.getCenter(), FOCUS_ZOOM);
    } else {
      map.fitBounds(bounds, { padding: FIT_PADDING });
    }

    hasFitted.current = true;
  }, [bounds, focusId, hotspots, map]);

  // Leaflet mis-sizes itself when its container starts hidden or resizes, which
  // happens whenever a side panel collapses.
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  return null;
}

function HotspotMarker({
  hotspot,
  selected,
  colorMode,
  onSelect,
}: {
  hotspot: Hotspot;
  selected: boolean;
  colorMode: MarkerColorMode;
  onSelect: (id: string) => void;
}) {
  const classification = getClassification(hotspot.classification);
  const risk = resolveRiskLevel(hotspot.risk_score);

  const color =
    colorMode === 'risk' ? `var(${risk.colorVar})` : `var(${classification.colorVar})`;

  const icon = useMemo(() => createHotspotIcon({ color, selected }), [color, selected]);

  const persistence = resolvePersistenceDays(hotspot);

  return (
    <Marker
      alt={`Hotspot ${hotspot.id}, ${classification.label}, risk ${hotspot.risk_score}`}
      eventHandlers={{ click: () => onSelect(hotspot.id) }}
      icon={icon}
      keyboard
      position={[hotspot.lat, hotspot.lon]}
      // Selected marker sits above the rest so its brackets are never clipped.
      zIndexOffset={selected ? 1000 : 0}
    >
      <Tooltip direction="top" offset={[0, -8]}>
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-data text-on-surface">{hotspot.id}</span>
          <span style={{ color: `var(${classification.colorVar})` }} className="text-label uppercase">
            {classification.label}
          </span>
          <span className="font-mono text-body-sm text-on-surface-variant">
            Risk {hotspot.risk_score} · {formatFrp(hotspot.frp)}
          </span>
          <span className="font-mono text-body-sm text-on-surface-variant">
            {formatCoordinates(hotspot.lat, hotspot.lon, 3)}
          </span>
          {persistence !== null ? (
            <span className="font-mono text-body-sm text-on-surface-variant">
              Detected {formatDays(persistence)}
            </span>
          ) : null}
        </span>
      </Tooltip>
    </Marker>
  );
}

function MapToolbar({
  onFit,
  canFit,
  colorMode,
  onSetColorMode,
  activeBasemapId,
  onSetBasemap,
  layerPickerOpen,
  onToggleLayerPicker,
  mapRef,
  onRefresh,
  isRefreshing,
  lastLoadedAt,
}: {
  onFit: () => void;
  canFit: boolean;
  colorMode: MarkerColorMode;
  onSetColorMode: (mode: MarkerColorMode) => void;
  activeBasemapId: string;
  onSetBasemap: (basemap: Basemap) => void;
  layerPickerOpen: boolean;
  onToggleLayerPicker: () => void;
  mapRef: React.RefObject<LeafletMap | null>;
  onRefresh?: () => void;
  isRefreshing: boolean;
  lastLoadedAt: Date | null;
}) {
  const buttonClass =
    'flex size-8 items-center justify-center text-on-surface transition-colors hover:bg-surface-high disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <div className="absolute right-3 top-3 z-[500] flex flex-col items-end gap-2">
      <div className="flex flex-col border border-outline-variant bg-surface-lowest/95 divide-y divide-outline-variant">
        <button
          aria-label="Zoom in"
          className={buttonClass}
          onClick={() => mapRef.current?.zoomIn()}
          type="button"
        >
          <Icon name="add" size={18} />
        </button>
        <button
          aria-label="Zoom out"
          className={buttonClass}
          onClick={() => mapRef.current?.zoomOut()}
          type="button"
        >
          <Icon name="remove" size={18} />
        </button>
        <button
          aria-label="Fit map to all visible hotspots"
          className={buttonClass}
          disabled={!canFit}
          onClick={onFit}
          title="Fit to data"
          type="button"
        >
          <Icon name="crop_free" size={18} />
        </button>

        {/* Only rendered when a real handler is supplied. */}
        {onRefresh ? (
          <button
            aria-label="Reload hotspot data from the backend"
            className={buttonClass}
            disabled={isRefreshing}
            onClick={onRefresh}
            title={
              lastLoadedAt
                ? `Reload hotspots — last loaded ${lastLoadedAt.toLocaleTimeString('en-GB', { hour12: false })}`
                : 'Reload hotspots from the backend'
            }
            type="button"
          >
            <Icon className={isRefreshing ? 'animate-spin' : undefined} name="refresh" size={18} />
          </button>
        ) : null}

        <button
          aria-expanded={layerPickerOpen}
          aria-label="Map layers and marker colouring"
          className={`${buttonClass}${layerPickerOpen ? ' bg-surface-high text-primary' : ''}`}
          onClick={onToggleLayerPicker}
          type="button"
        >
          <Icon name="layers" size={18} />
        </button>
      </div>

      {/*
        Load timestamp. States plainly that data is fetched on demand — there is
        no streaming feed behind this, so no "live" indicator is shown.
      */}
      {onRefresh ? (
        <div
          className="border border-outline-variant bg-surface-lowest/95 px-2 py-0.5"
          title="Hotspot data is fetched on request from a file-backed pipeline export (data/hotspots.json). No live ingestion."
        >
          <span className="font-mono text-[10px] text-outline">
            {isRefreshing
              ? 'Loading…'
              : lastLoadedAt
                ? `Loaded ${lastLoadedAt.toLocaleTimeString('en-GB', { hour12: false })}`
                : 'Not loaded'}
          </span>
        </div>
      ) : null}

      {layerPickerOpen ? (
        <div className="w-56 border border-outline-variant bg-surface-lowest/95 p-compact">
          <fieldset className="mb-3">
            <legend className="mb-1.5 text-label uppercase text-on-surface-variant">Basemap</legend>
            <div className="flex flex-col gap-1">
              {BASEMAPS.map((option) => (
                <label
                  className="flex cursor-pointer items-center gap-2 text-body-sm text-on-surface"
                  key={option.id}
                  title={option.description}
                >
                  <input
                    checked={activeBasemapId === option.id}
                    className="size-3 accent-[var(--color-primary)]"
                    name="basemap"
                    onChange={() => onSetBasemap(option)}
                    type="radio"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-label uppercase text-on-surface-variant">
              Colour markers by
            </legend>
            <div className="flex flex-col gap-1">
              <label className="flex cursor-pointer items-center gap-2 text-body-sm text-on-surface">
                <input
                  checked={colorMode === 'classification'}
                  className="size-3 accent-[var(--color-primary)]"
                  name="colorMode"
                  onChange={() => onSetColorMode('classification')}
                  type="radio"
                />
                Classification
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-body-sm text-on-surface">
                <input
                  checked={colorMode === 'risk'}
                  className="size-3 accent-[var(--color-primary)]"
                  name="colorMode"
                  onChange={() => onSetColorMode('risk')}
                  type="radio"
                />
                Risk level
              </label>
            </div>
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
