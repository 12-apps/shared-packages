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
 * How a discount computes its value. Each type reads exactly ONE value column
 * and the DB CHECK enforces that the other three are NULL:
 *
 * | type | column | means |
 * |---|---|---|
 * | `PERCENTAGE` | `percentOffBp` | basis points off its base |
 * | `FIXED_AMOUNT` | `amountOffCents` | cents off its base |
 * | `BUNDLE_PRICE` | `bundlePriceCents` | the matched group costs exactly this |
 * | `FREE_UNITS` | `freeUnits` | the cheapest N units of the group are free |
 *
 * The last two are COMBO rewards and are only legal on a `COMBO`-scoped rule,
 * because neither can be computed without a matched group to price: "the group
 * costs R$ 25" and "one of them is free" are both statements ABOUT a group.
 * `toDiscountScalars` refuses the combination, and a host's CHECK should too.
 *
 * The first two are legal at EVERY scope, `COMBO` included — "10% off when you
 * buy the bundle" is a perfectly ordinary promotion, and it reads its base from
 * the matched group like the other two.
 */
export const DISCOUNT_TYPES = [
  "PERCENTAGE",
  "FIXED_AMOUNT",
  "BUNDLE_PRICE",
  "FREE_UNITS",
] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/** The two types that only mean something against a matched combo group. */
export const COMBO_ONLY_DISCOUNT_TYPES = ["BUNDLE_PRICE", "FREE_UNITS"] as const;

/**
 * What a discount is allowed to touch. `ORDER` carries no targets; `CATEGORY`
 * and `ITEM` are resolved through their join tables; `COMBO` is resolved by
 * MATCHING the cart against a list of quantified slots (see
 * {@link ComboRequirement} in `./types`). The evaluator applies them
 * narrowest-first (R6) so an order-wide promo can never give away money an
 * item-level promo already removed.
 *
 * `COMBO` is the narrowest of the four and runs FIRST, because a combo price is
 * a number the merchant set deliberately for a specific group of units, and
 * everything else is an adjustment around it (R10).
 *
 * Appended rather than inserted: these values are stored as plain strings and
 * typically pinned by a CHECK constraint, so the ARRAY's order is not a
 * contract but its membership is. The pass order lives in
 * `./evaluate-passes.ts`, which names the scopes explicitly.
 */
export const DISCOUNT_SCOPES = ["ORDER", "CATEGORY", "ITEM", "COMBO"] as const;
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];

/**
 * The DIMENSIONS a discount can be pointed at — the two scopes above that name
 * rows in a host's catalog, as opposed to `ORDER` (which names nothing) and
 * `COMBO` (which names its own slots).
 *
 * Split out from the scopes because they are the key of a different thing: a
 * `DiscountableCollection` is a host's answer for ONE of these
 * (`./server/collections`), and a combo slot names both of them at once, so
 * neither list is a subset of the other in use even though it is here.
 *
 * This set is closed today and that is a boundary rather than a principle. A
 * third dimension — "every item from this supplier", "every item on this
 * shelf" — is expressible the moment targets are stored BY VALUE
 * (`(target_type, target_id)`) rather than as a join table per member, and the
 * registration seam is deliberately shaped so that widening this array plus
 * registering one more collection is the whole change.
 */
export const DISCOUNT_TARGET_TYPES = ["CATEGORY", "ITEM"] as const;
export type DiscountTargetType = (typeof DISCOUNT_TARGET_TYPES)[number];

/**
 * What makes a discount fire: the engine picks `AUTOMATIC` ones up on its own,
 * while a `CODE` one only becomes a candidate when the buyer types its coupon.
 */
export const DISCOUNT_TRIGGERS = ["AUTOMATIC", "CODE"] as const;
export type DiscountTrigger = (typeof DISCOUNT_TRIGGERS)[number];

/**
 * Where a rule sits relative to its window RIGHT NOW.
 *
 * A derived fact rather than a stored one — it is `startsAt`/`endsAt` compared
 * against an instant, so storing it would mean a column that is wrong between
 * the moment a promotion starts and the next time something wrote to it.
 *
 * The values are English wire tokens on purpose. They are read in three places
 * that must agree — an admin grid's filter pill, the query the backend
 * receives, and the badge on a row — and the moment one of those three is a
 * word in a language, the set stops being a set: the origin host filtered on
 * `Vigente`, so its pill values WERE its pt-BR labels, and a second host in
 * another language could not use its own words without changing the wire.
 * Labels come from the web copy pack; these do not.
 */
