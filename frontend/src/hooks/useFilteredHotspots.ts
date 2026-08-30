/**
 * The filtered hotspot list every data screen reads from.
 *
 * Pushes what it can to `GET /hotspots`, then applies the two client-side
 * filters documented in src/domain/filters.ts. Reporting both counts separately
 * means the UI can show exactly how much narrowing the backend did versus the
 * browser, instead of presenting one opaque number.
 */
import { useEffect, useMemo, useState } from 'react';
import { listHotspots } from '../api/hotspots';
import { applyClientFilters, sortHotspots, type SortKey } from '../domain/filters';
import { useFilters } from '../state/FiltersContext';
import { useAsync } from '../hooks/useAsync';
import type { Hotspot, HotspotListResponse } from '../types/hotspot';

export interface FilteredHotspots {
  /** Result after both server-side and client-side filtering. */
  hotspots: Hotspot[];
  /** Count the backend returned, before client-side narrowing. */
  serverCount: number;
  /** Final count after client-side narrowing. */
  count: number;
  /** How many records the client removed. Zero when the backend did all the work. */
  removedByClient: number;
  isInitialLoading: boolean;
  isFetching: boolean;
  error: string | null;
  refresh: () => void;
  /** When the most recent successful response arrived. */
  lastLoadedAt: Date | null;
}

export function useFilteredHotspots(sort?: SortKey): FilteredHotspots {
  const { filters, query } = useFilters();

  const { data, error, isInitialLoading, isFetching, refresh } = useAsync<HotspotListResponse>(
    (signal) => listHotspots(query, signal),
    // Serialised by useAsync, so a new object literal each render is fine.
    { deps: [query] },
  );

  // Timestamp of the most recent successful response, so the UI can state when
  // the data was loaded rather than implying it streams continuously.
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (data) setLastLoadedAt(new Date());
  }, [data]);

  return useMemo(() => {
    const fromServer = data?.hotspots ?? [];
    const filtered = applyClientFilters(fromServer, filters);
    const ordered = sort ? sortHotspots(filtered, sort) : filtered;

    return {
      hotspots: ordered,
      serverCount: data?.count ?? 0,
      count: ordered.length,
      removedByClient: fromServer.length - filtered.length,
      isInitialLoading,
      isFetching,
      error,
      refresh,
      lastLoadedAt,
    };
  }, [data, filters, sort, isInitialLoading, isFetching, error, refresh, lastLoadedAt]);
}

/** Find one hotspot in an already-loaded list, avoiding a second request. */
export function findHotspot(hotspots: Hotspot[], id: string | null): Hotspot | null {
  if (!id) return null;
  return hotspots.find((hotspot) => hotspot.id === id) ?? null;
}
