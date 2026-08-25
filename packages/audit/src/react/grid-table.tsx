/**
 * The TABLE the trail renders on, and the seam a host replaces it through.
 *
 * `DataViewsTableBase` is framework-agnostic by construction: it takes its
 * saved-view persistence and its router side-effects as injected props, because
 * neither is knowable from inside a component tree. That is the same boundary
 * this package already draws for filters — a package cannot know the host's
 * router — so the two are answered the same way: the host passes the table it
 * already wired for every other list, and the trail renders on it.
 *
 * A host that passes nothing still gets a grid. {@link StandaloneAuditTable}
 * binds the base with persistence that REFUSES and a router that does nothing,
 * which is the honest shape of "no saved views here": the toolbar's save
 * controls are present but report why they cannot, rather than a screen that
 * silently forgets what a reader named. It is the fallback for an embedded
 * trail and for this package's own suites — not the recommended adoption.
 */
import type { ComponentType, JSX } from 'react';

import {
  DataViewsTableBase,
  type DataViewsTableBaseProps,
  type DataViewMutationResult,
  type DataViewPersistence,
  type DataViewRouter,
} from '@12-apps/ui/data-display/DataViews';

import type { AuditRow } from './grid-rows';

/**
 * Everything the trail hands its table — the base's props MINUS the three the
 * host injects. A host binds its own wrapper (tenant, scope, `?view=` sync,
 * REST persistence) and passes the result as {@link AuditWebConfig.table}.
 */
export type AuditTableProps = Omit<
  DataViewsTableBaseProps<AuditRow>,
  'persistence' | 'router' | 'initialViewId'
>;

/** The component shape a host binds its wired DataViews table into. */
export type AuditTableComponent = ComponentType<AuditTableProps>;

/**
 * Saved views need a backend. With none wired, every mutation reports that in
 * the host's own words rather than resolving `{ ok: true }` over a write that
 * never happened — the base renders the message beside the control that asked.
 */
function inertPersistence(message: string): DataViewPersistence {
  const refuse = (): Promise<DataViewMutationResult> =>
    Promise.resolve({ ok: false, error: message });
  return { create: refuse, update: refuse, remove: refuse };
}

/** No router to sync `?view=` into, and nothing to re-fetch views from. */
const NO_ROUTER: DataViewRouter = {
  syncViewParam: () => undefined,
  refresh: () => undefined,
};

export interface StandaloneAuditTableProps extends AuditTableProps {
  /** What a saved-view mutation reports when no host persistence is wired. */
  viewsUnavailable: string;
}

export function StandaloneAuditTable({
  viewsUnavailable,
  ...props
}: StandaloneAuditTableProps): JSX.Element {
  return (
    <DataViewsTableBase<AuditRow>
      {...props}
      initialViewId={null}
      persistence={inertPersistence(viewsUnavailable)}
      router={NO_ROUTER}
    />
  );
}
