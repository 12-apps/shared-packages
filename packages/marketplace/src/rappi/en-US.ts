import type { RappiAdapterCopy } from "./copy";

/** The Rappi adapter's en-US pack: the same reasons, in English. */
export const RAPPI_ADAPTER_COPY_EN_US = {
  reasonLabels: {
    ITEM_OUT_OF_STOCK: "Item unavailable",
    ITEM_NOT_FOUND: "Item not found",
    ITEM_WRONG_PRICE: "Wrong item price",
    ORDER_MISSING_INFORMATION: "Order information missing",
    ORDER_MISSING_ADDRESS_INFORMATION: "Address information missing",
    ORDER_TOTAL_INCORRECT: "Order total incorrect",
  },
  missingStreetNumber: "no number",
} as const satisfies RappiAdapterCopy;
