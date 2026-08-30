/**
 * Hotspot marker icons.
 *
 * DESIGN.md specifies 8px squares colour-coded by classification, with a
 * crosshair bracket appearing around the active marker. Built as a Leaflet
 * divIcon so the shape stays square and CSS-driven rather than a raster sprite.
 *
 * The markup is assembled from a fixed template and a colour drawn from our own
 * token table — no hotspot field is ever interpolated into HTML.
 */
import { DivIcon } from 'leaflet';

/** Base marker edge length in px. */
const MARKER_SIZE = 10;
/** Outer box that carries the selection brackets. */
const SELECTED_BOX = 24;

export interface HotspotIconOptions {
  /** CSS colour, normally a var() from the classification or risk scale. */
  color: string;
  selected: boolean;
  /** Renders a hollow square, used for records the operator has already reviewed. */
  hollow?: boolean;
}

export function createHotspotIcon({ color, selected, hollow = false }: HotspotIconOptions): DivIcon {
  const fill = hollow ? 'transparent' : color;

  const dot =
    `<span class="ti-marker" style="background:${fill};box-shadow:0 0 0 1px ${color}"></span>`;

  if (!selected) {
    return new DivIcon({
      html: dot,
      className: 'ti-marker-icon',
      iconSize: [MARKER_SIZE, MARKER_SIZE],
      iconAnchor: [MARKER_SIZE / 2, MARKER_SIZE / 2],
    });
  }

  // Four corner brackets read as a crosshair without obscuring the point.
  const brackets = ['tl', 'tr', 'bl', 'br']
    .map((corner) => `<span class="ti-bracket ti-bracket--${corner}"></span>`)
    .join('');

  return new DivIcon({
    html: `<span class="ti-marker-selected">${brackets}${dot}</span>`,
    className: 'ti-marker-icon ti-marker-icon--selected',
    iconSize: [SELECTED_BOX, SELECTED_BOX],
    iconAnchor: [SELECTED_BOX / 2, SELECTED_BOX / 2],
  });
}
