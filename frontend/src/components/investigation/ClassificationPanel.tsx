/**
 * Classification panel.
 *
 * The Stitch design shows a six-bar probability distribution (91% / 6% / 1% …).
 * Pipeline-exported records carry `class_probabilities`, the classifier's
 * posterior over the five learned classes, and that is what fills the bars.
 * "Unknown" is the confidence gate rather than a class, so its row is drawn as
 * a dashed track and labelled "gated" when it is the assigned outcome.
 *
 * Records without the vector (the mock fixture) still get the single
 * `classification_confidence` scalar and an empty distribution area that says
 * so — no figure is invented for any class.
 */
import {
  CLASSIFICATION_LIST,
  getClassification,
  parseClassification,
  type ClassificationKey,
} from '../../domain/classification';
import { formatRatioAsPercent, toPercentScale } from '../../domain/format';
import { resolveRiskLevel } from '../../domain/risk';
import { Icon } from '../ui/Icon';
import { ProvenanceTag } from '../ui/ProvenanceTag';
import type { Hotspot } from '../../types/hotspot';

/** Render a 0-1 probability as a percentage with one decimal below 10%. */
function formatProbability(value: number): string {
  const pct = value * 100;
  return pct >= 10 || pct === 0 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

/**
 * Map the served `class_probabilities` (keyed by API label) onto classification
 * keys. Returns null when the record carries no vector, so the panel can say so.
 */
function resolveProbabilities(hotspot: Hotspot): Map<ClassificationKey, number> | null {
  const raw = hotspot.class_probabilities;
  if (!raw || typeof raw !== 'object') return null;
  const map = new Map<ClassificationKey, number>();
  for (const [label, value] of Object.entries(raw)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const key = parseClassification(label);
    if (key !== 'UNKNOWN') map.set(key, value);
  }
  return map.size > 0 ? map : null;
}

export function ClassificationPanel({ hotspot }: { hotspot: Hotspot }) {
  const definition = getClassification(hotspot.classification);
  const confidence = toPercentScale(hotspot.classification_confidence);
  const risk = resolveRiskLevel(hotspot.risk_score);
  const probabilities = resolveProbabilities(hotspot);

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

        {probabilities ? (
          /* ------------------------------------- Served posterior over the five classes */
          <div className="border border-outline-variant bg-surface-lowest">
            <div className="flex items-center gap-2 border-b border-outline-variant px-compact py-1">
              <h4 className="text-label uppercase text-on-surface-variant">Per-class probabilities</h4>
              <ProvenanceTag className="ml-auto" provenance="API" />
            </div>

            <div className="flex flex-col gap-1.5 p-compact">
              <p className="text-body-sm text-on-surface-variant">
                Posterior from the offline classifier (gradient-boosted ensemble blended with
                rule-based priors). Unknown is the confidence gate, not a class: it is assigned when
                the leading probability is below 60%.
              </p>

              <ul className="flex flex-col gap-1 pt-1">
                {CLASSIFICATION_LIST.map((entry) => {
                  const value = probabilities.get(entry.key);
                  const isGate = entry.key === 'UNKNOWN';
                  const isAssigned = entry.key === definition.key;
                  return (
                    <li className="flex items-center gap-2" key={entry.key}>
                      <span
                        className={`w-[7.5rem] shrink-0 truncate text-body-sm ${isAssigned ? 'text-on-surface' : 'text-outline'}`}
                        title={entry.label}
                      >
                        {entry.shortLabel}
                      </span>
                      {isGate || value === undefined ? (
                        <span className="h-2 flex-1 border border-dashed border-outline-variant/60" />
                      ) : (
                        <span className="h-2 flex-1 bg-surface-container">
                          <span
                            className="block h-full"
                            style={{
                              backgroundColor: `var(${entry.colorVar})`,
                              width: `${Math.max(0, Math.min(100, value * 100))}%`,
                              opacity: isAssigned ? 1 : 0.55,
                            }}
                          />
                        </span>
                      )}
                      <span
                        className={`w-10 shrink-0 text-right font-mono text-body-sm ${isAssigned ? 'text-on-surface' : 'text-outline'}`}
                        title={isGate ? 'Gate: assigned when the leading probability is below 60%' : undefined}
                      >
                        {isGate ? (isAssigned ? 'gated' : '—') : value === undefined ? '—' : formatProbability(value)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : (
          /* ------------------------------------------- No posterior on this record */
          <div className="border border-tertiary/30 bg-tertiary/5">
            <div className="flex items-center gap-2 border-b border-tertiary/30 px-compact py-1">
              <h4 className="text-label uppercase text-tertiary">Per-class probabilities</h4>
              <ProvenanceTag className="ml-auto" provenance="PENDING_MODEL" />
            </div>

            <div className="flex flex-col gap-1.5 p-compact">
              <p className="text-body-sm text-on-surface-variant">
                This record carries one confidence scalar and no class_probabilities vector (the
                mock fixture, or an export produced without the classifier posterior), so this panel
                stays empty — no values are estimated here.
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
                    {/* Empty track: the shape the model would fill, with no value implied. */}
                    <span className="h-2 flex-1 border border-dashed border-outline-variant/60" />
                    <span className="w-8 shrink-0 text-right font-mono text-body-sm text-outline">
                      —
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
