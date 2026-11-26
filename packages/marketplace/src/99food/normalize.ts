import type { NormalizedEvent, NormalizedMarketplaceOrder } from "../core/types";
import { normalizeOpenDeliveryEventAs, normalizeOpenDeliveryOrderAs } from "../open-delivery/normalize";

/**
 * The 99Food adapter's INBOUND half: Open Delivery v1.7.1's readers
 * (`../open-delivery/normalize.ts`), stamped with 99Food's provider id. 99Food
 * departs from the standard in nothing inbound: the `X-App-Signature` is the
 * standard's lowercase-hex HMAC-SHA256 of the body.
 */

/** The provider id 99Food is registered under. Uppercase: the column's CHECK holds that shape. */
export const NINETY_NINE_FOOD_PROVIDER = "NINETY_NINE_FOOD";

export { verifyOpenDeliverySignature } from "../open-delivery/normalize";

/** Normalize one webhook `Event` (see `normalizeOpenDeliveryEventAs`). Null only when it names no order. */
export function normalizeOpenDeliveryEvent(payload: unknown): NormalizedEvent | null {
  return normalizeOpenDeliveryEventAs(NINETY_NINE_FOOD_PROVIDER, payload);
}

/** Normalize one `Order` (see `normalizeOpenDeliveryOrderAs`). Null when it carries no id or no line. */
export function normalizeOpenDeliveryOrder(
  order: unknown,
  options: { missingStreetNumber: string },
): NormalizedMarketplaceOrder | null {
  return normalizeOpenDeliveryOrderAs(NINETY_NINE_FOOD_PROVIDER, order, options);
}
