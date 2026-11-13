import { cancelAcceptance } from "./acceptance";
import { failCancellationRequest } from "./cancellation";
import { awaitOrderBody, merchantMismatch, requeueOwedFetch } from "./fetch-order";
import { deferInboxEvent, recordInboxEvent, settleInboxEvent } from "./inbox";
import { ingestMarketplaceOrder, type IngestSettings } from "./ingest";
import { connectionMerchantId, resolveIngestionTarget } from "./integration";
import { markCancelledBeforeIngest } from "./order-fetch-marks";
import type { EngineContext } from "./ports";
import type { MarketplaceProvider, NormalizedEvent, NormalizedMarketplaceOrder } from "./types";

/**
 * One delivery, start to finish: normalize → inbox → ingest.
 *
 * The ONE path both producers use. The webhook calls it, and so does the
 * reconciliation retry sweep — which is the whole reason it is a module rather
 * than the body of a route handler. Two producers with two copies of this
 * sequence is how a webhook and a poll come to disagree about what an order is,
 * and the disagreement only shows up on the orders that took the unlucky path.
 */

/**
 * Normalize a raw payload through the provider's adapter, or null when no
 * adapter is registered for it or the adapter refuses the payload. The
 * registry is the only dispatch: there is no provider branch here.
 */
export function normalizeEvent(
  ctx: EngineContext,
  provider: MarketplaceProvider,
  payload: unknown,
): NormalizedEvent | null {
  return ctx.registry.get(provider)?.normalize(payload) ?? null;
}

/** How a delivery ended. `duplicate` and `ignored` are both ordinary outcomes. */
export type DeliveryOutcome =
  | { kind: "ingested"; orderId: string; unmappedSkus: string[] }
  | { kind: "cancelled" }
  | { kind: "cancellationFailed" }
  /** Recorded; the order body is fetched by the `marketplace.fetch-order` job. */
  | { kind: "awaitingOrder" }
  | { kind: "duplicate" }
  | { kind: "ignored"; reason: string }
  | { kind: "failed"; reason: string };

/**
 * Process one delivery for one tenant.
 *
 * NEVER throws. Every failure is caught, recorded on the inbox row, and
 * returned — because the caller is a webhook handler whose answer decides
 * whether the marketplace redelivers, and a 500 out of here would make an
 * ingestion bug indistinguishable from a network one while multiplying the
 * traffic that hits it.
 *
 * The delivery is recorded BEFORE it is processed. That ordering is the durable
 * part of the durable inbox: a process that dies mid-ingest leaves a PENDING
 * row the sweep will retry, whereas processing first and recording after loses
 * the event entirely on exactly the crashes worth surviving.
 */
export async function processDelivery(
  ctx: EngineContext,
  input: {
    clientId: string | null;
    event: NormalizedEvent;
    payload: unknown;
    settings: IngestSettings | null;
    now?: Date;
  },
): Promise<DeliveryOutcome> {
  const { clientId, event, settings } = input;
  const record = await recordInboxEvent(ctx, { clientId, event, payload: input.payload });
  if (!record.fresh) return { kind: "duplicate" };

  if (!clientId || !settings) {
    // Stored, not dropped, and the two reasons are kept apart because only one
    // of them is a problem. An order naming a merchant no tenant claims is the
    // loudest possible symptom of a half-finished onboarding, and it is only
    // findable later because the row survived. An order for a store that has
    // simply switched the channel off is not a fault at all — it stays PENDING
    // for the retry sweep to pick up if the store switches it back on.
    const reason = clientId ? "integration is not enabled" : "no tenant claims this merchant";
    if (clientId) await deferInboxEvent(ctx, record.id, reason);
    else await settleInboxEvent(ctx, record.id, "IGNORED", reason);
    return { kind: "ignored", reason };
  }

  try {
    return await applyEvent(ctx, record.id, clientId, event, settings, input.now);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await settleInboxEvent(ctx, record.id, "FAILED", reason);
    return { kind: "failed", reason };
  }
}

/** The event names an order whose body the marketplace serves apart (`orderToFetch`). */
function announcesOrderToFetch(event: NormalizedEvent): boolean {
  return event.order === null && event.orderToFetch === true && event.externalOrderId !== null;
}

/**
 * Why an order the event CARRIES must not be ingested for this store: it names
 * another merchant than the connection's (a wrong webhook URL, a replay), the
 * rule a fetched order is held to. Read only for an order that names its
 * merchant (an adapter that sets `externalMerchantId` on the order); an order
 * that names none costs no read.
 */
async function carriedOrderMismatch(
  ctx: EngineContext,
  clientId: string,
  order: NormalizedMarketplaceOrder,
): Promise<string | null> {
  if (!order.externalMerchantId) return null;
  // The one column, never the whole target: no credentials opened per order.
  return merchantMismatch(order, await connectionMerchantId(ctx, clientId, order.provider));
}

/**
 * Act on one recorded delivery: cancel, ingest, or deliberately nothing.
 *
 * Extracted so both producers share the ACTION as well as the recording — the
 * webhook and the retry sweep differ only in how they arrived here and in what
 * they do with a throw, never in what an event MEANS.
 */
