/**
 * KPI ribbon.
 *
 * Computed from the currently filtered hotspots, so the figures always describe
 * what is on the map. Where the Stitch design showed fabricated totals (1,248
 * detections, 142 high-risk) these are the real counts, which for the current
 * mock dataset are small — that is the honest number.
 *
 * Cells are buttons where a corresponding filter exists, turning the ribbon into
 * a drill-down rather than a passive readout.
 */
import type { HotspotSummary } from '../../domain/aggregate';
import { CLASSIFICATIONS } from '../../domain/classification';
import { RISK_LEVELS } from '../../domain/risk';
import { useFilters } from '../../state/FiltersContext';
import { Icon } from '../ui/Icon';

export interface KpiRibbonProps {
  summary: HotspotSummary;
  /** Unfiltered dataset size, for the "of N" context. */
  totalInDataset: number;
  isFiltered: boolean;
}

export function KpiRibbon({ summary, totalInDataset, isFiltered }: KpiRibbonProps) {
  const { filters, setFilter, selectOnlyClassification } = useFilters();

  return (
    <div
      className="flex shrink-0 divide-x divide-outline-variant overflow-x-auto border-b border-outline-variant bg-surface-low/40"
      role="group"
      aria-label="Key indicators for the current filter"
    >
      <Cell
        hint={isFiltered ? `of ${totalInDataset} in dataset` : 'Whole dataset'}
        label="Detections"
        value={summary.total}
      />

      <Cell
        active={filters.minRisk === 90}
        color={`var(${RISK_LEVELS.CRITICAL.colorVar})`}
        hint="Risk 90+"
        label="Critical"
        onClick={() => setFilter('minRisk', filters.minRisk === 90 ? null : 90)}
        value={summary.critical}
      />

      <Cell
        active={filters.minRisk === 80}
        color={`var(${RISK_LEVELS.HIGH.colorVar})`}
        hint="Risk 80-89"
        label="High"
        onClick={() => setFilter('minRisk', filters.minRisk === 80 ? null : 80)}
        value={summary.high}
      />

      <Cell
        active={filters.minPersistence === 7}
        color={`var(${CLASSIFICATIONS.PERSISTENT_THERMAL_SOURCE.colorVar})`}
        hint="Detected 7+ days"
        label="Persistent"
        onClick={() => setFilter('minPersistence', filters.minPersistence === 7 ? null : 7)}
        value={summary.persistent}
      />

      <Cell
        color={`var(${CLASSIFICATIONS.INDUSTRIAL_FIRE.colorVar})`}
        hint="Inside industrial polygon"
        label="Industrial-linked"
        value={summary.industrialLinked}
      />

      <Cell
        color={`var(${RISK_LEVELS.CRITICAL.colorVar})`}
        hint="Risk 80+ within 2 km of infrastructure"
        icon="priority_high"
        label="High risk near infra"
        value={summary.highRiskNearInfrastructure}
      />

      <Cell
        active={
          filters.classifications.length === 1 && filters.classifications[0] === 'UNKNOWN'
        }
        color={`var(${CLASSIFICATIONS.UNKNOWN.colorVar})`}
        hint="Awaiting classification"
        label="Unknown"
        onClick={() => selectOnlyClassification('UNKNOWN')}
        value={summary.unclassified}
      />
    </div>
  );
}

function Cell({
  label,
  value,
  hint,
  color,
  onClick,
  active = false,
  icon,
}: {
  label: string;
  value: number;
  hint: string;
  color?: string;
  onClick?: () => void;
  active?: boolean;
  icon?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1 truncate text-label uppercase text-outline">
        {icon ? <Icon name={icon} size={11} /> : null}
        {label}
      </span>
      <span
        className="font-mono text-display tabular-nums"
        style={color ? { color } : undefined}
      >
        {value.toLocaleString('en-IN')}
      </span>
      <span className="truncate text-[11px] leading-[14px] text-on-surface-variant/80">{hint}</span>
    </>
  );

  const base =
    'relative flex min-w-[136px] flex-1 flex-col justify-center gap-1 px-4 py-2.5 text-left';

  if (!onClick) {
    return (
      <div className={base} title={hint}>
        {body}
      </div>
    );
  }

  return (
    <button
      aria-pressed={active}
      className={`${base} rounded-none hover:bg-surface-high/70 ${
        active
          ? 'bg-surface-high/70 after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent after:content-[""]'
          : ''
      }`}
      onClick={onClick}
      title={`${hint} — click to filter`}
      type="button"
    >
      {body}
    </button>
  );
}
