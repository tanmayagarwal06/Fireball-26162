/**
 * State persisted to localStorage.
 *
 * Used for investigation notes. Notes that vanished on reload would be a control
 * pretending to work, so they are genuinely persisted — and the UI states that
 * they live in this browser only, with no server-side storage behind them.
 */
import { useCallback, useEffect, useState } from 'react';

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T) => void, () => void] {
  const [value, setValue] = useState<T>(() => {
    // Private-browsing modes and disabled storage both throw on access.
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initialValue : (JSON.parse(stored) as T);
    } catch {
      return initialValue;
    }
  });

  // Re-read when the key changes, e.g. when a different hotspot is selected.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      setValue(stored === null ? initialValue : (JSON.parse(stored) as T));
    } catch {
      setValue(initialValue);
    }
    // initialValue is intentionally excluded: it is a constant default and
    // including it would reset state on every render for object literals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage unavailable or quota exceeded: keep the in-memory value.
      }
    },
    [key],
  );

  const clear = useCallback(() => {
    setValue(initialValue);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing to recover from.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, update, clear];
}
