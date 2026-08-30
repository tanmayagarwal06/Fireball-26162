/**
 * Level-1 container: 1px border, square corners, tonal fill, no shadow.
 * This is the only bordered box the console uses, so panel chrome stays uniform
 * across all five screens.
 */
import type { ReactNode } from 'react';
import { Icon } from './Icon';

export interface PanelProps {
  /** Rendered as an uppercase label-caps heading in the panel header. */
  title?: string;
  /** Material Symbols ligature shown before the title. */
  icon?: string;
  /** Controls or provenance tags aligned to the right of the header. */
  actions?: ReactNode;
  children: ReactNode;
  /** Removes the body padding, for tables and maps that bleed to the edge. */
  flush?: boolean;
  /** Lets the panel body scroll instead of growing. */
  scroll?: boolean;
  className?: string;
}

export function Panel({
  title,
  icon,
  actions,
  children,
  flush = false,
  scroll = false,
  className,
}: PanelProps) {
  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col border border-outline-variant bg-surface-container${
        className ? ` ${className}` : ''
      }`}
    >
      {title ? (
        <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-outline-variant bg-surface-low px-compact">
          <h2 className="flex items-center gap-1.5 text-label uppercase text-on-surface-variant">
            {icon ? <Icon name={icon} size={14} /> : null}
            <span className="truncate">{title}</span>
          </h2>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}

      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col${flush ? '' : ' p-gutter'}${
          scroll ? ' overflow-auto' : ''
        }`}
      >
        {children}
      </div>
    </section>
  );
}
