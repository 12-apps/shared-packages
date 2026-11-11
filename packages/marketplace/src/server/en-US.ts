import type { MarketplaceServerCopy } from "./copy";

/** The marketplace routes' en-US pack. */
export const MARKETPLACE_SERVER_COPY_EN_US = {
  invalidInput: "Invalid data.",
  unknownProvider: "Unknown marketplace.",
  orderNoLongerPending: "This order was already decided or has expired. Refresh the screen.",
  invalidReason: "That reason is not one this marketplace accepts.",
  catalogItemNotFound: "Product not found.",
  nothingToUpdate: "Nothing to update.",
} as const satisfies MarketplaceServerCopy;
