import { OUTBOUND_GIVE_UP_MS, OUTBOUND_STALE_MS } from "./outbound-sweep";
import {
  availabilityDedupeKey,
  enqueueAvailability,
  hasPauseTable,
  holdsSomething,
  pauseTable,
  type StorePauseRow,
} from "./pause-store";
import type { EngineContext } from "./ports";

/**
 * The availability sweep (`marketplace.availability-sweep`, every five
 * minutes): nothing the engine owes a marketplace for a store's pause is lost,
 * and no store stays closed past the kitchen's pause (FUT-4851).
 *
 * - **Expired**: a pause whose `until` has passed without a renewal is over.
 *   The host stopped renewing (it died, or forgot to resume), so the engine
 *   resumes on its own: the owner's "never closed on a marketplace longer than
 *   the kitchen's own pause". An interruption has already ended on the
 *   marketplace (its delete answers "gone", which is done); a switch would
 *   otherwise stay off for good.
 * - **Stale**: an ask still PAUSING or RESUMING after the job's own retry span
 *   (a refused enqueue, a dead process) is re-queued; past
 *   {@link OUTBOUND_GIVE_UP_MS} it is FAILED as unanswered.
 * - **A failed resume that still holds something** is retried each pass until
 *   the give-up: a store must not stay closed because one delete failed.
 * - **A replaced closure** an extend could not delete is retried.
 *
 * Re-queued under a key of its own per pass, as the outbound sweep does. The
 * job is idempotent by the row and leased, so a duplicate run calls nobody
 * twice.
 */

/** What one pass did. */
export interface AvailabilitySweepResult {
  /** Pauses past their `until`, turned into resumes. */
  expired: number;
  /** Asks re-queued. */
  requeued: number;
  /** Asks failed as unanswered past the give-up. */
  givenUp: number;
}

const sweepKey = (row: StorePauseRow, now: Date): string =>
  availabilityDedupeKey({ clientId: row.clientId, provider: row.provider }, row.requestedAt, `:sweep:${now.getTime()}`);

async function requeue(ctx: EngineContext, rows: readonly StorePauseRow[], now: Date): Promise<number> {
  let queued = 0;
  for (const row of rows) {
    if (await enqueueAvailability(ctx, { clientId: row.clientId, provider: row.provider }, sweepKey(row, now))) queued += 1;
  }
  return queued;
}

/** Pauses past their end: resume them, predicated on nobody having renewed meanwhile. */
async function expire(ctx: EngineContext, now: Date): Promise<number> {
  const table = pauseTable(await ctx.ports.db());
  const rows = (await table.findMany({
    where: { wanted: "PAUSED", state: { in: ["PAUSING", "PAUSED", "FAILED"] }, until: { lt: now } },
  })) as StorePauseRow[];
  let expired = 0;
  for (const row of rows) {
    const held = holdsSomething(row);
    const moved = await table.updateMany({
      where: { id: row.id, wanted: "PAUSED", until: row.until },
      data: { wanted: "OPEN", state: held ? "RESUMING" : "OPEN", requestedAt: now, failureCode: null, failureDetail: null, failedAt: null },
    });
    if (moved.count === 0) continue;
    expired += 1;
    ctx.ports.publishChanged(row.clientId);
    if (held) await requeue(ctx, [{ ...row, requestedAt: now }], now);
  }
  return expired;
}

/** Asks waiting past the give-up: FAILED as unanswered. */
async function giveUp(ctx: EngineContext, cutoff: Date, now: Date): Promise<number> {
  const table = pauseTable(await ctx.ports.db());
  let failed = 0;
  for (const [state, code] of [["PAUSING", "PAUSE_UNANSWERED"], ["RESUMING", "RESUME_UNANSWERED"]] as const) {
    const moved = await table.updateMany({
      where: { state, requestedAt: { lt: cutoff } },
      data: { state: "FAILED", failureCode: code, failureDetail: null, failedAt: now },
    });
    failed += moved.count;
  }
  return failed;
}

/** A failed resume that still holds something, failed for a while and asked inside the give-up: back to RESUMING. */
async function retryFailedResumes(ctx: EngineContext, stale: Date, cutoff: Date): Promise<StorePauseRow[]> {
  const table = pauseTable(await ctx.ports.db());
  const rows = (await table.findMany({
    where: { state: "FAILED", wanted: "OPEN", failedAt: { lt: stale }, requestedAt: { gte: cutoff } },
  })) as StorePauseRow[];
  const retried: StorePauseRow[] = [];
  for (const row of rows.filter(holdsSomething)) {
    const moved = await table.updateMany({ where: { id: row.id, state: "FAILED", wanted: "OPEN" }, data: { state: "RESUMING" } });
    if (moved.count > 0) retried.push(row);
  }
  return retried;
}

/** One sweep pass. A host whose database has no pause model sweeps nothing. */
export async function sweepAvailability(ctx: EngineContext, now: Date): Promise<AvailabilitySweepResult> {
  const db = await ctx.ports.db();
  if (!hasPauseTable(db)) return { expired: 0, requeued: 0, givenUp: 0 };
  const table = pauseTable(db);
  const stale = new Date(now.getTime() - OUTBOUND_STALE_MS);
  const cutoff = new Date(now.getTime() - OUTBOUND_GIVE_UP_MS);

  const expired = await expire(ctx, now);
  const givenUp = await giveUp(ctx, cutoff, now);
  const waiting = (await table.findMany({
    where: { state: { in: ["PAUSING", "RESUMING"] }, requestedAt: { lt: stale, gte: cutoff } },
  })) as StorePauseRow[];
  const retired = (await table.findMany({ where: { state: "PAUSED", retiredExternalId: { not: null } } })) as StorePauseRow[];
  const failedResumes = await retryFailedResumes(ctx, stale, cutoff);
  const requeued = await requeue(ctx, [...waiting, ...retired, ...failedResumes], now);
  if (givenUp > 0) ctx.ports.logger.error(`marketplace.availability-sweep: gave up on ${givenUp} store pause ask(s).`);
  return { expired, requeued, givenUp };
}
