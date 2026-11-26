import { OPEN_DELIVERY_MERCHANT_REASON_CODES } from "../open-delivery/reasons";

/**
 * The words the 99Food adapter needs from its host, and nothing else.
 *
 * Required and defaultless, like every copy port in this repo: the adapter
 * ships no language of its own. Two packs sit beside it (`./pt-BR`,
 * `./en-US`); a host passes one by hand, or its own.
 */

/** The cancellation codes a merchant may send: Open Delivery v1.7.1's (`../open-delivery/reasons.ts`). */
export const NINETY_NINE_FOOD_REASON_CODES = OPEN_DELIVERY_MERCHANT_REASON_CODES;

export type NinetyNineFoodReasonCode = (typeof NINETY_NINE_FOOD_REASON_CODES)[number];

export interface NinetyNineFoodAdapterCopy {
  /** One label per reason code. Sent as the request's `reason` text when the store wrote none. */
  reasonLabels: Readonly<Record<NinetyNineFoodReasonCode, string>>;
  /** What an address with no street number says instead. */
  missingStreetNumber: string;
}
