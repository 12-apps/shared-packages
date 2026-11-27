import { outboundResultOf, type AdapterCallContext } from "../core/adapter";
import { firstDate, pick } from "../core/payload-read";
import type { MarketplaceCourierStep, NormalizedEvent, NormalizedMarketplaceOrder } from "../core/types";
import { isStop, openDeliveryCall, type OpenDeliveryDialect } from "../open-delivery/client";
import { normalizeOpenDeliveryEventAs, normalizeOpenDeliveryOrderAs } from "../open-delivery/normalize";

/**
 * The Keeta adapter's INBOUND half: Open Delivery's readers
 * (`../open-delivery/normalize.ts`) stamped with Keeta's provider id, plus
 * the one thing Keeta's `Order` does that the standard's does not: personal
 * data arrives ENCRYPTED.
 *
 * Events (Keeta's order guide, read 2026-11-26): `CREATED` → fetch;
 * `CANCELLED` (with a JSON-string `metadata` carrying `reason` and `code`) →
 * cancelled; `DISPATCHED`, `CONCLUDED` → lifecycle; `RIDER_ARRIVED_AT_STORE`,
 * `ORDER_COLLECTED` → courier steps (the second a lifecycle too). Keeta has NO
 * `CANCELLATION_REQUEST_DENIED`: a store's request that Keeta does not grant
 * produces no event, so it ends TIMEOUT at the adapter's answer window. The
 * rest (`CONFIRMED`, `READY_FOR_PICKUP`, `PICKUP_ONGOING`, `DELIVERED`,
 * `CANCELLATION_REQUESTED`, `USER_REFUND_REQUEST`, `REFUNDED`,
 * `REFUND_FAILED`, `RECOMMENDED_PREPARATION_START`) are recorded and IGNORED.
 */

/**
 * Keeta's rider events as courier steps (FUT-5665). ESTIMATED: the event names
 * are Keeta's order guide's (read 2026-11-26), their meaning is read off the
 * names; they carry no rider's name, photo or vehicle. `PICKUP_ONGOING` is left
 * IGNORED: whether it means "on the way" or "at the counter" is not stated.
 */
const KEETA_COURIER_STEP_OF: Readonly<Record<string, MarketplaceCourierStep>> = {
  RIDER_ARRIVED_AT_STORE: "ARRIVED_AT_ORIGIN",
  ORDER_COLLECTED: "COLLECTED",
};

/** The provider id Keeta is registered under. Uppercase: the column's CHECK holds that shape. */
export const KEETA_PROVIDER = "KEETA";

/** Keeta's prefix on an encrypted value (`ENC_#MQesaE=#1#`). */
const ENCRYPTED_PREFIX = "ENC_";
/** `POST /v1/batchDecrypt` takes at most 50 values a call. */
const DECRYPT_BATCH = 50;

/** Normalize one webhook `Event`. Null only when it names no order. */
export function normalizeKeetaEvent(payload: unknown): NormalizedEvent | null {
  const event = normalizeOpenDeliveryEventAs(KEETA_PROVIDER, payload);
  const step = event ? KEETA_COURIER_STEP_OF[event.eventType] : undefined;
  if (!event || !step) return event;
  const courier = { step, at: firstDate(payload, [["createdAt"]]), courier: null, returning: null };
  return { ...event, courier, ...(step === "COLLECTED" ? { lifecycle: "COLLECTED" as const } : {}) };
}

/** Normalize one `Order`, after {@link revealKeetaOrder}. Null when it carries no id or no line. */
export function normalizeKeetaOrder(
  order: unknown,
  options: { missingStreetNumber: string },
): NormalizedMarketplaceOrder | null {
  return normalizeOpenDeliveryOrderAs(KEETA_PROVIDER, order, options);
}

const isEncrypted = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);

/** Every encrypted value anywhere in the order, once each. */
function ciphersOf(value: unknown, found: Set<string>): Set<string> {
  if (isEncrypted(value)) found.add(value);
  else if (Array.isArray(value)) for (const entry of value) ciphersOf(entry, found);
  else if (typeof value === "object" && value !== null) for (const entry of Object.values(value)) ciphersOf(entry, found);
  return found;
}

/** A copy of the order with each encrypted value replaced by its plain text, or removed when there is none. */
function replaced(value: unknown, plain: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => replaced(entry, plain));
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isEncrypted(entry) && !plain.has(entry)) continue;
      copy[key] = isEncrypted(entry) ? plain.get(entry) : replaced(entry, plain);
    }
    return copy;
  }
  return value;
}

/** The `{ cipherText, plainText }` pairs a `batchDecrypt` answer carries with `errorCode` 0. */
function plainPairs(body: string): [string, string][] {
  const infos = pick(JSON.parse(body), "plainInfos");
  return (Array.isArray(infos) ? infos : []).flatMap((info): [string, string][] => {
    const cipher = pick(info, "cipherText");
    const text = pick(info, "plainText");
    const code = pick(info, "errorCode");
    return typeof cipher === "string" && typeof text === "string" && (code === undefined || code === 0)
      ? [[cipher, text]]
      : [];
  });
}

/** One `POST /v1/batchDecrypt` call: the plain texts it gave, none on any failure. */
async function decrypt(
  ctx: AdapterCallContext,
  dialect: OpenDeliveryDialect,
  ciphers: readonly string[],
): Promise<[string, string][]> {
  try {
    const response = await openDeliveryCall(ctx, dialect, {
      method: "POST",
      path: "/v1/batchDecrypt",
      body: { cipherInfos: ciphers.map((cipherText) => ({ cipherText })) },
    });
    if (isStop(response) || outboundResultOf(response).kind !== "accepted") return [];
    return plainPairs(response.body);
  } catch {
    return [];
  }
}

/**
 * Keeta encrypts `customer.phone.number` and the address's `district`,
 * `number`, `complement` and `formattedAddress` (`ENC_…`). Only an order the
 * MERCHANT delivers (its own courier or its 3PL) may be decrypted, through
 * `POST /v1/batchDecrypt` (at most 50 values a call); on Keeta's own fleet
 * the data stays masked. So: a merchant bag is decrypted, and every value
 * still encrypted after that (Keeta's fleet, a value Keeta would not decrypt,
 * a failed call) is REMOVED, never shown — the address then reads the copy's
 * missing-number text, and the phone is null.
 *
 * Never fails the fetch (choice): Keeta cancels an order not accepted within
 * 5 minutes and may close the store for it, so a decrypt that failed must not
 * keep the order out of the queue; the store reads the address on Keeta.
 */
export async function revealKeetaOrder(
  ctx: AdapterCallContext,
  dialect: OpenDeliveryDialect,
  order: unknown,
): Promise<unknown> {
  const ciphers = [...ciphersOf(order, new Set())];
  if (ciphers.length === 0) return order;
  const plain = new Map<string, string>();
  if (pick(order, "delivery", "deliveredBy") === "MERCHANT") {
    const batches: string[][] = [];
    for (let start = 0; start < ciphers.length; start += DECRYPT_BATCH) batches.push(ciphers.slice(start, start + DECRYPT_BATCH));
    const answers = await Promise.all(batches.map((batch) => decrypt(ctx, dialect, batch)));
    for (const [cipher, text] of answers.flat()) plain.set(cipher, text);
  }
  return replaced(order, plain);
}
