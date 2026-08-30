/**
 * Classification chip.
 *
 * Per DESIGN.md: square edges, a 10% tint of the class colour as background and
 * the full-opacity colour as text. The colour comes from the canonical
 * classification model, never from an inline literal.
 */
import type { CSSProperties } from 'react';
import { getClassification, isRecognisedClassification } from '../../domain/classification';
import { Icon } from './Icon';

export interface ClassificationBadgeProps {
  /** Raw classification string as returned by the backend. */
  classification: string | null | undefined;
  /** Use the abbreviated label, for dense tables and narrow panels. */
  short?: boolean;
  showIcon?: boolean;
  /** Colour swatch only, for map legends and list rows. */
  dotOnly?: boolean;
  className?: string;
}

export function ClassificationBadge({
  classification,
  short = false,
  showIcon = false,
  dotOnly = false,
  className,
}: ClassificationBadgeProps) {
  const definition = getClassification(classification);
  const color = `var(${definition.colorVar})`;
  const label = short ? definition.shortLabel : definition.label;

  // Surface unmapped backend labels rather than silently showing "Unknown".
  const unmapped = Boolean(classification) && !isRecognisedClassification(classification);
  const title = unmapped
    ? `Unrecognised classification from API: "${classification}"`
    : definition.label;

  if (dotOnly) {
    return (
      <span
        aria-label={definition.label}
        className={`inline-block size-2 shrink-0${className ? ` ${className}` : ''}`}
        role="img"
        style={{ backgroundColor: color }}
        title={title}
      />
    );
  }

  const style: CSSProperties = {
    color,
    backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
  };

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 border px-1.5 py-0.5 text-label uppercase${
        className ? ` ${className}` : ''
      }`}
      style={style}
      title={title}
    >
      {showIcon ? <Icon name={definition.icon} size={12} /> : null}
      <span className="truncate">{label}</span>
      {unmapped ? <span aria-hidden="true">*</span> : null}
    </span>
  );
}
