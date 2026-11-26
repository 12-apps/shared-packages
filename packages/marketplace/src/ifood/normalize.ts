import type {
  MarketplaceLifecycle,
  MarketplaceDeliveredBy,
  MarketplaceDiscountSponsor,
  MarketplaceOrderType,
  NormalizedAddress,
  NormalizedBuyer,
  NormalizedEvent,
  NormalizedMarketplaceOrder,
  NormalizedOrderDiscount,
  NormalizedOrderLine,
} from "../core/types";
import {
  asString,
  firstCents,
  firstDate,
  firstString,
  pick,
  toCents,
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
 * The lifecycle events (FUT-4653): the order left (`DSP`) and the order is
 * finished (`CON`). ESTIMATED: iFood's portal refused our reader (Cloudflare
 * 403, https://developer.ifood.com.br, 2026-11-25), so these codes and their
 * long forms are the ones iFood's event stream is commonly documented with,
 * not read off a page. They sit here beside the sets above so homologation
 * corrects one place.
 */
const LIFECYCLE_OF: Readonly<Record<string, MarketplaceLifecycle>> = {
  DSP: "DISPATCHED",
  DISPATCHED: "DISPATCHED",
  CON: "CONCLUDED",
  CONCLUDED: "CONCLUDED",
};

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
 * iFood's sponsor names as who pays. ESTIMATED: the names are the ones iFood's
 * order-details guide documents for `benefits[].sponsorshipValues[].name`, but
 * no recorded payload in this repo carries them; confirm against a real order
 * (https://developer.ifood.com.br/en-US/docs/guides/order/details).
 */
function sponsorOf(name: string | null): MarketplaceDiscountSponsor {
  const stated = name?.toUpperCase();
  if (stated === "IFOOD") return "MARKETPLACE";
  return stated === "MERCHANT" ? "MERCHANT" : "OTHER";
}

/**
 * The discounts on an order, one per sponsor's share of each benefit.
 * ESTIMATED shape (see {@link sponsorOf}): `benefits[]` with a `value` and
 * `sponsorshipValues[{ name, value, description? }]`. A benefit that names no
 * sponsor is the whole `value` under OTHER; a share with no usable amount is
 * skipped. Absent `benefits` is undefined ("did not say").
 */
function readDiscounts(order: unknown): NormalizedOrderDiscount[] | undefined {
  const benefits = pick(order, "benefits");
  if (!Array.isArray(benefits)) return undefined;
  return benefits.flatMap((benefit): NormalizedOrderDiscount[] => {
    const shares = pick(benefit, "sponsorshipValues");
    const parts = Array.isArray(shares)
      ? shares.map((share) => ({
          cents: toCents(pick(share, "value")),
          sponsor: sponsorOf(firstString(share, [["name"]])),
          name: firstString(share, [["description"]]),
        }))
      : [{ cents: toCents(pick(benefit, "value")), sponsor: "OTHER" as const, name: null }];
    return parts.flatMap((part) =>
      part.cents === null || part.cents <= 0
        ? []
        : [{ cents: part.cents, sponsor: part.sponsor, ...(part.name === null ? {} : { name: part.name }) }],
    );
  });
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

/** `{ key: value }` unless the value is undefined, so an unstated field is absent rather than `undefined`. */
function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
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
    // ESTIMATED names (iFood's order-details guide: `total.deliveryFee`,
    // `total.subTotal`, `benefits[]`). Fee and subtotal are null when unstated,
    // never 0; `discounts` is absent when `benefits` is.
    deliveryFeeCents: firstCents(order, [["total", "deliveryFee"]]),
    subtotalCents: firstCents(order, [["total", "subTotal"]]),
    ...optional("discounts", readDiscounts(order)),
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
    ...(LIFECYCLE_OF[eventType.toUpperCase()] ? { lifecycle: LIFECYCLE_OF[eventType.toUpperCase()] } : {}),
  };
}
