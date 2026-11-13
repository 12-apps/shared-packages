import {
  asString,
  firstCents,
  firstDate,
  firstString,
  pick,
  toCents,
  verifyHmacSha256Hex,
} from "../core/payload-read";
import type {
  MarketplaceDeliveredBy,
  MarketplaceOrderType,
  NormalizedAddress,
  NormalizedEvent,
  NormalizedMarketplaceOrder,
  NormalizedOrderLine,
} from "../core/types";

/**
 * The 99Food adapter's INBOUND half, on Open Delivery v1.7.1 (Abrasel).
 *
 * Open Delivery splits what iFood sends at once: the webhook's `Event` names
 * an order (`eventId`, `eventType`, `orderId`, `orderURL`, `createdAt`) and
 * carries no body, and `GET /v1/orders/{orderId}` answers the `Order`. So
 * there are two readers here: {@link normalizeOpenDeliveryEvent} for the
 * webhook (a `CREATED` becomes `orderToFetch`), and
 * {@link normalizeOpenDeliveryOrder} for what the engine's fetch job reads.
 *
 * Every shape below is the spec's (`components/schemas/Event`, `Order`,
 * `Price`, `Address`), and every fixture in the tests is the spec's own
 * example. Read defensively all the same: a missing field produces null, and
 * only a missing order id refuses an event (it is the idempotency key).
 */

/** The provider id 99Food is registered under. Uppercase: the column's CHECK holds that shape. */
export const NINETY_NINE_FOOD_PROVIDER = "NINETY_NINE_FOOD";

/** The order exists and its body must be fetched. */
const CREATED = "CREATED";
/** The order is cancelled: the store's request was granted, or a mandatory cancellation. */
const CANCELLED = "CANCELLED";
/** The marketplace refused the store's own cancellation request. */
const CANCELLATION_REQUEST_DENIED = "CANCELLATION_REQUEST_DENIED";

/**
 * Verify a delivery: Open Delivery's `X-App-Signature` is "a lowercased
 * hexadecimal HMAC signature of the webhook HTTP request body, using the
 * client secret as a key and SHA256 as the hash function". The key is the
 * merchant app's CLIENT SECRET, so a store's connection keeps that same value
 * as its webhook secret.
 *
 * Unlike iFood (whose secret is issued after certification), the key exists
 * from the moment the store connects, so an unset secret REFUSES: an unsigned
 * CANCELLED for a known order id would otherwise cancel it.
 */
export function verifyOpenDeliverySignature(
  rawBody: string,
  signature: string | null,
  webhookSecret: string | null,
): boolean {
  if (!webhookSecret) return false;
  return verifyHmacSha256Hex(rawBody, signature, webhookSecret);
}

/**
 * Normalize one webhook `Event`. Null only when it names no order.
 *
 * - `CREATED` announces an order: `orderToFetch`, the body is the fetch job's.
 * - `CANCELLED` is a cancellation, whether the store asked for it or not.
 * - `CANCELLATION_REQUEST_DENIED` refuses the store's request.
 * - Everything else (`CONFIRMED`, `CANCELLATION_REQUESTED`, `DISPATCHED`, the
 *   consumer's `ORDER_CANCELLATION_REQUEST` handshake…) is understood and
 *   recorded, and acts on nothing: an IGNORED inbox row.
 *
 * The merchant is named by the `X-App-MerchantId` HEADER, not the body; the
 * engine attributes a delivery by its URL's store slug, so it reads none.
 */
export function normalizeOpenDeliveryEvent(payload: unknown): NormalizedEvent | null {
  const externalOrderId = firstString(payload, [["orderId"]]);
  if (!externalOrderId) return null;
  const eventType = (firstString(payload, [["eventType"]]) ?? "UNKNOWN").toUpperCase();
  const cancelled = eventType === CANCELLED;
  const denied = eventType === CANCELLATION_REQUEST_DENIED;
  return {
    provider: NINETY_NINE_FOOD_PROVIDER,
    // The spec's own event id. The fallback is deterministic so a redelivery
    // still collides on the inbox's unique index.
    eventId: firstString(payload, [["eventId"]]) ?? `${externalOrderId}:${eventType}`,
    eventType,
    externalMerchantId: null,
    externalOrderId,
    order: null,
    orderToFetch: eventType === CREATED,
    cancelled,
    cancellationOutcome: cancelled ? "CONFIRMED" : denied ? "FAILED" : null,
  };
}

