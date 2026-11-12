import type { MarketplaceServerCopy } from "./copy";

/** The marketplace routes' en-US pack. */
export const MARKETPLACE_SERVER_COPY_EN_US = {
  invalidInput: "Invalid data.",
  nothingSaved: "Nothing was saved. Fix the problems listed and send the whole call again.",
  orderNoLongerPending: "This order was already decided or has expired. Refresh the screen.",
  problems: {
    DUPLICATE: "This row repeats one earlier in the same call.",
    NOT_FOUND: "Not found.",
    ALREADY_DECIDED: "This order was already decided.",
    EXPIRED: "This order's acceptance window has passed.",
    CONFLICT: "Someone else decided this order a moment ago.",
    INVALID_REASON: "That reason is not one this marketplace accepts.",
    ITEMS_REQUIRED: "This reason needs the items it is about.",
    UNKNOWN_ITEM: "This item is not in the order.",
    HOST_REFUSED: "The store refused this decision.",
    UNKNOWN_PROVIDER: "Unknown marketplace.",
    NOTHING_TO_UPDATE: "Nothing to update.",
    CATALOG_ITEM_NOT_FOUND: "Product not found.",
  },
} as const satisfies MarketplaceServerCopy;
