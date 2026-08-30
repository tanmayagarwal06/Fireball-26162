/**
 * Selectable hotspot feed.
 *
 * Dense rows, 1px dividers, no zebra striping — per DESIGN.md. Each row is a real
 * button so the list is fully keyboard navigable and the selected row is exposed
 * to assistive technology via aria-pressed.
 */
import { useEffect, useRef } from 'react';
import { getClassification } from '../../domain/classification';
import { resolveRiskLevel } from '../../domain/risk';
import { resolvePersistenceDays } from '../../domain/persistence';
import { formatCoordinates, formatDays, formatFrp, formatKm } from '../../domain/format';
import { Icon } from '../ui/Icon';
import type { Hotspot } from '../../types/hotspot';

export interface HotspotListProps {
  hotspots: Hotspot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Scroll the selected row into view when selection changes elsewhere. */
  followSelection?: boolean;
}

export function HotspotList({
  hotspots,
  selectedId,
  onSelect,
  followSelection = true,
}: HotspotListProps) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  // Keeps the list in step with map clicks, which is the common interaction path.
  useEffect(() => {
    if (!followSelection || !selectedId) return;
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, followSelection]);

  return (
    <ul className="flex flex-col divide-y divide-outline-variant">
      {hotspots.map((hotspot) => {
        const classification = getClassification(hotspot.classification);
        const risk = resolveRiskLevel(hotspot.risk_score);
        const persistence = resolvePersistenceDays(hotspot);
        const selected = hotspot.id === selectedId;

        return (
          <li key={hotspot.id}>
            <button
              aria-pressed={selected}
              className={`flex w-full flex-col gap-1 border-l-2 px-compact py-1.5 text-left transition-colors hover:bg-surface-high ${
                selected
                  ? 'border-l-primary bg-surface-high'
                  : 'border-l-transparent'
              }`}
              onClick={() => onSelect(hotspot.id)}
              ref={selected ? selectedRef : undefined}
              type="button"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0"
                  style={{ backgroundColor: `var(${classification.colorVar})` }}
                />
                <span className="font-mono text-data text-on-surface">{hotspot.id}</span>

                <span
                  className="ml-auto shrink-0 font-mono text-data"
                  style={{ color: `var(${risk.colorVar})` }}
                  title={risk.description}
                >
                  {hotspot.risk_score}
                </span>
              </span>

              <span className="truncate text-body-sm text-on-surface-variant">
                {classification.label}
              </span>

              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] leading-[13px] text-outline">
                <span>{formatCoordinates(hotspot.lat, hotspot.lon, 3)}</span>
                <span aria-hidden="true">·</span>
                <span>{formatFrp(hotspot.frp)}</span>
                {persistence !== null ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{formatDays(persistence)}</span>
                  </>
                ) : null}
                {hotspot.inside_industrial_polygon ? (
                  <span
                    className="flex items-center gap-0.5 text-on-surface-variant"
                    title={`Inside industrial polygon, ${formatKm(hotspot.distance_to_industry_km)} from ${
                      hotspot.nearest_facility_type ?? 'infrastructure'
                    }`}
                  >
                    <Icon name="factory" size={10} />
                    {formatKm(hotspot.distance_to_industry_km)}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
