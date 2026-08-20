/**
 * The feature-flags seams a host owns (FUT-884): where grant rows live, and
 * how a by-value user id becomes a person. In-memory here — the package types
 * the client structurally (`FeatureFlagsDb`), so a Map-backed delegate that
 * honours the same ordering and upsert semantics is a faithful stand-in for
 * the generated client, and the directory is the host's user table, which
 * this harness keeps as three seeded people.
 */
import type {
  FeatureFlagsDb,
  UserFeatureGrantRow,
} from '@12-apps/feature-flags';
import type { DirectoryUser, FeatureFlagsDirectory } from '@12-apps/feature-flags/server';

export const HARNESS_PEOPLE: readonly DirectoryUser[] = [
  { id: 'u-ana', email: 'ana@harness.dev', name: 'Ana Souza' },
  { id: 'u-bruno', email: 'bruno@harness.dev', name: 'Bruno Lima' },
  { id: 'u-clara', email: 'clara@harness.dev', name: null },
];

export const harnessDirectory: FeatureFlagsDirectory = {
  getUsers: (ids) => Promise.resolve(HARNESS_PEOPLE.filter((person) => ids.includes(person.id))),
  findUserByEmail: (email) =>
    Promise.resolve(HARNESS_PEOPLE.find((person) => person.email === email) ?? null),
};

interface SeedGrant {
  userId: string;
  flagKey: string;
  enabled?: boolean;
  note?: string | null;
}

/** A fresh store per backend, so suites never see each other's grants. */
export function memoryFeatureFlagsDb(seed: readonly SeedGrant[] = []): FeatureFlagsDb {
  let tick = 0;
  const next = (): Date => new Date(Date.UTC(2026, 7, 20, 12, 0, tick++));
  const store: UserFeatureGrantRow[] = seed.map((row, index) => {
    const at = next();
    return {
      id: `grant-${index + 1}`,
      userId: row.userId,
      flagKey: row.flagKey,
      enabled: row.enabled ?? true,
      grantedBy: 'root@harness.dev',
      note: row.note ?? null,
      createdAt: at,
      updatedAt: at,
    };
  });

  const indexOf = (userId: string, flagKey: string): number =>
    store.findIndex((row) => row.userId === userId && row.flagKey === flagKey);

  const matches = (
    row: UserFeatureGrantRow,
    where?: { userId?: string; flagKey?: string },
  ): boolean =>
    (where?.userId === undefined || row.userId === where.userId) &&
    (where?.flagKey === undefined || row.flagKey === where.flagKey);

  return {
    userFeatureGrant: {
      findMany: (args) => {
        let rows = store.filter((row) => matches(row, args.where));
        if (args.orderBy !== undefined) {
          rows = [...rows].sort(
            (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id),
          );
        }
        const skip = args.skip ?? 0;
        const take = args.take ?? rows.length;
        return Promise.resolve(rows.slice(skip, skip + take));
      },
      findUnique: (args) => {
        const at = indexOf(args.where.userId_flagKey.userId, args.where.userId_flagKey.flagKey);
        return Promise.resolve(at === -1 ? null : (store[at] ?? null));
      },
      upsert: (args) => {
        const at = indexOf(args.where.userId_flagKey.userId, args.where.userId_flagKey.flagKey);
        const existing = at === -1 ? undefined : store[at];
        if (existing === undefined) {
          const stamped = next();
          const created: UserFeatureGrantRow = {
            id: `grant-${store.length + 1}`,
            ...args.create,
            createdAt: stamped,
            updatedAt: stamped,
          };
          store.push(created);
          return Promise.resolve(created);
        }
        const updated: UserFeatureGrantRow = {
          ...existing,
          ...(args.update.enabled !== undefined ? { enabled: args.update.enabled } : {}),
          ...(args.update.grantedBy !== undefined ? { grantedBy: args.update.grantedBy } : {}),
          ...(args.update.note !== undefined ? { note: args.update.note } : {}),
          updatedAt: next(),
        };
        store[at] = updated;
        return Promise.resolve(updated);
      },
      delete: (args) => {
        const at = indexOf(args.where.userId_flagKey.userId, args.where.userId_flagKey.flagKey);
        const removed = at === -1 ? undefined : store.splice(at, 1)[0];
        return removed === undefined
          ? Promise.reject(new Error('record not found'))
          : Promise.resolve(removed);
      },
      count: (args) =>
        Promise.resolve(store.filter((row) => matches(row, args.where)).length),
    },
  };
}
