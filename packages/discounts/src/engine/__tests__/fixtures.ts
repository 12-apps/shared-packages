import { expect } from "vitest";

import { evaluateDiscounts } from "../evaluate";
import type {
  DiscountCartLine,
  DiscountEvaluation,
  DiscountRule,
} from "../types";

/**
 * Builders for the evaluator's unit matrix (FUT-245). Every date is a literal —
 * `no-random-data` is a hard error in these globs, and a discount engine whose
 * tests depend on the wall clock would be exactly the flake the gate exists to
 * prevent.
 *
 * Shared across the four suites so none of them has to restate a whole
 * `DiscountRule`; the duplication gate counts copy-pasted fixtures too.
 */

/** The evaluation instant every suite injects. */
export const NOW = new Date("2026-03-15T12:00:00.000Z");

/** A `createdAt` well before {@link NOW}, so rules are "old" by default. */
const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");

/** Shift {@link NOW} by whole milliseconds — the half-open window's resolution. */
export function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

/**
 * A live, stackable, order-wide 10%-off rule. Every case overrides only the
 * field it is about, so a test reads as its own name.
 */
export function rule(overrides: Partial<DiscountRule> & { id: string }): DiscountRule {
  return {
    name: `Promo ${overrides.id}`,
    type: "PERCENTAGE",
    percentOffBp: 1_000,
    amountOffCents: null,
    scope: "ORDER",
    targetCategoryIds: [],
    targetMenuItemIds: [],
    trigger: "AUTOMATIC",
    code: null,
    active: true,
    startsAt: null,
    endsAt: null,
    minSubtotalCents: null,
    usageLimit: null,
    usageCount: 0,
    perBuyerLimit: null,
    buyerUsageCount: 0,
    stackable: true,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

/** A percentage rule expressed in whole percent, for readable test intent. */
export function percentRule(
  percent: number,
  overrides: Partial<DiscountRule> & { id: string },
): DiscountRule {
  return rule({ type: "PERCENTAGE", percentOffBp: percent * 100, ...overrides });
}

/** A fixed-amount rule; `percentOffBp` is nulled to match the DB CHECK. */
export function fixedRule(
  amountOffCents: number,
  overrides: Partial<DiscountRule> & { id: string },
): DiscountRule {
  return rule({
    type: "FIXED_AMOUNT",
    percentOffBp: null,
    amountOffCents,
    ...overrides,
  });
}

/** One cart line, priced the way `getCartViewForTenant` prices it. */
export function line(
  overrides: Partial<DiscountCartLine> & { lineId: string },
): DiscountCartLine {
  return {
    menuItemId: `item-${overrides.lineId}`,
    variationMenuItemId: null,
    categoryPath: [],
    quantity: 1,
    unitPriceCents: 1_000,
    ...overrides,
  };
}

/**
 * Evaluate against a one-line, 1000-cent cart unless the case says otherwise —
 * most of the matrix is about the RULES, not about the cart.
 */
export function evaluateCart(args: {
  rules: readonly DiscountRule[];
  lines?: readonly DiscountCartLine[];
  couponCode?: string | null;
  now?: Date;
}): DiscountEvaluation {
  return evaluateDiscounts({
    lines: args.lines ?? [line({ lineId: "l1" })],
    rules: args.rules,
    couponCode: args.couponCode ?? null,
    now: args.now ?? NOW,
  });
}

function sumBy<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

/**
 * C23 — the double-entry invariant, asserted on every evaluation the matrix
 * produces: the applied discounts, the order total and the per-line allocation
 * are three views of ONE number, and no line may go negative.
 */
export function expectMoneyInvariant(result: DiscountEvaluation): void {
  const appliedTotal = sumBy(result.applied, (entry) => entry.amountCents);
  const lineTotal = sumBy(result.lines, (adjustment) => adjustment.discountCents);
  expect(appliedTotal).toBe(result.discountTotalCents);
  expect(lineTotal).toBe(result.discountTotalCents);
  expect(result.totalCents).toBe(result.subtotalCents - result.discountTotalCents);
  expect(result.totalCents).toBeGreaterThanOrEqual(0);
  expect(result.discountTotalCents).toBeGreaterThanOrEqual(0);
  expect(result.lines.every((adjustment) => adjustment.lineNetCents >= 0)).toBe(true);
  expect(result.applied.every((entry) => entry.amountCents > 0)).toBe(true);
}

/** The ids of the applied discounts, in application order. */
export function appliedIds(result: DiscountEvaluation): string[] {
  return result.applied.map((entry) => entry.discountId);
}

/** The rejection reason recorded for one discount id, or undefined. */
export function reasonFor(
  result: DiscountEvaluation,
  discountId: string | null,
): string | undefined {
  return result.rejections.find((rejection) => rejection.discountId === discountId)?.reason;
}
