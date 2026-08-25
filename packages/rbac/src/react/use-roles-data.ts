'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PaginationWire, RbacApiClient, RoleListRowWire } from './api';
import { toRoleRow, type RoleRow, type RoleSeedDefault } from './role-grid-config';

/**
 * The catalog's read. A hand-rolled loader for the same reason the roster's is:
 * a host on any query library — or none — must be able to mount this surface,
 * and taking one as a peer would decide for them.
 */

interface RolesData {
  rows: RoleRow[];
  pagination: PaginationWire | null;
  /** True only for the FIRST load; a refetch keeps the previous page on screen. */
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useRolesData(
  api: RbacApiClient,
  search: string,
  seeds: ReadonlyMap<string, RoleSeedDefault>,
  loadFailed: string,
  enabled: boolean,
): RolesData {
  const [page, setPage] = useState<{
    data: RoleListRowWire[];
    pagination: PaginationWire;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  // Only the LATEST read may write: two keystrokes can be in flight at once and
  // can answer out of order, and the slower one landing last would put an older
  // page on screen with nothing to say so.
  const latest = useRef(0);

  useEffect(() => {
    // The endpoint refuses an actor without the gate — don't fetch just to fail.
    if (!enabled) return;
    const ticket = ++latest.current;
    api
      .listRoles(search)
      .then((next) => {
        if (ticket !== latest.current) return;
        setPage(next);
        setError(null);
      })
      .catch(() => {
        if (ticket === latest.current) setError(loadFailed);
      });
  }, [api, search, nonce, loadFailed, enabled]);

  const rows = useMemo(
    () => (page ? page.data.map((record) => toRoleRow(record, seeds)) : []),
    [page, seeds],
  );

  return {
    rows,
    pagination: page?.pagination ?? null,
    loading: enabled && page === null && error === null,
    error,
    refresh: useCallback(() => setNonce((value) => value + 1), []),
  };
}
