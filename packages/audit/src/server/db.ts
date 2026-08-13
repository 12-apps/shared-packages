/**
 * The database seam (12-14) — the exact, narrow slice of a Prisma-shaped client
 * this surface uses on the ONE model the package owns (`prisma/audit.prisma`).
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

export interface AuditLogDelegate {
  create(args: { data: AuditLogCreateData }): Promise<unknown>;
  findMany(args: {
    where: AuditLogWhere;
    orderBy: { createdAt: 'desc' };
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
