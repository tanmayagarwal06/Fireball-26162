/**
 * System Status.
 *
 * Fully functional in Phase 1. It is the console's diagnostics surface: backend
 * connectivity, the live endpoint inventory, the unfiltered dataset baseline
 * from `/statistics`, and an explicit record of the data limitations this
 * prototype operates under.
 *
 * The limitations panel is deliberate. A reviewer should be able to see exactly
 * which numbers are trustworthy and which are affected by known defects,
 * without reading the source.
 */
import { API_BASE_URL } from '../api/client';
import { getStatistics } from '../api/system';
import { CLASSIFICATIONS, parseClassification } from '../domain/classification';
import { formatCount } from '../domain/format';
import { PERSISTENCE_THRESHOLD_DAYS } from '../domain/persistence';
import { RISK_LEVEL_LIST } from '../domain/risk';
import { useAsync, type AsyncState } from '../hooks/useAsync';
import {
  HEALTH_POLL_INTERVAL_MS,
  useBackendStatus,
  type BackendStatus,
} from '../state/BackendStatusContext';
import type { StatisticsResponse } from '../types/api';
import { Icon } from '../components/ui/Icon';
import { Metric } from '../components/ui/Metric';
import { Panel } from '../components/ui/Panel';
import { ErrorState, LoadingState, SkeletonRows } from '../components/ui/States';
import { ProvenanceTag } from '../components/ui/ProvenanceTag';

/** Every route currently implemented in backend/app.py, verified against the server. */
const ENDPOINTS: Array<{ method: string; path: string; purpose: string }> = [
  { method: 'GET', path: '/', purpose: 'Service banner and docs link' },
  { method: 'GET', path: '/health', purpose: 'Liveness plus loaded record count' },
  { method: 'GET', path: '/hotspots', purpose: 'Hotspot list with eight server-side filters' },
  { method: 'GET', path: '/hotspots/{id}', purpose: 'Single complete hotspot record' },
  {
    method: 'GET',
    path: '/hotspots/{id}/explanation',
    purpose: 'Rule-based evidence summary (not model output)',
  },
  { method: 'GET', path: '/statistics', purpose: 'Dataset-wide aggregates, unfiltered' },
  { method: 'GET', path: '/alerts', purpose: 'Alerts derived from hotspots on each request' },
];

/**
 * Constraints that shape what the rest of the console is allowed to display.
 * Each one was confirmed against the running backend.
 */
const LIMITATIONS: Array<{ title: string; detail: string; severity: 'defect' | 'note' | 'fixed' }> = [
  {
    severity: 'fixed',
    title: 'Backend persistence calculation — resolved',
    detail:
      'get_persistence() in backend/app.py previously applied a truthiness test to persistence_7d, an integer day count, and returned the look-back window length instead. Every record has a non-zero value, so it returned 7 for all of them: /statistics reported all 11 hotspots as 7+ day persistent and ?min_persistence= matched the whole dataset. It now returns the real count. Verified: persistent_sources is 2 (H001 and H011), the distribution is 5 / 4 / 2, and ?min_persistence= returns 11 / 9 / 5 / 2 for thresholds 1 / 2 / 4 / 7. The client-side workaround has been removed and persistence filtering is served by the API.',
  },
  {
    severity: 'note',
    title: 'Dataset contains a single acquisition date',
    detail:
      'All records share acq_date 2026-08-27, so no genuine time series exists. Trend views will show a single bucket and state the limitation rather than invent history.',
  },
  {
    severity: 'note',
    title: 'No per-class probability distribution',
    detail:
      'The backend exposes one classification_confidence scalar. The six-class probability chart in the Stitch investigation design cannot be populated until the classification engine exists.',
  },
  {
    severity: 'note',
    title: 'Alerts are computed, not stored',
    detail:
      '/alerts recalculates from hotspot records on every request. There is no alert store, acknowledgement state or notification delivery.',
  },
  {
    severity: 'note',
    title: 'Static mock dataset',
    detail:
      'Records are read once from mock/hotspots.json at server startup. There is no live NASA FIRMS ingestion and no scheduled refresh.',
  },
];

