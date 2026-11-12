import { NO_STANDING_REQUEST } from "./cancellation";
import { cancellationWindowMs, failedRequestData, tellCancellationFailed } from "./cancellation-outcome";
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
 *   settled the order on its own clock. A request still waiting that old is
 *   stamped FAILED, TIMEOUT (a person finishes it on the marketplace, through
 *   the app link),
 *   and an accept that old is never confirmed — which is also what keeps a
 *   host's ACCEPTED history from before this engine from being confirmed on
 *   the first pass.
 *
 * Before any of that, a store's cancellation request still waiting (PENDING:
 * never delivered, or REQUESTED: delivered and unanswered) past its
 * marketplace's answer window — the engine's `cancellationWindowMs`, else the
 * adapter's `cancellationAnswerWindowMs`, counted from the request — is FAILED
 * as TIMEOUT, and the host hears it through `onCancellationFailed` (FUT-4758,
 * the owner: "it cannot stay in that state with nothing happening"). The
 * store then cancels in the marketplace's own app. A PENDING request's
 * retries stop with it: the job re-reads the row and sends only from PENDING,
 * a run that starts past the window ends TIMEOUT itself without calling, and
 * this sweep re-queues no FAILED row. The window is read at the sweep's own
 * cadence, so a request ends between the window and the window plus one pass.
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
  /** Requests still waiting past {@link OUTBOUND_GIVE_UP_MS}, failed as TIMEOUT. */
  givenUp: number;
  /** Requests failed as TIMEOUT past their marketplace's answer window. */
  timedOut: number;
}

/** A store's cancellation request still waiting on the marketplace. */
const WAITING = ["PENDING", "REQUESTED"];

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
/**
 * Fail as TIMEOUT every request in `rows` still waiting, one predicated write
 * each, so a confirmation that lands meanwhile wins and its host hears nothing
 * twice. Returns how many moved.
 */
export async function failAsTimeout(ctx: EngineContext, rows: readonly OwedRow[]): Promise<number> {
  const db = await ctx.ports.db();
  let failed = 0;
  for (const row of rows) {
    const moved = await db.marketplaceAcceptance.updateMany({
      where: { orderId: row.orderId, clientId: row.clientId, cancellationStatus: { in: WAITING } },
      data: failedRequestData("TIMEOUT"),
    });
    if (moved.count === 0) continue;
    failed += 1;
    ctx.ports.publishChanged(row.clientId);
    await tellCancellationFailed(ctx, row.clientId, row.orderId, "TIMEOUT");
  }
  return failed;
}

/** Every request in `statuses` since before `cutoff`, for one provider or all. */
async function waitingSince(
  ctx: EngineContext,
  cutoff: Date,
  statuses: readonly string[],
  provider?: string,
): Promise<OwedRow[]> {
  const db = await ctx.ports.db();
  return (await db.marketplaceAcceptance.findMany({
    where: { ...(provider ? { provider } : {}), cancellationStatus: { in: statuses }, cancellationRequestedAt: { lt: cutoff } },
    select: OWED_SELECT,
  })) as OwedRow[];
}

/** Fail every request still waiting past its marketplace's window; no window, only the give-up. */
async function expireUnanswered(ctx: EngineContext, now: Date): Promise<number> {
  let expired = 0;
  for (const provider of ctx.registry.providers()) {
    const adapter = ctx.registry.get(provider);
    const window = adapter ? cancellationWindowMs(ctx, adapter) : null;
    if (window === null) continue;
    const cutoff = new Date(now.getTime() - window);
    expired += await failAsTimeout(ctx, await waitingSince(ctx, cutoff, WAITING, provider));
  }
  return expired;
}

/**
 * One sweep pass: expire the requests nobody answered, give up on the very old,
 * and re-queue what is still owed.
 */
export async function sweepOutbound(ctx: EngineContext, now: Date): Promise<OutboundSweepResult> {
  const db = await ctx.ports.db();
  const stale = new Date(now.getTime() - OUTBOUND_STALE_MS);
  const giveUp = new Date(now.getTime() - OUTBOUND_GIVE_UP_MS);

  const timedOut = await expireUnanswered(ctx, now);
  const givenUp = await failAsTimeout(ctx, await waitingSince(ctx, giveUp, WAITING));
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
      // An accept the store asked to cancel is not confirmed while the request waits.
      ...NO_STANDING_REQUEST,
    },
    select: OWED_SELECT,
  })) as OwedRow[];

  const requeued =
    (await requeue(ctx, cancellations, "requestCancellation", now)) + (await requeue(ctx, confirms, "confirm", now));
  if (givenUp > 0) ctx.ports.logger.error(`marketplace.outbound-sweep: gave up on ${givenUp} cancellation request(s).`);
  return { requeued, givenUp, timedOut };
}