export const DISCOUNT_WINDOW_STATES = ["RUNNING", "SCHEDULED", "ENDED"] as const;
export type DiscountWindowState = (typeof DISCOUNT_WINDOW_STATES)[number];

/**
 * Which of the three a rule is in, at `now`.
 *
 * Domain logic rather than presentation, which is why it lives beside the
 * vocabulary and not in the web surface: the badge on a row and the filter the
 * backend applies must answer this the same way, and two implementations of
 * "has it ended" is how a grid shows a rule as running on a row the filter
 * excludes.
 *
 * The window is half-open `[startsAt, endsAt)` — `endsAt` is EXCLUSIVE, so a
 * promotion ends the instant its end date begins.
 */
export function discountWindowState(
  rule: { startsAt: Date | string | null; endsAt: Date | string | null },
  now: Date,
): DiscountWindowState {
  const instant = now.getTime();
  const starts = rule.startsAt === null ? null : new Date(rule.startsAt).getTime();
  const ends = rule.endsAt === null ? null : new Date(rule.endsAt).getTime();
  if (starts !== null && starts > instant) return "SCHEDULED";
  if (ends !== null && ends <= instant) return "ENDED";
  return "RUNNING";
}

/**
 * Why a discount the buyer explicitly asked for was not applied. Only ever
 * surfaced for a coupon the buyer typed or for a promo displaced by an
 * exclusive one — a failing AUTOMATIC discount is silently skipped, because a
 * buyer must not be shown promotions they cannot have.
 *
 * `OUT_OF_SCHEDULE` earns its own key for the same reason `COMBO_NOT_MATCHED`
 * does, and NOT the one `NOT_STARTED`/`EXPIRED` share. A campaign that has
 * ended is over; there is nothing the buyer can do. A promotion that runs on
 * Fridays from 16:00 is one they can simply come back for, and "expirado" would
 * send them away from a shop that will sell it to them in an hour.
 *
 * `COMBO_NOT_MATCHED` is deliberately NOT folded into `NO_ELIGIBLE_ITEMS`,
 * even though the two are the same predicate ("R3 covered nothing"), because
 * the rest of this set is coarse for a reason that does not hold here: those
 * reasons are merged when there is nothing the buyer could do differently. A
 * buyer one soda short of a combo CAN act — adding it is the entire point of
 * advertising the combo — so the sentence is worth its own key. See the pt-BR
 * pack, where the scheduling reasons still collapse into one and this one
 * does not.
 */
export const DISCOUNT_REJECTION_REASONS = [
  "UNKNOWN_CODE",
  "INACTIVE",
  "NOT_STARTED",
  "EXPIRED",
  "OUT_OF_SCHEDULE",
  "MIN_SUBTOTAL_NOT_MET",
  "USAGE_LIMIT_REACHED",
  "BUYER_LIMIT_REACHED",
  "NO_ELIGIBLE_ITEMS",
  "COMBO_NOT_MATCHED",
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

/**
 * The most slots one combo may declare, and the most units one slot may ask
 * for. Both are FORM sanity rather than engine limits — the matcher is linear
 * in slots x lines and would not care — and they exist for the two reasons the
 * rest of this file's bounds do: an operator who typed 500 into a quantity
 * field made a mistake worth a sentence, and a host that pins these as CHECK
 * constraints needs a number to pin.
 *
 * Sized from what a combo IS rather than from what a database could hold: the
 * spoken examples are two and three slots ("sandwich + soda", "popcorn + two
 * sodas"), and a promotion nobody can describe in a sentence is not one a buyer
 * will understand on a card.
 */
export const MAX_COMBO_SLOTS = 8;
export const MAX_COMBO_SLOT_QUANTITY = 50;

/** Codes are compared case- and whitespace-insensitively. */
export function normalizeDiscountCode(raw: string): string {
  return raw.trim().toUpperCase();
}
