'use client';

import { createContext, useContext } from 'react';

import type { TableFilterCopy } from '../../../copy';

/** Open/close + active state shared by every `TableFilter` compound part. */
export interface TableFilterContextValue {
  /** Whether the filter panel is expanded. */
  open: boolean;
  /** Toggle the panel open/closed. */
  onOpenChange: (open: boolean) => void;
  /** When true, the trigger shows a filled indicator dot. */
  hasActiveFilters: boolean;
  /**
   * Every word the compound's parts render. Carried on the root's context
   * rather than on each part's props because the parts are a TREE — a host
   * composes `Panel`, `Keyword` and the fields under one root, and asking each
   * one separately for its share of the same table is the shape that makes a
   * host answer four times and get one of them wrong.
   */
  copy: TableFilterCopy;
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