export function SystemStatusPage() {
  const backend = useBackendStatus();
  const statistics = useAsync<StatisticsResponse>((signal) => getStatistics(signal));

  return (
    <div className="surface-grid flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex flex-col gap-gutter p-gutter">
        <ServicePanel backend={backend} />

        <div className="grid grid-cols-1 gap-gutter lg:grid-cols-2">
          <EndpointPanel />
          <BaselinePanel statistics={statistics} />
        </div>

        <LimitationsPanel />
      </div>
    </div>
  );
}

function ServicePanel({ backend }: { backend: BackendStatus }) {
  const connectivityColor =
    backend.tone === 'online'
      ? 'var(--color-status-online)'
      : backend.tone === 'offline'
        ? 'var(--color-status-offline)'
        : 'var(--color-status-pending)';

  return (
    <Panel
      actions={
        <button
          className="flex items-center gap-1 border border-outline-variant bg-surface-high px-2 py-0.5 text-label uppercase text-on-surface transition-colors hover:bg-surface-highest disabled:opacity-50"
          disabled={backend.isFetching}
          onClick={backend.refresh}
          type="button"
        >
          <Icon
            className={backend.isFetching ? 'animate-spin' : undefined}
            name="refresh"
            size={12}
          />
          {backend.isFetching ? 'Checking' : 'Re-check'}
        </button>
      }
      icon="monitor_heart"
      title="Backend service"
    >
      {backend.error ? (
        <div className="mb-gutter border border-error/40 bg-error/10 p-compact" role="alert">
          <p className="text-label uppercase text-error">Not reachable</p>
          <p className="mt-1 font-mono text-body-sm text-on-surface-variant">{backend.error}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-gutter md:grid-cols-4">
        <Metric
          label="Connectivity"
          provenance="DERIVED"
          text
          value={backend.label}
          valueColor={connectivityColor}
        />
        <Metric label="Service" provenance="API" text value={backend.health?.service ?? '—'} />
        <Metric
          label="Records loaded"
          provenance="API"
          size="lg"
          value={backend.health ? formatCount(backend.health.hotspots_loaded) : '—'}
        />
        <Metric
          hint={`Polled every ${HEALTH_POLL_INTERVAL_MS / 1000}s while the tab is visible`}
          label="Last checked"
          provenance="DERIVED"
          value={
            backend.lastCheckedAt
              ? backend.lastCheckedAt.toLocaleTimeString('en-GB', { hour12: false })
              : '—'
          }
        />
      </div>

      <div className="mt-gutter border-t border-outline-variant pt-gutter">
        <Metric
          hint="Override with VITE_API_BASE_URL in frontend/.env.local"
          label="Base URL"
          value={API_BASE_URL}
        />
      </div>
    </Panel>
  );
}

function EndpointPanel() {
  return (
    <Panel flush icon="api" title="Endpoint inventory">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Routes implemented by the backend, with their purpose</caption>
        <thead>
          <tr className="border-b border-outline-variant text-label uppercase text-on-surface-variant">
            <th className="px-gutter py-1.5 font-bold" scope="col">
              Method
            </th>
            <th className="px-gutter py-1.5 font-bold" scope="col">
              Path
            </th>
            <th className="px-gutter py-1.5 font-bold" scope="col">
              Purpose
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant">
          {ENDPOINTS.map((endpoint) => (
            <tr key={endpoint.path}>
              <td className="px-gutter py-1.5 font-mono text-body-sm text-outline">
                {endpoint.method}
              </td>
              <td className="px-gutter py-1.5 font-mono text-data text-primary">{endpoint.path}</td>
              <td className="px-gutter py-1.5 text-body-sm text-on-surface-variant">
                {endpoint.purpose}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function BaselinePanel({ statistics }: { statistics: AsyncState<StatisticsResponse> }) {
  return (
    <Panel
      actions={<ProvenanceTag provenance="API" />}
      icon="database"
      title="Dataset baseline — GET /statistics"
    >
      {statistics.isInitialLoading ? <LoadingState label="Loading statistics" /> : null}

      {statistics.status === 'error' && statistics.error ? (
        <ErrorState message={statistics.error} onRetry={statistics.refresh} />
      ) : null}

      {statistics.isFetching && !statistics.isInitialLoading && !statistics.data ? (
        <SkeletonRows rows={4} />
      ) : null}

      {statistics.data ? <Baseline data={statistics.data} /> : null}
    </Panel>
  );
}

function Baseline({ data }: { data: StatisticsResponse }) {
  const classificationEntries = Object.entries(data.classification_distribution).sort(
    ([, a], [, b]) => b - a,
  );

  const maxClassificationCount = Math.max(1, ...classificationEntries.map(([, count]) => count));

  return (
    <div className="flex flex-col gap-gutter">
      <div className="grid grid-cols-2 gap-gutter">
        <Metric
          label="Total detections"
          size="lg"
          value={formatCount(data.summary.total_detections)}
        />
        <Metric
          hint="risk_score >= 80"
          label="High risk"
          size="lg"
          value={formatCount(data.summary.high_risk)}
          valueColor="var(--color-risk-high)"
        />
        <Metric
          hint="inside_industrial_polygon"
          label="Industrial-linked"
          size="lg"
          value={formatCount(data.summary.industrial_linked)}
        />
        <Metric
          hint={`Detected on ${PERSISTENCE_THRESHOLD_DAYS}+ days`}
          label="Persistent sources"
          provenance="API"
          size="lg"
          value={formatCount(data.summary.persistent_sources)}
          valueColor="var(--color-class-persistent)"
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-outline-variant pt-gutter">
        <h3 className="text-label uppercase text-on-surface-variant">Classification distribution</h3>
        {classificationEntries.map(([label, count]) => {
          const definition = CLASSIFICATIONS[parseClassification(label)];
          return (
            <div className="flex items-center gap-2" key={label}>
              <span className="w-40 shrink-0 truncate text-body-sm text-on-surface">{label}</span>
              <div className="h-2 flex-1 bg-surface-lowest">
                <div
                  className="h-full"
                  style={{
                    backgroundColor: `var(${definition.colorVar})`,
                    width: `${(count / maxClassificationCount) * 100}%`,
                  }}
                />
              </div>
              <span className="w-8 shrink-0 text-right font-mono text-data text-on-surface">
                {count}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 border-t border-outline-variant pt-gutter">
        <h3 className="text-label uppercase text-on-surface-variant">
          Risk distribution — backend buckets
        </h3>
        <p className="text-body-sm text-on-surface-variant">
          The backend groups risk into three bands. The console presents four
          {' ('}
          {RISK_LEVEL_LIST.map((level) => level.label).join(', ')}
          {') '}
          so that Critical and High together equal the backend&apos;s high-risk total.
        </p>
        <div className="flex flex-wrap gap-gutter">
          {Object.entries(data.risk_distribution).map(([band, count]) => (
            <Metric key={band} label={band} value={formatCount(count)} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-outline-variant pt-gutter">
        <h3 className="text-label uppercase text-on-surface-variant">Industrial proximity</h3>
        <div className="flex flex-wrap gap-gutter">
          {Object.entries(data.industrial_proximity).map(([band, count]) => (
            <Metric key={band} label={band} value={formatCount(count)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LimitationsPanel() {
  return (
    <Panel icon="rule" title="Known data limitations">
      <p className="mb-gutter text-body-sm text-on-surface-variant">
        Verified against the running backend. These constrain what the other screens are permitted
        to display.
      </p>

      <ul className="flex flex-col divide-y divide-outline-variant">
        {LIMITATIONS.map((limitation) => (
          <li className="flex gap-gutter py-2 first:pt-0 last:pb-0" key={limitation.title}>
            <Icon
              className={
                limitation.severity === 'defect'
                  ? 'text-error'
                  : limitation.severity === 'fixed'
                    ? 'text-[var(--color-status-online)]'
                    : 'text-tertiary'
              }
              name={
                limitation.severity === 'defect'
                  ? 'bug_report'
                  : limitation.severity === 'fixed'
                    ? 'check_circle'
                    : 'info'
              }
              size={16}
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body-sm font-semibold text-on-surface">{limitation.title}</span>
              <span className="text-body-sm text-on-surface-variant">{limitation.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
