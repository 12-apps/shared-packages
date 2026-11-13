import { asString, firstDate, firstString, pick, verifyHmacSha256Hex } from "../core/payload-read";
import type {
  MarketplaceDeliveredBy,
  MarketplaceOrderType,
  NormalizedAddress,
  NormalizedEvent,
  NormalizedMarketplaceOrder,
  NormalizedOrderLine,
} from "../core/types";

/**
 * The Rappi adapter's INBOUND half, from Rappi's public developer portal
 * (dev-portal.rappi.com: webhook-events, api-reference/orders), read
 * 2026-11-13.
 *
 * Rappi registers one webhook URL PER EVENT, and its payloads do not name the
 * event they are. So the event is read from the body's shape, as the portal
 * documents each one:
 *
 * - `NEW_ORDER` is "the same information that we can get from the getOrders
 *   endpoint": one element of `GET orders`, an `order_detail` (with `items`,
 *   `totals`, `delivery_information`) beside `customer` and `store`.
 * - `NEW_ORDER_SCHEDULED` is that shape plus `"action": "scheduled"`, every
 *   price zero (the real order follows as `NEW_ORDER`); recorded, ignored.
 * - `NEW_ORDER_SCHEDULED_CANCELLED` is `"action": "cancelled"` with an
 *   `order_detail.order_id`: an order never released to the store; ignored.
 * - `ORDER_EVENT_CANCEL` is `{ event, order_id, store_id }`, `event` naming the
 *   cancellation (`canceled_with_charge`).
 * - `ORDER_OTHER_EVENT` is `{ event, order_id, store_id, event_time,
 *   additional_information }`; recorded, ignored.
 *
 * ESTIMATED, until the Rappi sandbox confirms it: telling ORDER_EVENT_CANCEL
 * from ORDER_OTHER_EVENT. The portal shows one example of each and names no
 * list of `event` values, so a payload is a cancellation only when it has
 * neither `event_time` nor `additional_information` AND its `event` names a
 * cancellation (`cancel` in it, which `canceled_with_charge` has). Anything
 * else is recorded and IGNORED: a missed cancellation is visible in the inbox,
 * a false one would cancel a live order.
 *
 * Rappi payloads carry no event id, so the inbox key is derived from the
 * order and the event, deterministic so a redelivery collides on the inbox's
 * unique index.
 */

/** The provider id Rappi is registered under. Uppercase: the column's CHECK holds that shape. */
export const RAPPI_PROVIDER = "RAPPI";

/** The header Rappi signs every webhook in (the portal: "Rappi-Signature"; headers are case-insensitive). */
export const RAPPI_SIGNATURE_HEADER = "rappi-signature";

/**
 * How Rappi states money. The portal types every amount as an `integer` and
 * names no unit (its examples are Colombian and Mexican pesos). Whether a
 * Brazilian store's `price: 2890` is R$ 28,90 or R$ 2.890 is not public, so
 * it is the adapter's REQUIRED config: `MINOR_UNITS` (cents) or `MAJOR_UNITS`
 * (whole reais). ESTIMATED until the sandbox shows a Brazilian order.
 */
export type RappiAmountUnit = "MINOR_UNITS" | "MAJOR_UNITS";

export interface RappiNormalizeOptions {
  amountUnit: RappiAmountUnit;
  missingStreetNumber: string;
}

/**
 * Verify a delivery, as the portal's "Validating Your Signature" says:
 * `Rappi-Signature: t=<timestamp>,sign=<signature>`; the signed payload is
 * the timestamp, `.`, and the raw body as it arrived; HMAC-SHA256 keyed by
 * the webhook's secret. The digest's encoding is not stated: the portal's
 * example `sign` is 64 hex characters, so it is read as lowercase hex
 * (ESTIMATED). Compared in constant time.
 *
 * The secret is REQUIRED: Rappi gives it when the webhook is registered, so a
 * connection without one refuses every delivery (an unsigned
 * ORDER_EVENT_CANCEL for a known order id would otherwise cancel it). No
 * timestamp tolerance is applied: the portal states none, and a replayed
 * delivery is a duplicate in the inbox.
 */
export function verifyRappiSignature(rawBody: string, header: string | null, webhookSecret: string | null): boolean {
  if (!webhookSecret || !header) return false;
  const parts = signatureParts(header);
  if (parts.t === null || parts.sign === null) return false;
  return verifyHmacSha256Hex(`${parts.t}.${rawBody}`, parts.sign, webhookSecret);
}

/** `t=…,sign=…` split on "," then on the first "=", as the portal describes. No regex. */
function signatureParts(header: string): { t: string | null; sign: string | null } {
  const found: { t: string | null; sign: string | null } = { t: null, sign: null };
  for (const element of header.split(",")) {
    const at = element.indexOf("=");
    if (at < 0) continue;
    const key = element.slice(0, at).trim().toLowerCase();
    const value = element.slice(at + 1).trim();
    if (value === "") continue;
    if (key === "t") found.t = value;
    if (key === "sign") found.sign = value;
  }
  return found;
}

