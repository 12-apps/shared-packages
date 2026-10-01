"use client";

import { useEffect, useRef, useState } from "react";

import type { RangeValue } from "./data-views-range-types";
import type { DataViewServer, DataViewState, DataViewSyncState } from "./data-views-types";

/**
 * A server-mode grid's URL round trip, and the echo it must not re-apply.
 *
 * A server-mode host mirrors the grid's query into its URL and hands it back as
 * `initialState`, which the base turns into `syncState` and MERGES over the live
 * state, so browser back/forward moves the controls. But the browser shows the
 * new URL before React renders it. An edit made in that window, such as
 * clearing a date bound right after typing it, is overwritten when the render
 * carrying the PREVIOUS query lands. The grid then re-emits that stale query,
 * and the cleared filter comes back and sticks in the URL (FUT-3182, the
 * audit trail's "De" bound).
 *
 * So the base records every query it emits. An `initialState` matching one
 * still pending is the host echoing it back, not a navigation, and it is not
 * merged. Anything else (back/forward, a deep link, a host-side reset) still is.
 * A host whose round trip changes the slice's shape never matches, and keeps
 * the old behaviour rather than losing a navigation.
 */

/** The URL-carried part of a grid state or query. */
type UrlSlice = Pick<DataViewState, "search" | "pills" | "ranges" | "sortBy" | "scope">;

/** Hosts drop unset bounds on the way through the URL, so the key drops them too. */
function bounds(range: RangeValue): RangeValue | null {
  const set = (value: number | string | undefined): boolean => value !== undefined && value !== "";
  const kept: RangeValue = {
    ...(set(range.min) ? { min: range.min } : {}),
    ...(set(range.max) ? { max: range.max } : {}),
  };
  return Object.keys(kept).length > 0 ? kept : null;
}

const byKey = ([a]: [string, unknown], [b]: [string, unknown]): number => a.localeCompare(b);

/** One comparable string for a URL slice: empty pills and unbounded ranges left out. */
export function urlSliceKey(slice: UrlSlice): string {
  const pills = Object.entries(slice.pills ?? {})
    .filter(([, values]) => values.length > 0)
    .sort(byKey);
  const ranges = Object.entries(slice.ranges ?? {})
    .map(([id, range]): [string, RangeValue | null] => [id, bounds(range)])
    .filter(([, range]) => range !== null)
    .sort(byKey);
  return JSON.stringify({
    q: slice.search ?? "",
    pills,
    ranges,
    sort: slice.sortBy ?? [],
    scope: slice.scope ?? null,
  });
}

/** Enough to cover a burst of edits; older entries can no longer echo. */
const MAX_PENDING = 20;

/**
 * Record what the grid emits, and recognise it coming back.
 *
 * `consumeEcho` answers whether a URL slice is one of the queries still in
 * flight. A match drops it and every older one, since the host has caught up to
 * at least that far; a miss is a navigation and clears the list.
 */
export function useUrlEchoGuard(server: DataViewServer | undefined): {
  server: DataViewServer | undefined;
  consumeEcho: (slice: UrlSlice) => boolean;
} {
  const pending = useRef<string[]>([]);
  const recorded: DataViewServer | undefined = server && {
    ...server,
    onQueryChange: (query) => {
      pending.current = [...pending.current, urlSliceKey(query)].slice(-MAX_PENDING);
      server.onQueryChange(query);
    },
  };
  const consumeEcho = (slice: UrlSlice): boolean => {
    const at = pending.current.lastIndexOf(urlSliceKey(slice));
    pending.current = at === -1 ? [] : pending.current.slice(at + 1);
    return at !== -1;
  };
  return { server: recorded, consumeEcho };
}

function syncFrom(serverMode: boolean, initialState: DataViewState | undefined): DataViewSyncState | undefined {
  if (!serverMode || !initialState) return undefined;
  return {
    search: initialState.search,
    pills: initialState.pills,
    ranges: initialState.ranges,
    sortBy: initialState.sortBy,
    // The scope belongs in the URL-driven slice alongside them: a
    // `?view=recusados`-style deep link and browser back/forward must move the
    // tab strip, and they must do it WITHOUT resetting the user's hidden
    // columns — which is the whole reason this is a merging `syncState` and
    // not a replacing `appliedState`.
    scope: initialState.scope,
  };
}

/**
 * Derive the grid's reactive `syncState` from the URL-seeded `initialState` in
 * server mode, so browser back/forward RE-APPLIES the search/pills/sort controls
 * (merging over live state, preserving hidden columns — see
 * {@link DataViewSyncState}). Client-mode tables (no `server`) get `undefined`.
 *
 * Seeded on the first render, so a deep link shows on mount. After that a new
 * `initialState` reference is re-applied unless it is the grid's own query
 * coming back (`consumeEcho`), which would overwrite an edit made since.
 */
export function useUrlSyncState(
  server: DataViewServer | undefined,
  initialState: DataViewState | undefined,
  consumeEcho: (slice: UrlSlice) => boolean,
): DataViewSyncState | undefined {
  const serverMode = server !== undefined;
  const [syncState, setSyncState] = useState(() => syncFrom(serverMode, initialState));
  const seen = useRef({ serverMode, initialState });
  useEffect(() => {
    const last = seen.current;
    if (last.serverMode === serverMode && last.initialState === initialState) return;
    seen.current = { serverMode, initialState };
    const next = syncFrom(serverMode, initialState);
    if (next && consumeEcho(next)) return;
    setSyncState(next);
    // `consumeEcho` reads a ref; only a new URL seed or a mode change re-runs this.
  }, [serverMode, initialState]);
  return syncState;
}
