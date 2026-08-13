/**
 * An in-memory {@link AuditDb} for the route/store tests (12-14).
 *
 * It implements the seam by hand — filtering an array the way the predicate says —
 * which is the point: the tests below then assert what the PACKAGE asked the
 * database for, so a route that forgot its tenant scope fails here rather than
 * being covered up by a helpful ORM. Real SQL is exercised in the harness.
 */
import type { AuditDb, AuditLogCreateData, AuditLogRecord, AuditLogWhere } from '../db';

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

export interface FakeAuditDb {
  db: AuditDb;
  rows: StoredRow[];
  /** Every `where` the package handed over — the tenancy assertions read this. */
  wheres: AuditLogWhere[];
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
  const raw: { sql: string; values: unknown[] }[] = [];
  const created: AuditLogCreateData[] = [];
  const db: AuditDb = {
    auditLog: {
      create({ data }) {
        created.push(data);
        add(data as SeedEntry);
        return Promise.resolve({});
      },
      findMany({ where, skip, take }) {
        wheres.push(where);
        const matched = rows
          .filter((stored) => matches(stored, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
    raw,
    created,
    seed(...entries: SeedEntry[]) {
      entries.forEach(add);
    },
  };
}
