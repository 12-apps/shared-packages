import type { DeletionContext } from "./context";
import { flush } from "./outbox";
import { isFreshSignIn, purgeDateOf } from "./schedule-math";
import type { CancelOutcome, ScheduleOutcome } from "./service";
import type { AccountStateRow, DeletionBlocker, DeletionCaller, DeletionForfeit, DeletionReport } from "./types";

/**
 * The person's two acts — scheduling and cancelling — and the screen they are
 * decided against. Every write carries the state it expects in its WHERE, so a
 * double tap, or a tap racing the sweep, settles on one outcome.
 */

type Refusal = Extract<ScheduleOutcome, { ok: false }>["reason"];

const isUniqueViolation = (error: unknown): boolean => (error as { code?: string } | null)?.code === "P2002";

interface Facts {
  readonly row: AccountStateRow | null;
  readonly blockers: readonly DeletionBlocker[];
  readonly forfeits: readonly DeletionForfeit[];
  readonly hasPassword: boolean;
}

async function readFacts(ctx: DeletionContext, userId: string, now: Date): Promise<Facts> {
  const { config } = ctx;
  const [row, blockers, forfeits, hasPassword] = await Promise.all([
    ctx.read(userId),
    config.blockers ? config.blockers(userId, now) : [],
    config.forfeits ? config.forfeits(userId, now) : [],
    config.hasPassword(userId),
  ]);
  return { row, blockers, forfeits, hasPassword };
}

export async function reportFor(ctx: DeletionContext, caller: DeletionCaller, now: Date): Promise<DeletionReport> {
  const { row, blockers, forfeits, hasPassword } = await readFacts(ctx, caller.userId, now);
  const pending = Boolean(row?.requestedAt && !row.deletedAt);
  return {
    state: pending ? "pending" : "active",
    purgeAt: pending ? (row?.purgeAt?.toISOString() ?? null) : null,
    graceDays: ctx.config.graceDays,
    blockers,
    forfeits,
    confirm: hasPassword ? "password" : "google",
    freshSignIn: isFreshSignIn(caller.signedInAt, now.getTime(), ctx.freshMs),
    canSchedule: !pending && blockers.length === 0,
  };
}

async function confirm(ctx: DeletionContext, caller: DeletionCaller, shown: DeletionReport, password: string | null): Promise<Refusal | null> {
  if (shown.confirm === "google") return shown.freshSignIn ? null : "sign-in-again";
  if (!password) return "wrong-password";
  const checked = await ctx.config.checkPassword(caller.email, password);
  if (checked === "rate-limited") return "rate-limited";
  return checked === "ok" ? null : "wrong-password";
}

/** The one write that schedules: wins only from "nothing scheduled", so a double tap schedules once. */
async function claimSchedule(ctx: DeletionContext, userId: string, now: Date, purgeAt: Date): Promise<boolean> {
  const db = await ctx.table();
  const scheduled = {
    requestedAt: now,
    purgeAt,
    remindedWeekAt: null,
    remindedDayAt: null,
    purgeClaimedAt: null,
    mailOwed: "scheduled",
    mailPurgeAt: purgeAt,
    mailClaimedAt: null,
  };
  const { count } = await db.updateMany({
    where: { userId, requestedAt: null, deletedAt: null },
    data: { ...scheduled, sessionEpoch: { increment: 1 } },
  });
  if (count === 1) return true;
  if (await db.findUnique({ where: { userId } })) return false;
  try {
    await db.create({ data: { userId, sessionEpoch: 1, ...scheduled } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/** Why this caller may not schedule now, or `null`. */
async function refusalFor(ctx: DeletionContext, caller: DeletionCaller, password: string | null, now: Date): Promise<Refusal | null> {
  if (caller.impersonated) return "impersonating";
  const shown = await reportFor(ctx, caller, now);
  if (shown.state === "pending") return "pending";
  if (!shown.canSchedule) return "blocked";
  const refused = await confirm(ctx, caller, shown, password);
  if (refused) return refused;
  return (await ctx.read(caller.userId))?.deletedAt ? "deleted" : null;
}

export async function scheduleDeletion(ctx: DeletionContext, caller: DeletionCaller, password: string | null, now: Date): Promise<ScheduleOutcome> {
  const refused = await refusalFor(ctx, caller, password, now);
  if (refused) return { ok: false, reason: refused };
  const purgeAt = purgeDateOf(now, ctx.config.graceDays);
  if (!(await claimSchedule(ctx, caller.userId, now, purgeAt))) return { ok: false, reason: "pending" };
  // The act is done (the epoch moved): what follows is recorded or retried, never a reason to fail it.
  const { config } = ctx;
  await ctx.tryHook("audit:scheduled", caller.userId, () => config.audit("scheduled", caller.userId, now));
  await flush(ctx, caller.userId, "scheduled", purgeAt, now);
  await ctx.tryHook("onScheduled", caller.userId, async () => {
    await config.onScheduled?.(caller.userId, caller.email, now);
  });
  return { ok: true, purgeAt };
}

export async function cancelDeletion(ctx: DeletionContext, caller: DeletionCaller, now: Date): Promise<CancelOutcome> {
  if (caller.impersonated) return { ok: false, reason: "impersonating" };
  const row = await ctx.read(caller.userId);
  if (!row?.purgeAt) return { ok: false, reason: "not-scheduled" };
  // Moves the epoch too: a token minted during the window (somebody else's,
  // with the password) does not outlive the cancel. The person signs in again.
  const { count } = await (await ctx.table()).updateMany({
    // Allowed until a purge actually claimed the account, even past the date.
    where: { userId: caller.userId, requestedAt: { not: null }, deletedAt: null, purgeClaimedAt: null },
    data: {
      requestedAt: null,
      purgeAt: null,
      remindedWeekAt: null,
      remindedDayAt: null,
      sessionEpoch: { increment: 1 },
      mailOwed: "cancelled",
      mailPurgeAt: row.purgeAt,
      mailClaimedAt: null,
    },
  });
  if (count !== 1) return { ok: false, reason: "not-scheduled" };
  await ctx.tryHook("audit:cancelled", caller.userId, () => ctx.config.audit("cancelled", caller.userId, now));
  await flush(ctx, caller.userId, "cancelled", row.purgeAt, now);
  return { ok: true };
}
