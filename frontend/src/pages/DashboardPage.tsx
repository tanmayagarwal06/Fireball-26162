/**
 * Screen 1 — Main Operations Dashboard.
 *
 * Layout follows the Stitch design's Fixed-Component Fluid-Map model: a filter
 * rail on the left, a dominant map in the centre, an investigation rail on the
 * right, a KPI ribbon above and a collapsible distribution strip below.
 *
 * Both rails collapse to icon buttons so the map keeps its dominance on a 1366px
 * laptop screen, which is the smallest target resolution.
 */
import { useCallback, useMemo, useState } from 'react';
import { MapView } from '../components/map/MapView';
import { FilterPanel } from '../components/filters/FilterPanel';
import { KpiRibbon } from '../components/hotspot/KpiRibbon';
import { HotspotList } from '../components/hotspot/HotspotList';
import { HotspotSummaryPanel } from '../components/hotspot/HotspotSummaryPanel';
import { BarChart } from '../components/charts/BarRow';
import { Icon } from '../components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import {
  classificationCounts,
  detectionsByHour,
  riskCounts,
  summarise,
} from '../domain/aggregate';
import { CLASSIFICATION_LIST } from '../domain/classification';
import { RISK_LEVEL_LIST } from '../domain/risk';
import { sortHotspots } from '../domain/filters';
import { useFilteredHotspots, findHotspot } from '../hooks/useFilteredHotspots';
import { useDataset } from '../state/DatasetContext';
import { useFilters } from '../state/FiltersContext';
import { useSelection } from '../state/SelectionContext';

