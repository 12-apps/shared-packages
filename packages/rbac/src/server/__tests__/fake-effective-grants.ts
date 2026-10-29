import type {
  EffectiveGrantData,
  EffectiveGrantRow,
  RbacEffectiveGrantDelegate,
} from '../effective-grants';

/**
 * An in-memory `rbac_effective_grants`, interpreting the closed argument
 * shapes `./effective-grants` passes. `mark` is what the package's triggers do
 * in SQL (`rbac_grants_mark`): insert the row stale, or mark it stale and bump
 * its version.
 */

interface StoredRow extends EffectiveGrantRow {
  userId: string;
  computedAt: Date | null;
}

interface FakeEffectiveGrants {
  delegate: RbacEffectiveGrantDelegate;
  rows: Map<string, StoredRow>;
  /** Statements issued, by method. */
  calls: string[];
  mark: (userId: string, scope: string) => void;
  /** Fail the next write-backs with this error. */
  failWrites: (error: Error | null) => void;
}

const keyOf = (userId: string, scope: string): string => `${userId}\u0000${scope}`;

const blank = (userId: string, scope: string): StoredRow => ({
  userId,
  scope,
  membershipRole: null,
  membershipActive: null,
  assignments: [],
  resources: [],
  stale: true,
  version: 0,
  computedAt: null,
});

/** A JSON round trip, as a jsonb column gives one. */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

function write(row: StoredRow, data: EffectiveGrantData): void {
  row.membershipRole = data.membershipRole;
  row.membershipActive = data.membershipActive;
  row.assignments = asJson(data.assignments);
  row.resources = asJson(data.resources);
  row.stale = data.stale;
  row.computedAt = data.computedAt;
}

export function createFakeEffectiveGrants(): FakeEffectiveGrants {
  const rows = new Map<string, StoredRow>();
  const calls: string[] = [];
  const failure: { error: Error | null } = { error: null };
  const guard = (): void => {
    if (failure.error) throw failure.error;
  };
  const delegate: RbacEffectiveGrantDelegate = {
    async findMany({ where }) {
      calls.push('findMany');
      return [...rows.values()]
        .filter((row) => row.userId === where.userId)
        .map((row) => ({
          scope: row.scope,
          membershipRole: row.membershipRole,
          membershipActive: row.membershipActive,
          assignments: asJson(row.assignments),
          resources: asJson(row.resources),
          stale: row.stale,
          version: row.version,
        }));
    },
    async updateMany({ where, data }) {
      calls.push('updateMany');
      guard();
      const row = rows.get(keyOf(where.userId, where.scope));
      if (!row || row.version !== where.version) return { count: 0 };
      write(row, data);
      return { count: 1 };
    },
    async createMany({ data }) {
      calls.push('createMany');
      guard();
      const fresh = data.filter((entry) => !rows.has(keyOf(entry.userId, entry.scope)));
      for (const entry of fresh) {
        const row = blank(entry.userId, entry.scope);
        write(row, entry);
        rows.set(keyOf(entry.userId, entry.scope), row);
      }
      return { count: fresh.length };
    },
    async deleteMany({ where }) {
      calls.push('deleteMany');
      guard();
      const key = keyOf(where.userId, where.scope);
      const row = rows.get(key);
      if (!row || row.version !== where.version) return { count: 0 };
      rows.delete(key);
      return { count: 1 };
    },
  };
  return {
    delegate,
    rows,
    calls,
    mark: (userId, scope) => {
      const key = keyOf(userId, scope);
      const row = rows.get(key);
      if (!row) {
        rows.set(key, blank(userId, scope));
        return;
      }
      row.stale = true;
      row.version += 1;
    },
    failWrites: (error) => {
      failure.error = error;
    },
  };
}
