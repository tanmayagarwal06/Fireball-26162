/**
 * LED-style status indicator.
 *
 * DESIGN.md reserves circular shapes for exactly this purpose, so this is the
 * only intentionally round element in the console.
 */
export type StatusTone = 'online' | 'offline' | 'pending';

const TONE_VAR: Record<StatusTone, string> = {
  online: '--color-status-online',
  offline: '--color-status-offline',
  pending: '--color-status-pending',
};

export interface StatusDotProps {
  tone: StatusTone;
  /** Accessible description; the dot is otherwise meaningless to a screen reader. */
  label: string;
  className?: string;
}

export function StatusDot({ tone, label, className }: StatusDotProps) {
  return (
    <span
      aria-label={label}
      className={`inline-block size-1.5 shrink-0 rounded-full${className ? ` ${className}` : ''}`}
      role="img"
      style={{ backgroundColor: `var(${TONE_VAR[tone]})` }}
      title={label}
    />
  );
}
