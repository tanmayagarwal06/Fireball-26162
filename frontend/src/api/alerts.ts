/**
 * Alert endpoint.
 *
 * `GET /alerts` derives its output from the hotspot dataset on every call. There
 * is no alert store, no acknowledgement state and no notification delivery
 * behind it, so the UI must not imply that alerts were "sent" or "received".
 */
import { apiRequest } from './client';
import type { AlertListResponse, AlertQuery } from '../types/api';

export function listAlerts(
  query: AlertQuery = {},
  signal?: AbortSignal,
): Promise<AlertListResponse> {
  return apiRequest<AlertListResponse>('/alerts', { query, signal });
}

/**
 * Status values the backend can actually emit, from `get_alert_status()`.
 *
 * Risk >= 90 -> NEEDS INVESTIGATION, >= 80 -> NEW, otherwise REVIEWED.
 * Stitch screen-4 also offered an "Investigating" option; the backend has no
 * such state, so it is deliberately absent here.
 */
export const ALERT_STATUSES = ['NEEDS INVESTIGATION', 'NEW', 'REVIEWED'] as const;

export type AlertStatus = (typeof ALERT_STATUSES)[number];
