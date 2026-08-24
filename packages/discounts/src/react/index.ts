/**
 * `@12-apps/discounts/react` — the promotions ADMIN, as a host mounts it.
 *
 * One factory: {@link createWebDiscounts}. Everything else exported here is
 * either a seam a consumer legitimately needs on its own (the transport, to
 * substitute the backend; the formatters, to render a discount outside these
 * screens) or a type it needs to satisfy the config.
 *
 * The contract a consumer is held to, in two lines:
 *
 *  - **Build the surface ONCE, at module scope.** The members are component
 *    TYPES; rebuilding per render remounts the whole tree below, and a form
 *    then cannot be typed into.
 *  - **`onError` is yours.** These screens tell the OPERATOR what went wrong.
 *    Whether anyone else learns of it is a host decision, and a no-op default
 *    would make "nothing is broken" and "nothing is watching" look identical.
 */
export {
  createWebDiscounts,
  useWebDiscounts,
  DiscountsSurface,
  type DiscountsScreenProps,
  type DiscountsWebConfig,
  type WebDiscounts,
} from "./create-web-discounts";

export {
  missingWebCopy,
  fill,
  type DiscountsActionsCopy,
  type DiscountsCardCopy,
  type DiscountsFormCopy,
  type DiscountsScreenCopy,
  type DiscountsTargetCopy,
  type DiscountsVocabularyCopy,
  type DiscountsWebCopy,
  type DiscountsWindowCopy,
} from "./copy";

export { PT_BR_DISCOUNTS_WEB_COPY } from "./pt-BR";
export { EN_US_DISCOUNTS_WEB_COPY } from "./en-US";

export {
  createFormatters,
  formatDiscountValue,
  formatWindow,
  windowStateOf,
  EMPTY,
  type DiscountsFormatters,
} from "./format";

export {
  createDiscountsApiClient,
  toWriteBody,
  type DiscountFormPayload,
  type DiscountsApiClient,
  type DiscountsPage,
  type DiscountsPagination,
  type DiscountWireRecord,
  type WireTarget,
  type WireTargetGroup,
} from "./api";

export {
  httpDiscountsTransport,
  DiscountsHttpError,
  type DiscountsResult,
  type DiscountsTransport,
} from "./transport";

export { toListItem, type DiscountListItem } from "./row";

export type { CurrencyFieldComponent } from "./discount-form-fields";
