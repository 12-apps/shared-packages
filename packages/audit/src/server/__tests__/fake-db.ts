/**
 * An in-memory {@link AuditDb} for the route/store tests.
 *
 * It implements the seam by hand — filtering and SORTING an array the way the
 * arguments say — which is the point: the tests then assert what the PACKAGE
 * asked the database for, so a route that forgot its tenant scope, or a listing
 * that asked for an order Postgres does not guarantee, fails here rather than
 * being covered up by a helpful ORM. Real SQL is exercised in the harness.
 */
import type {
  AuditDb,
  AuditLogCreateData,
  AuditLogOrderBy,
  AuditLogRecord,
  AuditLogWhere,
} from '../db';

export interface SeedEntry extends Partial<AuditLogRecord> {
  clientId: string;
}

interface StoredRow extends AuditLogRecord {
  clientId: string;
}

/**
 * One stored row from a partial seed.
 *
 * The id counter is passed IN rather than kept module-level: a shared counter
 * would make every fake's ids depend on how many rows earlier tests happened to
 * seed, which is the order dependency the flakiness gate exists to stop.
 */
function row(seed: SeedEntry, sequence: number): StoredRow {
  return {
    id: seed.id ?? `a${sequence}`,
    clientId: seed.clientId,
    createdAt: seed.createdAt ?? new Date('2026-08-01T12:00:00Z'),
    actorUserId: seed.actorUserId ?? null,
    actorRole: seed.actorRole ?? null,
    scope: seed.scope ?? null,
    onBehalfOfUserId: seed.onBehalfOfUserId ?? null,
    action: seed.action ?? 'order.cancel',
    resourceType: seed.resourceType ?? 'order',
    resourceId: seed.resourceId ?? 'o1',
    before: seed.before ?? {},
    after: seed.after ?? {},
    requestId: seed.requestId ?? null,
  };
}

const matches = (stored: StoredRow, where: AuditLogWhere): boolean => {
  // `undefined` means NOT PROVIDED, exactly as Prisma reads it — so an omitted
  // (or `undefined`) `clientId` matches EVERY row rather than none.
  //
  // The lenient version of this line (`stored.clientId !== where.clientId`) was a
  // silent safety net pointing the wrong way: it made a missing tenant scope
  // return zero rows here while real Prisma returned every tenant's, so the one
  // class of tenancy bug this fake exists to catch was the one it could not. The
  // cast is deliberate — `AuditLogWhere.clientId` is typed `string`, and the point
  // of the check is that types are erased at the host seam.
  const scope = where.clientId as string | undefined;
  if (scope !== undefined && stored.clientId !== scope) return false;
  if (where.actorUserId !== undefined && stored.actorUserId !== where.actorUserId) return false;
  if (where.action && !where.action.in.includes(stored.action)) return false;
  if (where.resourceType && !where.resourceType.in.includes(stored.resourceType)) return false;
  if (typeof where.resourceId === 'string' && stored.resourceId !== where.resourceId) return false;
  if (
    where.resourceId &&
    typeof where.resourceId === 'object' &&
    !stored.resourceId.toLowerCase().includes(where.resourceId.contains.toLowerCase())
  ) {
    return false;
  }
  if (where.createdAt?.gte && stored.createdAt < where.createdAt.gte) return false;
  if (where.createdAt?.lt && stored.createdAt >= where.createdAt.lt) return false;
  return true;
};

/**
 * Order a page the way a database with NO tie-break guarantee would.
 *
 * `created_at` is `timestamp(3)`, and an audit trail is written in bursts, so
 * ties are the normal case rather than the exotic one. SQL guarantees nothing
 * about the order of rows a sort cannot distinguish — and the two halves of a
 * page are two separate statements, so a real engine is free to answer them
 * differently.
 *
 * This fake reproduces that freedom deliberately: when the caller's `orderBy`
 * distinguishes the rows, the order is exact; when it does not, the tied group
 * is ROTATED by the number of calls made so far. Nothing here is random — the
 * rotation is deterministic and the same on every machine — but a listing that
 * asks only for `createdAt DESC` sees page 1 and page 2 disagree about the tie,
 * which is precisely the duplicate-and-miss a `skip`/`take` reader experiences
 * against Postgres.
 */
function orderRows(
  matched: StoredRow[],
  orderBy: AuditLogOrderBy | undefined,
  call: number,
): StoredRow[] {
  const byId = orderBy?.some((clause) => 'id' in clause) ?? false;
  const groups = new Map<number, StoredRow[]>();
  for (const stored of matched) {
    const key = stored.createdAt.getTime();
    groups.set(key, [...(groups.get(key) ?? []), stored]);
  }
  const instants = [...groups.keys()].sort((a, b) => b - a);
  return instants.flatMap((instant) => {
    const tied = groups.get(instant) ?? [];
    if (byId) return [...tied].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    // No tie-break asked for: any permutation is a legal answer, so give a
    // different legal one per statement.
    const offset = tied.length === 0 ? 0 : call % tied.length;
    return [...tied.slice(offset), ...tied.slice(0, offset)];
  });
}

export interface FakeAuditDb {
  db: AuditDb;
  rows: StoredRow[];
  /** Every `where` the package handed over — the tenancy assertions read this. */
  wheres: AuditLogWhere[];
  /** Every `orderBy` the package handed over — the tie-break assertions read this. */
  orderBys: (AuditLogOrderBy | undefined)[];
  /** Every raw statement + parameters the retention sweep issued. */
  raw: { sql: string; values: unknown[] }[];
  created: AuditLogCreateData[];
  seed(...entries: SeedEntry[]): void;
}

export function fakeAuditDb(): FakeAuditDb {
  const rows: StoredRow[] = [];
  const next = { id: 0 };
  const add = (seed: SeedEntry): void => {
    next.id += 1;
    rows.push(row(seed, next.id));
  };
  const wheres: AuditLogWhere[] = [];
  const orderBys: (AuditLogOrderBy | undefined)[] = [];
  const calls = { findMany: 0 };
  const raw: { sql: string; values: unknown[] }[] = [];
  const created: AuditLogCreateData[] = [];
  const db: AuditDb = {
    auditLog: {
      create({ data }) {
        created.push(data);
        add(data as SeedEntry);
        return Promise.resolve({});
      },
      findMany({ where, orderBy, skip, take }) {
        wheres.push(where);
        orderBys.push(orderBy);
        calls.findMany += 1;
        const matched = orderRows(
          rows.filter((stored) => matches(stored, where)),
          orderBy,
          calls.findMany,
        );
        return Promise.resolve(matched.slice(skip, skip + take));
      },
      count({ where }) {
        wheres.push(where);
        return Promise.resolve(rows.filter((stored) => matches(stored, where)).length);
      },
    },
    $executeRawUnsafe(sql: string, ...values: unknown[]) {
      raw.push({ sql, values });
      return Promise.resolve(0);
    },
  };
  return {
    db,
    rows,
    wheres,
    orderBys,
    raw,
    created,
    seed(...entries: SeedEntry[]) {
      entries.forEach(add);
    },
  };
}
