"use client";

import { useEffect, useRef } from "react";

import type { DataViewServer, DataViewState } from "./data-views-types";

/**
 * Server-mode wiring extracted from {@link useDataViewsState} (keeps it within
 * the size/complexity budget): re-fetch on every effective-query change (page
 * resets to 1) and expose `changePage` for the pagination control. Read the
 * latest `state`/`server` at fire time so an inline `server` object per render
 * doesn't loop the effect.
 */
export function useServerQuery(
  server: DataViewServer | undefined,
  state: DataViewState,
  scope: string | undefined,
): {
  changePage: (page: number) => void;
} {
  const emit = (page: number): void => {
    if (!server) return;
    server.onQueryChange({
      search: state.search,
      pills: state.pills,
      ranges: state.ranges ?? {},
      sortBy: state.sortBy,
      // Spread rather than `scope: scope`: a table declaring no scopes must emit
      // a query with NO `scope` key at all, not one present-and-undefined that
      // every host would then have to know to ignore.
      ...(scope !== undefined ? { scope } : {}),
      page,
      pageSize: server.pageSize,
    });
  };
  const queryKey = server
    ? JSON.stringify({
        q: state.search,
        pills: state.pills,
        ranges: state.ranges ?? {},
        sort: state.sortBy,
        // The RESOLVED scope, so a deep link naming a removed scope re-fetches
        // once for the fallback rather than looping on the stored id.
        scope,
      })
    : "";
  const firstQuery = useRef(true);
  useEffect(() => {
    if (!server) return;
    if (firstQuery.current) {
      firstQuery.current = false;
      return;
    }
    emit(1);
    // Emit only when the query key changes; `emit` reads fresh state at fire time.
  }, [queryKey]);
  return { changePage: (page: number) => emit(page) };
}

/** The controller's server-mode derived fields (or client-mode defaults). */
export function serverDerived(
  server: DataViewServer | undefined,
  fallbackCount: number,
): { serverMode: boolean; serverPage: number; serverPageCount: number; serverTotalCount: number } {
  if (!server) {
    return { serverMode: false, serverPage: 1, serverPageCount: 1, serverTotalCount: fallbackCount };
  }
  return {
    serverMode: true,
    serverPage: server.page,
    serverPageCount: Math.max(1, Math.ceil(server.totalCount / server.pageSize)),
    serverTotalCount: server.totalCount,
  };
}