/** A `Price` object (`{ value, currency }`) in cents. */
function priceCents(source: unknown, ...path: string[]): number | null {
  return toCents(pick(source, ...path, "value"));
}

/**
 * The note a kitchen reads: the chosen options (a pizza's halves are options)
 * and the buyer's own instructions. The normalized line has no options of its
 * own, and a flavour dropped from the ticket is food made wrong.
 */
function lineNote(item: unknown, fraction: string | null): string | null {
  const rawOptions = pick(item, "options");
  const options = (Array.isArray(rawOptions) ? rawOptions : [])
    .map((option) => {
      const name = asString(pick(option, "name"));
      const quantity = Number(pick(option, "quantity") ?? 1);
      return name && quantity > 1 ? `${quantity}x ${name}` : name;
    })
    .filter((name): name is string => name !== null);
  const parts = [fraction, options.join(", ") || null, firstString(item, [["specialInstructions"]])];
  const note = parts.filter((part): part is string => part !== null).join(" · ");
  return note === "" ? null : note;
}

/**
 * What the buyer paid for the whole line, in cents. The spec's `totalPrice`
 * ("quantity * (unitPrice + optionsPrice)") is the figure the order's
 * `itemsPrice` is built from, and it wins whenever it is stated — its own
 * example does not add up otherwise (unit 43, options 50, total 50).
 *
 * Without it: `unitPrice × quantity + optionsPrice`. ESTIMATED: the spec calls
 * `optionsPrice` "the sum of the total prices of all options of the item", a
 * LINE figure, so it is added once, never multiplied by the quantity or by a
 * weight.
 */
function lineTotalCents(item: unknown, quantity: number): number {
  const total = priceCents(item, "totalPrice");
  if (total !== null) return total;
  const unit = priceCents(item, "unitPrice") ?? 0;
  return Math.round(unit * quantity) + (priceCents(item, "optionsPrice") ?? 0);
}

/** The stated quantity (decimal for weighed units), 1 when absent or nonsense. */
function quantityOf(item: unknown): number {
  const stated = Number(pick(item, "quantity") ?? 1);
  return Number.isFinite(stated) && stated > 0 ? stated : 1;
}

/**
 * Split a line total over a whole quantity so the lines add up to it EXACTLY:
 * one row at `total / quantity` when it divides; otherwise `quantity - 1`
 * units at the floor and one unit carrying the remainder, under the same SKU
 * (R$ 10.00 over 3 is 3.33 × 2 + 3.34).
 */
function splitWhole(total: number, quantity: number): { quantity: number; unitPriceCents: number }[] {
  const floor = Math.floor(total / quantity);
  const remainder = total - floor * quantity;
  if (remainder === 0) return [{ quantity, unitPriceCents: floor }];
  const rest = quantity === 1 ? [] : [{ quantity: quantity - 1, unitPriceCents: floor }];
  return [...rest, { quantity: 1, unitPriceCents: floor + remainder }];
}

/**
 * One `Order.items[]` entry → its lines, which always add up to the line's
 * total ({@link lineTotalCents}). A whole quantity is split by
 * {@link splitWhole}; a fractional one (500 g as `0.5 KG`) is one line at its
 * total, the weight in the note.
 *
 * A line with no `externalCode` keys on the item id, then the name: an
 * unmapped line is recoverable, a dropped one is not. ESTIMATED: whether the
 * item id is stable across orders is not pinned by the spec; if it is per
 * order, each such order adds an unmapped SKU row.
 */
