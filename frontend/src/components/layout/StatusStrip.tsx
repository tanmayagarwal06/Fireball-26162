/**
 * Bottom status strip.
 *
 * Every value here is real: connectivity comes from `/health`, the record count
 * is the backend's own `hotspots_loaded`, and the data source is stated plainly
 * as a file-backed pipeline export. This is where the console is honest about what it is
 * connected to, which matters more than a polished number would.
 */
import { API_BASE_URL } from '../../api/client';
import type { HealthResponse } from '../../types/api';
import { formatCount } from '../../domain/format';
import { Icon } from '../ui/Icon';
import { StatusDot, type StatusTone } from '../ui/StatusDot';

export interface StatusStripProps {
  health: HealthResponse | null;
  tone: StatusTone;
  label: string;
  error: string | null;
  isFetching: boolean;
  onRefresh: () => void;
  /** Timestamp of the last successful /health response. */
  lastCheckedAt: Date | null;
}

function formatClock(date: Date | null): string {
  if (!date) return '—';
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

export function StatusStrip({
  health,
  tone,
  label,
  error,
  isFetching,
  onRefresh,
  lastCheckedAt,
}: StatusStripProps) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 overflow-x-auto border-t border-outline-variant bg-surface-low/80 px-gutter">
      <div className="flex shrink-0 items-center gap-1.5">
        <StatusDot label={`Backend ${label}`} tone={tone} />
        <span className="text-label uppercase text-on-surface-variant">{label}</span>
      </div>

      <Divider />

      <span
        className="shrink-0 font-mono text-body-sm text-outline"
        title="Backend base URL. Override with VITE_API_BASE_URL."
      >
        {API_BASE_URL}
      </span>

      <Divider />

      {/* Named explicitly as a file-backed export — there is no live FIRMS ingestion. */}
      <span
        className="shrink-0 text-label uppercase text-on-surface-variant"
        title="Records loaded by the backend at startup from data/hotspots.json, a capped export of the latest 7-day window produced by src/run_pipeline.py. Not a live NASA FIRMS feed."
      >
        Source: pipeline export
        {health ? (
          <span className="ml-1.5 font-mono normal-case text-on-surface">
            {formatCount(health.hotspots_loaded)} records
          </span>
        ) : null}
      </span>

      {error ? (
        <>
          <Divider />
          <span className="min-w-0 truncate text-body-sm text-error" title={error}>
            {error}
          </span>
        </>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <span className="font-mono text-body-sm text-outline" title="Time of the last /health check">
          Checked {formatClock(lastCheckedAt)}
        </span>
        <button
          aria-label="Re-check backend health"
          className="flex h-5 items-center gap-1 rounded-[4px] border border-outline-variant px-1.5 text-label uppercase text-on-surface-variant hover:bg-surface-high hover:text-on-surface disabled:opacity-50"
          disabled={isFetching}
          onClick={onRefresh}
          type="button"
        >
          <Icon className={isFetching ? 'animate-spin' : undefined} name="refresh" size={12} />
          <span className="hidden sm:inline">{isFetching ? 'Checking' : 'Re-check'}</span>
        </button>
      </div>
    </footer>
  );
}

function Divider() {
  return <span aria-hidden="true" className="h-3 w-px shrink-0 bg-outline-variant" />;
}
