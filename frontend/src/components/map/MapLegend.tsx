/**
 * Map legend.
 *
 * Switches with the marker colour mode, so the legend can never disagree with
 * what is on the map. Rows are buttons in classification mode: clicking one
 * isolates that class, which is faster than reaching for the filter panel.
 */
import { CLASSIFICATION_LIST } from '../../domain/classification';
import { RISK_LEVEL_LIST } from '../../domain/risk';
import { useFilters } from '../../state/FiltersContext';
import { Icon } from '../ui/Icon';
import { HEAT_WEIGHTS, type HeatWeightMode } from './HeatLayer';
import type { MapViewMode, MarkerColorMode } from './MapView';

export interface MapLegendProps {
  colorMode: MarkerColorMode;
  viewMode?: MapViewMode;
  heatWeight?: HeatWeightMode;
}

export function MapLegend({ colorMode, viewMode = 'markers', heatWeight = 'frp' }: MapLegendProps) {
  const { filters, selectOnlyClassification, selectAllClassifications } = useFilters();

  const isolated = filters.classifications.length === 1 ? filters.classifications[0] : null;
  const showHeat = viewMode !== 'markers';
  const showClasses = viewMode !== 'heatmap';

  return (
    <div className="glass absolute bottom-8 left-3 z-[500] min-w-[164px] rounded-[var(--radius-md)] p-gutter">
      {showHeat ? (
        <div className={showClasses ? 'mb-3 border-b border-outline-variant pb-3' : ''}>
          <h3 className="mb-1.5 text-label uppercase text-on-surface-variant">Thermal density</h3>
          <div
            aria-hidden="true"
            className="h-2 w-full rounded-full"
            style={{
              backgroundImage:
                'linear-gradient(90deg, rgba(124,45,18,0.15), #7c2d12 25%, #ea580c 50%, #ff9f3f 72%, #ffd257 90%, #fff7ed)',
            }}
          />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-outline">
            <span>Sparse</span>
            <span>Dense</span>
          </div>
          <p className="mt-1 text-[11px] leading-[14px] text-on-surface-variant/80">
            Weighted by {HEAT_WEIGHTS[heatWeight].label.toLowerCase()}
          </p>
        </div>
      ) : null}

      {showClasses ? (
        <>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h3 className="text-label uppercase text-on-surface-variant">
          {colorMode === 'risk' ? 'Risk level' : 'Classification'}
        </h3>
        {isolated ? (
          <button
            className="flex items-center gap-0.5 rounded-[4px] text-label uppercase text-accent hover:underline"
            onClick={selectAllClassifications}
            type="button"
          >
            <Icon name="close" size={10} />
            Clear
          </button>
        ) : null}
      </div>

      {colorMode === 'risk' ? (
        <ul className="flex flex-col gap-1">
          {RISK_LEVEL_LIST.map((level) => (
            <li className="flex items-center gap-2" key={level.key}>
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: `var(${level.colorVar})` }}
              />
              <span className="text-body-sm text-on-surface">{level.label}</span>
              <span className="ml-auto pl-2 font-mono text-[10px] text-outline">
                {level.key === 'CRITICAL' ? '90+' : level.key === 'LOW' ? '<50' : `${level.minScore}+`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {CLASSIFICATION_LIST.map((definition) => {
            const active = isolated === definition.key;

            return (
              <li key={definition.key}>
                <button
                  aria-pressed={active}
                  className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-left hover:bg-surface-high ${
                    active ? 'bg-surface-high' : ''
                  }`}
                  onClick={() => selectOnlyClassification(definition.key)}
                  title={
                    active
                      ? `Showing only ${definition.label}. Click to clear.`
                      : `Show only ${definition.label}`
                  }
                  type="button"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: `var(${definition.colorVar})` }}
                  />
                  <span
                    className={`text-body-sm ${active ? 'text-on-surface' : 'text-on-surface-variant'}`}
                  >
                    {definition.shortLabel}
                  </span>
                  {/* Model code, shown so the mapping to the classifier is visible. */}
                  <span className="ml-auto pl-2 font-mono text-[10px] text-outline">
                    {definition.code}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
        </>
      ) : null}
    </div>
  );
}