function readLines(item: unknown): NormalizedOrderLine[] {
  const name = firstString(item, [["name"]]);
  const sku = firstString(item, [["externalCode"], ["id"]]) ?? name;
  if (!sku) return [];
  const quantity = quantityOf(item);
  const whole = Number.isInteger(quantity);
  const fraction = whole ? null : `${quantity} ${firstString(item, [["unit"]]) ?? ""}`.trim();
  const total = lineTotalCents(item, quantity);
  const parts = whole ? splitWhole(total, quantity) : [{ quantity: 1, unitPriceCents: total }];
  const note = lineNote(item, fraction);
  return parts.map((part) => ({ externalSku: sku, name: name ?? sku, ...part, note }));
}

/** `DELIVERY` or `TAKEOUT`; `INDOOR` (eaten at the store) is neither, so unstated. */
function readOrderType(order: unknown): MarketplaceOrderType | null {
  const stated = firstString(order, [["type"]])?.toUpperCase();
  return stated === "DELIVERY" || stated === "TAKEOUT" ? stated : null;
}

function readDeliveredBy(order: unknown): MarketplaceDeliveredBy | null {
  const stated = firstString(order, [["delivery", "deliveredBy"]])?.toUpperCase();
  return stated === "MERCHANT" || stated === "MARKETPLACE" ? stated : null;
}

/**
 * `delivery.deliveryAddress`. The spec's schema says `street`, `number`,
 * `district`; its own (commented) order example says `streetName`,
 * `streetNumber`, `neighborhood`. Both are read. The state is ISO 3166-2 by
 * recommendation (`BR-SP`), so the country prefix is dropped.
 */
function readAddress(order: unknown, missingStreetNumber: string): NormalizedAddress | null {
  const raw = pick(order, "delivery", "deliveryAddress");
  const street = firstString(raw, [["street"], ["streetName"]]);
  if (street === null) return null;
  return {
    street,
    number: firstString(raw, [["number"], ["streetNumber"]]) ?? missingStreetNumber,
    neighborhood: firstString(raw, [["district"], ["neighborhood"]]) ?? "",
    complement: firstString(raw, [["complement"]]),
    reference: firstString(raw, [["reference"]]),
    postalCode: firstString(raw, [["postalCode"]])?.replace(/\D/g, "") || null,
    city: firstString(raw, [["city"]]),
    state: firstString(raw, [["state"]])?.replace(/^[A-Z]{2}-/u, "") ?? null,
  };
}

/**
 * Normalize one `Order` (the answer of `GET /v1/orders/{orderId}`). Null when
 * it carries no id or no line.
 *
 * The total is `total.orderAmount`, "the final value of the order (itemsPrice
 * + otherFees - discounts)": the buyer's receipt, gross. Open Delivery's
 * `Order` states NO commission field, so `commissionCents` is null ("did not
 * say"), never 0; the marketplace's cut arrives with its statement.
 */
export function normalizeOpenDeliveryOrder(
  order: unknown,
  options: { missingStreetNumber: string },
): NormalizedMarketplaceOrder | null {
  const externalOrderId = firstString(order, [["id"]]);
  const rawItems = pick(order, "items");
  const lines = (Array.isArray(rawItems) ? rawItems : [])
    .flatMap(readLines);
  if (!externalOrderId || lines.length === 0) return null;
  return {
    provider: NINETY_NINE_FOOD_PROVIDER,
    externalOrderId,
    externalDisplayId: firstString(order, [["displayId"]]),
    externalMerchantId: firstString(order, [["merchant", "id"]]),
    buyer: {
      externalId: firstString(order, [["customer", "id"]]),
      name: firstString(order, [["customer", "name"]]),
      phone: firstString(order, [["customer", "phone", "number"]]),
    },
    lines,
    // The line sum is the FALLBACK: the stated total carries the fees and
    // discounts the lines do not, and it is the number on the receipt.
    totalCents:
      firstCents(order, [["total", "orderAmount", "value"]]) ??
      lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0),
    commissionCents: null,
    deliveryDueAt: firstDate(order, [
      ["delivery", "estimatedDeliveryDateTime"],
      ["takeout", "takeoutDateTime"],
      ["schedule", "scheduledDateTimeEnd"],
    ]),
    placedAt: firstDate(order, [["createdAt"]]) ?? new Date(),
    orderType: readOrderType(order),
    deliveredBy: readDeliveredBy(order),
    deliveryAddress: readAddress(order, options.missingStreetNumber),
  };
}
