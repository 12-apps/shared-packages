"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DiscountsApiClient, DiscountsPage, WireTargetGroup } from "./api";

/**
 * The screen's two reads, and the three states they can be in.
 *
 * A hand-rolled loader rather than a query library, and that is a dependency
 * decision rather than a preference: a host on TanStack Query, SWR or nothing
 * at all must all be able to mount this surface, and taking one of them as a
 * peer would decide for them. What is lost is a shared cache across pages; what
 * is kept is the one behaviour that actually matters on a server-driven grid —
 * the PREVIOUS page stays on screen while the next one loads, so paging does
 * not flash an empty table.
 *
 * The two reads are separate on purpose. The page changes on every filter
 * keystroke; the registered collections change when a host adds one, which is
 * never during a session. Refetching the catalog per keystroke would be the
 * origin's mistake — it side-loaded both catalogs on every mount — at a higher
 * frequency.
 */

interface DiscountsData {
  page: DiscountsPage | null;
  /** Undefined until the collections have loaded — see the menu's `groups`. */
  groups: readonly WireTargetGroup[] | undefined;
  /** True only for the FIRST load; a refetch keeps the previous page on screen. */
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * @param search The owned query params for this render, already serialized. A
 * string rather than an object so the effect's dependency is a value, not an
 * identity — an object literal would re-fetch on every render.
 */
export function useDiscountsData(
  api: DiscountsApiClient,
  search: string,
  onError: (error: unknown, context: string) => void,
): DiscountsData {
  const [page, setPage] = useState<DiscountsPage | null>(null);
  const [groups, setGroups] = useState<readonly WireTargetGroup[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  // Every in-flight read is stamped, and only the LATEST one may write. Two
  // keystrokes can be in flight at once and they can answer out of order; the
  // slower one landing last would put an older page on screen with no clue
  // anything went wrong.
  const latest = useRef(0);

  const report = useCallback(
    (cause: unknown, context: string) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      onError(cause, context);
    },
    [onError],
  );

  useEffect(() => {
    const ticket = ++latest.current;
    api
      .list(search)
      .then((next) => {
        if (ticket !== latest.current) return;
        setError(null);
        setPage(next);
      })
      .catch((cause: unknown) => {
        if (ticket !== latest.current) return;
        report(cause, "discounts.list");
      });
  }, [api, search, nonce, report]);

  useEffect(() => {
    let live = true;
    api
      .targets()
      .then((next) => {
        if (live) setGroups(next);
      })
      .catch((cause: unknown) => {
        // A failed catalog read is NOT a failed page. The grid is perfectly
        // readable without it; only the edit form is withheld, which is what
        // `groups: undefined` already means to the row menu.
        if (live) onError(cause, "discounts.targets");
      });
    return () => {
      live = false;
    };
  }, [api, onError]);

  return {
    page,
    groups,
    loading: page === null && error === null,
    error,
    refresh: useCallback(() => setNonce((value) => value + 1), []),
  };
}
