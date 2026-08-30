/**
 * Filter controls.
 *
 * Only controls that correspond to a real backend capability. Every section
 * carries a tag showing whether the constraint was applied by the server or in
 * the browser, and the two client-side cases explain themselves on hover — an
 * operator should never have to guess whether the API honoured their filter.
 *
 * Option lists for satellite and land cover come from the dataset itself, because
 * the backend matches these exactly: an option that occurs in no record would
 * silently return nothing.
 */
import type { ReactNode } from 'react';
import { CLASSIFICATION_LIST } from '../../domain/classification';
import {
  MAX_INDUSTRIAL_DISTANCE_OPTIONS,
  MIN_PERSISTENCE_OPTIONS,
  filterPlacement,
  type FilterPlacement,
} from '../../domain/filters';
import { isClassificationSelected, useFilters } from '../../state/FiltersContext';
import { useDataset } from '../../state/DatasetContext';
import { useDebouncedCommit } from '../../hooks/useDebouncedCommit';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';

export interface FilterPanelProps {
  /** Result count after filtering, shown so the effect is immediately visible. */
  resultCount: number;
  totalCount: number;
  isFetching: boolean;
}

export function FilterPanel({ resultCount, totalCount, isFetching }: FilterPanelProps) {
  const { filters, setFilter, toggleClassification, selectAllClassifications, reset, activeCount } =
    useFilters();
  const dataset = useDataset();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-outline-variant bg-surface-low px-compact">
        <h2 className="flex items-center gap-1.5 text-label uppercase text-on-surface-variant">
          <Icon name="filter_list" size={14} />
          Filter controls
          {activeCount > 0 ? (
            <span className="border border-primary/40 bg-primary/10 px-1 font-mono text-[10px] text-primary">
              {activeCount}
            </span>
          ) : null}
        </h2>

        <button
          className="flex items-center gap-0.5 text-label uppercase text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
          disabled={activeCount === 0}
          onClick={reset}
          title="Clear all filters"
          type="button"
        >
          <Icon name="restart_alt" size={12} />
          Reset
        </button>
      </header>

      {/* Live result count, so the operator sees the effect of every change. */}
      <div className="flex shrink-0 items-baseline gap-1.5 border-b border-outline-variant bg-surface-lowest px-compact py-1.5">
        <span className="font-mono text-data-lg text-primary">{resultCount}</span>
        <span className="text-body-sm text-on-surface-variant">
          of {totalCount} detections shown
        </span>
        {isFetching ? <Icon className="ml-auto animate-spin text-outline" name="progress_activity" size={12} /> : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-gutter">
        {/* ------------------------------------------------ Classification */}
        <FilterSection
          icon="category"
          placement={filterPlacement(filters, 'classifications')}
          placementNote={
            filters.classifications.length > 1
              ? 'The backend accepts one classification per request, so a multi-class selection is narrowed in the browser.'
              : 'A single class is passed to the backend as ?classification='
          }
          title="Classification"
          action={
            filters.classifications.length > 0 ? (
              <button
                className="text-label uppercase text-primary hover:underline"
                onClick={selectAllClassifications}
                type="button"
              >
                All
              </button>
            ) : null
          }
        >
          <div className="flex flex-col gap-1.5">
            {CLASSIFICATION_LIST.map((definition) => {
              const checked = isClassificationSelected(filters, definition.key);

              return (
                <label
                  className="group flex cursor-pointer items-center gap-2"
                  key={definition.key}
                  title={`${definition.label} (model code ${definition.code})`}
                >
                  <input
                    checked={checked}
                    className="size-3.5 shrink-0 accent-[var(--color-primary)]"
                    onChange={() => toggleClassification(definition.key)}
                    type="checkbox"
                  />
                  <span
                    className="size-2 shrink-0"
                    style={{ backgroundColor: `var(${definition.colorVar})` }}
                  />
                  <span
                    className={`truncate text-body-sm transition-colors ${
                      checked ? 'text-on-surface' : 'text-outline'
                    }`}
                  >
                    {definition.label}
                  </span>
                </label>
              );
            })}
          </div>
        </FilterSection>

        {/* ----------------------------------------------------- Risk score */}
        <FilterSection
          icon="warning"
          placement={filterPlacement(filters, 'minRisk')}
          placementNote="Sent to the backend as ?min_risk="
          title="Minimum risk score"
        >
          <MinRiskSlider
            onChange={(value) => setFilter('minRisk', value)}
            value={filters.minRisk}
          />
        </FilterSection>

        {/* ---------------------------------------------------- Persistence */}
        <FilterSection
          icon="schedule"
          placement={filterPlacement(filters, 'minPersistence')}
          placementNote="Applied in the browser: the backend's min_persistence parameter is affected by the get_persistence() defect and matches every record. See System Status."
          title="Temporal persistence"
        >
          <Select
            ariaLabel="Minimum persistence in days"
            onChange={(value) => setFilter('minPersistence', value)}
            options={MIN_PERSISTENCE_OPTIONS}
            value={filters.minPersistence}
          />
        </FilterSection>

        {/* ------------------------------------------------------ Satellite */}
        <FilterSection
          icon="satellite_alt"
          placement={filterPlacement(filters, 'satellite')}
          placementNote="Sent to the backend as ?satellite= using the full sensor identifier"
          title="Data source"
        >
          <Select
            ariaLabel="Satellite sensor"
            emptyLabel={dataset.isLoading ? 'Loading sensors…' : 'No sensors in dataset'}
            onChange={(value) => setFilter('satellite', value)}
            options={[
              { label: 'All sensors', value: null },
              ...dataset.satellites.map((satellite) => ({ label: satellite, value: satellite })),
            ]}
            value={filters.satellite}
          />
        </FilterSection>

        {/* --------------------------------------------- Industrial context */}
        <FilterSection
          icon="factory"
          placement={filterPlacement(filters, 'maxIndustrialDistance')}
          placementNote="Sent to the backend as ?max_industrial_distance= in km. Records with no recorded distance are excluded by the backend."
          title="Industrial proximity"
        >
          <Select
            ariaLabel="Maximum distance to industrial infrastructure"
            onChange={(value) => setFilter('maxIndustrialDistance', value)}
            options={MAX_INDUSTRIAL_DISTANCE_OPTIONS}
            value={filters.maxIndustrialDistance}
          />
        </FilterSection>

        {/* ----------------------------------------------------- Land cover */}
        <FilterSection
          icon="terrain"
          placement={filterPlacement(filters, 'landCover')}
          placementNote="Sent to the backend as ?land_cover="
          title="Land cover"
        >
          <Select
            ariaLabel="Land cover class"
            emptyLabel={dataset.isLoading ? 'Loading classes…' : 'No classes in dataset'}
            onChange={(value) => setFilter('landCover', value)}
            options={[
              { label: 'All land cover', value: null },
              ...dataset.landCovers.map((cover) => ({ label: cover, value: cover })),
            ]}
            value={filters.landCover}
          />
        </FilterSection>

        {/* ----------------------------------------------------- Date range */}
        <FilterSection
          icon="date_range"
          placement={
            filters.dateFrom || filters.dateTo
              ? 'server'
              : 'inactive'
          }
          placementNote="Sent to the backend as ?date_from= and ?date_to="
          title="Acquisition date"
        >
          <div className="flex flex-col gap-2">
            <DateInput
              label="From"
              max={filters.dateTo ?? dataset.latestDate}
              min={dataset.earliestDate}
              onChange={(value) => setFilter('dateFrom', value)}
              value={filters.dateFrom}
            />
            <DateInput
              label="To"
              max={dataset.latestDate}
              min={filters.dateFrom ?? dataset.earliestDate}
              onChange={(value) => setFilter('dateTo', value)}
              value={filters.dateTo}
            />

            {/* State the real extent so the control's limits are not a mystery. */}
            {dataset.earliestDate ? (
              <p className="text-body-sm text-outline">
                {dataset.isSingleDate
                  ? `Dataset covers a single date: ${dataset.earliestDate}`
                  : `Dataset covers ${dataset.earliestDate} to ${dataset.latestDate}`}
              </p>
            ) : null}
          </div>
        </FilterSection>
      </div>
    </div>
  );
}

