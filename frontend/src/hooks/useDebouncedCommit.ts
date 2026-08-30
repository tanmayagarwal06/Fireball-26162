/**
 * Local value that commits upstream after a pause.
 *
 * Range inputs fire on every pixel of travel. Committing each one would issue a
 * request per frame, so the slider stays responsive locally and only pushes the
 * value — and therefore only refetches — once the operator stops moving it.
 */
import { useEffect, useRef, useState } from 'react';

export function useDebouncedCommit<T>(
  externalValue: T,
  commit: (value: T) => void,
  delayMs = 300,
): [T, (value: T) => void] {
  const [localValue, setLocalValue] = useState(externalValue);
  const isEditing = useRef(false);

  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Accept external changes (a filter reset, for example) unless the operator is
  // mid-drag, in which case their input wins.
  useEffect(() => {
    if (!isEditing.current) setLocalValue(externalValue);
  }, [externalValue]);

  useEffect(() => {
    if (!isEditing.current) return;

    const timer = window.setTimeout(() => {
      isEditing.current = false;
      commitRef.current(localValue);
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [localValue, delayMs]);

  const update = (value: T) => {
    isEditing.current = true;
    setLocalValue(value);
  };

  return [localValue, update];
}
