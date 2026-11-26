import { deferInboxEvent, settleInboxEvent } from "./inbox";
import type { IngestSettings } from "./ingest";
import type { DeliveryOutcome } from "./pipeline";
import type { EngineContext } from "./ports";
import { readStatusRows, noteMarketplaceStep, statusTable } from "./status-store";
import type { MarketplaceDeliveredBy, MarketplaceLifecycle, NormalizedEvent } from "./types";

/**
 * Inbound lifecycle (FUT-4653): the marketplace says the order was dispatched
 * or concluded, and the order follows, FORWARD only.
 *
 * What the engine owns, in order, each stopping the event with a reason the
 * inbox row keeps:
 *
 * 1. an order the engine does not hold yet is DEFERRED (PENDING, one attempt
 *    counted), so the reconcile pass applies the event after the order's own
 *    event ingests, and retires it after `maxInboxAttempts` like any row;
 * 2. an order that is not ACCEPTED is never moved: the aceite is where the
 *    stock is judged, and an ended order is not revived;
 * 3. a cancellation request standing (PENDING or REQUESTED) is the store's
 *    last word and nothing here contradicts it;
 * 4. an event that answers a step WE informed (a STORE row for DISPATCHED, or
 *    for HANDED_OVER when the event is CONCLUDED) is an echo: the failure case
 *    of forward-only alone is the store's undo, where the echo would
 *    dispatch a card again with no courier.
 *
 * What the host owns (`onLifecycle`): whether the order can move, to where,
 * and how. Whatever it answers, the step is NOTED as the marketplace's, so our
 * own job never informs it back and nothing is informed after a CONCLUDED.
 *
 * A host that binds no `onLifecycle`, a connection with the switch OFF (or
 * settings built by hand without it) and a host without the status model get
 * `null`: the caller's old answer, "no order body", byte for byte.
 */

/** The step of the table an event's echo is looked for under. */
const ECHO_OF: Record<MarketplaceLifecycle, "DISPATCHED" | "HANDED_OVER"> = {
  DISPATCHED: "DISPATCHED",
  CONCLUDED: "HANDED_OVER",
};

interface HeldAcceptance {
  orderId: string;
  status: string;
  deliveredBy: string | null;
  cancellationStatus: string | null;
}

/** Settle the row IGNORED with a reason, and answer it. */
async function ignored(ctx: EngineContext, inboxId: string, reason: string): Promise<DeliveryOutcome> {
  await settleInboxEvent(ctx, inboxId, "IGNORED", reason);
  return { kind: "ignored", reason };
}

/** Why a held order is not moved by the marketplace's word, or null when it may be. */
function refusal(held: HeldAcceptance): string | null {
  if (held.status !== "ACCEPTED") return `the order is ${held.status}, not ACCEPTED`;
  // A request that FAILED left the order the store's own: only a standing one stops us.
  if (held.cancellationStatus === "PENDING" || held.cancellationStatus === "REQUESTED") {
    return `a cancellation request is ${held.cancellationStatus}`;
  }
  return null;
}

function deliveredByOf(held: HeldAcceptance): MarketplaceDeliveredBy | null {
  return held.deliveredBy === "MERCHANT" || held.deliveredBy === "MARKETPLACE" ? held.deliveredBy : null;
}

/** What `followLifecycle` needs once it is known the connection follows this event. */
interface Following {
  lifecycle: MarketplaceLifecycle;
  externalOrderId: string;
  hook: NonNullable<EngineContext["ports"]["order"]["onLifecycle"]>;
}

/** Whether this ingestion follows this event at all: a lifecycle, the switch ON, a host hook. */
function following(ctx: EngineContext, event: NormalizedEvent, settings: IngestSettings): Following | null {
  const hook = ctx.ports.order.onLifecycle;
  if (!event.lifecycle || !event.externalOrderId || !settings.followStatus || !hook) return null;
  return { lifecycle: event.lifecycle, externalOrderId: event.externalOrderId, hook };
}

/**
 * Apply one lifecycle event, or null when this ingestion does not follow it
 * (no lifecycle, switch OFF, no hook, no status model): the caller then does
 * what it did before FUT-4653.
 */
export async function followLifecycle(
  ctx: EngineContext,
  inboxId: string,
  clientId: string,
  event: NormalizedEvent,
  settings: IngestSettings,
): Promise<DeliveryOutcome | null> {
  const follow = following(ctx, event, settings);
  if (!follow) return null;
  const { lifecycle, hook } = follow;
  const db = await ctx.ports.db();
  const table = statusTable(db);
  if (!table) return null;

  const held = (await db.marketplaceAcceptance.findFirst({
    where: { clientId, provider: event.provider, externalOrderId: follow.externalOrderId },
    select: { orderId: true, status: true, deliveredBy: true, cancellationStatus: true },
  })) as HeldAcceptance | null;
  if (!held) {
    const reason = "lifecycle before its order";
    await deferInboxEvent(ctx, inboxId, reason);
    return { kind: "ignored", reason };
  }
  const stopped = refusal(held);
  if (stopped) return ignored(ctx, inboxId, stopped);

  const echo = ECHO_OF[lifecycle];
  const ours = (await readStatusRows(table, held.orderId, [echo])).some((row) => row.source === "STORE");
  if (ours) return ignored(ctx, inboxId, `echo of our ${echo}`);

  const answer = await hook.call(ctx.ports.order, clientId, held.orderId, event, { deliveredBy: deliveredByOf(held) });
  await noteMarketplaceStep(ctx, { clientId, orderId: held.orderId, provider: event.provider, step: lifecycle });
  if (answer === "moved") {
    await settleInboxEvent(ctx, inboxId, "PROCESSED");
    ctx.ports.publishChanged(clientId);
    return { kind: "moved", orderId: held.orderId, lifecycle };
  }
  const reason = answer === "unchanged" ? `already at or past ${lifecycle}` : answer.reason;
  if (answer !== "unchanged") ctx.ports.logger.warn(`marketplace.lifecycle: ${event.provider} order ${held.orderId}: ${reason}`);
  return ignored(ctx, inboxId, reason);
}
