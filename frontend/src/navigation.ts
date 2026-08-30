/**
 * Route paths and the primary navigation model.
 *
 * Declared in one place so the router, the top navigation and any programmatic
 * links (map marker -> investigation, alert row -> investigation) all agree.
 */

export const ROUTES = {
  dashboard: '/',
  investigation: '/investigation',
  analytics: '/analytics',
  alerts: '/alerts',
  investigator: '/investigator',
  status: '/status',
} as const;

/** Deep link to the investigation view for one hotspot. */
export function investigationPath(hotspotId: string): string {
  return `${ROUTES.investigation}/${encodeURIComponent(hotspotId)}`;
}

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  /** Longer description used as the link title attribute. */
  description: string;
}

/**
 * The five entries from the Stitch top bar, in their original order.
 *
 * Investigation is intentionally absent: it is a per-hotspot drill-down reached
 * from the dashboard, alerts or the investigator, exactly as in the designs.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    path: ROUTES.dashboard,
    label: 'Dashboard',
    icon: 'public',
    description: 'Main operations dashboard and thermal anomaly map',
  },
  {
    path: ROUTES.analytics,
    label: 'Analytics',
    icon: 'analytics',
    description: 'Aggregate analysis and pattern discovery',
  },
  {
    path: ROUTES.alerts,
    label: 'Alerts',
    icon: 'warning',
    description: 'Alert and risk centre',
  },
  {
    path: ROUTES.investigator,
    label: 'AI Investigator',
    icon: 'psychology',
    description: 'Structured evidence workstation',
  },
  {
    path: ROUTES.status,
    label: 'System Status',
    icon: 'monitor_heart',
    description: 'Backend health, dataset provenance and API diagnostics',
  },
];
