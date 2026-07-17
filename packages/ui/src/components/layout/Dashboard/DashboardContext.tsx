'use client';

import { createContext, useContext } from 'react';

/**
 * Value shared across every `Dashboard` sub-component through React context.
 *
 * The root `<Dashboard>` owns this state; opt-in parts such as
 * `<Dashboard.FilterToggle>` and `<Dashboard.Filters>` read from and write to
 * it so they stay in sync without the caller wiring anything up. Nothing here
 * is required — a `Dashboard` composed of only a `<Dashboard.Header>` simply
 * never touches the filter fields.
 */
export interface DashboardContextValue {
  /** Whether the `<Dashboard.Filters>` region is currently expanded. */
  filtersVisible: boolean;
  /** Toggles {@link filtersVisible}. Bound to `<Dashboard.FilterToggle>`. */
  toggleFilters: () => void;
  /** Whether the advanced `<Dashboard.MoreFilters>` panel is expanded. */
  moreFiltersOpen: boolean;
  /** Toggles {@link moreFiltersOpen}. Bound to `<Dashboard.MoreFiltersToggle>`. */
  toggleMoreFilters: () => void;
  /**
   * Count of active filters, surfaced as a badge on `<Dashboard.FilterToggle>`.
   * Supplied by the caller via the `activeFilterCount` prop on `<Dashboard>`.
   */
  activeFilterCount: number;
  /** Stable prefix for `data-testid` attributes across sub-components. */
  testIdPrefix: string;
}

/** Backing context. `null` when a sub-component is used outside `<Dashboard>`. */
export const DashboardContext = createContext<DashboardContextValue | null>(null);

/**
 * Reads the nearest {@link DashboardContext}.
 *
 * @throws If called outside a `<Dashboard>` provider.
 * @returns The current dashboard context value.
 */
export function useDashboardContext(): DashboardContextValue {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('Dashboard sub-components must be used within a <Dashboard>');
  }
  return context;
}
