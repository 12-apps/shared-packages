import type {
  EffectiveGrantData,
  EffectiveGrantRow,
  RbacEffectiveGrantDelegate,
} from '../effective-grants';

/**
 * An in-memory `rbac_effective_grants`, interpreting the closed argument
 * shapes `./effective-grants` passes. `mark` is what the package's triggers do
 * in SQL (`rbac_grants_mark`): insert the row stale, or mark it stale — each
 * time with the next value of one sequence, as the migration's
 * `rbac_effective_grants_version_seq`.
 */

interface StoredRow extends EffectiveGrantRow {
  userId: string;
  version: number;
  computedAt: Date | null;
}

interface FakeEffectiveGrants {
  delegate: RbacEffectiveGrantDelegate;
  rows: Map<string, StoredRow>;
  /** Age every computed row, as the clock would. */
  age: (ms: number) => void;
  /** Statements issued, by method. */
  calls: string[];
  mark: (userId: string, scope: string) => void;
  /** Fail the next write-backs with this error. */
  failWrites: (error: Error | null) => void;
}

const keyOf = (userId: string, scope: string): string => `${userId}\u0000${scope}`;

const blank = (userId: string, scope: string, version: number): StoredRow => ({
  userId,
  scope,
  membershipRole: null,
  membershipActive: null,
  assignments: [],
  resources: [],
  stale: true,
  version,
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
  const sequence = { last: 0 };
  const nextVersion = (): number => {
    sequence.last += 1;
    return sequence.last;
  };
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
          computedAt: row.computedAt,
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
      for (const entry of fresh) rows.set(keyOf(entry.userId, entry.scope), blank(entry.userId, entry.scope, nextVersion()));
      return { count: fresh.length };
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
        rows.set(key, blank(userId, scope, nextVersion()));
        return;
      }
      row.stale = true;
      row.version = nextVersion();
    },
    age: (ms) => {
      for (const row of rows.values()) {
        if (row.computedAt) row.computedAt = new Date(row.computedAt.getTime() - ms);
      }
    },
    failWrites: (error) => {
      failure.error = error;
    },
  };
}
