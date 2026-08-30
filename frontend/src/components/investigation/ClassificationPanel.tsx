/**
 * Classification panel.
 *
 * The Stitch design shows a six-bar probability distribution (91% / 6% / 1% …).
 * The backend exposes a single `classification_confidence` scalar, so that chart
 * cannot be populated without inventing five numbers.
 *
 * This renders the one real value, then reserves the distribution area and states
 * plainly that it needs the classification engine. The empty rows are drawn at
 * zero width so the layout the model will fill is visible, but no figure is
 * shown for any class.
 */
import { CLASSIFICATION_LIST, getClassification } from '../../domain/classification';
import { formatRatioAsPercent, toPercentScale } from '../../domain/format';
import { resolveRiskLevel } from '../../domain/risk';
import { Icon } from '../ui/Icon';
import { ProvenanceTag } from '../ui/ProvenanceTag';
import type { Hotspot } from '../../types/hotspot';

export function ClassificationPanel({ hotspot }: { hotspot: Hotspot }) {
  const definition = getClassification(hotspot.classification);
  const confidence = toPercentScale(hotspot.classification_confidence);
  const risk = resolveRiskLevel(hotspot.risk_score);

  return (
    <section className="border border-outline-variant bg-surface-container">
      <header className="flex items-center gap-2 border-b border-outline-variant bg-surface-low px-compact py-1">
        <h3 className="flex items-center gap-1.5 text-label uppercase text-on-surface">
          <Icon name="category" size={14} />
          Classification
        </h3>
        <ProvenanceTag className="ml-auto" provenance="API" />
      </header>

      <div className="flex flex-col gap-3 p-compact">
        {/* The assigned class and the one confidence figure that genuinely exists. */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span
              className="flex items-center gap-1.5 text-data-lg"
              style={{ color: `var(${definition.colorVar})` }}
            >
              <Icon name={definition.icon} size={16} />
              <span className="truncate font-sans font-semibold">{definition.label}</span>
            </span>
            <span className="font-mono text-body-sm text-outline">
              Model code {definition.code}
            </span>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="text-label uppercase text-on-surface-variant">Confidence</span>
            <span className="font-mono text-data-lg text-on-surface">
              {formatRatioAsPercent(hotspot.classification_confidence)}
            </span>
          </div>
        </div>

        {/* Confidence bar, the single real quantitative signal available. */}
        {confidence !== null ? (
          <div className="flex flex-col gap-1">
            <div className="h-1.5 w-full bg-surface-lowest">
              <div
                className="h-full"
                style={{
                  backgroundColor: `var(${definition.colorVar})`,
                  width: `${confidence}%`,
                }}
              />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-outline">
              <span>0%</span>
              <span>100%</span>
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 border-t border-outline-variant pt-2">
          <span className="text-label uppercase text-on-surface-variant">Risk score</span>
          <span className="font-mono text-data" style={{ color: `var(${risk.colorVar})` }}>
            {hotspot.risk_score} / 100 · {risk.label.toUpperCase()}
          </span>
        </div>

        {/* ------------------------------------------- Awaiting the classifier */}
        <div className="border border-tertiary/30 bg-tertiary/5">
          <div className="flex items-center gap-2 border-b border-tertiary/30 px-compact py-1">
            <h4 className="text-label uppercase text-tertiary">Per-class probabilities</h4>
            <ProvenanceTag className="ml-auto" provenance="PENDING_MODEL" />
          </div>

          <div className="flex flex-col gap-1.5 p-compact">
            <p className="text-body-sm text-on-surface-variant">
              The backend returns one confidence scalar, not a distribution across the six classes.
              This panel stays empty until the classification engine is integrated — no values are
              estimated here.
            </p>

            <ul className="flex flex-col gap-1 pt-1">
              {CLASSIFICATION_LIST.map((entry) => (
                <li className="flex items-center gap-2" key={entry.key}>
                  <span
                    className="w-[7.5rem] shrink-0 truncate text-body-sm text-outline"
                    title={entry.label}
                  >
                    {entry.shortLabel}
                  </span>
                  {/* Empty track: the shape the model will fill, with no value implied. */}
                  <span className="h-2 flex-1 border border-dashed border-outline-variant/60" />
                  <span className="w-8 shrink-0 text-right font-mono text-body-sm text-outline">
                    —
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
