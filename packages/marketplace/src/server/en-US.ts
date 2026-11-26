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
  link: {
    problems: {
      UNAVAILABLE: "Connecting through the app is not available for this marketplace.",
      NO_LINK_IN_PROGRESS: "No connection is in progress. Start again from the first step.",
      LINK_EXPIRED: "The code has expired. Get a new code and repeat the steps.",
      CODE_REFUSED: "The marketplace refused the authorization code. Check the code and paste it again.",
      MARKETPLACE_REFUSED: "The marketplace refused the connection request.",
      NOT_LINKED: "This store is not connected through the app. Connect it again.",
      UNKNOWN_MERCHANT: "This store is not among the ones authorized on the marketplace.",
      MERCHANT_TAKEN: "This marketplace store is already connected to another account.",
    },
    tryAgain: "The marketplace did not answer. Try again in a moment.",
  },
} as const satisfies MarketplaceServerCopy;
