import type { OutboundOrderRef } from "./adapter";
import type { CourierTrackingResult, MarketplaceCourierAnswer, MarketplaceCourierEngine } from "./courier-port";
import { deferInboxEvent, settleInboxEvent } from "./inbox";
import type { IngestSettings } from "./ingest";
import { readOutboundConnection } from "./integration";
import { followLifecycle } from "./lifecycle";
import { validatePickupCode } from "./pickup-code";
import type { DeliveryOutcome } from "./pipeline";
import type { EngineContext } from "./ports";
import type { MarketplaceDeliveredBy, MarketplaceCourierStep, NormalizedEvent } from "./types";

/**
 * The marketplace's own courier (FUT-5665), the engine's half: courier events
 * reach the host's `onCourier`, and the host's job reads the tracking.
 *
 * A courier event moves nothing: it is a fact the host stores (who is coming,
 * when they arrived, the bag coming back). The one that also moves the order,
 * `COLLECTED`, names the lifecycle too and goes through `followLifecycle`
 * like a `DISPATCHED`, after the host stored its facts.
 */

interface CourierAcceptance {
  orderId: string;
  status: string;
  deliveredBy: string | null;
}

/** What the courier half made of an event, before the inbox row is settled. */
type CourierStepOutcome =
  | { kind: "deferred" }
  | { kind: "stopped"; reason: string }
  | { kind: "recorded"; orderId: string; step: MarketplaceCourierStep };

function deliveredByOf(value: string | null): MarketplaceDeliveredBy | null {
  return value === "MERCHANT" || value === "MARKETPLACE" ? value : null;
}

function reasonOf(answer: MarketplaceCourierAnswer, step: MarketplaceCourierStep): string {
  if (answer === "unchanged") return `nothing to record for ${step}`;
  return answer === "recorded" ? "" : answer.reason;
}

/** Hand the courier's facts to the host, or null when this host or this event has none. */
async function followCourier(ctx: EngineContext, clientId: string, event: NormalizedEvent): Promise<CourierStepOutcome | null> {
  const hook = ctx.ports.order.onCourier;
  const courier = event.courier;
  if (!hook || !courier || !event.externalOrderId) return null;
  const db = await ctx.ports.db();
  const held = (await db.marketplaceAcceptance.findFirst({
    where: { clientId, provider: event.provider, externalOrderId: event.externalOrderId },
    select: { orderId: true, status: true, deliveredBy: true },
  })) as CourierAcceptance | null;
  if (!held) return { kind: "deferred" };
  if (held.status !== "ACCEPTED") return { kind: "stopped", reason: `the order is ${held.status}, not ACCEPTED` };
  const facts = { deliveredBy: deliveredByOf(held.deliveredBy), at: courier.at ?? ctx.ports.clock.now() };
  const answer = await hook.call(ctx.ports.order, clientId, held.orderId, courier, facts);
  if (answer === "recorded") return { kind: "recorded", orderId: held.orderId, step: courier.step };
  return { kind: "stopped", reason: reasonOf(answer, courier.step) };
}

/** Settle the inbox row for a courier event that named no lifecycle the host moved on. */
async function settleCourier(
  ctx: EngineContext,
  inboxId: string,
  clientId: string,
  outcome: CourierStepOutcome,
): Promise<DeliveryOutcome> {
  if (outcome.kind === "recorded") {
    await settleInboxEvent(ctx, inboxId, "PROCESSED");
    ctx.ports.publishChanged(clientId);
    return { kind: "courier", orderId: outcome.orderId, step: outcome.step };
  }
  if (outcome.kind === "deferred") {
    const reason = "courier event before its order";
    await deferInboxEvent(ctx, inboxId, reason);
    return { kind: "ignored", reason };
  }
  await settleInboxEvent(ctx, inboxId, "IGNORED", outcome.reason);
  return { kind: "ignored", reason: outcome.reason };
}

/**
 * The courier's facts first, then the lifecycle the event names: null when
 * neither applies (the caller then does what it did before). A lifecycle that
 * moved the order answers for the row; one that moved nothing (already past
 * it, an echo) leaves the row to the courier's facts when they were recorded.
 */
export async function followCourierAndLifecycle(
  ctx: EngineContext,
  inboxId: string,
  clientId: string,
  event: NormalizedEvent,
  settings: IngestSettings,
): Promise<DeliveryOutcome | null> {
  const courier = await followCourier(ctx, clientId, event);
  const followed = await followLifecycle(ctx, inboxId, clientId, event, settings);
  const recorded = courier?.kind === "recorded";
  if (followed && !(recorded && followed.kind === "ignored")) return followed;
  return courier ? settleCourier(ctx, inboxId, clientId, courier) : null;
}

interface TrackedAcceptance {
  orderId: string;
  provider: string;
  externalOrderId: string;
  externalDisplayId: string | null;
  deliveredBy: string | null;
  createdAt: Date;
}

/**
 * Read where the marketplace's courier is (FUT-5665). Calls the marketplace at
 * once, so the host runs it in a job, never on a tap or a screen load, and at
 * the marketplace's own rate (iFood: at most once per 30 s). `notYet` before a
 * courier is assigned; `unsupported` with no call for an order the engine does
 * not hold, a marketplace with no tracking, or a bag the store carries itself.
 */
export async function readCourierTracking(
  ctx: EngineContext,
  input: { clientId: string; orderId: string },
): Promise<CourierTrackingResult> {
  const db = await ctx.ports.db();
  const row = (await db.marketplaceAcceptance.findFirst({
    where: { clientId: input.clientId, orderId: input.orderId },
    select: { orderId: true, provider: true, externalOrderId: true, externalDisplayId: true, deliveredBy: true, createdAt: true },
  })) as TrackedAcceptance | null;
  if (!row) return { kind: "unsupported", reason: "no marketplace order with this id" };
  const api = ctx.registry.get(row.provider)?.courier;
  if (!api) return { kind: "unsupported", reason: `${row.provider} has no courier tracking` };
  if (row.deliveredBy !== "MARKETPLACE") return { kind: "unsupported", reason: "the order is not carried by the marketplace's courier" };
  let connection;
  try {
    connection = await readOutboundConnection(ctx, input.clientId, row.provider);
  } catch (error) {
    return { kind: "refused", status: 0, message: `credentials do not open: ${error instanceof Error ? error.message : String(error)}`, own: true };
  }
  if (!connection) return { kind: "refused", status: 0, message: "no credentials on file", own: true };
  const ref: OutboundOrderRef = {
    externalOrderId: row.externalOrderId,
    externalDisplayId: row.externalDisplayId,
    hostOrderCode: row.orderId,
    placedAt: row.createdAt,
  };
  return api.tracking({ http: ctx.ports.http, tokens: ctx.tokens, now: ctx.ports.clock.now(), ...connection }, ref);
}

/** The engine's courier calls, bound to its context. */
export function courierEngine(ctx: EngineContext): MarketplaceCourierEngine {
  return {
    validatePickupCode: (input) => validatePickupCode(ctx, input),
    courierTracking: (input) => readCourierTracking(ctx, input),
  };
}
