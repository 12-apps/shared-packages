import type {
  MarketplaceDeliveredBy,
  MarketplaceOrderType,
  NormalizedAddress,
  NormalizedBuyer,
  NormalizedEvent,
  NormalizedMarketplaceOrder,
  NormalizedOrderLine,
} from "../core/types";
import {
  asString,
  firstCents,
  firstDate,
  firstString,
  pick,
  verifyHmacSha256Hex,
} from "../core/payload-read";

/**
 * The iFood adapter's INBOUND half: one delivery → a {@link NormalizedEvent}.
 *
 * Everything iFood-shaped about a delivery is in this file, and the engine
 * never learns the name: it reaches this through the adapter registry.
 *
 * The payload is treated as UNTRUSTED and read defensively throughout: iFood's
 * documented shape and iFood's actual shape have drifted before, and a
 * `TypeError` reading a missing field would reject a paid order at the door.
 * Every reader below either produces a value or produces null; the one thing
 * that can refuse an order outright is a missing order ID, because without it
 * there is no idempotency key and ingesting would risk a duplicate.
 */

/** iFood event codes this ingestion acts on. */
const ORDER_PLACED = new Set(["PLC", "PLACED", "ORDER_PLACED"]);
const ORDER_CANCELLED = new Set(["CAN", "CANCELLED", "ORDER_CANCELLED"]);
/** iFood refused the store's own cancellation request. */
const CANCELLATION_REQUEST_FAILED = new Set(["CARF", "CANCELLATION_REQUEST_FAILED"]);

/**
 * Verify a delivery against the merchant's webhook secret: iFood signs the raw
 * body with HMAC-SHA256, hex. The rule (an unset secret accepts; a set one
 * refuses an unsigned delivery; constant-time compare) is the engine's
 * {@link verifyHmacSha256Hex}. iFood's own onboarding issues the secret after
 * the merchant is certified, so refusing before then would make the
 * connection untestable.
 */
export function verifyIfoodSignature(
  rawBody: string,
  signature: string | null,
  webhookSecret: string | null,
): boolean {
  return verifyHmacSha256Hex(rawBody, signature, webhookSecret);
}

/** The buyer, as much of them as iFood discloses on the order. */
function readBuyer(order: unknown): NormalizedBuyer {
  return {
    externalId: asString(pick(order, "customer", "id")),
    name: asString(pick(order, "customer", "name")),
    phone: firstString(order, [
      ["customer", "phone", "number"],
      ["customer", "phone"],
    ]),
  };
}

/**
 * One iFood item → one normalized line.
 *
 * A line with no resolvable SKU still becomes a line: `externalSku` falls back
 * to the item's own id, and failing that to its name. That fallback is doing
 * real work — an unmapped line is recoverable (the store maps it and it is
 * fixed forever), a DROPPED line is not, because nothing downstream can tell
 * that food is missing from the ticket.
 */
function readLine(item: unknown): NormalizedOrderLine | null {
  const name = firstString(item, [["name"], ["description"]]);
  const sku = firstString(item, [["externalCode"], ["sku"], ["id"]]) ?? name;
  if (!sku) return null;
  const quantity = Number(pick(item, "quantity") ?? 1);
  return {
    externalSku: sku,
    name: name ?? sku,
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1,
    unitPriceCents: firstCents(item, [["unitPrice"], ["price"]]) ?? 0,
    note: firstString(item, [["observations"], ["note"]]),
  };
}

/**
 * The commission iFood states on the order, in cents.
 *
 * Absent on plenty of real payloads (it depends on the merchant's contract and
 * on which API version delivered the order), and absent is stored as NULL
 * rather than as 0 — "iFood took nothing" and "iFood did not say" are different
 * claims, and only one of them is safe to put in a margin report.
 */
function readCommission(order: unknown): number | null {
  return firstCents(order, [["total", "commission"], ["commission"], ["payments", "commission"]]);
}

/** iFood's `orderType` as the two ways an order reaches the buyer, or null when it says neither. */
function readOrderType(order: unknown): MarketplaceOrderType | null {
  const stated = firstString(order, [["orderType"]])?.toUpperCase();
  return stated === "DELIVERY" || stated === "TAKEOUT" ? stated : null;
}

/** `delivery.deliveredBy`: iFood's own fleet, or the merchant's. Anything else is unstated. */
function readDeliveredBy(order: unknown): MarketplaceDeliveredBy | null {
  const stated = firstString(order, [["delivery", "deliveredBy"]])?.toUpperCase();
  if (stated === "IFOOD") return "MARKETPLACE";
  return stated === "MERCHANT" ? "MERCHANT" : null;
}

