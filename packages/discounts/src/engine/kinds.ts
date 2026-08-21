/**
 * The discount vocabulary (FUT-235) — a constants-only module with no imports
 * at all, so every surface can hold it: an offline tool generator, a browser
 * bundle, a validator, a worker. Nothing here reaches a database or a clock.
 *
 * A host stores `type`, `scope` and `trigger` as plain strings, and typically
 * pins them with CHECK constraints. Where it does, these arrays and those
 * CHECKs are the two halves of ONE closed set: widening one without the other
 * is how a write starts failing at the database instead of at the validator.
 */

/**
 * How a discount computes its value. `PERCENTAGE` reads `percentOffBp`,
 * `FIXED_AMOUNT` reads `amountOffCents`; the DB CHECK enforces that exactly one
 * of the two columns is set.
 */
export const DISCOUNT_TYPES = ["PERCENTAGE", "FIXED_AMOUNT"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/**
 * What a discount is allowed to touch. `ORDER` carries no targets; `CATEGORY`
 * and `ITEM` are resolved through their join tables. The evaluator applies them
 * narrowest-first (R6) so an order-wide promo can never give away money an
 * item-level promo already removed.
 */
export const DISCOUNT_SCOPES = ["ORDER", "CATEGORY", "ITEM"] as const;
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];

/**
 * What makes a discount fire: the engine picks `AUTOMATIC` ones up on its own,
 * while a `CODE` one only becomes a candidate when the buyer types its coupon.
 */
export const DISCOUNT_TRIGGERS = ["AUTOMATIC", "CODE"] as const;
export type DiscountTrigger = (typeof DISCOUNT_TRIGGERS)[number];

/**
 * Why a discount the buyer explicitly asked for was not applied. Only ever
 * surfaced for a coupon the buyer typed or for a promo displaced by an
 * exclusive one — a failing AUTOMATIC discount is silently skipped, because a
 * buyer must not be shown promotions they cannot have.
 */
export const DISCOUNT_REJECTION_REASONS = [
  "UNKNOWN_CODE",
  "INACTIVE",
  "NOT_STARTED",
  "EXPIRED",
  "MIN_SUBTOTAL_NOT_MET",
  "USAGE_LIMIT_REACHED",
  "BUYER_LIMIT_REACHED",
  "NO_ELIGIBLE_ITEMS",
  "ZERO_VALUE",
  "NOT_STACKABLE",
  "EMPTY_CART",
] as const;
export type DiscountRejectionReason = (typeof DISCOUNT_REJECTION_REASONS)[number];

/** 100% in basis points — the ceiling the DB CHECK also enforces. */
export const MAX_PERCENT_OFF_BP = 10_000;

/**
 * The smallest amount a discounted order is allowed to be worth: one cent.
 *
 * This exists for a PAYMENT reason, not a pricing one. An order's total is the
 * only number ever handed to a payment provider, and providers reject a
 * zero-amount charge — so an order discounted to nothing sits awaiting a
 * payment that can never be raised: stock never consumed, coupon never
 * counted, buyer looking at a charge nobody can settle. Keeping one cent
 * payable is cheaper than teaching a payment path to settle an order nobody
 * pays for.
 *
 * It is enforced DURING application (see R9 in `./evaluate.ts`), never as a
 * post-hoc trim of the final total: a discount is capped to the cents actually
 * available above this floor before it is allocated, so
 * `Σ applied[].amountCents === discountTotalCents === Σ lines[].discountCents`
 * still holds to the cent. Trimming the total afterwards would break exactly
 * that identity, and the `orders_subtotal_check` CHECK would reject the row.
 *
 * A cart whose gross is already zero is NOT raised to one cent — the floor caps
 * discounts, it never invents money. See `maxDiscountableCents` in
 * `./allocate.ts`, which is the single place the floor is turned into a number.
 */
export const MIN_PAYABLE_TOTAL_CENTS = 1;

/** Codes are compared case- and whitespace-insensitively. */
export function normalizeDiscountCode(raw: string): string {
  return raw.trim().toUpperCase();
}
