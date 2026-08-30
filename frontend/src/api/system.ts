/** Service health and dataset-wide statistics. */
import { apiRequest } from './client';
import type { HealthResponse, StatisticsResponse } from '../types/api';

/** `GET /health` — also reports how many records the backend loaded. */
export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiRequest<HealthResponse>('/health', { signal });
}

/**
 * `GET /statistics` — aggregates over the whole dataset.
 *
 * Accepts no query parameters, so it cannot honour the dashboard filters. Use it
 * for the unfiltered baseline only.
 */
export function getStatistics(signal?: AbortSignal): Promise<StatisticsResponse> {
  return apiRequest<StatisticsResponse>('/statistics', { signal });
}
