/**
 * Persistent top navigation, 52px tall per the toolbar token.
 *
 * Carries the product identity (ember mark + wordmark), the five primary views
 * as a pill group, and the live backend status. The status indicator reflects
 * a real `/health` poll — it is not decorative.
 */
import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from '../../navigation';
import { Icon } from '../ui/Icon';
import { StatusDot, type StatusTone } from '../ui/StatusDot';

export interface TopNavProps {
  backendTone: StatusTone;
  backendLabel: string;
  /** Opens the mobile navigation drawer at narrow widths. */
  onToggleNav: () => void;
  navOpen: boolean;
}

export function TopNav({ backendTone, backendLabel, onToggleNav, navOpen }: TopNavProps) {
  return (
    <header className="flex h-toolbar shrink-0 items-center justify-between gap-4 border-b border-outline-variant bg-background/95 px-gutter backdrop-blur">
      <div className="flex min-w-0 items-center gap-5">
        <button
          aria-controls="primary-navigation"
          aria-expanded={navOpen}
          aria-label="Toggle navigation"
          className="flex size-8 items-center justify-center border border-outline-variant text-on-surface-variant hover:bg-surface-high md:hidden"
          onClick={onToggleNav}
          type="button"
        >
          <Icon name={navOpen ? 'close' : 'menu'} size={18} />
        </button>

        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="ember-mark size-3 shrink-0 rounded-full" />
          <span className="truncate text-headline text-on-surface">Thermal Intelligence</span>
          {/* States the problem statement without implying a live data feed. */}
          <span className="hidden rounded-[4px] border border-outline-variant px-1.5 font-mono text-[10px] leading-[16px] tracking-[0.04em] text-outline lg:inline">
            SIH26162
          </span>
        </div>

        <nav
          aria-label="Primary"
          className="hidden items-center gap-0.5 rounded-[var(--radius-md)] border border-outline-variant bg-surface-low/70 p-0.5 md:flex"
        >
          {NAV_ITEMS.map((item) => (
            <NavLink
              className={({ isActive }) =>
                [
                  'flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-body-sm transition-colors',
                  isActive
                    ? 'bg-surface-highest font-medium text-on-surface shadow-[inset_0_1px_0_rgb(255_255_255_/_0.06)]'
                    : 'text-on-surface-variant hover:bg-surface-high hover:text-on-surface',
                ].join(' ')
              }
              end={item.path === '/'}
              key={item.path}
              title={item.description}
              to={item.path}
            >
              <Icon className="text-outline" name={item.icon} size={14} />
              <span className="whitespace-nowrap">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div
          className="flex h-7 items-center gap-2 rounded-[var(--radius-sm)] border border-outline-variant bg-surface-low/70 px-2.5"
          title={`Backend connectivity: ${backendLabel}`}
        >
          <StatusDot label={`Backend ${backendLabel}`} tone={backendTone} />
          <span className="hidden text-label uppercase text-on-surface-variant sm:inline">
            API {backendLabel}
          </span>
        </div>
      </div>
    </header>
  );
}
