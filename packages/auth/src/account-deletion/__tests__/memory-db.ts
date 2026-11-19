import type { AccountStateDb, AccountStateRow } from "../types";

/** An in-memory `authAccountState` that honours the predicates the service writes with. */
type Where = Record<string, unknown>;

function matches(row: AccountStateRow, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return (expected as Where[]).some((branch) => matches(row, branch));
    const value = (row as unknown as Record<string, unknown>)[key];
    if (expected === null) return value === null || value === undefined;
    if (expected instanceof Date) return value instanceof Date && value.getTime() === expected.getTime();
    if (typeof expected === "object") {
      const op = expected as { not?: unknown; lte?: Date; gt?: Date };
      if ("not" in op) return op.not === null ? value !== null && value !== undefined : value !== op.not;
      if (op.lte && op.gt) return value instanceof Date && value.getTime() <= op.lte.getTime() && value.getTime() > op.gt.getTime();
      if (op.lte) return value instanceof Date && value.getTime() <= op.lte.getTime();
      if (op.gt) return value instanceof Date && value.getTime() > op.gt.getTime();
    }
    return value === expected;
  });
}

function apply(row: AccountStateRow, data: Record<string, unknown>): AccountStateRow {
  const next: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(data)) {
    const op = value as { increment?: number } | null;
    next[key] = op && typeof op === "object" && !(op instanceof Date) && "increment" in op ? (next[key] as number) + (op.increment ?? 0) : value;
  }
  return next as unknown as AccountStateRow;
}

export function memoryDb(): AccountStateDb & { rows: Map<string, AccountStateRow> } {
  const rows = new Map<string, AccountStateRow>();
  const blank = (userId: string): AccountStateRow => ({
    userId, sessionEpoch: 0, requestedAt: null, purgeAt: null, remindedWeekAt: null, remindedDayAt: null,
    mailOwed: null, mailPurgeAt: null, purgeClaimedAt: null, deletedAt: null,
  });
  return {
    rows,
    authAccountState: {
      findUnique: async ({ where }) => rows.get(where.userId) ?? null,
      findMany: async ({ where, take }) => [...rows.values()].filter((row) => matches(row, where)).slice(0, take ?? Infinity),
      create: async ({ data }) => {
        if (rows.has(data.userId)) throw Object.assign(new Error("unique"), { code: "P2002" });
        const next = apply(blank(data.userId), data);
        rows.set(data.userId, next);
        return next;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of rows.values()) {
          if (!matches(row, where)) continue;
          rows.set(row.userId, apply(row, data));
          count += 1;
        }
        return { count };
      },
    },
  };
}
