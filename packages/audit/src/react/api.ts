import type {
  AuditActorOptionWire,
  AuditLogFilters,
  AuditLogPageWire,
} from '../core/types';

import type { AuditTransport } from './transport';

/**
 * The typed wire calls the viewer makes — the REST twins of the `/server`
 * descriptors, built from an `apiBase` (the host's admin mount, e.g.
 * `/api/admin/acme`). The paths here and in `routes.ts` are ONE contract;
 * changing either alone is a drift bug, which is why both halves ship together.
 */

export interface AuditApiClient {
  listEntries(filters: AuditLogFilters): Promise<AuditLogPageWire>;
  listActors(): Promise<AuditActorOptionWire[]>;
}

/**
 * The query string for one filter set.
 *
 * Exported because it is also the URL a host may want to build for a deep link
 * (an alert mailing "the trail for this order"), and restating it there is how
 * the two drift.
 */
export function auditQueryString(filters: AuditLogFilters): string {
  // A TABLE rather than a run of `if`s: every parameter is "this filter, under
  // this wire name", and one omitted line is a filter the screen silently stops
  // sending. Empty and page-1 values are dropped, so a cleared filter bar
  // produces the bare path and a cache key stays stable.
  const pairs: readonly (readonly [string, string | undefined])[] = [
    ['q', filters.q],
    ['action_in', filters.actionIn?.join(',')],
    ['resourceType_in', filters.resourceTypeIn?.join(',')],
    ['actorUserId', filters.actorUserId],
    ['resourceId', filters.resourceId],
    ['from', filters.from],
    ['to', filters.to],
    ['page', filters.page && filters.page > 1 ? String(filters.page) : undefined],
    ['pageSize', filters.pageSize ? String(filters.pageSize) : undefined],
  ];
  const query = new URLSearchParams();
  for (const [key, value] of pairs) {
    if (value) query.set(key, value);
  }
  return query.toString();
}

export function createAuditApiClient(apiBase: string, transport: AuditTransport): AuditApiClient {
  const base = apiBase.replace(/\/$/, '');
  return {
    listEntries(filters: AuditLogFilters): Promise<AuditLogPageWire> {
      const query = auditQueryString(filters);
      return transport.get<AuditLogPageWire>(
        `${base}/audit-logs${query ? `?${query}` : ''}`,
      );
    },
    async listActors(): Promise<AuditActorOptionWire[]> {
      const payload = await transport.get<{ data: AuditActorOptionWire[] }>(
        `${base}/audit-logs/actors`,
      );
      return payload.data;
    },
  };
}
