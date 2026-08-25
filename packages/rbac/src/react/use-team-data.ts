'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { PaginationWire, RbacApiClient, TeamContextWire } from './api';
import type { MemberRowStatus, TeamRow } from './team-grid-config';
import { useLatestRead } from './use-latest-read';

/**
 * The roster's two reads, and the composition that turns them into rows.
 *
 * A hand-rolled loader rather than a query library, and that is a dependency
 * decision rather than a preference: a host on TanStack Query, SWR or nothing
 * at all must all be able to mount this surface, and taking one as a peer would
 * decide for them. What is kept is the behaviour that actually matters on a
 * server-driven grid — the PREVIOUS page stays on screen while the next loads,
 * so paging never flashes an empty table.
 */

interface TeamData {
  rows: TeamRow[];
  context: TeamContextWire | null;
  pagination: PaginationWire | null;
  /** True only for the FIRST load; a refetch keeps the previous page on screen. */
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** A wire status narrowed to the row union (an unknown value reads as enabled). */
function toRowStatus(status: string): MemberRowStatus {
  return status === 'DISABLED' || status === 'PENDING' ? status : 'ENABLED';
}

/**
 * The pending invites the ACTIVE filters admit — the status facet admits
 * PENDING, and the roles facet admits the role the invite will grant.
 *
 * Computed from the filters rather than from the current page on purpose: the
 * count feeds the grid's total, and a total that shrank after page one would
 * invalidate the page the reader is standing on.
 */
export function matchingInvites(
  context: TeamContextWire,
  params: URLSearchParams,
): TeamContextWire['pendingInvites'] {
  const statusFilter = params.getAll('status_in').filter(Boolean);
  const roleFilter = params.getAll('role_in').filter(Boolean);
  if (statusFilter.length > 0 && !statusFilter.includes('PENDING')) return [];
  return context.pendingInvites.filter(
    (invite) => roleFilter.length === 0 || roleFilter.includes(invite.role),
  );
}

/**
 * Merge the paged roster with the context read: per-member custom roles, plus
 * the pending accountless invites as rows above the roster.
 *
 * Invites RENDER only on the first page, because they live OUTSIDE the
 * database's paging — repeating them on every page would be the alternative,
 * and it is worse.
 */
export function composeTeamRows(
  members: readonly {
    userId: string;
    role: string;
    email: string;
    name: string | null;
    status: string;
  }[],
  context: TeamContextWire,
  params: URLSearchParams,
): TeamRow[] {
  const custom = new Map(context.customRolesByMember.map((e) => [e.userId, e.roles]));
  const rows: TeamRow[] = members.map((member) => ({
    userId: member.userId,
    role: member.role,
    email: member.email,
    name: member.name,
    customRoles: custom.get(member.userId) ?? [],
    status: toRowStatus(member.status),
    inviteId: null,
  }));

  const pastFirstPage = Number(params.get('page') ?? '1') > 1;
  if (pastFirstPage) return rows;
  const invites: TeamRow[] = matchingInvites(context, params).map((invite) => ({
    userId: `invite:${invite.id}`,
    role: invite.role,
    email: invite.email,
    name: null,
    customRoles: [],
    status: 'PENDING' as const,
    inviteId: invite.id,
  }));
  return [...invites, ...rows];
}

/**
 * @param search The roster's owned params for this render, already serialized.
 * A string rather than an object so the effect's dependency is a VALUE — an
 * object literal would re-fetch on every render.
 */
export function useTeamData(
  api: RbacApiClient,
  search: string,
  loadFailed: string,
): TeamData {
  const [page, setPage] = useState<{
    data: { userId: string; role: string; email: string; name: string | null; status: string }[];
    pagination: PaginationWire;
  } | null>(null);
  const [context, setContext] = useState<TeamContextWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reads = useLatestRead();

  useEffect(() => {
    const ticket = reads.claim();
    Promise.all([api.listTeam(search), api.teamContext()])
      .then(([nextPage, nextContext]) => {
        if (!reads.isCurrent(ticket)) return;
        setPage(nextPage);
        setContext(nextContext);
        setError(null);
      })
      .catch(() => {
        if (reads.isCurrent(ticket)) setError(loadFailed);
      });
  }, [api, search, nonce, loadFailed]);

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const rows = useMemo(
    () => (page && context ? composeTeamRows(page.data, context, params) : []),
    [page, context, params],
  );

  // The grid's total counts the invites the active filters admit, not the ones
  // rendered — see `matchingInvites`.
  const pagination = useMemo(() => {
    if (!page || !context) return null;
    return {
      ...page.pagination,
      total: page.pagination.total + matchingInvites(context, params).length,
    };
  }, [page, context, params]);

  return {
    rows,
    context,
    pagination,
    loading: page === null && error === null,
    error,
    refresh: useCallback(() => setNonce((value) => value + 1), []),
  };
}
