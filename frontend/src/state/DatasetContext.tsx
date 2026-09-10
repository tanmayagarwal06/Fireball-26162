/**
 * The unfiltered dataset.
 *
 * Fetched once so filter dropdowns can offer only values that genuinely occur in
 * the data — a satellite option that matches nothing would be worse than no
 * option at all, given the backend's exact-match semantics.
 *
 * It also exposes the acquisition-date span, which is what lets the analytics
 * screen state honestly that no time series exists rather than drawing one.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { listHotspots } from '../api/hotspots';
import { useAsync } from '../hooks/useAsync';
import { parseClassification, type ClassificationKey } from '../domain/classification';
import type { Hotspot, HotspotListResponse } from '../types/hotspot';

export interface DatasetContextValue {
  /** Every record the backend holds, unfiltered. */
  all: Hotspot[];
  /** Distinct full sensor identifiers, sorted. */
  satellites: string[];
  /** Distinct land-cover classes, sorted. */
  landCovers: string[];
  /** Distinct nearest-facility types, sorted, nulls excluded. */
  facilityTypes: string[];
  /** Classes that actually occur in the data. */
  presentClassifications: ClassificationKey[];
  /** Distinct acq_date values, ascending. */
  dates: string[];
  earliestDate: string | null;
  latestDate: string | null;
  /**
   * True when the whole dataset shares one acquisition date, which is the case
   * today. Time-based views must check this and degrade.
   */
  isSingleDate: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

const DatasetContext = createContext<DatasetContextValue | null>(null);

function distinct(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const value of values) {
    const trimmed = String(value ?? '').trim();
    if (trimmed) set.add(trimmed);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function DatasetProvider({ children }: { children: ReactNode }) {
  const { data, error, isInitialLoading, refresh } = useAsync<HotspotListResponse>((signal) =>
    listHotspots({}, signal),
  );

  const value = useMemo<DatasetContextValue>(() => {
    const all = data?.hotspots ?? [];

    const dates = distinct(all.map((hotspot) => hotspot.acq_date));

    const presentClassifications = [
      ...new Set(all.map((hotspot) => parseClassification(hotspot.classification))),
    ];

    return {
      all,
      satellites: distinct(all.map((hotspot) => hotspot.satellite)),
      landCovers: distinct(all.map((hotspot) => hotspot.land_cover_class)),
      facilityTypes: distinct(all.map((hotspot) => hotspot.nearest_facility_type)),
      presentClassifications,
      dates,
      earliestDate: dates[0] ?? null,
      latestDate: dates[dates.length - 1] ?? null,
      isSingleDate: dates.length <= 1,
      isLoading: isInitialLoading,
      error,
      refresh,
    };
  }, [data, error, isInitialLoading, refresh]);

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}

export function useDataset(): DatasetContextValue {
  const context = useContext(DatasetContext);
  if (!context) throw new Error('useDataset must be used inside a DatasetProvider.');
  return context;
}
