/**
 * Screen 3 — Analytics & Pattern Discovery.
 *
 * Every panel answers a stated operational question, printed above the chart, so
 * nothing is here purely to fill space. Two design constraints from the data:
 *
 *  - Aggregates are computed from the *filtered* `/hotspots` result, so the page
 *    responds to the shared filter state. `/statistics` is fetched alongside it as
 *    the unfiltered baseline, because that endpoint accepts no parameters and
 *    therefore cannot follow the filters.
 *
 *  - Every record shares one acquisition date, so there is no trend to plot. The
 *    temporal panel says so and shows the within-day distribution instead of
 *    drawing a fabricated multi-day line.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { getStatistics } from '../api/system';
import { useAsync } from '../hooks/useAsync';
import { useFilteredHotspots } from '../hooks/useFilteredHotspots';
import { BarChart } from '../components/charts/BarRow';
import { ScatterPlot } from '../components/charts/ScatterPlot';
import { Icon } from '../components/ui/Icon';
import { Metric } from '../components/ui/Metric';
import { Panel } from '../components/ui/Panel';
import { ProvenanceTag } from '../components/ui/ProvenanceTag';
import { EmptyState, ErrorState, LoadingState, SkeletonRows } from '../components/ui/States';
import {
  classificationCounts,
  dayNightCounts,
  detectionsByDate,
  detectionsByHour,
  facilityCounts,
  landCoverCounts,
  persistenceCounts,
  proximityCounts,
  riskCounts,
  satelliteCounts,
  summarise,
  thermalPoints,
  topByRisk,
} from '../domain/aggregate';
import { CLASSIFICATION_LIST } from '../domain/classification';
import { PERSISTENCE_BAND_LIST } from '../domain/persistence';
import { RISK_LEVEL_LIST } from '../domain/risk';
import { formatCount, formatFrp, formatKelvin, formatKm } from '../domain/format';
import { investigationPath } from '../navigation';
import { useDataset } from '../state/DatasetContext';
import { useFilters } from '../state/FiltersContext';
import { useSelection } from '../state/SelectionContext';
import type { StatisticsResponse } from '../types/api';

export function AnalyticsPage() {
  const navigate = useNavigate();
  const dataset = useDataset();
  const { filters, isDefault, activeCount, selectOnlyClassification, setFilter, reset } =
    useFilters();
  const { selectedId, select } = useSelection();

  const { hotspots, count, error, isInitialLoading, isFetching, refresh } = useFilteredHotspots();

  const baseline = useAsync<StatisticsResponse>((signal) => getStatistics(signal));

  const summary = useMemo(() => summarise(hotspots), [hotspots]);
  const classCounts = useMemo(() => classificationCounts(hotspots), [hotspots]);
  const riskBands = useMemo(() => riskCounts(hotspots), [hotspots]);
  const persistenceBands = useMemo(() => persistenceCounts(hotspots), [hotspots]);
  const proximity = useMemo(() => proximityCounts(hotspots), [hotspots]);
  const satellites = useMemo(() => satelliteCounts(hotspots), [hotspots]);
  const landCovers = useMemo(() => landCoverCounts(hotspots), [hotspots]);
  const facilities = useMemo(() => facilityCounts(hotspots), [hotspots]);
  const dayNight = useMemo(() => dayNightCounts(hotspots), [hotspots]);
  const byDate = useMemo(() => detectionsByDate(hotspots), [hotspots]);
  const byHour = useMemo(() => detectionsByHour(hotspots), [hotspots]);
  const scatter = useMemo(() => thermalPoints(hotspots), [hotspots]);
  const priority = useMemo(() => topByRisk(hotspots, 8), [hotspots]);

  const openInvestigation = (id: string) => {
    select(id);
    navigate(investigationPath(id));
  };

  if (isInitialLoading) return <LoadingState label="Loading analytics" />;

  if (error) {
    return <ErrorState message={error} onRetry={refresh} title="Could not load hotspots" />;
  }

  return (
    <div className="surface-grid flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* -------------------------------------------------------- Scope bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-outline-variant bg-surface-low px-gutter py-2">
        <h1 className="text-headline text-on-surface">Analytics &amp; Pattern Discovery</h1>

        <span className="flex items-center gap-1.5 font-mono text-body-sm text-on-surface-variant">
          <Icon name="filter_list" size={13} />
          {isDefault
            ? `Whole dataset · ${count} detections`
            : `${activeCount} filter${activeCount === 1 ? '' : 's'} active · ${count} of ${dataset.all.length} detections`}
        </span>

        {!isDefault ? (
          <button
            className="border border-outline-variant bg-surface-high px-2 py-0.5 text-label uppercase text-on-surface transition-colors hover:bg-surface-highest"
            onClick={reset}
            type="button"
          >
            Reset filters
          </button>
        ) : null}

        <span className="ml-auto font-mono text-body-sm text-outline">
          {dataset.isSingleDate && dataset.earliestDate
            ? `Single acquisition date: ${dataset.earliestDate}`
            : `${dataset.earliestDate ?? '—'} to ${dataset.latestDate ?? '—'}`}
        </span>

        <button
          className="flex items-center gap-1 border border-outline-variant bg-surface-high px-2 py-0.5 text-label uppercase text-on-surface transition-colors hover:bg-surface-highest disabled:opacity-50"
          disabled={isFetching}
          onClick={() => {
            refresh();
            baseline.refresh();
          }}
          title="Reload hotspots and the backend baseline"
          type="button"
        >
          <Icon className={isFetching ? 'animate-spin' : undefined} name="refresh" size={12} />
          {isFetching ? 'Loading' : 'Refresh'}
        </button>
      </div>

      {count === 0 ? (
        <EmptyState
          action={{ label: 'Reset filters', onClick: reset }}
          description="The active filters exclude every record, so there is nothing to aggregate."
          title="No detections in scope"
        />
      ) : (
        <div className="flex flex-col gap-gutter p-gutter">
          {/* ------------------------------------------------ KPI summary */}
          <div className="grid grid-cols-2 gap-gutter md:grid-cols-4 xl:grid-cols-7">
            <SummaryCard
              accent="var(--color-primary)"
              label="Detections"
              value={formatCount(summary.total)}
            />
            <SummaryCard
              accent="var(--color-risk-critical)"
              label="Critical"
              hint="Risk 90+"
              value={formatCount(summary.critical)}
            />
            <SummaryCard
              accent="var(--color-risk-high)"
              label="High"
              hint="Risk 80-89"
              value={formatCount(summary.high)}
            />
            <SummaryCard
              accent="var(--color-class-persistent)"
              derived
              hint="7+ days"
              label="Persistent"
              value={formatCount(summary.persistent)}
            />
            <SummaryCard
              accent="var(--color-class-industrial)"
              hint="In industrial polygon"
              label="Industrial"
              value={formatCount(summary.industrialLinked)}
            />
            <SummaryCard
              accent="var(--color-class-unknown)"
              hint="Needs review"
              label="Unknown class"
              value={formatCount(summary.unclassified)}
            />
            <SummaryCard
              accent="var(--color-risk-critical)"
              derived
              hint="Risk 80+ within 2 km"
              label="High risk near infra"
              value={formatCount(summary.highRiskNearInfrastructure)}
            />
          </div>

          {/* -------------------------------------- Classification & risk */}
          <div className="grid grid-cols-1 gap-gutter lg:grid-cols-2">
            <Panel
              actions={<ProvenanceTag provenance="DERIVED" />}
              icon="category"
              title="Which thermal classes dominate the current scope?"
            >
              <BarChart
                data={CLASSIFICATION_LIST.map((definition) => ({
                  key: definition.key,
                  label: definition.label,
                  value: classCounts[definition.key],
                  color: `var(${definition.colorVar})`,
                  active:
                    filters.classifications.length === 1 &&
                    filters.classifications[0] === definition.key,
                  onClick: () => selectOnlyClassification(definition.key),
                  title: `${definition.label} (model code ${definition.code}) — click to isolate`,
                }))}
                labelWidth="10rem"
              />
            </Panel>

            <Panel
              actions={<ProvenanceTag provenance="DERIVED" />}
              icon="warning"
              title="How is operational risk distributed?"
            >
              <BarChart
                data={RISK_LEVEL_LIST.map((level) => ({
                  key: level.key,
                  label: level.label,
                  value: riskBands[level.key],
                  color: `var(${level.colorVar})`,
                  active: level.minScore > 0 && filters.minRisk === level.minScore,
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
                labelWidth="10rem"
              />

              {/* Reconcile the four-band operator scale with the backend's three. */}
              <div className="mt-3 border-t border-outline-variant pt-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-label uppercase text-on-surface-variant">
                    Unfiltered backend baseline
                  </h3>
                  <ProvenanceTag className="ml-auto" provenance="API" />
                </div>

                {baseline.isInitialLoading ? (
                  <SkeletonRows className="mt-2" rows={3} />
                ) : baseline.data ? (
                  <>
                    <div className="mt-2 flex flex-wrap gap-4">
                      {Object.entries(baseline.data.risk_distribution).map(([band, value]) => (
                        <Metric key={band} label={band} value={formatCount(value)} />
                      ))}
                    </div>
                    <p className="mt-1.5 text-[10px] leading-[13px] text-outline">
                      The backend groups risk into three bands (High 80+, Medium 50+, Low). The
                      console adds Critical at 90+, so Critical + High always equals the backend&apos;s
                      High. Baseline covers the whole dataset regardless of filters.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-body-sm text-on-surface-variant">
                    {baseline.error ?? 'Baseline unavailable.'}
                  </p>
                )}
              </div>
            </Panel>
          </div>

          {/* ------------------------------ Persistence & infrastructure */}
          <div className="grid grid-cols-1 gap-gutter lg:grid-cols-3">
            <Panel
              actions={<ProvenanceTag provenance="DERIVED" />}
              icon="schedule"
              title="How many sources are persistent?"
            >
              <BarChart
                data={PERSISTENCE_BAND_LIST.map((band) => ({
                  key: band.key,
                  label: band.label,
                  value: persistenceBands[band.key],
                  color:
                    band.key === 'PERSISTENT'
                      ? 'var(--color-class-persistent)'
                      : 'var(--color-outline-variant)',
                  active: filters.minPersistence === band.minDays && band.minDays > 0,
                  onClick:
                    band.minDays > 0
                      ? () =>
                          setFilter(
                            'minPersistence',
                            filters.minPersistence === band.minDays ? null : band.minDays,
                          )
                      : undefined,
                }))}
                labelWidth="5rem"
              />

              <p className="mt-2 border-t border-outline-variant pt-2 text-[10px] leading-[13px] text-outline">
                Derived from <span className="font-mono">persistence_7d</span>. The backend&apos;s own
                persistence figures report every record as 7+ days because of the{' '}
                <span className="font-mono">get_persistence()</span> defect, so they are not shown
                here. See System Status.
              </p>
            </Panel>

            <Panel
              actions={<ProvenanceTag provenance="DERIVED" />}
              icon="factory"
              title="How close are detections to industry?"
            >
              <BarChart
                data={[
                  {
                    key: 'within500m',
                    label: 'Within 500 m',
                    value: proximity.within500m,
                    color: 'var(--color-class-industrial)',
                    active: filters.maxIndustrialDistance === 0.5,
                    onClick: () =>
                      setFilter(
                        'maxIndustrialDistance',
                        filters.maxIndustrialDistance === 0.5 ? null : 0.5,
                      ),
                  },
                  {
                    key: 'to2km',
                    label: '500 m – 2 km',
                    value: proximity.from500mTo2km,
                    color: 'var(--color-outline-variant)',
                  },
                  {
                    key: 'beyond',
                    label: 'Beyond 2 km',
                    value: proximity.beyond2km,
                    color: 'var(--color-surface-highest)',
                  },
                  ...(proximity.unknown > 0
                    ? [
                        {
                          key: 'unknown',
                          label: 'No distance recorded',
                          value: proximity.unknown,
                          color: 'var(--color-class-unknown)',
                          title:
                            'These records are excluded by the backend proximity filter, which drops null distances.',
                        },
                      ]
                    : []),
                ]}
                labelWidth="7.5rem"
              />

              <div className="mt-2 flex items-center gap-2 border-l-2 border-l-[var(--color-risk-critical)] bg-surface-lowest px-2 py-1.5">
                <Icon className="text-[var(--color-risk-critical)]" name="priority_high" size={14} />
                <span className="font-mono text-data text-on-surface">
                  {summary.highRiskNearInfrastructure}
                </span>
                <span className="text-body-sm text-on-surface-variant">
                  high-risk detections within 2 km of infrastructure
                </span>
              </div>
            </Panel>

            <Panel
              actions={<ProvenanceTag provenance="API" />}
              icon="apartment"
              title="Which facility types are implicated?"
            >
              <BarChart
                data={facilities.map((entry) => ({
                  key: entry.key,
                  label: entry.label,
                  value: entry.value,
                  color:
                    entry.key === 'No facility nearby'
                      ? 'var(--color-outline-variant)'
                      : 'var(--color-class-industrial)',
                }))}
                labelWidth="8rem"
              />
            </Panel>
          </div>

          {/* --------------------------------------- Thermal separability */}
          <Panel
            actions={<ProvenanceTag provenance="API" />}
            icon="scatter_plot"
            title="Do thermal characteristics separate the classes?"
          >
            <p className="mb-2 text-body-sm text-on-surface-variant">
              Fire radiative power against brightness temperature. Overlap between natural and
              industrial classes is exactly what makes spatial and temporal context necessary — this
              plot is the argument for the intelligence layer.
            </p>

            <ScatterPlot
              onSelect={openInvestigation}
              points={scatter}
              selectedId={selectedId}
            />

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-outline-variant pt-2">
              {CLASSIFICATION_LIST.map((definition) => (
                <span
                  className="flex items-center gap-1.5 text-body-sm text-on-surface-variant"
                  key={definition.key}
                >
                  <span
                    className="size-2"
                    style={{ backgroundColor: `var(${definition.colorVar})` }}
                  />
                  {definition.shortLabel}
                </span>
              ))}
              <span className="ml-auto font-mono text-[10px] text-outline">
                Click a point to open its investigation
              </span>
            </div>
          </Panel>

          {/* ---------------------------------- Acquisition & land cover */}
          <div className="grid grid-cols-1 gap-gutter lg:grid-cols-3">
            <Panel
              actions={<ProvenanceTag provenance="DERIVED" />}
              icon="schedule"
              title="When during the day are detections made?"
            >
              {/* Honest about the absence of a time series. */}
              <div className="mb-2 flex gap-2 border border-tertiary/30 bg-tertiary/5 p-2">
                <Icon className="shrink-0 text-tertiary" name="info" size={14} />
                <p className="text-body-sm text-on-surface-variant">
                  {byDate.length <= 1
                    ? `The dataset holds a single acquisition date (${byDate[0]?.label ?? '—'}), so no multi-day trend can be plotted. Shown instead: the distribution across hours of that day.`
                    : `Detections span ${byDate.length} dates. Shown: distribution across hours of the day.`}
                </p>
              </div>

              <HourChart hours={byHour} />

              <div className="mt-2 flex gap-4 border-t border-outline-variant pt-2">
                <Metric label="Day overpass" value={formatCount(dayNight.day)} />
                <Metric label="Night overpass" value={formatCount(dayNight.night)} />
                {dayNight.unknown > 0 ? (
                  <Metric label="Unrecorded" value={formatCount(dayNight.unknown)} />
                ) : null}
              </div>
            </Panel>

            <Panel
              actions={<ProvenanceTag provenance="API" />}
              icon="terrain"
              title="What land cover do detections occur on?"
            >
              <BarChart
                data={landCovers.map((entry) => ({
                  key: entry.key,
                  label: entry.label,
                  value: entry.value,
                  color: 'var(--color-secondary)',
                  active: filters.landCover === entry.key,
                  onClick: () =>
                    setFilter('landCover', filters.landCover === entry.key ? null : entry.key),
                  title: `${entry.label} — click to filter`,
                }))}
                labelWidth="7rem"
              />
            </Panel>

            <Panel
              actions={<ProvenanceTag provenance="API" />}
              icon="satellite_alt"
              title="Which sensors are contributing?"
            >
              <BarChart
                data={satellites.map((entry) => ({
                  key: entry.key,
                  label: entry.label,
                  value: entry.value,
                  color: 'var(--color-primary)',
                  active: filters.satellite === entry.key,
                  onClick: () =>
                    setFilter('satellite', filters.satellite === entry.key ? null : entry.key),
                  title: `${entry.label} — click to filter`,
                }))}
                labelWidth="9.5rem"
              />

              <div className="mt-2 flex flex-wrap gap-4 border-t border-outline-variant pt-2">
                <Metric label="Peak FRP" value={formatFrp(summary.maxFrp)} />
                <Metric label="Mean FRP" value={formatFrp(summary.meanFrp)} />
                <Metric label="Peak brightness" value={formatKelvin(summary.maxBrightness)} />
              </div>
            </Panel>
          </div>

          {/* -------------------------------------------- Priority table */}
          <Panel
            actions={<ProvenanceTag provenance="DERIVED" />}
            flush
            icon="priority_high"
            title="Which detections need attention first?"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <caption className="sr-only">
                  Highest-risk detections in the current scope
                </caption>
                <thead>
                  <tr className="border-b border-outline-variant text-label uppercase text-on-surface-variant">
                    <th className="px-gutter py-1.5" scope="col">Hotspot</th>
                    <th className="px-gutter py-1.5" scope="col">Class</th>
                    <th className="px-gutter py-1.5 text-right" scope="col">Risk</th>
                    <th className="px-gutter py-1.5 text-right" scope="col">FRP</th>
                    <th className="px-gutter py-1.5 text-right" scope="col">Brightness</th>
                    <th className="px-gutter py-1.5 text-right" scope="col">Industry</th>
                    <th className="px-gutter py-1.5" scope="col">Land cover</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {priority.map((hotspot) => {
                    const definition = CLASSIFICATION_LIST.find(
                      (entry) => entry.apiLabel === hotspot.classification,
                    );

                    return (
                      <tr
                        className="cursor-pointer transition-colors hover:bg-surface-high"
                        key={hotspot.id}
                        onClick={() => openInvestigation(hotspot.id)}
                      >
                        <td className="px-gutter py-1.5">
                          <button
                            className="font-mono text-data text-primary hover:underline"
                            type="button"
                          >
                            {hotspot.id}
                          </button>
                        </td>
                        <td className="px-gutter py-1.5">
                          <span className="flex items-center gap-1.5 text-body-sm text-on-surface">
                            <span
                              className="size-2 shrink-0"
                              style={{
                                backgroundColor: `var(${definition?.colorVar ?? '--color-class-unknown'})`,
                              }}
                            />
                            {hotspot.classification}
                          </span>
                        </td>
                        <td className="px-gutter py-1.5 text-right font-mono text-data text-on-surface">
                          {hotspot.risk_score}
                        </td>
                        <td className="px-gutter py-1.5 text-right font-mono text-data text-on-surface-variant">
                          {formatFrp(hotspot.frp)}
                        </td>
                        <td className="px-gutter py-1.5 text-right font-mono text-data text-on-surface-variant">
                          {formatKelvin(hotspot.brightness_temperature)}
                        </td>
                        <td className="px-gutter py-1.5 text-right font-mono text-data text-on-surface-variant">
                          {formatKm(hotspot.distance_to_industry_km)}
                        </td>
                        <td className="px-gutter py-1.5 text-body-sm text-on-surface-variant">
                          {hotspot.land_cover_class ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  accent,
  derived = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent: string;
  derived?: boolean;
}) {
  return (
    <div
      className="flex min-w-0 flex-col justify-between gap-1 border border-outline-variant bg-surface-container p-2"
      style={{ borderTopWidth: '2px', borderTopColor: accent }}
    >
      <div className="flex items-start gap-1">
        <span className="min-w-0 truncate text-label uppercase text-on-surface-variant" title={label}>
          {label}
        </span>
        {derived ? <ProvenanceTag provenance="DERIVED" /> : null}
      </div>
      <span className="font-mono text-data-lg text-on-surface">{value}</span>
      {hint ? <span className="truncate text-[10px] leading-[12px] text-outline">{hint}</span> : null}
    </div>
  );
}

/** Detections by hour of day. A within-day distribution, not a trend. */
function HourChart({ hours }: { hours: number[] }) {
  const max = Math.max(...hours, 0);

  if (max === 0) {
    return <p className="text-body-sm text-on-surface-variant">No acquisition times recorded.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        aria-label="Detections by hour of day"
        className="flex h-24 items-end gap-px"
        role="img"
      >
        {hours.map((value, hour) => (
          <span
            className="flex-1 bg-outline-variant transition-colors hover:bg-primary"
            key={hour}
            style={{ height: `${Math.max(2, (value / max) * 100)}%` }}
            title={`${String(hour).padStart(2, '0')}:00 — ${value} detection${value === 1 ? '' : 's'}`}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-outline">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  );
}
