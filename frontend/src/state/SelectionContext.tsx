/**
 * The currently selected hotspot, shared application-wide.
 *
 * Selecting a marker on the dashboard carries through to the investigator and
 * back, so an operator never loses their place when switching screens.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export interface SelectionContextValue {
  selectedId: string | null;
  select: (id: string | null) => void;
  /** Selecting the already-selected hotspot clears it. */
  toggle: (id: string) => void;
  clear: () => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => setSelectedId(id), []);

  const toggle = useCallback((id: string) => {
    setSelectedId((current) => (current === id ? null : id));
  }, []);

  const clear = useCallback(() => setSelectedId(null), []);

  const value = useMemo<SelectionContextValue>(
    () => ({ selectedId, select, toggle, clear }),
    [selectedId, select, toggle, clear],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionContextValue {
  const context = useContext(SelectionContext);
  if (!context) throw new Error('useSelection must be used inside a SelectionProvider.');
  return context;
}
