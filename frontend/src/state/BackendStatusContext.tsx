/**
 * Backend connectivity, shared application-wide.
 *
 * Polls `GET /health` on a fixed interval so the shell can show whether the
 * FastAPI process is actually reachable. Held in one context so the top nav, the
 * status strip and the System Status screen all read the same result instead of
 * each issuing their own request.
 *
 * This is a health check only. It does not imply live satellite ingestion — the
 * backend serves a file-backed export loaded once at startup.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getHealth } from '../api/system';
import { useAsync } from '../hooks/useAsync';
import type { HealthResponse } from '../types/api';
import type { StatusTone } from '../components/ui/StatusDot';

/** How often connectivity is re-checked, in milliseconds. */
export const HEALTH_POLL_INTERVAL_MS = 30_000;

export interface BackendStatus {
  health: HealthResponse | null;
  error: string | null;
  tone: StatusTone;
  /** "ONLINE" | "OFFLINE" | "CHECKING" */
  label: string;
  isFetching: boolean;
  lastCheckedAt: Date | null;
  refresh: () => void;
}

const BackendStatusContext = createContext<BackendStatus | null>(null);

export function BackendStatusProvider({ children }: { children: ReactNode }) {
  const { data, error, status, isFetching, refresh } = useAsync<HealthResponse>(
    (signal) => getHealth(signal),
  );

  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (status === 'success') setLastCheckedAt(new Date());
  }, [status, data]);

  // Keep the latest refresh callback out of the interval's dependency list so the
  // timer is created once rather than reset on every render.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const timer = window.setInterval(() => {
      // Skip polling while the tab is hidden; there is nothing to observe.
      if (document.visibilityState === 'visible') refreshRef.current();
    }, HEALTH_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, []);

  const value = useMemo<BackendStatus>(() => {
    let tone: StatusTone = 'pending';
    let label = 'Checking';

    if (status === 'error') {
      tone = 'offline';
      label = 'Offline';
    } else if (status === 'success') {
      const healthy = data?.status === 'ok';
      tone = healthy ? 'online' : 'pending';
      label = healthy ? 'Online' : 'Degraded';
    }

    return {
      health: data,
      error,
      tone,
      label: label.toUpperCase(),
      isFetching,
      lastCheckedAt,
      refresh,
    };
  }, [data, error, status, isFetching, lastCheckedAt, refresh]);

  return <BackendStatusContext.Provider value={value}>{children}</BackendStatusContext.Provider>;
}

export function useBackendStatus(): BackendStatus {
  const context = useContext(BackendStatusContext);

  if (!context) {
    throw new Error('useBackendStatus must be used inside a BackendStatusProvider.');
  }

  return context;
}