async function applyEvent(
  ctx: EngineContext,
  inboxId: string,
  clientId: string,
  event: NormalizedEvent,
  settings: IngestSettings,
  now: Date | undefined,
): Promise<DeliveryOutcome> {
  const outcome = event.cancellationOutcome ?? (event.cancelled ? "CONFIRMED" : null);
  if (outcome === "FAILED" && event.externalOrderId) {
    // The marketplace refused the store's own cancellation request. Understood
    // and recorded, never IGNORED: it is what tells a person to finish the
    // cancellation on the marketplace's side.
    await failCancellationRequest(ctx, {
      clientId,
      provider: event.provider,
      externalOrderId: event.externalOrderId,
    });
    await settleInboxEvent(ctx, inboxId, "PROCESSED");
    return { kind: "cancellationFailed" };
  }

  if (event.cancelled && event.externalOrderId) {
    const order = { clientId, provider: event.provider, externalOrderId: event.externalOrderId };
    // A cancellation that outran a fetched order's body leaves its marker, so
    // the fetch that follows ingests nothing.
    if (!(await cancelAcceptance(ctx, { ...order, now }))) await markCancelledBeforeIngest(ctx, order);
    await settleInboxEvent(ctx, inboxId, "PROCESSED");
    return { kind: "cancelled" };
  }

  if (announcesOrderToFetch(event)) {
    // The event announces an order whose body the marketplace serves apart.
    // Fetching is a call to the marketplace, so it is a job's, never this
    // request's: the row waits PENDING and the fetch is queued.
    await awaitOrderBody(ctx, clientId, inboxId);
    return { kind: "awaitingOrder" };
  }

  if (!event.order) {
    // An event type this ingestion does not act on. Marketplaces emit a wide
    // stream (dispatched, concluded, driver assigned…) and most of it is not an
    // order; IGNORED says "understood, nothing to do" and keeps it out of the
    // retry sweep, which FAILED would not.
    const reason = `no order body on ${event.eventType}`;
    await settleInboxEvent(ctx, inboxId, "IGNORED", reason);
    return { kind: "ignored", reason };
  }

  return ingestCarried(ctx, inboxId, clientId, event.order, settings, now);
}

/** Ingest the order an event carries, unless it names another merchant than the connection's. */
async function ingestCarried(
  ctx: EngineContext,
  inboxId: string,
  clientId: string,
  order: NormalizedMarketplaceOrder,
  settings: IngestSettings,
  now: Date | undefined,
): Promise<DeliveryOutcome> {
  const mismatch = await carriedOrderMismatch(ctx, clientId, order);
  if (mismatch) {
    // FAILED, so the reconciliation sweep retries it once the connection's
    // merchant id is corrected, within the inbox's attempt bound.
    await settleInboxEvent(ctx, inboxId, "FAILED", mismatch);
    ctx.ports.logger.error(`marketplace.ingest: inbox row ${inboxId} refused: ${mismatch}`);
    return { kind: "failed", reason: mismatch };
  }
  const result = await ingestMarketplaceOrder(ctx, { clientId, order, settings, now });
  await settleInboxEvent(ctx, inboxId, "PROCESSED");
  return { kind: "ingested", orderId: result.orderId, unmappedSkus: result.unmappedSkus };
}

/**
 * Re-run a delivery already sitting in the inbox.
 *
 * Used by the retry sweep. It re-reads the store's CURRENT settings rather than
 * whatever they were when the event first arrived — a store that connected the
 * channel properly an hour after the first order came in should have that order
 * ingested on the retry, which is the case this exists for.
 */
export async function reprocessStoredDelivery(
  ctx: EngineContext,
  input: { id: string; clientId: string; provider: MarketplaceProvider; payload: unknown; receivedAt?: Date | null },
): Promise<DeliveryOutcome> {
  const event = normalizeEvent(ctx, input.provider, input.payload);
  if (!event) {
    const reason = "payload no longer normalizes";
    await settleInboxEvent(ctx, input.id, "IGNORED", reason);
    return { kind: "ignored", reason };
  }
  const target = await resolveIngestionTarget(ctx, input.clientId, input.provider);
  if (!target?.enabled) {
    // Still not ready. Deferred rather than settled, for the same reason as on
    // arrival — and the attempt counter is what eventually retires it, so a
    // store that never switches the channel on does not have its inbox re-read
    // forever.
    const reason = "integration is not enabled";
    await deferInboxEvent(ctx, input.id, reason);
    return { kind: "ignored", reason };
  }
  // A row waiting for its order body is the fetch job's: re-queued, never fetched here.
  if (announcesOrderToFetch(event)) return requeueOwedFetch(ctx, input);
  try {
    return await applyEvent(
      ctx,
      input.id,
      input.clientId,
      event,
      { autoAccept: target.autoAccept, ackSlaSeconds: target.ackSlaSeconds },
      undefined,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await settleInboxEvent(ctx, input.id, "FAILED", reason);
    return { kind: "failed", reason };
  }
}
