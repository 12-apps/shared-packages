/**
 * Audit-log READS (12-14): the tenant-scoped, server-paginated page behind the
 * viewer and the listing endpoint. Strictly read-only — the write side is
 * `writer.ts`, and the model is append-only.
 *
 * ## Tenancy
 *
 * `clientId` is a REQUIRED parameter of every function here and a REQUIRED field
 * of {@link AuditLogWhere}, and it is always the value the host resolved for the
 * caller. The filters cannot express a tenant (the wire schema has no such key,
 * and zod strips what it does not declare), so there is no request shape that
 * widens a read past its tenant — the predicate is built here, from the actor,
 * every time.
 */
import type { AuditLogPageWire, AuditLogWire, AuditPagination } from '../core/types';

import type { AuditDirectory, AuditUserIdentity } from './config';
import type { AuditDb, AuditLogRecord, AuditLogWhere } from './db';
import type { AuditLogQuery } from './wire';

/** Pagination meta for a page of `total` rows. */
export function paginationMeta(total: number, page: number, pageSize: number): AuditPagination {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return { total, page, pageSize, pageCount, hasNextPage: page < pageCount };
}

/**
 * Resolve the query into the predicate.
 *
 * `clientId` is written FIRST and unconditionally, and every other clause is
 * additive — so no combination of filters can remove it.
 */
/** The inclusive-day range as a half-open predicate, or nothing. */
function createdAtRange(query: AuditLogQuery): Pick<AuditLogWhere, 'createdAt'> {
  if (!query.from && !query.toExclusive) return {};
  return {
    createdAt: {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.toExclusive ? { lt: query.toExclusive } : {}),
    },
  };
}

/**
 * The resource-id predicate. An exact `resourceId` filter and the free-text `q`
 * both target the same column; the exact match WINS, because a caller that
 * supplied an id is asking for THAT resource's trail.
 */
function resourceIdMatch(query: AuditLogQuery): Pick<AuditLogWhere, 'resourceId'> {
  if (query.resourceId) return { resourceId: query.resourceId };
  if (query.q) return { resourceId: { contains: query.q, mode: 'insensitive' } };
  return {};
}

export function buildAuditWhere(clientId: string, query: AuditLogQuery): AuditLogWhere {
  return {
    clientId,
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...resourceIdMatch(query),
    ...(query.actionIn ? { action: { in: query.actionIn } } : {}),
    ...(query.resourceTypeIn ? { resourceType: { in: query.resourceTypeIn } } : {}),
    ...createdAtRange(query),
  };
}

/** Row projection: the JSON diffs pass through as-is (already allowlisted). */
function toWire(entry: AuditLogRecord, names: Map<string, string>): AuditLogWire {
  return {
    id: entry.id,
    createdAt: entry.createdAt.toISOString(),
    actorUserId: entry.actorUserId,
    actorName: entry.actorUserId ? (names.get(entry.actorUserId) ?? null) : null,
    actorRole: entry.actorRole,
    scope: entry.scope,
    onBehalfOfUserId: entry.onBehalfOfUserId,
    onBehalfOfName: entry.onBehalfOfUserId
      ? (names.get(entry.onBehalfOfUserId) ?? null)
      : null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    before: (entry.before ?? {}) as Record<string, unknown>,
    after: (entry.after ?? {}) as Record<string, unknown>,
    requestId: entry.requestId,
  };
}

/** A directory identity as one display string. */
const displayName = (identity: AuditUserIdentity): string =>
  identity.name ?? identity.email ?? identity.id;

/**
 * Display names for every id on the page, in ONE batched call.
 *
 * BOTH id columns go into that single call: the directory de-duplicates nothing
 * for us, so the union is built here — and the impersonated person is very often
 * the actor of some other row on the same page, so it is usually no wider.
 * Resolving them in a second call, or not at all, would leave "X on behalf of
 * <uuid>" on screen: a row that names the real human and reduces the person they
 * were rendering as to an id nobody can read.
 */
async function resolveNames(
  directory: AuditDirectory | undefined,
  rows: readonly AuditLogRecord[],
): Promise<Map<string, string>> {
  if (!directory) return new Map();
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.actorUserId) ids.add(row.actorUserId);
    if (row.onBehalfOfUserId) ids.add(row.onBehalfOfUserId);
  }
  if (ids.size === 0) return new Map();
  const identities = await directory.getUsers([...ids]);
  return new Map(identities.map((identity) => [identity.id, displayName(identity)]));
}

export interface AuditStore {
  /** One tenant's trail as a page, newest first. */
  listPage(clientId: string, query: AuditLogQuery): Promise<AuditLogPageWire>;
  /** The actors the viewer's "who" filter may offer, for one tenant. */
  listActors(clientId: string): Promise<{ id: string; label: string }[]>;
}

export function createAuditStore(
  db: () => Promise<AuditDb>,
  directory?: AuditDirectory,
): AuditStore {
  return {
    async listPage(clientId: string, query: AuditLogQuery): Promise<AuditLogPageWire> {
      const client = await db();
      const where = buildAuditWhere(clientId, query);
      // Both halves of the page against the SAME predicate, in parallel.
      const [rows, total] = await Promise.all([
        client.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        client.auditLog.count({ where }),
      ]);
      const names = await resolveNames(directory, rows);
      return {
        data: rows.map((row) => toWire(row, names)),
        pagination: paginationMeta(total, query.page, query.pageSize),
      };
    },
    async listActors(clientId: string): Promise<{ id: string; label: string }[]> {
      if (!directory?.listActors) return [];
      const identities = await directory.listActors(clientId);
      return identities.map((identity) => ({ id: identity.id, label: displayName(identity) }));
    },
  };
}
