/**
 * An in-memory `FeatureFlagsDb` that implements the structural delegate
 * faithfully — same ordering, same upsert semantics — so the suites exercise
 * the routes exactly as the generated client would drive them.
 */

import type { FeatureFlagsDb, UserFeatureGrantRow } from "../index";

interface SeedRow {
  userId: string;
  flagKey: string;
  enabled?: boolean;
  grantedBy?: string;
  note?: string | null;
}

interface FakeDb {
  db: FeatureFlagsDb;
  rows(): readonly UserFeatureGrantRow[];
}

export function fakeDb(seed: readonly SeedRow[] = []): FakeDb {
  let tick = 0;
  const next = (): Date => new Date(Date.UTC(2026, 7, 20, 12, 0, tick++));
  const store: UserFeatureGrantRow[] = seed.map((row, index) => {
    const at = next();
    return {
      id: `grant-${index + 1}`,
      userId: row.userId,
      flagKey: row.flagKey,
      enabled: row.enabled ?? true,
      grantedBy: row.grantedBy ?? "seed@12-apps.dev",
      note: row.note ?? null,
      createdAt: at,
      updatedAt: at,
    };
  });

  const keyOf = (userId: string, flagKey: string): number =>
    store.findIndex((row) => row.userId === userId && row.flagKey === flagKey);

  const matches = (row: UserFeatureGrantRow, where?: { userId?: string; flagKey?: string }): boolean =>
    (where?.userId === undefined || row.userId === where.userId) &&
    (where?.flagKey === undefined || row.flagKey === where.flagKey);

  const sorted = (rows: UserFeatureGrantRow[]): UserFeatureGrantRow[] =>
    [...rows].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id),
    );

  return {
    rows: () => [...store],
    db: {
      userFeatureGrant: {
        findMany: (args) => {
          let rows = store.filter((row) => matches(row, args.where));
          if (args.orderBy !== undefined) rows = sorted(rows);
          const skip = args.skip ?? 0;
          const take = args.take ?? rows.length;
          return Promise.resolve(rows.slice(skip, skip + take));
        },
        findUnique: (args) => {
          const index = keyOf(args.where.userId_flagKey.userId, args.where.userId_flagKey.flagKey);
          return Promise.resolve(index === -1 ? null : (store[index] ?? null));
        },
        upsert: (args) => {
          const index = keyOf(args.where.userId_flagKey.userId, args.where.userId_flagKey.flagKey);
          const existing = index === -1 ? null : store[index];
          if (existing === null || existing === undefined) {
            const at = next();
            const created: UserFeatureGrantRow = {
              id: `grant-${store.length + 1}`,
              ...args.create,
              note: args.create.note,
              createdAt: at,
              updatedAt: at,
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
          store[index] = updated;
          return Promise.resolve(updated);
        },
        delete: (args) => {
          const index = keyOf(args.where.userId_flagKey.userId, args.where.userId_flagKey.flagKey);
          if (index === -1) return Promise.reject(new Error("record not found"));
          const [removed] = store.splice(index, 1);
          if (removed === undefined) return Promise.reject(new Error("record not found"));
          return Promise.resolve(removed);
        },
        count: (args) =>
          Promise.resolve(store.filter((row) => matches(row, args.where)).length),
      },
    },
  };
}
