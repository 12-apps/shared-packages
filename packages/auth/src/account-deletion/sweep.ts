import type { DeletionContext } from "./context";
import { flush } from "./outbox";
import { dueReminder } from "./schedule-math";
import type { SweepSummary } from "./service";
import type { AccountStateRow } from "./types";

/**
 * The job's pass: for each row that needs something, a due purge first (no
 * mail ever holds it), else the owed mail, else a due reminder. Paged by a
 * cursor on the id, so a row that stays selected never holds the rest.
 *
 * The purge takes a lease (`purgeClaimedAt`), runs the host's idempotent
 * `erase`, writes the audit, and only then stamps `deletedAt` (dropping any
 * mail still owed); a failure leaves the lease to expire and a later pass runs
 * it again. Once claimed, the deletion cannot be cancelled.
 */

const PAGE = 50;
const MAX_PAGES = 20;
const PURGE_LEASE_MS = 30 * 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Outcome = "mailed" | "purged" | "failed" | "none";

async function remind(ctx: DeletionContext, row: AccountStateRow, now: Date): Promise<boolean> {
  const kind = dueReminder(row, now);
  if (!kind || !row.purgeAt || row.mailOwed) return false;
  const stamp = kind === "week-before" ? "remindedWeekAt" : "remindedDayAt";
  const { count } = await (await ctx.table()).updateMany({
    where: { userId: row.userId, [stamp]: null, mailOwed: null, deletedAt: null, requestedAt: row.requestedAt, purgeAt: row.purgeAt },
    data: { [stamp]: now, mailOwed: kind, mailPurgeAt: row.purgeAt, mailClaimedAt: null },
  });
  if (count !== 1) return false;
  return (await flush(ctx, row.userId, kind, row.purgeAt, now)) === "sent";
}

function purgeOwed(row: AccountStateRow, now: Date): boolean {
  return Boolean(row.requestedAt && row.purgeAt && !row.deletedAt && row.purgeAt.getTime() <= now.getTime());
}

async function purge(ctx: DeletionContext, row: AccountStateRow, now: Date): Promise<boolean> {
  if (!purgeOwed(row, now)) return false;
  const db = await ctx.table();
  const leaseExpired = new Date(now.getTime() - PURGE_LEASE_MS);
  // The lease: taken from nobody, or from a pass that died over 30 min ago.
  const claimed = await db.updateMany({
    where: {
      userId: row.userId,
      deletedAt: null,
      requestedAt: { not: null },
      purgeAt: { lte: now },
      OR: [{ purgeClaimedAt: null }, { purgeClaimedAt: { lte: leaseExpired } }],
    },
    data: { purgeClaimedAt: now },
  });
  if (claimed.count !== 1) return false;
  // `erase` must be idempotent: after a failure the lease expires and it runs again.
  await ctx.config.erase(row.userId, (await ctx.config.emailOf(row.userId)) ?? "", now);
  await ctx.config.audit("purged", row.userId, now);
  // A mail still owed to a purged account is moot: the outbox goes with it.
  const done = await db.updateMany({
    where: { userId: row.userId, purgeClaimedAt: now, deletedAt: null },
    data: { deletedAt: now, mailOwed: null, mailPurgeAt: null, mailClaimedAt: null },
  });
  return done.count === 1;
}

async function owedMail(ctx: DeletionContext, row: AccountStateRow, now: Date): Promise<Outcome> {
  if (!row.mailOwed || !row.mailPurgeAt) return "none";
  const flushed = await flush(ctx, row.userId, row.mailOwed, row.mailPurgeAt, now);
  if (flushed === "sent") return "mailed";
  return flushed === "failed" ? "failed" : "none";
}

async function work(ctx: DeletionContext, row: AccountStateRow, now: Date): Promise<Outcome> {
  if (await purge(ctx, row, now)) return "purged";
  if (row.mailOwed) return owedMail(ctx, row, now);
  return (await remind(ctx, row, now)) ? "mailed" : "none";
}

function needsWork(after: string, now: Date): Record<string, unknown> {
  const leaseExpired = new Date(now.getTime() - PURGE_LEASE_MS);
  return {
    userId: { gt: after },
    deletedAt: null,
    OR: [
      { mailOwed: { not: null } },
      { requestedAt: { not: null }, purgeAt: { lte: now }, OR: [{ purgeClaimedAt: null }, { purgeClaimedAt: { lte: leaseExpired } }] },
      { requestedAt: { not: null }, purgeAt: { gt: now, lte: new Date(now.getTime() + 7 * DAY_MS) }, remindedWeekAt: null },
      { requestedAt: { not: null }, purgeAt: { gt: now, lte: new Date(now.getTime() + DAY_MS) }, remindedDayAt: null },
    ],
  };
}

/** One page's rows, each worked on its own: one that throws is counted and told, the rest go on. */
async function workPage(ctx: DeletionContext, rows: readonly AccountStateRow[], now: Date, tally: Record<Exclude<Outcome, "none">, number>): Promise<void> {
  for (const row of rows) {
    try {
      const outcome = await work(ctx, row, now);
      if (outcome !== "none") tally[outcome] += 1;
    } catch (error) {
      tally.failed += 1;
      ctx.reportError(error, "sweep", row.userId);
    }
  }
}

export async function sweepDeletions(ctx: DeletionContext, now: Date): Promise<SweepSummary> {
  const tally = { mailed: 0, purged: 0, failed: 0 };
  let after = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await (await ctx.table()).findMany({ where: needsWork(after, now), orderBy: { userId: "asc" }, take: PAGE });
    await workPage(ctx, rows, now, tally);
    if (rows.length < PAGE) break;
    after = rows[rows.length - 1]?.userId ?? after;
  }
  return tally;
}
