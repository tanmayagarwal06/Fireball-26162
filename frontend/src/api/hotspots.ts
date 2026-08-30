/**
 * Hotspot endpoints.
 *
 * Each function maps to exactly one route in backend/app.py. There are no
 * placeholder or invented endpoints here.
 */
import { apiRequest } from './client';
import type { Hotspot, HotspotListResponse, HotspotQuery } from '../types/hotspot';
import type { ExplanationResponse } from '../types/api';

/**
 * `GET /hotspots`
 *
 * Server-side filtering for every parameter the backend actually supports.
 * Note that `min_persistence` is currently a no-op server-side — see the defect
 * note on `HotspotQuery.min_persistence`. Callers should filter persistence via
 * `filterByPersistence()` in src/domain/persistence.ts instead.
 */
export function listHotspots(
  query: HotspotQuery = {},
  signal?: AbortSignal,
): Promise<HotspotListResponse> {
  return apiRequest<HotspotListResponse>('/hotspots', { query, signal });
}

/**
 * `GET /hotspots/{id}` — the full record. Throws an ApiError with status 404
 * when the id is unknown.
 */
export function getHotspot(id: string, signal?: AbortSignal): Promise<Hotspot> {
  return apiRequest<Hotspot>(`/hotspots/${encodeURIComponent(id)}`, { signal });
}

/**
 * `GET /hotspots/{id}/explanation`
 *
 * Returns a deterministic evidence summary built from structured fields. This is
 * NOT model output — the classification engine does not exist yet. Anything
 * rendered from this response must be presented as rule-derived evidence.
 */
export function getHotspotExplanation(
  id: string,
  signal?: AbortSignal,
): Promise<ExplanationResponse> {
  return apiRequest<ExplanationResponse>(`/hotspots/${encodeURIComponent(id)}/explanation`, {
    signal,
  });
}
