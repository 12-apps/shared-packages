/**
 * Audit-log READS: the tenant-scoped, server-paginated page behind the viewer
 * and the listing endpoint. Strictly read-only — the write side is `writer.ts`,
 * and the model is append-only.
 *
 * ## Tenancy
 *
 * `clientId` is a REQUIRED parameter of every function here and a REQUIRED field
 * of {@link AuditLogWhere}, and it is always the value the host resolved for the
 * caller. The filters cannot express a tenant (the wire schema has no such key,
 * and zod strips what it does not declare), so there is no request shape that
 * widens a read past its tenant — the predicate is built here, from the actor,
 * every time.
 *
 * The one seam the package does not control is the VALUE the host hands over, and
 * types are erased at runtime — so it is checked here too. See
 * {@link requireTenantId}: `undefined` is the shape that fails OPEN, and it is the
 * shape a plausible `resolveActor` produces.
 */
import type { AuditLogPageWire, AuditLogWire, AuditPagination } from '../core/types';

import type { AuditDirectory, AuditUserIdentity } from './config';
import { auditLogOrderBy } from './db';
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

/**
 * The tenant id the host resolved, or a LOUD throw.
 *
 * `AuditActor.tenantId: string` is a compile-time promise, and this package's
 * whole tenancy claim rests on it — so it is verified at the one seam where the
 * value crosses in from host code. `undefined` is the dangerous shape and the
 * plausible one: a `resolveActor` written the obvious way —
 * `const { tenantId, permissions } = await resolveTenant(slug, session)` — hands it
 * over for a slug the caller is not a member of, and Prisma OMITS an `undefined`
 * clause. `{ clientId: undefined }` would therefore return every tenant's rows,
 * with `count` reporting the global total. `''` happens to fail closed, which only
 * makes the bug shape-dependent and harder to see in review.
 *
 * A plain `Error` on purpose: this is a host contract violation, not a caller's
 * bad request, so it must NOT be folded into a 4xx the host can shrug off. It
 * escapes `foldApiError` and surfaces as a 500. Same call, and the same reasoning,
 * as `purgeTenantWindow`'s empty-tenant refusal in `retention.ts`.
 */
function requireTenantId(clientId: string): string {
  if (typeof clientId !== 'string' || clientId === '') {
    throw new Error(
      'Audit reads require a tenant id: resolveActor returned an actor whose ' +
        `tenantId is ${JSON.stringify(clientId)}. An unscoped audit read would ` +
        'cross tenants, so it is refused.',
    );
  }
  return clientId;
}

export function buildAuditWhere(clientId: string, query: AuditLogQuery): AuditLogWhere {
  return {
    clientId: requireTenantId(clientId),
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
 *
 * A FAILING directory DEGRADES to raw ids rather than taking the listing down. The
 * names are an affordance layered over rows the package already has; a host whose
 * user table is briefly unreachable should still be able to read its security log
 * (a 500 there is the reading a dispute needs, refused for a cosmetic reason).
 * The same call already degrades in the viewer's actor-options fetch, and the same
 * reasoning gives an absent directory raw ids instead of a 501.
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
  try {
    const identities = await directory.getUsers([...ids]);
    return new Map(identities.map((identity) => [identity.id, displayName(identity)]));
  } catch {
    return new Map();
  }
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
      // Before the connection, not after: an unscoped read is refused rather than
      // issued. (`buildAuditWhere` checks again — it is exported, so a host
      // building its own predicate gets the same guard.)
      requireTenantId(clientId);
      const client = await db();
      const where = buildAuditWhere(clientId, query);
      // Both halves of the page against the SAME predicate, in parallel.
      const [rows, total] = await Promise.all([
        client.auditLog.findMany({
          where,
          // A TOTAL order in whichever direction was asked for — see
          // `auditLogOrderBy`. Entries written in a burst share a millisecond,
          // and without the id tie-break two pages of the same filtered set can
          // order those ties differently: the operator sees one row twice and
          // never sees another.
          orderBy: auditLogOrderBy(query.sort === 'createdAt:asc' ? 'asc' : 'desc'),
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
      // Guarded even though the roster is the HOST's query: handing `undefined`
      // to `directory.listActors` asks the host for "every actor", and the answer
      // names who works at somebody else's store.
      requireTenantId(clientId);
      if (!directory?.listActors) return [];
      const identities = await directory.listActors(clientId);
      return identities.map((identity) => ({ id: identity.id, label: displayName(identity) }));
    },
  };
}
