/**
 * Material Symbols Outlined wrapper.
 *
 * The Stitch designs use this icon font throughout, so matching it preserves
 * visual fidelity without pulling in an icon package. Icons are decorative here
 * — every icon in the console sits beside a text label — so they are hidden from
 * assistive technology. When an icon is the only content of a control, put an
 * aria-label on the control itself.
 */
import type { CSSProperties } from 'react';

export interface IconProps {
  /** Material Symbols ligature name, e.g. "warning". */
  name: string;
  /** Rendered size in px. Defaults to 16 to suit the dense layout. */
  size?: number;
  filled?: boolean;
  className?: string;
}

export function Icon({ name, size = 16, filled = false, className }: IconProps) {
  const style: CSSProperties = {
    fontSize: `${size}px`,
    width: `${size}px`,
    height: `${size}px`,
  };

  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined shrink-0 select-none${className ? ` ${className}` : ''}`}
      data-filled={filled ? 'true' : undefined}
      style={style}
    >
      {name}
    </span>
  );
}
