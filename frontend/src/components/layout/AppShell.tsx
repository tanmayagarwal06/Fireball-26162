/**
 * Application shell.
 *
 * A fixed-viewport frame: 48px top navigation, a fluid content region that owns
 * its own scrolling, and a 24px status strip. Screens render into <Outlet /> and
 * are responsible for their own internal layout, which is what lets the
 * dashboard hand the full content region to the map.
 */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { NAV_ITEMS } from '../../navigation';
import { useBackendStatus } from '../../state/BackendStatusContext';
import { Icon } from '../ui/Icon';
import { StatusStrip } from './StatusStrip';
import { TopNav } from './TopNav';

export function AppShell() {
  const status = useBackendStatus();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile drawer after navigating, so it never covers the new screen.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-on-surface">
      {/*
        Skip link. The dashboard puts a filter rail and a map between the nav and
        the primary content, which is a long tab journey for keyboard users.
      */}
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[1000] focus:border focus:border-on-surface focus:bg-surface-container focus:px-3 focus:py-1.5 focus:text-label focus:uppercase focus:text-on-surface"
        href="#main-content"
      >
        Skip to main content
      </a>

      <TopNav
        backendLabel={status.label}
        backendTone={status.tone}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((open) => !open)}
      />

      {/* Narrow-width navigation drawer. Hidden entirely at md and above. */}
      {navOpen ? (
        <nav
          aria-label="Primary"
          className="shrink-0 border-b border-outline-variant bg-surface-container md:hidden"
          id="primary-navigation"
        >
          {NAV_ITEMS.map((item) => (
            <NavLink
              className={({ isActive }) =>
                [
                  'flex items-center gap-2 border-b border-outline-variant px-gutter py-2 text-body-sm transition-colors last:border-b-0',
                  isActive
                    ? 'bg-surface-high font-semibold text-primary'
                    : 'text-on-surface-variant hover:bg-surface-high hover:text-on-surface',
                ].join(' ')
              }
              end={item.path === '/'}
              key={item.path}
              to={item.path}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      ) : null}

      <main
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        id="main-content"
        tabIndex={-1}
      >
        <Outlet />
      </main>

      <StatusStrip
        error={status.error}
        health={status.health}
        isFetching={status.isFetching}
        label={status.label}
        lastCheckedAt={status.lastCheckedAt}
        onRefresh={status.refresh}
        tone={status.tone}
      />
    </div>
  );
}
