/**
 * The words the Rappi adapter needs from its host, and nothing else.
 *
 * Required and defaultless, like every copy port in this repo: the adapter
 * ships no language of its own. Two packs sit beside it (`./pt-BR`,
 * `./en-US`); a host passes one by hand, or its own.
 */

/**
 * The `cancel_type` values a store may send with `PUT orders/{orderId}/reject`,
 * verbatim from Rappi's public API reference (dev-portal.rappi.com,
 * api-reference/orders, "PUT orders/{orderId}/reject"). Pinned by the portal,
 * not estimated.
 */
export const RAPPI_REASON_CODES = [
  "ITEM_OUT_OF_STOCK",
  "ITEM_NOT_FOUND",
  "ITEM_WRONG_PRICE",
  "ORDER_MISSING_INFORMATION",
  "ORDER_MISSING_ADDRESS_INFORMATION",
  "ORDER_TOTAL_INCORRECT",
] as const;

export type RappiReasonCode = (typeof RAPPI_REASON_CODES)[number];

/**
 * The codes with which the portal REQUIRES the offending items ("If the value
 * informed for cancel_type is one of the following: ITEM_WRONG_PRICE,
 * ITEM_NOT_FOUND, ITEM_OUT_OF_STOCK. It would be required to include the
 * offending items").
 */
export const RAPPI_ITEM_REASON_CODES: readonly RappiReasonCode[] = ["ITEM_OUT_OF_STOCK", "ITEM_NOT_FOUND", "ITEM_WRONG_PRICE"];

export interface RappiAdapterCopy {
  /** One label per reason code. Sent as the reject's required `reason` text. */
  reasonLabels: Readonly<Record<RappiReasonCode, string>>;
  /** What an address with no street number says instead. */
  missingStreetNumber: string;
}
