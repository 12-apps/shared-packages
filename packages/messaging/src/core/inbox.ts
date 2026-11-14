import type { EngineContext } from "./context";
import { errorText } from "./errors";
import { bodyHash } from "./hash";
import { handleEvent, type EventOutcome } from "./inbound";
import type { NormalizedEvent } from "./types";

/**
 * The durable inbox: persist the raw delivery, ACK, then process in a job.
 *
 * Nothing is resolved before the row is written — not the tenant, not even
 * whether the body parses — because the one thing a webhook must never do is
 * lose a delivery to a bug in the code that reads it. The raw bytes are kept
 * so a mapping bug can be replayed once fixed.
 */

/** The job the engine enqueues per fresh delivery, by wire name. */
export const PROCESS_DELIVERY_JOB = "messaging.process-delivery";

/** Store one verified delivery and queue its processing. Redeliveries are stored once. */
export async function receiveDelivery(
  ctx: EngineContext,
  channel: string,
  rawBody: string,
): Promise<{ deliveryId: string; fresh: boolean }> {
  const { store, clock, enqueue, logger } = ctx.config;
  const recorded = await store.recordDelivery({ channel, bodyHash: bodyHash(rawBody), rawBody, receivedAt: clock.now() });
  if (recorded.fresh) {
    const queued = await enqueue.enqueue(
      PROCESS_DELIVERY_JOB,
      { deliveryId: recorded.id },
      { dedupeKey: `${PROCESS_DELIVERY_JOB}:${recorded.id}` },
    );
    // Never fatal: the row is stored, and the reconciliation sweep runs it.
    if (!queued.enqueued) logger.warn(`messaging.inbox: delivery ${recorded.id} not queued (${queued.reason ?? "no reason"})`);
  }
  return { deliveryId: recorded.id, fresh: recorded.fresh };
}

/** What processing one stored delivery did. */
export type DeliveryOutcome =
  | { kind: "missing" }
  | { kind: "already-processed" }
  | { kind: "processed"; events: EventOutcome[] }
  | { kind: "unreadable"; reason: string };

/**
 * Process one stored delivery. Every event handler is idempotent (messages
 * dedupe on their channel id, receipts on their column), so a retry after a
 * partial failure redoes nothing. A throw settles the row FAILED and is
 * rethrown, so the job's own retry runs it again.
 */
export async function processDelivery(ctx: EngineContext, deliveryId: string): Promise<DeliveryOutcome> {
  const { store, clock, logger } = ctx.config;
  const row = await store.getDelivery(deliveryId);
  if (!row) return { kind: "missing" };
  if (row.state === "PROCESSED") return { kind: "already-processed" };

  const adapter = ctx.adapters.get(row.channel);
  let events: NormalizedEvent[];
  try {
    if (!adapter) throw new Error(`no adapter mounted for channel "${row.channel}"`);
    events = adapter.parse(row.rawBody);
  } catch (error) {
    // The same bytes will never read differently: settle it, with the reason,
    // rather than retry. The raw body stays for a replay once the code is fixed.
    const reason = errorText(error);
    logger.warn(`messaging.inbox: delivery ${deliveryId} unreadable: ${reason}`);
    await store.settleDelivery(deliveryId, { state: "PROCESSED", error: `unreadable: ${reason}`, at: clock.now() });
    return { kind: "unreadable", reason };
  }

  try {
    const outcomes: EventOutcome[] = [];
    for (const event of events) outcomes.push(await handleEvent(ctx, row.channel, event));
    await store.settleDelivery(deliveryId, { state: "PROCESSED", error: null, at: clock.now() });
    return { kind: "processed", events: outcomes };
  } catch (error) {
    await store.settleDelivery(deliveryId, { state: "FAILED", error: errorText(error), at: clock.now() });
    throw error;
  }
}

/**
 * Re-run deliveries left unprocessed (a dead worker, a refused enqueue, a
 * failure) once they are older than the job's own retry span. One delivery's
 * failure never stops the batch.
 */
export async function reconcileInbox(ctx: EngineContext): Promise<{ retried: number; failed: number }> {
  const { store, clock, logger, reconcileAfterMs, maxDeliveryAttempts, reconcileBatchSize } = ctx.config;
  const due = await store.listRetryableDeliveries({
    receivedBefore: new Date(clock.now().getTime() - reconcileAfterMs),
    maxAttempts: maxDeliveryAttempts,
    take: reconcileBatchSize,
  });
  let failed = 0;
  for (const row of due) {
    try {
      await processDelivery(ctx, row.id);
    } catch (error) {
      failed += 1;
      logger.warn(`messaging.inbox: delivery ${row.id} failed again: ${errorText(error)}`);
    }
  }
  return { retried: due.length, failed };
}
