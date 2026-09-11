/**
 * Screen 4 — Alert & Risk Centre.
 *
 * Reads `GET /alerts`, which is real, and joins each entry back to its hotspot
 * record to correct the fields the alert payload misreports.
 *
 * Filtering is split deliberately:
 *  - `min_risk` and `classification` go to the backend, which supports them.
 *  - `status` also goes to the backend.
 *  - The remaining shared filters (satellite, land cover, dates, persistence) are
 *    not accepted by `/alerts`, so the result is intersected client-side with the
 *    filtered hotspot set. The scope bar states which is which.
 *
 * There are no acknowledge or dispatch controls: the backend has no alert store,
 * so such buttons would be decoration pretending to be workflow.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { listAlerts } from '../api/alerts';
import { useAsync } from '../hooks/useAsync';
import { useFilteredHotspots } from '../hooks/useFilteredHotspots';
import { Icon } from '../components/ui/Icon';
import { Metric } from '../components/ui/Metric';
import { ProvenanceTag } from '../components/ui/ProvenanceTag';
import { Select } from '../components/ui/Select';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { ClassificationBadge } from '../components/ui/ClassificationBadge';
import {
  ALERT_SORT_OPTIONS,
  ALERT_STATUS_META,
  alertSeverityCounts,
  enrichAlerts,
  formatAge,
  sortAlerts,
  type AlertSortKey,
  type EnrichedAlert,
} from '../domain/alerts';
import { RISK_LEVEL_LIST } from '../domain/risk';
import {
  formatAcquisition,
  formatCoordinates,
  formatDays,
  formatKm,
  formatPercent,
  formatText,
} from '../domain/format';
import { investigationPath } from '../navigation';
import { useDataset } from '../state/DatasetContext';
import { useFilters } from '../state/FiltersContext';
import { useSelection } from '../state/SelectionContext';
import type { AlertListResponse } from '../types/api';

export function AlertsPage() {
  const navigate = useNavigate();
  const dataset = useDataset();
  const { query, reset, activeCount } = useFilters();
  const { selectedId, select } = useSelection();

  const [status, setStatus] = useState<string | null>(null);
  const [sort, setSort] = useState<AlertSortKey>('risk-desc');

  // Only the three parameters /alerts actually implements.
  const alertQuery = useMemo(
    () => ({
      ...(query.min_risk !== undefined ? { min_risk: query.min_risk } : {}),
      ...(query.classification !== undefined ? { classification: query.classification } : {}),
      ...(status !== null ? { status } : {}),
    }),
    [query.min_risk, query.classification, status],
  );

  const alerts = useAsync<AlertListResponse>((signal) => listAlerts(alertQuery, signal), {
    deps: [alertQuery],
  });

  // Supplies the hotspot join and the client-side intersection.
  const scoped = useFilteredHotspots();

  const enriched = useMemo(() => {
    const raw = alerts.data?.alerts ?? [];
    const joined = enrichAlerts(raw, dataset.all);

    // Apply the filters /alerts cannot honour, by restricting to the hotspot
    // ids that survived the full filter set.
    const allowedIds = new Set(scoped.hotspots.map((hotspot) => hotspot.id));
    const intersected = joined.filter((entry) => allowedIds.has(entry.alert.hotspot_id));

    return sortAlerts(intersected, sort);
  }, [alerts.data, dataset.all, scoped.hotspots, sort]);

  const severityCounts = useMemo(() => alertSeverityCounts(enriched), [enriched]);
  const selected = useMemo(
    () => enriched.find((entry) => entry.alert.hotspot_id === selectedId) ?? null,
    [enriched, selectedId],
  );

  const serverCount = alerts.data?.count ?? 0;
  const droppedByClient = serverCount - enriched.length;

  const openInvestigation = (id: string) => {
    select(id);
    navigate(investigationPath(id));
  };

  if (alerts.isInitialLoading) return <LoadingState label="Loading alerts" />;

  if (alerts.error) {
    return <ErrorState message={alerts.error} onRetry={alerts.refresh} title="Could not load alerts" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* --------------------------------------------------- Severity strip */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-outline-variant bg-surface-lowest px-gutter py-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-label uppercase text-on-surface-variant">Alerts in scope</span>
          <span className="font-mono text-data-lg text-on-surface">{enriched.length}</span>
        </div>

        <span aria-hidden="true" className="h-4 w-px bg-outline-variant" />

        <div className="flex flex-wrap gap-2">
          {RISK_LEVEL_LIST.map((level) => (
            <div
              className="flex items-center gap-1.5 border-l-2 px-2 py-0.5"
              key={level.key}
              style={{ borderLeftColor: `var(${level.colorVar})` }}
              title={level.description}
            >
              <span
                className="text-label uppercase"
                style={{ color: `var(${level.colorVar})` }}
              >
                {level.label}
              </span>
              <span className="font-mono text-data text-on-surface">
                {severityCounts[level.key] ?? 0}
              </span>
            </div>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ProvenanceTag provenance="API" />
          <span
            className="font-mono text-body-sm text-outline"
            title="Alerts are recalculated from hotspot records on every request. There is no alert store, acknowledgement state or delivery mechanism."
          >
            Computed per request · no persistence
          </span>

          <button
            className="flex items-center gap-1 border border-outline-variant bg-surface-high px-2 py-0.5 text-label uppercase text-on-surface transition-colors hover:bg-surface-highest disabled:opacity-50"
            disabled={alerts.isFetching}
            onClick={() => {
              alerts.refresh();
              scoped.refresh();
            }}
            title="Re-query the alert endpoint"
            type="button"
          >
            <Icon
              className={alerts.isFetching ? 'animate-spin' : undefined}
              name="refresh"
              size={12}
            />
            {alerts.isFetching ? 'Loading' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------- Filter bar */}
      <div className="flex shrink-0 flex-wrap items-end gap-3 border-b border-outline-variant bg-surface px-gutter py-2">
        <Icon className="mb-1.5 text-on-surface-variant" name="filter_list" size={16} />

        <Select
          className="w-44"
          label="Status"
          onChange={setStatus}
          options={[
            { label: 'All statuses', value: null },
            ...ALERT_STATUS_META.map((meta) => ({ label: meta.label, value: meta.value })),
          ]}
          value={status}
        />

        <Select
          className="w-44"
          label="Sort by"
          onChange={setSort}
          options={ALERT_SORT_OPTIONS.map((option) => ({
            label: option.label,
            value: option.value,
          }))}
          value={sort}
        />

        {/* Make the split between server and client filtering explicit. */}
        <div className="flex flex-col gap-1">
          <span className="text-label uppercase text-on-surface-variant">Scope</span>
          <span className="font-mono text-body-sm text-on-surface-variant">
            {serverCount} from API
            {droppedByClient > 0 ? (
              <span
                className="text-tertiary"
                title="Filters the /alerts endpoint does not accept (satellite, land cover, date, persistence) were applied in the browser."
              >
                {' '}
                · {droppedByClient} excluded client-side
              </span>
            ) : null}
          </span>
        </div>

        {activeCount > 0 || status !== null ? (
          <button
            className="mb-0.5 ml-auto flex items-center gap-1 border border-outline-variant bg-surface-high px-2 py-1 text-label uppercase text-on-surface transition-colors hover:bg-surface-highest"
            onClick={() => {
              reset();
              setStatus(null);
            }}
            type="button"
          >
            <Icon name="restart_alt" size={12} />
            Reset filters
          </button>
        ) : null}
      </div>

      {/* ----------------------------------------------------- Alert queue */}
      <div className="min-h-0 flex-1 overflow-auto">
        {enriched.length === 0 ? (
          <EmptyState
            action={
              activeCount > 0 || status !== null
                ? {
                    label: 'Reset filters',
                    onClick: () => {
                      reset();
                      setStatus(null);
                    },
                  }
                : undefined
            }
            description={
              activeCount > 0 || status !== null
                ? 'No alerts match the active filters.'
                : 'The backend returned no alerts for the current dataset.'
            }
            icon="notifications_off"
            title="No alerts in scope"
          />
        ) : (
          <table className="w-full min-w-[1080px] border-collapse text-left">
            <caption className="sr-only">
              Prioritised alert queue, {enriched.length} entries
            </caption>
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-outline-variant text-label uppercase text-on-surface-variant">
                <th className="w-10 px-2 py-1.5 text-center" scope="col">#</th>
                <th className="px-gutter py-1.5" scope="col">Hotspot</th>
                <th className="px-gutter py-1.5" scope="col">Classification</th>
                <th className="px-gutter py-1.5 text-right" scope="col">Risk</th>
                <th className="px-gutter py-1.5 text-right" scope="col">Conf.</th>
                <th className="px-gutter py-1.5" scope="col">Location</th>
                <th className="px-gutter py-1.5 text-right" scope="col">Persist.</th>
                <th className="px-gutter py-1.5 text-right" scope="col">Industry</th>
                <th className="px-gutter py-1.5" scope="col">Detected</th>
                <th className="px-gutter py-1.5 text-right" scope="col">Age</th>
                <th className="px-gutter py-1.5" scope="col">Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-outline-variant">
              {enriched.map((entry, index) => (
                <AlertRow
                  entry={entry}
                  index={index}
                  key={entry.alert.hotspot_id}
                  onOpen={() => openInvestigation(entry.alert.hotspot_id)}
                  onSelect={() => select(entry.alert.hotspot_id)}
                  selected={entry.alert.hotspot_id === selectedId}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ------------------------------------------- Selected alert context */}
      {selected ? (
        <div className="shrink-0 border-t border-outline-variant bg-surface p-gutter">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h2 className="text-label uppercase text-on-surface-variant">Selected alert context</h2>
            <span
              className="border px-1.5 py-0.5 text-label uppercase"
              style={{
                color: `var(${selected.severity.colorVar})`,
                borderColor: `color-mix(in srgb, var(${selected.severity.colorVar}) 40%, transparent)`,
              }}
            >
              {selected.severity.label}
            </span>

            <button
              className="ml-auto flex items-center gap-1.5 border border-primary/40 bg-primary/10 px-3 py-1 text-label uppercase text-primary transition-colors hover:bg-primary/20"
              onClick={() => openInvestigation(selected.alert.hotspot_id)}
              type="button"
            >
              <Icon name="travel_explore" size={14} />
              View investigation
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Metric
              label="Hotspot"
              provenance="API"
              value={selected.alert.hotspot_id}
              valueColor={`var(${selected.severity.colorVar})`}
            />
            <Metric label="Classification" provenance="API" text value={selected.alert.classification} />
            <Metric
              label="Risk score"
              provenance="API"
              value={`${selected.alert.risk_score} / 100`}
              valueColor={`var(${selected.severity.colorVar})`}
            />
            <Metric
              hint="Classification confidence, not FIRMS detection confidence"
              label="Confidence"
              provenance="API"
              value={formatPercent(selected.alert.confidence)}
            />
            <Metric
              label="Persistence"
              provenance="API"
              value={formatDays(selected.persistenceDays)}
            />
            <Metric
              label="Industrial distance"
              provenance="API"
              value={formatKm(selected.alert.industrial_distance_km)}
            />
            <Metric
              label="Coordinates"
              provenance="API"
              value={formatCoordinates(selected.alert.location.lat, selected.alert.location.lon)}
            />
            <Metric
              label="Detected"
              provenance="API"
              value={formatAcquisition(selected.alert.detection_date, selected.alert.detection_time)}
            />
            <Metric
              hint="Relative to the current system clock"
              label="Age"
              provenance="DERIVED"
              value={formatAge(selected.ageHours)}
            />
            <Metric label="Land cover" provenance="API" text value={formatText(selected.landCover)} />
            <Metric
              label="Nearest facility"
              provenance="API"
              text
              value={formatText(selected.facilityType)}
            />
            <Metric
              label="In industrial polygon"
              provenance="API"
              text
              value={
                selected.insideIndustrialPolygon === null
                  ? '—'
                  : selected.insideIndustrialPolygon
                    ? 'Yes'
                    : 'No'
              }
            />
          </div>

          {/* Be explicit that status is a function of risk, not a workflow state. */}
          <p className="mt-2 border-t border-outline-variant pt-2 text-body-sm text-on-surface-variant">
            <span className="text-label uppercase text-on-surface-variant">Status: </span>
            <span style={{ color: `var(${selected.status.colorVar})` }}>{selected.status.label}</span>
            {' — '}
            {selected.status.description} Status cannot be changed from this console because the
            backend derives it from the risk score on every request.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function AlertRow({
  entry,
  index,
  selected,
  onSelect,
  onOpen,
}: {
  entry: EnrichedAlert;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const severityColor = `var(${entry.severity.colorVar})`;

  return (
    <tr
      className={`cursor-pointer border-l-2 transition-colors hover:bg-surface-high ${
        selected ? 'bg-surface-high' : ''
      }`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      style={{ borderLeftColor: severityColor }}
      title="Click to select · double-click to open the investigation"
    >
      <td className="px-2 py-1.5 text-center font-mono text-[10px] text-outline">
        {String(index + 1).padStart(2, '0')}
      </td>

      <td className="px-gutter py-1.5">
        <button
          className="font-mono text-data hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          style={{ color: 'var(--color-on-surface)' }}
          type="button"
        >
          {entry.alert.hotspot_id}
        </button>
      </td>

      <td className="px-gutter py-1.5">
        <ClassificationBadge classification={entry.alert.classification} short />
      </td>

      <td className="px-gutter py-1.5 text-right font-mono text-data" style={{ color: severityColor }}>
        {entry.alert.risk_score}
      </td>

      <td className="px-gutter py-1.5 text-right font-mono text-data text-on-surface-variant">
        {formatPercent(entry.alert.confidence)}
      </td>

      <td className="px-gutter py-1.5 font-mono text-body-sm text-on-surface-variant">
        {formatCoordinates(entry.alert.location.lat, entry.alert.location.lon, 3)}
      </td>

      <td
        className="px-gutter py-1.5 text-right font-mono text-data"
        style={{
          color:
            entry.persistenceDays !== null && entry.persistenceDays >= 7
              ? 'var(--color-class-persistent)'
              : 'var(--color-on-surface-variant)',
        }}
        title="Days on which the source was detected, from the alert payload."
      >
        {entry.persistenceDays !== null ? `${entry.persistenceDays} d` : '—'}
      </td>

      <td
        className="px-gutter py-1.5 text-right font-mono text-data"
        style={{
          color:
            typeof entry.alert.industrial_distance_km === 'number' &&
            entry.alert.industrial_distance_km <= 0.5
              ? 'var(--color-class-industrial)'
              : 'var(--color-on-surface-variant)',
        }}
      >
        {formatKm(entry.alert.industrial_distance_km)}
      </td>

      <td className="px-gutter py-1.5 font-mono text-body-sm text-on-surface-variant">
        {formatAcquisition(entry.alert.detection_date, entry.alert.detection_time)}
      </td>

      <td className="px-gutter py-1.5 text-right font-mono text-body-sm text-outline">
        {formatAge(entry.ageHours)}
      </td>

      <td className="px-gutter py-1.5">
        <span
          className="text-label uppercase"
          style={{ color: `var(${entry.status.colorVar})` }}
          title={entry.status.description}
        >
          {entry.status.label}
        </span>
      </td>
    </tr>
  );
}
