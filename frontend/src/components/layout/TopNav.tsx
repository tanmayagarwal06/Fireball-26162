/**
 * Persistent top navigation, 48px tall per the Stitch toolbar-width token.
 *
 * Carries the product identity, the five primary views and the live backend
 * status indicator. The status indicator reflects a real `/health` poll — it is
 * not decorative.
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
    <header className="flex h-toolbar shrink-0 items-center justify-between gap-4 border-b border-outline-variant bg-background px-gutter">
      <div className="flex min-w-0 items-center gap-4">
        <button
          aria-controls="primary-navigation"
          aria-expanded={navOpen}
          aria-label="Toggle navigation"
          className="flex size-7 items-center justify-center border border-outline-variant text-on-surface-variant transition-colors hover:bg-surface-high md:hidden"
          onClick={onToggleNav}
          type="button"
        >
          <Icon name={navOpen ? 'close' : 'menu'} size={18} />
        </button>

        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-headline font-bold uppercase tracking-tight text-on-surface">
            Thermal Intelligence
          </span>
          {/* States the problem statement without implying a live data feed. */}
          <span className="hidden font-mono text-body-sm text-outline lg:inline">SIH26162</span>
        </div>

        <nav aria-label="Primary" className="hidden h-full items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink
              className={({ isActive }) =>
                [
                  'flex h-full items-center gap-1.5 border-b-2 px-2 text-body-sm transition-colors',
                  isActive
                    ? 'border-primary font-semibold text-primary'
                    : 'border-transparent text-on-surface-variant hover:bg-surface-high hover:text-on-surface',
                ].join(' ')
              }
              end={item.path === '/'}
              key={item.path}
              title={item.description}
              to={item.path}
            >
              <Icon name={item.icon} size={14} />
              <span className="whitespace-nowrap">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div
          className="flex items-center gap-1.5 border border-outline-variant bg-surface-container px-2 py-1"
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
