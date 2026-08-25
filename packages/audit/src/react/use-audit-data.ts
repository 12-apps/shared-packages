/**
 * The viewer's two reads: the page for a filter set, and the actor roster.
 *
 * The page hook KEEPS THE LAST GOOD PAGE while the next one is in flight, which
 * the hand-rolled screen this replaces did not need and the grid does. A
 * `DataViews` table holds real interaction state — an open filter menu, a
 * focused search box, a selection, the display panel — and unmounting it on
 * every request throws all of that away: typing a third character into the
 * search would close the box it was typed into. Every other server-driven list
 * in an adopting host keeps the previous page on screen for exactly this
 * reason; this is that behaviour, without the query library.
 */
import { useEffect, useState } from 'react';

import type {
  AuditActorOptionWire,
  AuditLogFilters,
  AuditLogPageWire,
} from '../core/types';

import type { AuditApiClient } from './api';

interface AuditPageState {
  /** The most recent page that LOADED — kept across a refetch. */
  page: AuditLogPageWire | null;
  /** The failure in force, or `null`. Cleared by a successful read. */
  error: string | null;
  /** A request is in flight (which does not mean the screen is empty). */
  loading: boolean;
}

/**
 * The page for one filter set.
 *
 * The dependency is the SERIALIZED filter set, deliberately, and not `filters`
 * itself: the fetch must re-run when a filter VALUE changes, not when a
 * controlled host hands over a new object literal carrying the same values —
 * which it does on every one of its own renders, and which would refetch the
 * page each time.
 */
export function useAuditPage(
  api: AuditApiClient,
  filters: AuditLogFilters,
  errorTitle: string,
  reloadToken: number,
): AuditPageState {
  const [state, setState] = useState<AuditPageState>({
    page: null,
    error: null,
    loading: true,
  });
  const query = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true }));
    api
      // Read back out of the serialized form the dependency is keyed on, so the
      // request and the cache key can never describe different filters.
      // `AuditLogFilters` is JSON-safe by construction (strings, numbers,
      // string arrays — the day bounds are `YYYY-MM-DD`, not Dates), so the
      // round trip is lossless.
      .listEntries(JSON.parse(query) as AuditLogFilters)
      .then((page) => {
        if (!cancelled) setState({ page, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState((previous) => ({
          // The stale page stays: a failed refetch of page 4 must not blank the
          // trail, and the error panel says which read failed.
          page: previous.page,
          error: error instanceof Error ? error.message : errorTitle,
          loading: false,
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [api, query, reloadToken, errorTitle]);

  return state;
}

/**
 * The actor-filter options, fetched once per client.
 *
 * A failure is swallowed into an empty list: the options are an affordance, not
 * the data — a host with no directory answers empty, and a failure here must
 * not take the trail down with it. The actor pill is then not offered at all,
 * and an id pasted from another system still matches through the search box.
 */
export function useActorOptions(api: AuditApiClient): readonly AuditActorOptionWire[] {
  const [actors, setActors] = useState<readonly AuditActorOptionWire[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .listActors()
      .then((options) => {
        if (!cancelled) setActors(options);
      })
      .catch(() => {
        if (!cancelled) setActors([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return actors;
}
