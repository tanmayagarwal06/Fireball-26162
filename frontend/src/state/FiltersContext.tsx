/**
 * Filter state, shared across the dashboard, analytics and alerts.
 *
 * Held above the router so a filter set survives navigation between screens —
 * part of making the five views feel like one console rather than five pages.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_FILTERS,
  countActiveFilters,
  isDefaultFilters,
  toHotspotQuery,
  type FilterState,
} from '../domain/filters';
import { CLASSIFICATION_KEYS, type ClassificationKey } from '../domain/classification';
import type { HotspotQuery } from '../types/hotspot';

export interface FiltersContextValue {
  filters: FilterState;
  /** Update one field. Pass null to clear it. */
  setFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  /** Add or remove a class from the selection. */
  toggleClassification: (key: ClassificationKey) => void;
  /** Select every class, i.e. clear the class filter. */
  selectAllClassifications: () => void;
  /** Select exactly one class — used when clicking a legend or chart row. */
  selectOnlyClassification: (key: ClassificationKey) => void;
  reset: () => void;
  /** Server-side parameters for GET /hotspots. */
  query: HotspotQuery;
  activeCount: number;
  isDefault: boolean;
}

const FiltersContext = createContext<FiltersContextValue | null>(null);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const setFilter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      setFilters((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const toggleClassification = useCallback((key: ClassificationKey) => {
    setFilters((current) => {
      // An empty selection means "all", so the first click has to start from the
      // full set and remove one — otherwise unchecking a box would widen the view.
      const base =
        current.classifications.length === 0 ? [...CLASSIFICATION_KEYS] : current.classifications;

      const next = base.includes(key)
        ? base.filter((candidate) => candidate !== key)
        : [...base, key];

      // Selecting everything is equivalent to no filter at all.
      return {
        ...current,
        classifications: next.length === CLASSIFICATION_KEYS.length ? [] : next,
      };
    });
  }, []);

  const selectAllClassifications = useCallback(() => {
    setFilters((current) => ({ ...current, classifications: [] }));
  }, []);

  const selectOnlyClassification = useCallback((key: ClassificationKey) => {
    setFilters((current) => {
      const isOnlyThis =
        current.classifications.length === 1 && current.classifications[0] === key;

      // Clicking the same class twice clears the filter, which makes legend and
      // chart rows behave as a toggle.
      return { ...current, classifications: isOnlyThis ? [] : [key] };
    });
  }, []);

  const reset = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  const value = useMemo<FiltersContextValue>(
    () => ({
      filters,
      setFilter,
      toggleClassification,
      selectAllClassifications,
      selectOnlyClassification,
      reset,
      query: toHotspotQuery(filters),
      activeCount: countActiveFilters(filters),
      isDefault: isDefaultFilters(filters),
    }),
    [filters, setFilter, toggleClassification, selectAllClassifications, selectOnlyClassification, reset],
  );

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function useFilters(): FiltersContextValue {
  const context = useContext(FiltersContext);
  if (!context) throw new Error('useFilters must be used inside a FiltersProvider.');
  return context;
}

/** True when a class is currently included, treating "empty" as "all". */
export function isClassificationSelected(
  filters: FilterState,
  key: ClassificationKey,
): boolean {
  return filters.classifications.length === 0 || filters.classifications.includes(key);
}
