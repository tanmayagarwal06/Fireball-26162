/**
 * Minimal async-resource hook.
 *
 * Deliberately not a data-fetching library. The console makes a handful of
 * requests against a local mock API; adding TanStack Query would be weight
 * without benefit. This covers the four states every screen needs — idle,
 * loading, success, error — plus cancellation and manual refresh.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toErrorMessage } from '../api/client';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  status: AsyncStatus;
  /** True only on the very first load, so refreshes don't blank the screen. */
  isInitialLoading: boolean;
  /** True while any request is in flight, including background refreshes. */
  isFetching: boolean;
  /** Re-run the request, keeping the previous data visible until it resolves. */
  refresh: () => void;
}

export interface UseAsyncOptions {
  /**
   * Re-runs the request whenever any entry changes. Compared by value after
   * JSON serialisation, so plain filter objects can be passed without
   * memoising them at every call site.
   */
  deps?: unknown[];
  /** Set false to hold the request until a precondition is met. */
  enabled?: boolean;
}

export function useAsync<T>(
  task: (signal: AbortSignal) => Promise<T>,
  options: UseAsyncOptions = {},
): AsyncState<T> {
  const { deps = [], enabled = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AsyncStatus>(enabled ? 'loading' : 'idle');
  const [isFetching, setIsFetching] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const hasLoadedOnce = useRef(false);

  // Keep the latest task without making it a dependency: an inline arrow
  // function would otherwise re-trigger the effect on every render.
  const taskRef = useRef(task);
  taskRef.current = task;

  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      setIsFetching(false);
      return;
    }

    const controller = new AbortController();
    let active = true;

    setIsFetching(true);
    if (!hasLoadedOnce.current) setStatus('loading');

    taskRef
      .current(controller.signal)
      .then((result) => {
        if (!active) return;
        hasLoadedOnce.current = true;
        setData(result);
        setError(null);
        setStatus('success');
      })
      .catch((cause: unknown) => {
        // An abort is a normal consequence of unmount or a superseded request.
        if (!active || controller.signal.aborted) return;
        setError(toErrorMessage(cause));
        setStatus('error');
      })
      .finally(() => {
        if (active) setIsFetching(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // depsKey is the serialised form of the caller's deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey, enabled, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return {
    data,
    error,
    status,
    isInitialLoading: status === 'loading' && !hasLoadedOnce.current,
    isFetching,
    refresh,
  };
}
