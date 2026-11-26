/**
 * The cancellation codes a merchant may send, verbatim from Open Delivery's
 * `RequestCancelled.code`: the same eleven in v1.7.1 and in Keeta's v1.5.0
 * (its "códigos de cancelamento (v1.0.7+)"). Pinned by the standard, not
 * estimated. The two codes only the marketplace sends
 * (`CONSUMER_CANCELLATION_REQUESTED`, `OTHER_CANCELLATION_REASON`) are not a
 * store's to choose and are left out.
 */
export const OPEN_DELIVERY_MERCHANT_REASON_CODES = [
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

export type OpenDeliveryMerchantReasonCode = (typeof OPEN_DELIVERY_MERCHANT_REASON_CODES)[number];

/** The one reason that means "an item is unavailable". */
export const OPEN_DELIVERY_ITEM_UNAVAILABLE: OpenDeliveryMerchantReasonCode = "UNAVAILABLE_ITEM";
