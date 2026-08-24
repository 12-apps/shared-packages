import { EN_US_DISCOUNT_REJECTION_COPY } from "./engine/en-US";
import { PT_BR_DISCOUNT_REJECTION_COPY } from "./engine/pt-BR";
import type { DiscountRejectionCopy } from "./engine/rejection-copy";
import { EN_US_DISCOUNTS_WEB_COPY } from "./react/en-US";
import type { DiscountsWebCopy } from "./react/copy";
import { PT_BR_DISCOUNTS_WEB_COPY } from "./react/pt-BR";
import type { DiscountsServerCopy } from "./server/copy";
import { EN_US_DISCOUNTS_SERVER_COPY } from "./server/en-US";
import { PT_BR_DISCOUNTS_SERVER_COPY } from "./server/pt-BR";

/**
 * All three surfaces, in both languages, keyed by tag — what a host hands to
 * `@12-apps/i18n` when the reader's language is a property of the request
 * rather than of the deployment.
 *
 * Three packs rather than one, because the three have different AUDIENCES and
 * different lifetimes: the rejection copy is read by a shopper at a cart, the
 * server copy by an operator filling a form, and the web copy by that same
 * operator on the screen around it. A host may well resolve them from different
 * places.
 *
 * `LocalePack` is mirrored here rather than imported so the package stays
 * liftable into a repo that has never heard of `@12-apps/i18n`. The named
 * single-language packs stay exported and unchanged.
 */
type LocalePack<T> = { readonly "pt-BR": T; readonly "en-US": T };

export const DISCOUNT_REJECTION_COPY = {
  "pt-BR": PT_BR_DISCOUNT_REJECTION_COPY,
  "en-US": EN_US_DISCOUNT_REJECTION_COPY,
} as const satisfies LocalePack<DiscountRejectionCopy>;

export const DISCOUNTS_SERVER_COPY = {
  "pt-BR": PT_BR_DISCOUNTS_SERVER_COPY,
  "en-US": EN_US_DISCOUNTS_SERVER_COPY,
} as const satisfies LocalePack<DiscountsServerCopy>;

export const DISCOUNTS_WEB_COPY = {
  "pt-BR": PT_BR_DISCOUNTS_WEB_COPY,
  "en-US": EN_US_DISCOUNTS_WEB_COPY,
} as const satisfies LocalePack<DiscountsWebCopy>;
