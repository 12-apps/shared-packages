/**
 * The database seam — the exact, narrow slice of a Prisma-shaped client this
 * surface uses on the ONE model the package owns (`prisma/audit.prisma`).
 * Structural on purpose, never generated: a real host passes its Prisma client;
 * the harness passes hand-written SQL over PGlite, and neither the writer nor
 * the routes can tell.
 *
 * Every argument type below is CLOSED — the union of the shapes this package
 * actually passes — so a non-Prisma implementation has a finite, documented
 * surface to satisfy instead of "all of Prisma".
 */

/** The row the store projects. `before`/`after` arrive as parsed JSON. */
export interface AuditLogRecord {
  id: string;
  createdAt: Date;
  actorUserId: string | null;
  actorRole: string | null;
  scope: string | null;
  onBehalfOfUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  before: unknown;
  after: unknown;
  requestId: string | null;
}

/** What the writer inserts. `id`/`createdAt` are the model's own defaults. */
export interface AuditLogCreateData {
  clientId: string;
  actorUserId: string | null;
  actorRole: string | null;
  scope: string | null;
  onBehalfOfUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  requestId: string | null;
}

/**
 * The closed predicate the listing builds.
 *
 * `clientId` is REQUIRED, and that is the tenancy boundary: this package has no
 * code path that reads or counts audit rows without it, so there is no way to
 * ask for "everything" — not through a filter, not through a query param, not by
 * omission. See `store.ts`, where the value comes from the resolved actor and
 * never from the request.
 */
export interface AuditLogWhere {
  clientId: string;
  actorUserId?: string;
  resourceId?: string | { contains: string; mode: 'insensitive' };
  action?: { in: string[] };
  resourceType?: { in: string[] };
  createdAt?: { gte?: Date; lt?: Date };
}

/**
 * The listing's TOTAL order: newest first, ties broken by id.
 *
 * The tie-break is not a nicety, it is what makes `skip`/`take` pagination
 * correct at all. `created_at` is `timestamp(3)` and takes the statement's own
 * clock, so entries written in a burst — which is exactly how an audit trail is
 * written — routinely share a millisecond. SQL guarantees NO order among rows a
 * sort cannot distinguish, and the two halves of a page are two separate
 * statements: with `created_at DESC` alone, page 1 and page 2 can order the
 * same tied rows differently, so an operator paging through the trail sees one
 * entry twice and never sees another. On a security log that is a row that
 * silently does not exist for whoever was reading.
 *
 * `id` is the tie-break because it is the primary key: unique, non-null, and
 * present on every row, so the order is TOTAL. It is a random `uuid()` rather
 * than a sequence, so it says nothing about arrival order — and it does not
 * need to. What a tie-break has to be is stable across statements, not
 * meaningful.
 *
 * Frozen, exported, and passed by the store rather than restated: a seam
 * implementation maps THIS array into its own ORDER BY, so the package and its
 * host cannot come to disagree about the sort. The shape stays CLOSED — a
 * two-element tuple with fixed keys — so a hand-written implementation has a
 * finite thing to translate rather than "all of Prisma's orderBy".
 */
export type AuditSortDirection = 'asc' | 'desc';
export type AuditLogOrderBy = readonly [
  { createdAt: AuditSortDirection },
  { id: AuditSortDirection },
];

/** The default order: newest first. See {@link AuditLogOrderBy}. */
export const AUDIT_LOG_ORDER_BY: AuditLogOrderBy = Object.freeze([
  Object.freeze({ createdAt: 'desc' as const }),
  Object.freeze({ id: 'desc' as const }),
]) as AuditLogOrderBy;

/** Oldest first — the same total order, read forwards. */
export const AUDIT_LOG_ORDER_BY_ASC: AuditLogOrderBy = Object.freeze([
  Object.freeze({ createdAt: 'asc' as const }),
  Object.freeze({ id: 'asc' as const }),
]) as AuditLogOrderBy;

/**
 * The order for one direction.
 *
 * The TIE-BREAK follows the direction rather than staying fixed: reversing only
 * the timestamp would leave rows that share a millisecond in their old relative
 * order, so page 1 ascending and page 1 descending would not be reverses of each
 * other — and paging through the ascending view would skip and repeat exactly
 * the ties the tie-break exists to pin down.
 */
export const auditLogOrderBy = (direction: AuditSortDirection): AuditLogOrderBy =>
  direction === 'asc' ? AUDIT_LOG_ORDER_BY_ASC : AUDIT_LOG_ORDER_BY;

export interface AuditLogDelegate {
  create(args: { data: AuditLogCreateData }): Promise<unknown>;
  findMany(args: {
    where: AuditLogWhere;
    orderBy: AuditLogOrderBy;
    skip: number;
    take: number;
  }): Promise<AuditLogRecord[]>;
  count(args: { where: AuditLogWhere }): Promise<number>;
}

/**
 * The write client: whatever the CALLER's transaction exposes.
 *
 * The writer takes this per call rather than reaching for `config.db`, because
 * the entry must land in the SAME transaction as the mutation it describes —
 * "it happened" and "it was logged" commit or roll back together. A writer that
 * opened its own connection would be fire-and-forget, which is the one thing an
 * audit trail may not be.
 */
export interface AuditWriteClient {
  auditLog: Pick<AuditLogDelegate, 'create'>;
}

/**
 * The read/sweep client.
 *
 * `$executeRawUnsafe` is here for the retention sweep alone, and it is not an
 * escape hatch anyone should reach for otherwise: `deleteMany` on this model is
 * blocked by the append-only guard, so the ONLY sanctioned removal has to go
 * around the model API. The SQL is built by this package from a constant with
 * bound parameters (never string-interpolated values) — see `retention.ts`.
 */
export interface AuditDb extends AuditWriteClient {
  auditLog: AuditLogDelegate;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

/** Deferred so hosts with an async client bootstrap can pass it directly. */
export type AuditDbProvider = () => Promise<AuditDb>;