export function DashboardPage() {
  const { hotspots, count, error, isInitialLoading, isFetching, refresh, lastLoadedAt } =
    useFilteredHotspots('risk-desc');
  const { selectedId, select } = useSelection();
  const { isDefault, selectOnlyClassification, setFilter, filters, reset } = useFilters();
  const dataset = useDataset();

  const [filtersOpen, setFiltersOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(true);
  const [stripOpen, setStripOpen] = useState(true);
  /** Which drawer is open below the lg breakpoint, where the right rail is hidden. */
  const [mobilePane, setMobilePane] = useState<'selected' | 'feed' | null>(null);

  const summary = useMemo(() => summarise(hotspots), [hotspots]);
  const selected = useMemo(() => findHotspot(hotspots, selectedId), [hotspots, selectedId]);

  const classCounts = useMemo(() => classificationCounts(hotspots), [hotspots]);
  const riskBands = useMemo(() => riskCounts(hotspots), [hotspots]);
  const hourly = useMemo(() => detectionsByHour(hotspots), [hotspots]);

  // Newest first for the activity feed, independent of the map's risk ordering.
  const feed = useMemo(() => sortHotspots(hotspots, 'recent-desc'), [hotspots]);

  /**
   * Reload both requests behind this screen: the filtered list that feeds the map
   * and the unfiltered dataset that supplies the filter option domains.
   */
  const handleRefresh = useCallback(() => {
    refresh();
    dataset.refresh();
  }, [refresh, dataset]);

  if (isInitialLoading) {
    return <LoadingState label="Loading hotspots" />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={refresh} title="Could not load hotspots" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <KpiRibbon
        isFiltered={!isDefault}
        summary={summary}
        totalInDataset={dataset.all.length}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ---------------------------------------------------- Filter rail */}
        <aside
          className={`flex shrink-0 flex-col border-r border-outline-variant bg-surface transition-[width] ${
            filtersOpen ? 'w-[268px]' : 'w-9'
          }`}
        >
          {filtersOpen ? (
            <>
              <div className="min-h-0 flex-1 overflow-hidden">
                <FilterPanel
                  isFetching={isFetching}
                  resultCount={count}
                  totalCount={dataset.all.length}
                />
              </div>
              <CollapseButton
                direction="left"
                label="Collapse filters"
                onClick={() => setFiltersOpen(false)}
              />
            </>
          ) : (
            <ExpandRail
              icon="filter_list"
              label="Show filters"
              onClick={() => setFiltersOpen(true)}
            />
          )}
        </aside>

        {/* ------------------------------------------------------- Map + strip */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MapView
            hotspots={hotspots}
            isRefreshing={isFetching}
            lastLoadedAt={lastLoadedAt}
            onRefresh={handleRefresh}
            onSelect={select}
            selectedId={selectedId}
          />

          {/* Distribution strip. Real counts only; no invented time series. */}
          <div className="shrink-0 border-t border-outline-variant bg-surface">
            <button
              aria-expanded={stripOpen}
              className="flex w-full items-center gap-1.5 px-gutter py-1 text-label uppercase text-on-surface-variant transition-colors hover:bg-surface-high"
              onClick={() => setStripOpen((open) => !open)}
              type="button"
            >
              <Icon name={stripOpen ? 'expand_more' : 'expand_less'} size={14} />
              Distributions
              <span className="ml-auto font-mono text-[10px] normal-case text-outline">
                {count} records in view
              </span>
            </button>

            {stripOpen ? (
              <div className="grid grid-cols-1 gap-gutter border-t border-outline-variant p-gutter md:grid-cols-3">
                <StripPanel title="Classification">
                  <BarChart
                    data={CLASSIFICATION_LIST.map((definition) => ({
                      key: definition.key,
                      label: definition.shortLabel,
                      value: classCounts[definition.key],
                      color: `var(${definition.colorVar})`,
                      active:
                        filters.classifications.length === 1 &&
                        filters.classifications[0] === definition.key,
                      onClick: () => selectOnlyClassification(definition.key),
                      title: `${definition.label} — click to isolate`,
                    }))}
                    labelWidth="5.5rem"
                  />
                </StripPanel>

                <StripPanel title="Risk band (derived)">
                  <BarChart
                    data={RISK_LEVEL_LIST.map((level) => ({
                      key: level.key,
                      label: level.label,
                      value: riskBands[level.key],
                      color: `var(${level.colorVar})`,
                      active: filters.minRisk === level.minScore && level.minScore > 0,
                      onClick:
                        level.minScore > 0
                          ? () =>
                              setFilter(
                                'minRisk',
                                filters.minRisk === level.minScore ? null : level.minScore,
                              )
                          : undefined,
                      title: level.description,
                    }))}
                    labelWidth="5.5rem"
                  />
                </StripPanel>

                <StripPanel
                  note={
                    dataset.isSingleDate
                      ? 'Distribution across one acquisition date. A multi-day trend needs more than one date in the dataset.'
                      : undefined
                  }
                  title="Acquisition hour"
                >
                  <HourHistogram hours={hourly} />
                </StripPanel>
              </div>
            ) : null}
          </div>
        </div>

        {/* ------------------------------------------- Investigation rail */}
        <aside
          className={`hidden shrink-0 flex-col border-l border-outline-variant bg-surface transition-[width] lg:flex ${
            detailOpen ? 'w-[300px]' : 'w-9'
          }`}
        >
          {detailOpen ? (
            <>
              <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-outline-variant bg-surface-low px-compact">
                <h2 className="flex items-center gap-1.5 truncate text-label uppercase text-on-surface-variant">
                  <Icon name="travel_explore" size={14} />
                  {selected ? `Selected · ${selected.id}` : 'Selection'}
                </h2>
                <button
                  aria-label="Collapse detail panel"
                  className="text-on-surface-variant transition-colors hover:text-on-surface"
                  onClick={() => setDetailOpen(false)}
                  type="button"
                >
                  <Icon name="chevron_right" size={16} />
                </button>
              </header>

              {/* Upper half: selected record. Lower half: activity feed. */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {selected ? (
                  <HotspotSummaryPanel hotspot={selected} />
                ) : (
                  <div className="p-gutter">
                    <EmptyState
                      description="Click a marker on the map or a row in the feed below to inspect a detection."
                      icon="ads_click"
                      title="No hotspot selected"
                    />
                  </div>
                )}
              </div>

              <div className="flex max-h-[42%] min-h-0 shrink-0 flex-col border-t border-outline-variant">
                <h3 className="flex shrink-0 items-center gap-1.5 border-b border-outline-variant bg-surface-low px-compact py-1 text-label uppercase text-on-surface-variant">
                  <Icon name="list" size={12} />
                  Activity feed
                  <span className="ml-auto font-mono text-[10px] normal-case text-outline">
                    {feed.length}
                  </span>
                </h3>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {feed.length === 0 ? (
                    <p className="p-gutter text-body-sm text-on-surface-variant">
                      No detections match the current filters.
                    </p>
                  ) : (
                    <HotspotList
                      hotspots={feed}
                      onSelect={select}
                      selectedId={selectedId}
                    />
                  )}
                </div>
              </div>
            </>
          ) : (
            <ExpandRail
              icon="travel_explore"
              label="Show selection panel"
              onClick={() => setDetailOpen(true)}
            />
          )}
        </aside>
      </div>

      {/*
        Narrow-width equivalent of the right rail. Below lg the rail is hidden, so
        without this the selected hotspot and the feed would be unreachable on a
        tablet or small laptop.
      */}
      <div className="shrink-0 border-t border-outline-variant bg-surface lg:hidden">
        <div className="flex divide-x divide-outline-variant">
          <button
            aria-expanded={mobilePane === 'selected'}
            className={`flex flex-1 items-center justify-center gap-1.5 py-1.5 text-label uppercase transition-colors ${
              mobilePane === 'selected'
                ? 'bg-surface-high text-primary'
                : 'text-on-surface-variant hover:bg-surface-high'
            }`}
            onClick={() => setMobilePane(mobilePane === 'selected' ? null : 'selected')}
            type="button"
          >
            <Icon name="travel_explore" size={14} />
            {selected ? `Selected · ${selected.id}` : 'Selection'}
          </button>

          <button
            aria-expanded={mobilePane === 'feed'}
            className={`flex flex-1 items-center justify-center gap-1.5 py-1.5 text-label uppercase transition-colors ${
              mobilePane === 'feed'
                ? 'bg-surface-high text-primary'
                : 'text-on-surface-variant hover:bg-surface-high'
            }`}
            onClick={() => setMobilePane(mobilePane === 'feed' ? null : 'feed')}
            type="button"
          >
            <Icon name="list" size={14} />
            Feed ({feed.length})
          </button>
        </div>

        {mobilePane ? (
          <div className="max-h-[45vh] overflow-y-auto border-t border-outline-variant">
            {mobilePane === 'selected' ? (
              selected ? (
                <HotspotSummaryPanel hotspot={selected} />
              ) : (
                <p className="p-gutter text-body-sm text-on-surface-variant">
                  Tap a marker on the map or a row in the feed to inspect a detection.
                </p>
              )
            ) : feed.length === 0 ? (
              <p className="p-gutter text-body-sm text-on-surface-variant">
                No detections match the current filters.
              </p>
            ) : (
              <HotspotList hotspots={feed} onSelect={select} selectedId={selectedId} />
            )}
          </div>
        ) : null}
      </div>

      {/* Empty-result recovery, shown when filters exclude everything. */}
      {count === 0 && !isDefault ? (
        <div className="shrink-0 border-t border-outline-variant bg-surface-container px-gutter py-2">
          <div className="flex flex-wrap items-center gap-3">
            <Icon className="text-tertiary" name="filter_alt_off" size={16} />
            <p className="text-body-sm text-on-surface-variant">
              No detections match the current filters.
            </p>
            <button
              className="border border-outline-variant bg-surface-high px-2 py-0.5 text-label uppercase text-on-surface transition-colors hover:bg-surface-highest"
              onClick={reset}
              type="button"
            >
              Reset filters
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StripPanel({
  title,
  children,
  note,
}: {
  title: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-label uppercase text-on-surface-variant">{title}</h3>
      {children}
      {note ? <p className="text-[10px] leading-[13px] text-outline">{note}</p> : null}
    </section>
  );
}

/**
 * Detections by acquisition hour.
 *
 * A within-day distribution, not a trend. Bars are scaled to the busiest hour.
 */
function HourHistogram({ hours }: { hours: number[] }) {
  const max = Math.max(...hours, 0);

  if (max === 0) {
    return <p className="text-body-sm text-on-surface-variant">No acquisition times available.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-12 items-end gap-px" role="img" aria-label="Detections by hour of day">
        {hours.map((value, hour) => (
          <span
            className="flex-1 bg-outline-variant transition-colors hover:bg-primary"
            key={hour}
            style={{ height: `${max > 0 ? Math.max(2, (value / max) * 100) : 2}%` }}
            title={`${String(hour).padStart(2, '0')}:00 — ${value} detection${value === 1 ? '' : 's'}`}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-outline">
        <span>00:00</span>
        <span>12:00</span>
        <span>23:00</span>
      </div>
    </div>
  );
}

function CollapseButton({
  onClick,
  label,
  direction,
}: {
  onClick: () => void;
  label: string;
  direction: 'left' | 'right';
}) {
  return (
    <button
      aria-label={label}
      className="flex h-6 shrink-0 items-center justify-center gap-1 border-t border-outline-variant text-on-surface-variant transition-colors hover:bg-surface-high hover:text-on-surface"
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon name={direction === 'left' ? 'chevron_left' : 'chevron_right'} size={14} />
      <span className="text-label uppercase">Hide</span>
    </button>
  );
}

function ExpandRail({
  onClick,
  label,
  icon,
}: {
  onClick: () => void;
  label: string;
  icon: string;
}) {
  return (
    <button
      aria-label={label}
      className="flex flex-1 flex-col items-center gap-2 py-2 text-on-surface-variant transition-colors hover:bg-surface-high hover:text-on-surface"
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon name={icon} size={16} />
      <span className="text-label uppercase [writing-mode:vertical-rl]">{label}</span>
    </button>
  );
}
