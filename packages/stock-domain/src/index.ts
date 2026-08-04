/**
 * The stock-movement reason vocabulary — the two closed value sets the taxonomy
 * is built on, owned HERE and nowhere else.
 *
 * These lists used to be written out by hand in nine places (the Prisma-backed
 * repository, the lifecycle blueprint, the MCP registry's zod enums, the report
 * builder's loss predicate, two admin screens and a route's `as` casts). Every
 * copy was correct on the day it was written, and nothing could tell you when
 * one stopped being correct: the copies do not reference each other, so a value
 * added to one is invisible to the rest.
 *
 * Worse, most copies WIDENED to `string` at the point of use — the type that
 * admits every value is also the type that never fails to compile, so the drift
 * could not surface even in principle. Deriving the types from these arrays is
 * what makes the compiler the thing that notices.
 *
 * Deliberately zero-dependency and runtime-free of framework code: the server
 * repositories, the Next.js API routes, the report builder and the browser SPAs
 * all import it, so anything heavier here would be dragged into a bundle.
 */

/**
 * The axis a reason sits on: whether it explains stock LEAVING or COMING BACK.
 *
 * This is the distinction that decides a movement's sign, so it is also the one
 * a loss report must filter on — the same taxonomy models surpluses, and a
 * GAIN reason counted as a loss makes the number lie rather than merely round.
 */
export const STOCK_REASON_KINDS = ['LOSS', 'GAIN'] as const;

/** A reason's axis. Fixed at creation — a LOSS reason never becomes a GAIN one. */
export type StockReasonKind = (typeof STOCK_REASON_KINDS)[number];

/**
 * How a LOSS is sub-classified. Inert on a GAIN reason, which carries the
 * default rather than a meaningful value — so this is never a substitute for
 * reading the kind.
 */
export const LOSS_CATEGORIES = ['WASTE', 'LOSS', 'SPOILAGE'] as const;

/** A loss's sub-classification. */
export type LossCategory = (typeof LOSS_CATEGORIES)[number];

/** What a reason's axis defaults to when the caller does not choose one. */
export const DEFAULT_STOCK_REASON_KIND: StockReasonKind = 'LOSS';

/** What a loss's sub-classification defaults to, and what a GAIN reason carries. */
export const DEFAULT_LOSS_CATEGORY: LossCategory = 'LOSS';

/**
 * Narrow an untrusted string to a reason axis.
 *
 * Takes `string` rather than {@link StockReasonKind} on purpose: this is the
 * boundary where a form field, a query param or a database column becomes a
 * domain value, and a parameter already typed as the union would make the check
 * vacuous.
 */
export function isStockReasonKind(value: string): value is StockReasonKind {
  return (STOCK_REASON_KINDS as readonly string[]).includes(value);
}

/** Narrow an untrusted string to a loss sub-classification. */
export function isLossCategory(value: string): value is LossCategory {
  return (LOSS_CATEGORIES as readonly string[]).includes(value);
}
