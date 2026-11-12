import { MARKETPLACE_OUTBOUND_JOB, enqueueOutbound, type OutboundAction } from "./outbound-queue";
import type { EngineContext } from "./ports";

/**
 * The outbound sweep: nothing owed to a marketplace is lost.
 *
 * A decision queues its call right after the commit, but a queue can refuse
 * the job, a process can die between the commit and the enqueue, and a job can
 * die without stamping. The ROW still says what is owed — a PENDING request,
 * or an ACCEPTED order with neither confirm stamp — so this pass re-queues
 * every such row once it is older than the outbound job's own retry span.
 *
 * Bounded both ways:
 * - younger than {@link OUTBOUND_STALE_MS}: the original job may still be
 *   retrying, so it is left alone;
 * - older than {@link OUTBOUND_GIVE_UP_MS}: a marketplace has long since
 *   settled the order on its own clock. A PENDING request that old is stamped
 *   FAILED (a person finishes it on the marketplace, through the app link),
 *   and an accept that old is never confirmed — which is also what keeps a
 *   host's ACCEPTED history from before this engine from being confirmed on
 *   the first pass.
 *
 * Re-queued under a key of its own per pass: a queue keeps a finished job's id
 * and would swallow a re-queue under the job's plain key. The job itself is
 * idempotent by the row, so a duplicate run calls nobody twice.
 */

/** Longer than the outbound job's three attempts with their backoff. */
export const OUTBOUND_STALE_MS = 10 * 60_000;

/** Past this, a marketplace has settled the order without us. */
export const OUTBOUND_GIVE_UP_MS = 24 * 60 * 60_000;

/** What one sweep pass did. */
export interface OutboundSweepResult {
  requeued: number;
  givenUp: number;
}

interface OwedRow {
  clientId: string;
  orderId: string;
  provider: string;
}

const OWED_SELECT = { clientId: true, orderId: true, provider: true } as const;

/** The sweep's own dedupe key: distinct from the job's, and per pass. */
function sweepDedupeKey(action: OutboundAction, orderId: string, now: Date): string {
  return `${MARKETPLACE_OUTBOUND_JOB}:${action}:${orderId}:sweep:${now.getTime()}`;
}

async function requeue(ctx: EngineContext, rows: readonly OwedRow[], action: OutboundAction, now: Date): Promise<number> {
  let queued = 0;
  for (const row of rows) {
    const payload = { clientId: row.clientId, orderId: row.orderId, action };
    if (await enqueueOutbound(ctx, payload, row.provider, sweepDedupeKey(action, row.orderId, now))) queued += 1;
  }
  return queued;
}

/** Re-queue every owed call older than the job's retry span; give up on the ancient ones. */
export async function sweepOutbound(ctx: EngineContext, now: Date): Promise<OutboundSweepResult> {
  const db = await ctx.ports.db();
  const stale = new Date(now.getTime() - OUTBOUND_STALE_MS);
  const giveUp = new Date(now.getTime() - OUTBOUND_GIVE_UP_MS);

  const abandoned = await db.marketplaceAcceptance.updateMany({
    where: { cancellationStatus: "PENDING", cancellationRequestedAt: { lt: giveUp } },
    data: { cancellationStatus: "FAILED" },
  });
  const cancellations = (await db.marketplaceAcceptance.findMany({
    where: { cancellationStatus: "PENDING", cancellationRequestedAt: { lt: stale, gte: giveUp } },
    select: OWED_SELECT,
  })) as OwedRow[];
  const confirms = (await db.marketplaceAcceptance.findMany({
    where: {
      status: "ACCEPTED",
      confirmedAt: null,
      confirmFailedAt: null,
      acknowledgedAt: { lt: stale, gte: giveUp },
    },
    select: OWED_SELECT,
  })) as OwedRow[];

  const requeued =
    (await requeue(ctx, cancellations, "requestCancellation", now)) + (await requeue(ctx, confirms, "confirm", now));
  if (abandoned.count > 0) ctx.ports.logger.error(`marketplace.outbound-sweep: gave up on ${abandoned.count} cancellation request(s).`);
  return { requeued, givenUp: abandoned.count };
}
