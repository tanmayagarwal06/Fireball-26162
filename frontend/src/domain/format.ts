/**
 * Formatting helpers for technical values.
 *
 * Everything produced here is intended to be rendered in JetBrains Mono, per the
 * design system: coordinates, timestamps, FRP, brightness temperature, IDs and
 * any other numeric telemetry.
 *
 * All functions accept null/undefined and return an em dash placeholder, so a
 * missing field renders as a visible gap rather than "null" or "NaN".
 */

/** Rendered whenever a value is genuinely absent from the dataset. */
export const NO_VALUE = '—';

function hasValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Signed decimal degrees to hemisphere notation, e.g. 28.6139 -> "28.6139° N". */
export function formatLatitude(lat: number | null | undefined, decimals = 4): string {
  if (!hasValue(lat)) return NO_VALUE;
  return `${Math.abs(lat).toFixed(decimals)}° ${lat >= 0 ? 'N' : 'S'}`;
}

export function formatLongitude(lon: number | null | undefined, decimals = 4): string {
  if (!hasValue(lon)) return NO_VALUE;
  return `${Math.abs(lon).toFixed(decimals)}° ${lon >= 0 ? 'E' : 'W'}`;
}

/** Full coordinate pair, matching the Stitch header format. */
export function formatCoordinates(
  lat: number | null | undefined,
  lon: number | null | undefined,
  decimals = 4,
): string {
  if (!hasValue(lat) || !hasValue(lon)) return NO_VALUE;
  return `${formatLatitude(lat, decimals)}, ${formatLongitude(lon, decimals)}`;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * "2026-08-27" -> "27 AUG 2026".
 *
 * Parsed by hand rather than via Date to avoid the timezone shift that
 * `new Date("2026-08-27")` introduces (it is treated as UTC midnight, which can
 * render as the previous day in negative offsets). Acquisition dates are plain
 * calendar dates and must not move.
 */
export function formatAcqDate(acqDate: string | null | undefined): string {
  if (!acqDate) return NO_VALUE;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(acqDate.trim());
  if (!match) return acqDate;

  const [, year, month, day] = match;
  const monthLabel = MONTHS[Number(month) - 1] ?? month;

  return `${day} ${monthLabel} ${year}`;
}

/** "2026-08-27" + "12:30" -> "27 AUG 2026 · 12:30". */
export function formatAcquisition(
  acqDate: string | null | undefined,
  acqTime: string | null | undefined,
): string {
  const date = formatAcqDate(acqDate);
  if (date === NO_VALUE) return NO_VALUE;
  return acqTime ? `${date} · ${acqTime}` : date;
}

/** Fire Radiative Power, e.g. "182.4 MW". */
export function formatFrp(frp: number | null | undefined): string {
  return hasValue(frp) ? `${frp.toFixed(1)} MW` : NO_VALUE;
}

/** Brightness temperature, e.g. "1240.5 K". */
export function formatKelvin(kelvin: number | null | undefined): string {
  return hasValue(kelvin) ? `${kelvin.toFixed(1)} K` : NO_VALUE;
}

/** Distance in kilometres, e.g. "0.42 km". */
export function formatKm(km: number | null | undefined): string {
  return hasValue(km) ? `${km.toFixed(2)} km` : NO_VALUE;
}

/**
 * Percentage from a value already on a 0-100 scale
 * (`Hotspot.confidence`, or the pre-scaled fields on /alerts and /explanation).
 */
export function formatPercent(value: number | null | undefined, decimals = 0): string {
  return hasValue(value) ? `${value.toFixed(decimals)}%` : NO_VALUE;
}

/**
 * Percentage from a 0-1 ratio (`Hotspot.classification_confidence`).
 *
 * Tolerates a value that is already 0-100, because `/alerts` and
 * `/hotspots/{id}/explanation` return the same underlying field pre-scaled by
 * the backend's `confidence_as_percent()` helper.
 */
export function formatRatioAsPercent(ratio: number | null | undefined, decimals = 0): string {
  if (!hasValue(ratio)) return NO_VALUE;
  const percent = ratio <= 1 ? ratio * 100 : ratio;
  return `${percent.toFixed(decimals)}%`;
}

/** Normalise a confidence field to 0-100 regardless of which scale it arrived on. */
export function toPercentScale(value: number | null | undefined): number | null {
  if (!hasValue(value)) return null;
  return value <= 1 ? value * 100 : value;
}

/** Thousands separators for counts. */
export function formatCount(value: number | null | undefined): string {
  return hasValue(value) ? value.toLocaleString('en-IN') : NO_VALUE;
}

/** Persistence in days, e.g. "7 days" / "1 day". */
export function formatDays(days: number | null | undefined): string {
  if (!hasValue(days)) return NO_VALUE;
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** "D" -> "Day", "N" -> "Night". */
export function formatDayNight(dayNight: string | null | undefined): string {
  if (dayNight === 'D') return 'Day';
  if (dayNight === 'N') return 'Night';
  return NO_VALUE;
}

/** Fall back to the placeholder for empty or missing text. */
export function formatText(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : NO_VALUE;
}