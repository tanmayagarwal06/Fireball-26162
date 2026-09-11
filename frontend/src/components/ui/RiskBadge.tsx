/**
 * Risk chip.
 *
 * The band is frontend-derived (see src/domain/risk.ts); the score itself comes
 * straight from the API. The tooltip states the threshold so an operator can see
 * why a score landed in a given band.
 */
import type { CSSProperties } from 'react';
import { resolveRiskLevel } from '../../domain/risk';

export interface RiskBadgeProps {
  /** Raw `risk_score`, 0-100. */
  score: number | null | undefined;
  /** Show "87 / 100" instead of just "87". */
  showDenominator?: boolean;
  /** Hide the band name, leaving only the number. */
  scoreOnly?: boolean;
  className?: string;
}

export function RiskBadge({
  score,
  showDenominator = false,
  scoreOnly = false,
  className,
}: RiskBadgeProps) {
  const level = resolveRiskLevel(score);
  const color = `var(${level.colorVar})`;

  const style: CSSProperties = {
    color,
    borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
    backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
  };

  const value = typeof score === 'number' ? score : '—';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-1.5 py-0.5${
        className ? ` ${className}` : ''
      }`}
      style={style}
      title={level.description}
    >
      <span className="font-mono text-data">
        {value}
        {showDenominator ? ' / 100' : ''}
      </span>
      {scoreOnly ? null : (
        <span className="text-label uppercase">{level.label}</span>
      )}
    </span>
  );
}
