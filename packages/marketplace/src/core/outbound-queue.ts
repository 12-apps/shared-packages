import type { EngineContext } from "./ports";
import type { MarketplaceProvider } from "./types";

/**
 * The outbound job's name and payload — what a decision QUEUES.
 *
 * No path that answers a request ever calls a marketplace: an aceite, a
 * refusal, a webhook and an ingest only enqueue this, and the job does the
 * call. The payload carries identifiers only; the reason code and every
 * outcome live on the acceptance row, so a replayed or duplicated job reads
 * the truth rather than a stale copy of it.
 */

/** The wire name, `<namespace>.<blueprint>` as the jobs contribution binds it. */
export const MARKETPLACE_OUTBOUND_JOB = "marketplace.outbound";

/** What goes out: the store's aceite, or the store's cancellation request. */
export type OutboundAction = "confirm" | "requestCancellation";

/** The outbound job's payload. Identifiers only. */
export interface OutboundJobPayload {
  clientId: string;
  orderId: string;
  action: OutboundAction;
}

/** The dedupe key: at most one queued call per (order, action). */
export function outboundDedupeKey(payload: OutboundJobPayload): string {
  return `${MARKETPLACE_OUTBOUND_JOB}:${payload.action}:${payload.orderId}`;
}

/**
 * Queue one outbound call, when the marketplace's API can take it at all.
 *
 * A marketplace whose adapter states no API for the action gets nothing
 * queued: there is nobody to call, and the host shows the app link instead.
 * The queue port never throws. A refusal to enqueue is logged AND recovered:
 * the row still owes the call (PENDING, or ACCEPTED with no confirm stamp),
 * and the outbound sweep re-queues every such row (`./outbound-sweep.ts`).
 *
 * `dedupeKey` defaults to the job's own key; the sweep passes its own, since a
 * queue keeps a finished job's id and would swallow a re-queue under it.
 */
export async function enqueueOutbound(
  ctx: EngineContext,
  payload: OutboundJobPayload,
  provider: MarketplaceProvider,
  dedupeKey: string = outboundDedupeKey(payload),
): Promise<boolean> {
  const adapter = ctx.registry.get(provider);
  if (!adapter) return false;
  const able =
    payload.action === "confirm" ? adapter.capabilities.apiConfirm : adapter.capabilities.apiCancel;
  if (!able) return false;
  const outcome = await ctx.ports.enqueue.enqueue(MARKETPLACE_OUTBOUND_JOB, payload, { dedupeKey });
  if (!outcome.enqueued) {
    ctx.ports.logger.warn(
      `${MARKETPLACE_OUTBOUND_JOB}: ${payload.action} for order ${payload.orderId} was not queued; the outbound sweep will re-queue it` +
        (outcome.reason ? ` (${outcome.reason})` : ""),
    );
  }
  return outcome.enqueued;
}
