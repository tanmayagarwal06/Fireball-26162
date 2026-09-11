/**
 * Density heat layer.
 *
 * A canvas overlay (leaflet.heat) that renders the filtered detections as a
 * continuous intensity surface. It answers a different question from the
 * markers — "where is thermal activity concentrated?" rather than "which
 * detection is this?" — so the two are offered as alternative or stacked views.
 *
 * Intensity is weighted per detection (see `HEAT_WEIGHTS`); the default weights
 * by fire radiative power on a log scale so one 30 MW industrial release does
 * not vanish next to a hundred 2 MW crop fires, and vice versa. The gradient is
 * the console's ember ramp: deep red through orange to a near-white core.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as L from 'leaflet';
import 'leaflet.heat';
import { useMap } from 'react-leaflet';
import type { Hotspot } from '../../types/hotspot';

export type HeatWeightMode = 'frp' | 'risk' | 'uniform';

export const HEAT_WEIGHTS: Record<HeatWeightMode, { label: string; description: string }> = {
  frp: {
    label: 'Fire radiative power',
    description: 'log-scaled FRP; saturates at 30 MW, the 99th percentile of the export',
  },
  risk: { label: 'Risk score', description: 'risk_score / 100' },
  uniform: { label: 'Detection count', description: 'every detection counts equally' },
};

/** Ember ramp keyed by normalised intensity. Colours are token values from DESIGN.md. */
const EMBER_GRADIENT: Record<number, string> = {
  0.0: 'rgba(124, 45, 18, 0)',
  0.25: '#7c2d12',
  0.5: '#ea580c',
  0.72: '#ff9f3f',
  0.9: '#ffd257',
  1.0: '#fff7ed',
};

const FRP_SATURATION_MW = 30;
const MIN_WEIGHT = 0.12;

function weightOf(hotspot: Hotspot, mode: HeatWeightMode): number {
  if (mode === 'uniform') return 0.6;
  if (mode === 'risk') {
    const risk = Number.isFinite(hotspot.risk_score) ? hotspot.risk_score / 100 : 0.3;
    return Math.max(MIN_WEIGHT, Math.min(1, risk));
  }
  const frp = typeof hotspot.frp === 'number' && hotspot.frp > 0 ? hotspot.frp : 1;
  const scaled = Math.log1p(frp) / Math.log1p(FRP_SATURATION_MW);
  return Math.max(MIN_WEIGHT, Math.min(1, scaled));
}

export interface HeatLayerProps {
  hotspots: Hotspot[];
  weightMode: HeatWeightMode;
  /** Blend softer when markers are stacked on top so the points stay readable. */
  subdued?: boolean;
}

export function HeatLayer({ hotspots, weightMode, subdued = false }: HeatLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.HeatLayer | null>(null);

  const points = useMemo<L.HeatLatLngTuple[]>(
    () => hotspots.map((hotspot) => [hotspot.lat, hotspot.lon, weightOf(hotspot, weightMode)]),
    [hotspots, weightMode],
  );

  const options = useMemo<L.HeatMapOptions>(
    () => ({
      radius: 22,
      blur: 18,
      maxZoom: 11,
      max: 1.0,
      minOpacity: subdued ? 0.18 : 0.28,
      gradient: EMBER_GRADIENT,
    }),
    [subdued],
  );

  useEffect(() => {
    const layer = L.heatLayer(points, options);
    // leaflet.heat schedules its redraw with requestAnimationFrame and does not
    // cancel it on removal, so a frame can fire after the layer has left the map
    // and dereference a null map. Guard the redraw instead of patching the plugin.
    const internals = layer as unknown as { _redraw: () => void; _map: L.Map | null };
    const redraw = internals._redraw;
    internals._redraw = function guardedRedraw(this: typeof internals) {
      if (!this._map) return;
      redraw.call(this);
    };
    layer.addTo(map);
    layerRef.current = layer;
    return () => {
      layer.remove();
      layerRef.current = null;
    };
    // Options changes rebuild the layer; point changes are applied in place below.
  }, [map, options]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    layerRef.current?.setLatLngs(points);
  }, [points]);

  return null;
}
