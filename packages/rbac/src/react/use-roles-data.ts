'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { PaginationWire, RbacApiClient, RoleListRowWire } from './api';
import { useLatestRead } from './use-latest-read';
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
  const reads = useLatestRead();

  useEffect(() => {
    // The endpoint refuses an actor without the gate — don't fetch just to fail.
    if (!enabled) return;
    const ticket = reads.claim();
    api
      .listRoles(search)
      .then((next) => {
        if (!reads.isCurrent(ticket)) return;
        setPage(next);
        setError(null);
      })
      .catch(() => {
        if (reads.isCurrent(ticket)) setError(loadFailed);
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
