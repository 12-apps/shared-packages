'use client';

import { createContext, useContext } from 'react';

/** Open/close + active state shared by every `TableFilter` compound part. */
export interface TableFilterContextValue {
  /** Whether the filter panel is expanded. */
  open: boolean;
  /** Toggle the panel open/closed. */
  onOpenChange: (open: boolean) => void;
  /** When true, the trigger shows a filled indicator dot. */
  hasActiveFilters: boolean;
}

/** Backing context. `null` outside a `<TableFilter>` root. */
export const TableFilterContext = createContext<TableFilterContextValue | null>(null);

/**
 * Reads the nearest {@link TableFilterContext}.
 *
 * @throws If used outside `<TableFilter>`.
 */
export function useTableFilterContext(): TableFilterContextValue {
  const context = useContext(TableFilterContext);
  if (!context) {
    throw new Error('TableFilter compound components must be rendered inside <TableFilter>');
  }
  return context;
}