/**
 * Where a delivery goes. The street is what a courier cannot find a door
 * without, so an address with none is none; a missing number reads as the
 * host's own words for "no number" (`copy.missingStreetNumber`), which keeps
 * the street, the neighbourhood and the reference rather than dropping the
 * whole door.
 */
function readAddress(order: unknown, missingStreetNumber: string): NormalizedAddress | null {
  const raw = pick(order, "delivery", "deliveryAddress");
  const street = firstString(raw, [["streetName"], ["street"]]);
  if (street === null) return null;
  return {
    street,
    number: firstString(raw, [["streetNumber"], ["number"]]) ?? missingStreetNumber,
    neighborhood: firstString(raw, [["neighborhood"]]) ?? "",
    complement: firstString(raw, [["complement"]]),
    reference: firstString(raw, [["reference"]]),
    postalCode: firstString(raw, [["postalCode"]])?.replace(/\D/g, "") || null,
    city: firstString(raw, [["city"]]),
    state: firstString(raw, [["state"]]),
  };
}

/** The order body of a placed-order event, or null when it carries none. */
function readOrder(
  payload: unknown,
  externalOrderId: string,
  missingStreetNumber: string,
): NormalizedMarketplaceOrder | null {
  const order = pick(payload, "order") ?? payload;
  const rawItems = pick(order, "items");
  const lines = (Array.isArray(rawItems) ? rawItems : [])
    .map(readLine)
    .filter((line): line is NormalizedOrderLine => line !== null);
  if (lines.length === 0) return null;

  const stated = firstCents(order, [["total", "orderAmount"], ["totalPrice"], ["total"]]);

  return {
    provider: "IFOOD",
    externalOrderId,
    externalDisplayId: firstString(order, [["displayId"]]) ?? firstString(payload, [["displayId"]]),
    buyer: readBuyer(order),
    lines,
    // The line sum is the FALLBACK, never the preference: iFood's stated total
    // carries delivery fees, its promotions and its rounding, and it is the
    // number on the buyer's receipt. Summing lines when iFood did say is how a
    // store's revenue quietly stops matching its iFood statement.
    totalCents: stated ?? lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0),
    commissionCents: readCommission(order),
    deliveryDueAt: firstDate(order, [["delivery", "deliveryDateTime"], ["preparationStartDateTime"]]),
    placedAt:
      firstDate(order, [["createdAt"]]) ?? firstDate(payload, [["createdAt"]]) ?? new Date(),
    orderType: readOrderType(order),
    deliveredBy: readDeliveredBy(order),
    deliveryAddress: readAddress(order, missingStreetNumber),
  };
}

/**
 * Normalize one iFood delivery.
 *
 * Returns null only when the payload carries no order id at all — the one thing
 * this pipeline cannot proceed without, because it IS the idempotency key and
 * ingesting without it risks the duplicate that "never lose an order" is
 * balanced against.
 */
export function normalizeIfoodEvent(
  payload: unknown,
  options: { missingStreetNumber: string },
): NormalizedEvent | null {
  const externalOrderId = firstString(payload, [["orderId"], ["order", "id"], ["id"]]);
  if (!externalOrderId) return null;

  const eventType = firstString(payload, [["fullCode"], ["code"]]) ?? "UNKNOWN";
  const cancelled = ORDER_CANCELLED.has(eventType.toUpperCase());
  const placed = ORDER_PLACED.has(eventType.toUpperCase());
  const refusedRequest = CANCELLATION_REQUEST_FAILED.has(eventType.toUpperCase());

  return {
    provider: "IFOOD",
    // iFood's own event id when it sends one. The fallback is deterministic on
    // purpose — (order, type) is stable across a redelivery, so a duplicate
    // still collides on the inbox's unique index instead of creating a second
    // row that would be processed a second time.
    eventId: firstString(payload, [["id"]]) ?? `${externalOrderId}:${eventType}`,
    eventType,
    externalMerchantId: firstString(payload, [["merchantId"], ["merchant", "id"]]),
    externalOrderId,
    order: placed ? readOrder(payload, externalOrderId, options.missingStreetNumber) : null,
    cancelled,
    cancellationOutcome: cancelled ? "CONFIRMED" : refusedRequest ? "FAILED" : null,
  };
}
