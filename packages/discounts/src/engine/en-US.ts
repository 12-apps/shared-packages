import { MIN_SUBTOTAL_TOKEN, type DiscountRejectionCopy } from "./rejection-copy";

/**
 * The en-US pack — a NAMED export a host passes by hand
 * (`rejectionCopy: EN_US_DISCOUNT_REJECTION_COPY`), never a default.
 *
 * Deliberately COARSER than the reason set, and the translation keeps it that
 * way: switched off, not started yet and expired all read the same, because the
 * difference only leaks how the merchant schedules promotions and the buyer
 * could not act on it either way. Four distinct English sentences here would be
 * a disclosure the Portuguese does not make.
 *
 * `COMBO_NOT_MATCHED` is the one place that coarsening stops, and for the same
 * test read the other way: a buyer one soda short of the bundle can finish it,
 * so telling them WHICH kind of failure this was is the difference between a
 * dead end and a sale. It does not name the missing item — the evaluator does
 * not report one, because "which item is missing" has no single answer when a
 * slot accepts a whole category.
 *
 * `MIN_SUBTOTAL_TOKEN` is substituted with the formatted amount, so the
 * sentence must carry it rather than a number.
 */
export const EN_US_DISCOUNT_REJECTION_COPY: DiscountRejectionCopy = {
  UNKNOWN_CODE: "That coupon is invalid or expired.",
  INACTIVE: "That coupon is invalid or expired.",
  NOT_STARTED: "That coupon is invalid or expired.",
  EXPIRED: "That coupon is invalid or expired.",
  OUT_OF_SCHEDULE: "This promotion is not running right now.",
  MIN_SUBTOTAL_NOT_MET: `This coupon needs a minimum order of ${MIN_SUBTOTAL_TOKEN}.`,
  USAGE_LIMIT_REACHED: "This coupon has reached its usage limit.",
  BUYER_LIMIT_REACHED: "You have already used this coupon.",
  NO_ELIGIBLE_ITEMS: "This coupon does not apply to the items in your cart.",
  COMBO_NOT_MATCHED: "Your cart does not have every item in this bundle yet.",
  ZERO_VALUE: "This coupon does not apply to the items in your cart.",
  NOT_STACKABLE: "Another promotion already applied is better than this coupon.",
  EMPTY_CART: "Your cart is empty.",
  minSubtotalUnknown: "This coupon needs a minimum order value.",
};