/** Rappi's store id, from wherever this event shape keeps it. */
function storeIdOf(payload: unknown): string | null {
  return firstString(payload, [["store", "internal_id"], ["order_detail", "store", "internal_id"], ["order_detail", "store_id"], ["store_id"]]);
}

/** One event's frame; the order is filled by the caller. */
function eventOf(
  orderId: string,
  eventType: string,
  payload: unknown,
  extra: Partial<NormalizedEvent> & { eventId?: string } = {},
): NormalizedEvent {
  return {
    provider: RAPPI_PROVIDER,
    eventId: `${orderId}:${eventType}`,
    eventType,
    externalMerchantId: storeIdOf(payload),
    externalOrderId: orderId,
    order: null,
    cancelled: false,
    cancellationOutcome: null,
    ...extra,
  };
}

/** A shape with an `order_detail`: NEW_ORDER, or one of the scheduled notices. */
function orderDetailEvent(payload: unknown, options: RappiNormalizeOptions): NormalizedEvent | null {
  const orderId = firstString(payload, [["order_detail", "order_id"]]);
  if (!orderId) return null;
  const action = firstString(payload, [["action"]])?.toLowerCase() ?? null;
  if (action === "scheduled") return eventOf(orderId, "NEW_ORDER_SCHEDULED", payload);
  if (action === "cancelled") return eventOf(orderId, "NEW_ORDER_SCHEDULED_CANCELLED", payload);
  return eventOf(orderId, "NEW_ORDER", payload, { order: normalizeRappiOrder(payload, options) });
}

/** Whether `event` names a cancellation: "cancel" in it, case-insensitive. ESTIMATED (see the file header). */
function namesCancellation(event: string): boolean {
  return event.toLowerCase().includes("cancel");
}

/** A shape with a top-level `order_id`: ORDER_EVENT_CANCEL or ORDER_OTHER_EVENT (and the tracking stream). */
function orderEvent(payload: unknown): NormalizedEvent | null {
  const orderId = firstString(payload, [["order_id"]]);
  if (!orderId) return null;
  const event = firstString(payload, [["event"]]) ?? "UNKNOWN";
  const other = pick(payload, "event_time") !== undefined || pick(payload, "additional_information") !== undefined;
  const cancelled = !other && namesCancellation(event);
  const eventType = cancelled ? "ORDER_EVENT_CANCEL" : "ORDER_OTHER_EVENT";
  const at = asString(pick(payload, "event_time"));
  return eventOf(orderId, eventType, payload, {
    eventId: [orderId, eventType, event, ...(at ? [at] : [])].join(":"),
    cancelled,
    cancellationOutcome: cancelled ? "CONFIRMED" : null,
  });
}

/**
 * Normalize one webhook delivery. Null only when it names no order (PING,
 * MENU_*, STORE_CONNECTIVITY, STORE_PROVISIONING_STATUS): nothing to key on.
 */
export function normalizeRappiEvent(payload: unknown, options: RappiNormalizeOptions): NormalizedEvent | null {
  const detail = pick(payload, "order_detail");
  if (typeof detail === "object" && detail !== null) return orderDetailEvent(payload, options);
  return orderEvent(payload);
}

/** An amount as Rappi states it, in cents; null when absent or not a number. */
function amountCents(value: unknown, unit: RappiAmountUnit): number | null {
  const numeric = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return null;
  return Math.round(unit === "MAJOR_UNITS" ? numeric * 100 : numeric);
}

/** A stated count, 1 when absent or nonsense. */
function countOf(source: unknown): number {
  const stated = Number(pick(source, "quantity") ?? 1);
  return Number.isFinite(stated) && stated > 0 ? stated : 1;
}

function arrayAt(source: unknown, ...path: string[]): unknown[] {
  const found = pick(source, ...path);
  return Array.isArray(found) ? found : [];
}

/**
 * One unit's price: the item's `price` ("Unit price for the item without the
 * discount") plus each subitem's `price × quantity`. ESTIMATED: the portal
 * does not say whether a subitem's quantity is per unit of its item or for the
 * whole line; it is read per unit (a topping on each salad of three).
 */
function unitCents(item: unknown, unit: RappiAmountUnit): number {
  const base = amountCents(pick(item, "price"), unit) ?? 0;
  return arrayAt(item, "subitems").reduce<number>(
    (sum, sub) => sum + (amountCents(pick(sub, "price"), unit) ?? 0) * countOf(sub),
    base,
  );
}

/** The ticket's note: the subitems (a topping, a dressing) and the buyer's comments. */
function lineNote(item: unknown): string | null {
  const subitems = arrayAt(item, "subitems")
    .map((sub) => {
      const name = asString(pick(sub, "name"));
      const quantity = countOf(sub);
      return name && quantity > 1 ? `${quantity}x ${name}` : name;
    })
    .filter((name): name is string => name !== null);
  // `comments` is typed an array and shown as a string in the same reference.
  const rawComments = pick(item, "comments");
  const comments = (Array.isArray(rawComments) ? rawComments : [rawComments])
    .map(asString)
    .filter((comment): comment is string => comment !== null);
  const note = [subitems.join(", "), ...comments].filter((part) => part !== "").join(" · ");
  return note === "" ? null : note;
}

