import { expect } from "vitest";

import { evaluateDiscounts } from "../evaluate";
import { toMinutes, type DiscountSchedule, type LocalClock } from "../schedule";
import type {
  ComboRequirement,
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

/**
 * One combo slot. Both target lists default to empty, so a case names only the
 * one it is about — `slot({ menuItemIds: ["burger"], quantity: 3 })`.
 */
export function slot(overrides: Partial<ComboRequirement> = {}): ComboRequirement {
  return { menuItemIds: [], categoryIds: [], quantity: 1, ...overrides };
}

/**
 * A live, stackable COMBO rule. Defaults to a 10%-off-the-group reward so a
 * case that is about MATCHING does not have to pick a reward, exactly as
 * {@link rule} defaults to an order-wide 10%.
 */
export function comboRule(
  requirements: readonly ComboRequirement[],
  overrides: Partial<DiscountRule> & { id: string },
): DiscountRule {
  return rule({ scope: "COMBO", comboRequirements: requirements, ...overrides });
}

/** A combo priced as a whole: the matched group costs `bundlePriceCents`. */
export function bundleRule(
  bundlePriceCents: number,
  requirements: readonly ComboRequirement[],
  overrides: Partial<DiscountRule> & { id: string },
): DiscountRule {
  return comboRule(requirements, {
    type: "BUNDLE_PRICE",
    percentOffBp: null,
    bundlePriceCents,
    ...overrides,
  });
}

/** A "take N, pay for fewer" combo: the cheapest `freeUnits` are free. */
export function freeUnitsRule(
  freeUnits: number,
  requirements: readonly ComboRequirement[],
  overrides: Partial<DiscountRule> & { id: string },
): DiscountRule {
  return comboRule(requirements, {
    type: "FREE_UNITS",
    percentOffBp: null,
    freeUnits,
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
  localNow?: LocalClock | null;
}): DiscountEvaluation {
  return evaluateDiscounts({
    lines: args.lines ?? [line({ lineId: "l1" })],
    rules: args.rules,
    couponCode: args.couponCode ?? null,
    now: args.now ?? NOW,
    localNow: args.localNow,
  });
}

/** Monday-first weekday indices, so a case reads as the day it is about. */
export const MON = 0;
export const TUE = 1;
export const WED = 2;
export const THU = 3;
export const FRI = 4;
export const SAT = 5;
export const SUN = 6;

/** A store wall clock: `clock(FRI, "17:30")`. */
export function clock(weekday: number, hhmm: string): LocalClock {
  const parsed = toMinutes(hhmm);
  if (parsed === null) throw new Error(`not a time: ${hhmm}`);
  return { weekday, minutes: parsed };
}

/** "Toda sexta, das 16:00 às 20:00" — one window, spelled as the merchant says it. */
export function schedule(
  days: readonly number[],
  from: string,
  to: string,
): DiscountSchedule {
  return { windows: [{ days, from, to }] };
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
