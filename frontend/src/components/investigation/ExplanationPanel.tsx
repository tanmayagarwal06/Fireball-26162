/**
 * Backend explanation panel.
 *
 * Renders `GET /hotspots/{id}/explanation`. That endpoint assembles evidence
 * strings from structured fields with plain Python conditionals — it is not a
 * model and contains no learned reasoning, so the panel says so in its header
 * rather than letting "explanation" imply inference.
 *
 * The risk-factor bars need normalisation to be comparable, which the backend
 * does not provide. Bar *lengths* are therefore frontend-derived while the
 * numbers beside them are the raw API values; both facts are labelled.
 */
import { formatKm, formatPercent } from '../../domain/format';
import { Icon } from '../ui/Icon';
import { ProvenanceTag } from '../ui/ProvenanceTag';
import type { ExplanationResponse } from '../../types/api';

/**
 * Normalisation ranges for the risk-factor bars.
 * Chosen from the observed spread in the dataset, and stated in the UI.
 */
const FRP_SCALE_MW = 250;
const PERSISTENCE_SCALE_DAYS = 7;
const PROXIMITY_SCALE_KM = 5;

export function ExplanationPanel({ explanation }: { explanation: ExplanationResponse }) {
  const factors = explanation.risk_factors;

  const bars = [
    {
      key: 'thermal',
      label: 'Thermal intensity',
      raw: factors.thermal_intensity !== null ? `${factors.thermal_intensity.toFixed(1)} MW` : '—',
      ratio:
        factors.thermal_intensity !== null
          ? Math.min(1, factors.thermal_intensity / FRP_SCALE_MW)
          : null,
      basis: `Normalised against ${FRP_SCALE_MW} MW`,
    },
    {
      key: 'persistence',
      label: 'Persistence',
      raw: `${factors.persistence_days} d`,
      ratio: Math.min(1, factors.persistence_days / PERSISTENCE_SCALE_DAYS),
      basis: `Normalised against ${PERSISTENCE_SCALE_DAYS} days (distinct prior detection days within 1 km).`,
    },
    {
      key: 'proximity',
      label: 'Infrastructure proximity',
      raw: formatKm(factors.infrastructure_proximity_km),
      // Inverted: closer infrastructure means a larger contribution to risk.
      ratio:
        factors.infrastructure_proximity_km !== null
          ? Math.max(0, 1 - factors.infrastructure_proximity_km / PROXIMITY_SCALE_KM)
          : null,
      basis: `Inverted and normalised against ${PROXIMITY_SCALE_KM} km — nearer infrastructure contributes more.`,
    },
    {
      key: 'confidence',
      label: 'Classification confidence',
      raw: formatPercent(factors.classification_confidence),
      ratio:
        factors.classification_confidence !== null
          ? Math.min(1, factors.classification_confidence / 100)
          : null,
      basis: 'Already a percentage; used directly.',
    },
  ];

  return (
    <section className="border border-outline-variant bg-surface-container">
      <header className="flex flex-wrap items-center gap-2 border-b border-outline-variant bg-surface-low px-compact py-1">
        <h3 className="flex items-center gap-1.5 text-label uppercase text-on-surface">
          <Icon name="rule" size={14} />
          Why this classification
        </h3>
        <ProvenanceTag className="ml-auto" provenance="API" />
      </header>

      <div className="flex flex-col gap-3 p-compact">
        {/* Set expectations before the operator reads the bullet points. */}
        <p className="border-l-2 border-outline-variant bg-surface-lowest px-2 py-1.5 text-body-sm text-on-surface-variant">
          <Icon className="mr-1 align-[-2px] text-outline" name="info" size={12} />
          Assembled by the backend from structured fields using fixed rules, plus the pipeline&apos;s
          recorded evidence strings (model feature attributions and context rules). It is a
          deterministic evidence summary, not free-form model reasoning.
        </p>

        {explanation.supporting_evidence.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <h4 className="text-label uppercase text-on-surface-variant">Supporting evidence</h4>
            <ul className="flex flex-col gap-1">
              {explanation.supporting_evidence.map((item) => (
                <li className="flex gap-1.5 text-body-sm text-on-surface" key={item}>
                  <Icon className="mt-0.5 shrink-0 text-primary" name="check_circle" size={13} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Always shown: an empty conflicting list is itself a finding. */}
        <div className="flex flex-col gap-1.5">
          <h4 className="text-label uppercase text-on-surface-variant">Conflicting evidence</h4>
          {explanation.conflicting_evidence.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {explanation.conflicting_evidence.map((item) => (
                <li className="flex gap-1.5 text-body-sm text-on-surface" key={item}>
                  <Icon className="mt-0.5 shrink-0 text-tertiary" name="error" size={13} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border border-outline-variant bg-surface-lowest px-2 py-1.5 text-body-sm text-outline">
              None reported. The backend does not currently populate this list for any record, so an
              empty result here is not evidence of agreement.
            </p>
          )}
        </div>

        {/* Risk factor contributions */}
        <div className="flex flex-col gap-2 border-t border-outline-variant pt-2">
          <div className="flex items-center gap-2">
            <h4 className="text-label uppercase text-on-surface-variant">Risk factors</h4>
            <ProvenanceTag className="ml-auto" provenance="DERIVED" />
          </div>

          <div className="flex flex-col gap-1.5">
            {bars.map((bar) => (
              <div className="flex items-center gap-2" key={bar.key} title={bar.basis}>
                <span className="w-[8.5rem] shrink-0 truncate text-body-sm text-on-surface-variant">
                  {bar.label}
                </span>
                <span className="h-2 flex-1 bg-surface-lowest">
                  {bar.ratio !== null ? (
                    <span
                      className="block h-full bg-primary"
                      style={{ width: `${bar.ratio * 100}%` }}
                    />
                  ) : null}
                </span>
                <span className="w-16 shrink-0 text-right font-mono text-data text-on-surface">
                  {bar.raw}
                </span>
              </div>
            ))}
          </div>

          <p className="text-[10px] leading-[13px] text-outline">
            Bar lengths are normalised in the frontend to make the factors comparable; the figures on
            the right are the raw values from the API. These are not learned feature weights.
          </p>
        </div>

        {/* The backend's own uncertainty statement, quoted verbatim. */}
        {explanation.uncertainty ? (
          <p className="border-t border-outline-variant pt-2 text-body-sm text-on-surface-variant">
            <span className="text-label uppercase text-on-surface-variant">Uncertainty: </span>
            {explanation.uncertainty}
          </p>
        ) : null}
      </div>
    </section>
  );
}
