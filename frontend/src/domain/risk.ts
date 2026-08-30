/**
 * Risk banding.
 *
 * The backend stores a single numeric `risk_score` (0-100) and buckets it three
 * ways inside `/statistics` (High >= 80, Medium >= 50, Low otherwise). Stitch
 * screen-4 presents a four-level operator scale including CRITICAL, which the
 * backend has no concept of.
 *
 * These thresholds are therefore FRONTEND-DERIVED. They are chosen so that
 * CRITICAL + HIGH is exactly the backend's `high_risk` count (risk >= 80), and
 * MEDIUM / LOW keep the backend's own 50 boundary. That keeps the operator scale
 * reconcilable with `/statistics` instead of quietly disagreeing with it.
 *
 * Against the current 11-record dataset this yields 3 critical, 1 high,
 * 5 medium, 2 low — and 3 + 1 = 4 = the backend's reported high_risk.
 */

export const RISK_LEVEL_KEYS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

export type RiskLevelKey = (typeof RISK_LEVEL_KEYS)[number];

export interface RiskLevelDefinition {
  key: RiskLevelKey;
  label: string;
  /** Inclusive lower bound on risk_score. */
  minScore: number;
  colorVar: string;
  /** Short human description of the band, for tooltips and legends. */
  description: string;
}

export const RISK_LEVELS: Record<RiskLevelKey, RiskLevelDefinition> = {
  CRITICAL: {
    key: 'CRITICAL',
    label: 'Critical',
    minScore: 90,
    colorVar: '--color-risk-critical',
    description: 'Risk score 90-100. Immediate operator attention.',
  },
  HIGH: {
    key: 'HIGH',
    label: 'High',
    minScore: 80,
    colorVar: '--color-risk-high',
    description: 'Risk score 80-89. Counts toward the backend high-risk total.',
  },
  MEDIUM: {
    key: 'MEDIUM',
    label: 'Medium',
    minScore: 50,
    colorVar: '--color-risk-medium',
    description: 'Risk score 50-79. Routine monitoring.',
  },
  LOW: {
    key: 'LOW',
    label: 'Low',
    minScore: 0,
    colorVar: '--color-risk-low',
    description: 'Risk score below 50.',
  },
};

/** Ordered most severe first — the order alerts and legends are presented in. */
export const RISK_LEVEL_LIST: RiskLevelDefinition[] = RISK_LEVEL_KEYS.map((key) => RISK_LEVELS[key]);

/** Band a raw 0-100 risk score. */
export function resolveRiskLevel(score: number | null | undefined): RiskLevelDefinition {
  const value = typeof score === 'number' && Number.isFinite(score) ? score : 0;
  return RISK_LEVEL_LIST.find((level) => value >= level.minScore) ?? RISK_LEVELS.LOW;
}

export function riskColor(key: RiskLevelKey): string {
  return `var(${RISK_LEVELS[key].colorVar})`;
}

/**
 * The backend's own definition of high risk, kept here so the threshold is not
 * duplicated as a magic number. Mirrors `risk >= 80` in backend/app.py.
 */
export const BACKEND_HIGH_RISK_THRESHOLD = 80;

export function isHighRisk(score: number | null | undefined): boolean {
  return typeof score === 'number' && score >= BACKEND_HIGH_RISK_THRESHOLD;
}
