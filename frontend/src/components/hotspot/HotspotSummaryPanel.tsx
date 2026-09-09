/**
 * Selected-hotspot summary for the dashboard's right rail.
 *
 * A condensed read of the record with a route into the full investigation. Every
 * value here is a raw API field; nothing is inferred except the risk band and the
 * persistence figure, both tagged accordingly.
 */
import { Link } from 'react-router-dom';
import { getClassification } from '../../domain/classification';
import { resolveRiskLevel } from '../../domain/risk';
import { resolvePersistenceDays } from '../../domain/persistence';
import {
  formatAcquisition,
  formatCoordinates,
  formatDayNight,
  formatDays,
  formatFrp,
  formatKelvin,
  formatKm,
  formatPercent,
  formatRatioAsPercent,
  formatText,
} from '../../domain/format';
import { investigationPath } from '../../navigation';
import { ClassificationBadge } from '../ui/ClassificationBadge';
import { Icon } from '../ui/Icon';
import { Metric } from '../ui/Metric';
import { RiskBadge } from '../ui/RiskBadge';
import type { Hotspot } from '../../types/hotspot';

export function HotspotSummaryPanel({ hotspot }: { hotspot: Hotspot }) {
  const classification = getClassification(hotspot.classification);
  const risk = resolveRiskLevel(hotspot.risk_score);
  const persistence = resolvePersistenceDays(hotspot);

  return (
    <div className="flex flex-col gap-gutter p-gutter">
      {/* Identity and headline assessment */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="font-mono text-data-lg text-on-surface">{hotspot.id}</span>
          <ClassificationBadge classification={hotspot.classification} showIcon />
          <span className="text-body-sm text-on-surface-variant">
            {formatRatioAsPercent(hotspot.classification_confidence)} classification confidence
          </span>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-label uppercase text-on-surface-variant">Risk</span>
          <span className="font-mono text-data-lg" style={{ color: `var(${risk.colorVar})` }}>
            {hotspot.risk_score}
            <span className="text-outline"> / 100</span>
          </span>
          <RiskBadge score={hotspot.risk_score} scoreOnly={false} />
        </div>
      </div>

      <Link
        className="flex items-center justify-center gap-1.5 border border-primary/40 bg-primary/10 px-3 py-1.5 text-label uppercase text-primary transition-colors hover:bg-primary/20"
        to={investigationPath(hotspot.id)}
      >
        <Icon name="travel_explore" size={14} />
        Open full investigation
      </Link>

      {/* Geolocation and acquisition */}
      <Section title="Detection">
        <Metric
          label="Coordinates"
          provenance="API"
          value={formatCoordinates(hotspot.lat, hotspot.lon)}
        />
        <Metric
          label="Acquired"
          provenance="API"
          value={formatAcquisition(hotspot.acq_date, hotspot.acq_time)}
        />
        <Metric label="Sensor" provenance="API" value={hotspot.satellite} />
        <Metric
          label="Overpass"
          provenance="API"
          value={formatDayNight(hotspot.day_night)}
        />
      </Section>

      {/* Thermal characteristics */}
      <Section title="Thermal">
        <Metric label="FRP" provenance="API" value={formatFrp(hotspot.frp)} />
        <Metric
          label="Brightness temp"
          provenance="API"
          value={formatKelvin(hotspot.brightness_temperature)}
        />
        <Metric
          hint="FIRMS detection confidence, distinct from classification confidence"
          label="Detection conf."
          provenance="API"
          value={formatPercent(hotspot.confidence)}
        />
        <Metric
          label="Hotspot density"
          provenance="API"
          value={hotspot.hotspot_density ?? '—'}
        />
      </Section>

      {/* Spatial and temporal context */}
      <Section title="Context">
        <Metric
          hint="Derived from persistence_7d"
          label="Persistence"
          provenance="DERIVED"
          value={formatDays(persistence)}
        />
        <Metric
          label="Industrial distance"
          provenance="API"
          value={formatKm(hotspot.distance_to_industry_km)}
        />
        <Metric
          label="Nearest facility"
          provenance="API"
          text
          value={formatText(hotspot.nearest_facility_type)}
        />
        <Metric
          label="Land cover"
          provenance="API"
          text
          value={formatText(hotspot.land_cover_class)}
        />
        <Metric
          label="In industrial polygon"
          provenance="API"
          text
          value={hotspot.inside_industrial_polygon ? 'Yes' : 'No'}
          valueColor={
            hotspot.inside_industrial_polygon
              ? `var(${classification.colorVar})`
              : undefined
          }
        />
      </Section>

      {/* Pipeline-authored evidence strings: SHAP attributions and context rules rendered as text. */}
      {hotspot.evidence.length > 0 ? (
        <section className="flex flex-col gap-1.5 border-t border-outline-variant pt-gutter">
          <h3 className="flex items-center gap-1.5 text-label uppercase text-on-surface-variant">
            Recorded evidence
            <span
              className="border border-outline-variant px-1 text-[9px] font-bold uppercase leading-[14px] tracking-[0.06em] text-outline"
              title="Generated by the offline pipeline from model feature attributions (TreeSHAP) and context rules. Not free-text language-model output."
            >
              Pipeline
            </span>
          </h3>
          <ul className="flex flex-col gap-1">
            {hotspot.evidence.map((item) => (
              <li className="flex gap-1.5 text-body-sm text-on-surface-variant" key={item}>
                <Icon className="mt-0.5 text-outline" name="chevron_right" size={12} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-outline-variant pt-gutter">
      <h3 className="text-label uppercase text-on-surface-variant">{title}</h3>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">{children}</div>
    </section>
  );
}