const PLACEMENT_TAG: Record<FilterPlacement, { label: string; className: string } | null> = {
  server: { label: 'API', className: 'border-outline-variant text-on-surface-variant' },
  client: { label: 'CLIENT', className: 'border-tertiary/40 text-tertiary' },
  inactive: null,
};

function FilterSection({
  title,
  icon,
  children,
  placement,
  placementNote,
  action,
}: {
  title: string;
  icon: string;
  children: ReactNode;
  placement: FilterPlacement;
  placementNote: string;
  action?: ReactNode;
}) {
  const tag = PLACEMENT_TAG[placement];

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <h3 className="flex items-center gap-1.5 text-label uppercase text-on-surface">
          <Icon name={icon} size={14} />
          {title}
        </h3>

        {tag ? (
          <span
            className={`border px-1 text-[9px] font-bold uppercase leading-[14px] tracking-[0.06em] ${tag.className}`}
            title={placementNote}
          >
            {tag.label}
          </span>
        ) : null}

        {action ? <span className="ml-auto">{action}</span> : null}
      </div>

      {children}
    </section>
  );
}

/**
 * Risk slider. Debounced so dragging does not fire a request per frame, and
 * snapped to 5-point steps because the underlying scores are whole numbers and
 * finer granularity would be false precision.
 */
function MinRiskSlider({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [local, setLocal] = useDebouncedCommit(value ?? 0, (next) =>
    onChange(next === 0 ? null : next),
  );

  return (
    <div className="flex flex-col gap-1.5">
      <input
        aria-label="Minimum risk score"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={local}
        className="h-1 w-full appearance-none bg-outline-variant accent-[var(--color-primary)]"
        max={100}
        min={0}
        onChange={(event) => setLocal(Number(event.target.value))}
        step={5}
        type="range"
        value={local}
      />

      <div className="flex items-center justify-between font-mono text-body-sm text-on-surface-variant">
        <span>0</span>
        <span className="text-data text-on-surface">
          {local === 0 ? 'Any' : `${local}+`}
        </span>
        <span>100</span>
      </div>
    </div>
  );
}

function DateInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  min: string | null;
  max: string | null;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-body-sm text-on-surface-variant">{label}</span>
      <input
        className="min-w-0 flex-1 border border-outline-variant bg-input px-1.5 py-1 font-mono text-body-sm text-on-surface transition-colors focus:border-on-surface focus:outline-none"
        max={max ?? undefined}
        min={min ?? undefined}
        onChange={(event) => onChange(event.target.value || null)}
        type="date"
        value={value ?? ''}
      />
      {value ? (
        <button
          aria-label={`Clear ${label.toLowerCase()} date`}
          className="shrink-0 text-on-surface-variant transition-colors hover:text-on-surface"
          onClick={() => onChange(null)}
          type="button"
        >
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </label>
  );
}