/**
 * One `order_detail.items[]` entry → its lines, which add up EXACTLY to the
 * item's total. A whole quantity is one row at the unit price (`unit × q` is
 * the total, nothing to divide); a fractional one (the portal types quantity
 * an integer, so this is defensive) is one row at its rounded total.
 *
 * The key is the item's `sku` (the store's own, "the ally grants their own
 * SKU"), then Rappi's `id`, then the name: an unmapped line is recoverable, a
 * dropped one is not.
 */
function readLines(item: unknown, unit: RappiAmountUnit): NormalizedOrderLine[] {
  const name = firstString(item, [["name"]]);
  const sku = firstString(item, [["sku"], ["id"]]) ?? name;
  if (!sku) return [];
  const quantity = countOf(item);
  const each = unitCents(item, unit);
  const row = Number.isInteger(quantity)
    ? { quantity, unitPriceCents: each }
    : { quantity: 1, unitPriceCents: Math.round(each * quantity) };
  return [{ externalSku: sku, name: name ?? sku, ...row, note: lineNote(item) }];
}

/**
 * `delivery_method`: `delivery` (Rappi's courier), `marketplace` (the store's
 * own: the portal sends the customer's data "only when delivery method is
 * marketplace"), `pickup`.
 */
function readMethod(detail: unknown): { orderType: MarketplaceOrderType | null; deliveredBy: MarketplaceDeliveredBy | null } {
  const method = firstString(detail, [["delivery_method"]])?.toLowerCase();
  if (method === "delivery") return { orderType: "DELIVERY", deliveredBy: "MARKETPLACE" };
  if (method === "marketplace") return { orderType: "DELIVERY", deliveredBy: "MERCHANT" };
  if (method === "pickup") return { orderType: "TAKEOUT", deliveredBy: null };
  return { orderType: null, deliveredBy: null };
}

/** `order_detail.delivery_information`, the Brazilian fields included (`federal_unit`). */
function readAddress(detail: unknown, missingStreetNumber: string): NormalizedAddress | null {
  const raw = pick(detail, "delivery_information");
  const street = firstString(raw, [["street_name"], ["complete_address"]]);
  if (street === null) return null;
  return {
    street,
    number: firstString(raw, [["street_number"]]) ?? missingStreetNumber,
    neighborhood: firstString(raw, [["neighborhood"]]) ?? "",
    complement: firstString(raw, [["complement"]]),
    reference: firstString(raw, [["description"]]),
    postalCode: firstString(raw, [["postal_code"]])?.replace(/\D/g, "") || null,
    city: firstString(raw, [["city"]]),
    state: firstString(raw, [["federal_unit"]]),
  };
}

/** The buyer, top-level `customer` as the example has it, or under `order_detail` as the table names it. */
function readBuyer(payload: unknown): NormalizedMarketplaceOrder["buyer"] {
  const customer = pick(payload, "customer") ?? pick(payload, "order_detail", "customer");
  const name = [firstString(customer, [["first_name"]]), firstString(customer, [["last_name"]])]
    .filter((part): part is string => part !== null)
    .join(" ");
  return { externalId: null, name: name === "" ? null : name, phone: firstString(customer, [["phone_number"]]) };
}

/**
 * Normalize one getOrders element (the NEW_ORDER body). Null when it carries
 * no order id or no line.
 *
 * The total is `totals.total_order`, "the total amount that the restaurant
 * receives" (with tip and delivery fee when the store delivers): the figure
 * the store's receipt is reconciled against. Rappi states no commission, so
 * `commissionCents` is null ("did not say"), never 0. The merchant the order
 * names is Rappi's store id (`store.internal_id`), the id every other event
 * carries as `store_id`; the engine refuses it for another connection.
 */
export function normalizeRappiOrder(payload: unknown, options: RappiNormalizeOptions): NormalizedMarketplaceOrder | null {
  const detail = pick(payload, "order_detail");
  const externalOrderId = firstString(detail, [["order_id"]]);
  const lines = arrayAt(detail, "items").flatMap((item) => readLines(item, options.amountUnit));
  if (!externalOrderId || lines.length === 0) return null;
  const method = readMethod(detail);
  return {
    provider: RAPPI_PROVIDER,
    externalOrderId,
    // Rappi's order id is the number its app and courier show.
    externalDisplayId: externalOrderId,
    externalMerchantId: storeIdOf(payload),
    buyer: readBuyer(payload),
    lines,
    totalCents:
      amountCents(pick(detail, "totals", "total_order"), options.amountUnit) ??
      lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0),
    commissionCents: null,
    // Rappi states no delivery promise on the order.
    deliveryDueAt: null,
    placedAt: firstDate(detail, [["created_at"]]) ?? new Date(),
    orderType: method.orderType,
    deliveredBy: method.deliveredBy,
    deliveryAddress: method.orderType === "TAKEOUT" ? null : readAddress(detail, options.missingStreetNumber),
  };
}
