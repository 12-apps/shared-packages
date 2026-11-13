/**
 * The words the 99Food adapter needs from its host, and nothing else.
 *
 * Required and defaultless, like every copy port in this repo: the adapter
 * ships no language of its own. Two packs sit beside it (`./pt-BR`,
 * `./en-US`); a host passes one by hand, or its own.
 */

/**
 * The cancellation codes a merchant may send, verbatim from Open Delivery
 * v1.7.1 (`RequestCancelled.code`). Pinned by the spec, not estimated. The two
 * codes only the marketplace sends (`CONSUMER_CANCELLATION_REQUESTED`,
 * `OTHER_CANCELLATION_REASON`) are not a store's to choose and are left out.
 */
export const NINETY_NINE_FOOD_REASON_CODES = [
  "SYSTEMIC_ISSUES",
  "DUPLICATE_APPLICATION",
  "UNAVAILABLE_ITEM",
  "RESTAURANT_WITHOUT_DELIVERY_PERSON",
  "OUTDATED_MENU",
  "ORDER_OUTSIDE_THE_DELIVERY_AREA",
  "BLOCKED_CUSTOMER",
  "OUTSIDE_DELIVERY_HOURS",
  "INTERNAL_DIFFICULTIES_OF_THE_RESTAURANT",
  "RISK_AREA",
  "DELIVERY_PROBLEM",
] as const;

export type NinetyNineFoodReasonCode = (typeof NINETY_NINE_FOOD_REASON_CODES)[number];

export interface NinetyNineFoodAdapterCopy {
  /** One label per reason code. Sent as the request's `reason` text when the store wrote none. */
  reasonLabels: Readonly<Record<NinetyNineFoodReasonCode, string>>;
  /** What an address with no street number says instead. */
  missingStreetNumber: string;
}
