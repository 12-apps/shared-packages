import { describe, expect, it } from "vitest";

import { computeTax } from "../compute";
import { roundTaxCents } from "../rounding";
import type { LineTax, TaxBreakdown, TaxClass, TaxInput, TaxLineInput, TaxRegime } from "../types";
import { CLASSES, RESTAURANT_SELLER, SAO_PAULO, TABLES } from "./fixtures/baskets";

/**
 * Property tests over random baskets. Every draw is a pure hash of (seed,
 * draw number), so every run draws the same baskets and a failure names the
 * seed that reproduces it — random in coverage, deterministic in CI.
 */

/** A stateless hash of (seed, draw) onto [0, 1) — mulberry32's mixing step, so no closure carries state. */
function draw(seed: number, index: number): number {
  let t = (Math.imul(seed, 0x9e3779b1) + Math.imul(index + 1, 0x6d2b79f5)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const CLASS_POOL: readonly TaxClass[] = Object.values(CLASSES);
const DATES = ["2026-03-10", "2027-01-01", "2028-12-31", "2029-07-04", "2031-02-28", "2033-01-01", "2040-05-05"];
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

function basket(seed: number, regime: TaxRegime): TaxInput {
  const random = (index: number) => draw(seed, index);
  const pick = <T>(items: readonly T[], index: number): T => items[Math.floor(random(index) * items.length)]!;
  const lines: TaxLineInput[] = Array.from({ length: 1 + Math.floor(random(0) * 12) }, (_, i) => ({
    id: `line-${i}`,
    valueCents: Math.floor(random(100 + i * 4) * 50_000),
    quantity: 1 + Math.floor(random(101 + i * 4) * 5000) / 1000,
    foodAndDrink: random(102 + i * 4) < 0.8,
    taxClass: pick(CLASS_POOL, 103 + i * 4),
  }));
  const total = lines.reduce((sum, line) => sum + line.valueCents, 0);
  const restaurantRegime = random(1) < 0.7;
  return {
    lines,
    seller: { ...RESTAURANT_SELLER, regime, restaurantRegime },
    destinationIbge: SAO_PAULO,
    exclusions: {
      serviceCharge:
        random(2) < 0.6
          ? { id: "service", amountCents: Math.round(total * random(3) * 0.25), passedToStaff: random(4) < 0.7, taxClass: CLASSES.deliveryFee }
          : null,
      retainedIntermediation: restaurantRegime && random(5) < 0.4 ? { id: "platform", amountCents: Math.floor(random(6) * 5000) } : null,
    },
    tables: TABLES,
    supplyDate: pick(DATES, 7),
  };
}

const TAXES = [
  ["cbsCents", "cbsRateBp"],
  ["ibsUfCents", "ibsUfRateBp"],
  ["ibsMunCents", "ibsMunRateBp"],
] as const;

/** Exact: |tax − base × rate × (1 − reduction)| ≤ ½ cent, and an exact half lands on the even cent. */
function isNearestEven(line: LineTax, tax: (typeof TAXES)[number]): boolean {
  const scale = 100_000_000n;
  const exact = BigInt(line.taxBaseCents) * BigInt(line[tax[1]]) * BigInt(10_000 - line.reductionBp);
  const twiceGap = 2n * (BigInt(line[tax[0]]) * scale - exact);
  const gap = twiceGap < 0n ? -twiceGap : twiceGap;
  if (gap < scale) return true;
  return gap === scale && line[tax[0]] % 2 === 0;
}

function sumOf(result: TaxBreakdown, pick: (line: LineTax) => number): number {
  return result.lines.reduce((sum, line) => sum + pick(line), 0);
}

function insideTaxes(line: LineTax, base: number): number {
  return TAXES.reduce((sum, [, rate]) => sum + roundTaxCents(base, line[rate], line.reductionBp), 0);
}

describe("properties over 200 seeded baskets", () => {
  it.each(SEEDS)("seed %i: every item's tax is its base × rate to the nearest cent, ties to even; the order adds them up", (seed) => {
    const result = computeTax(basket(seed, "REGIME_REGULAR"));
    for (const line of result.lines) {
      for (const tax of TAXES) expect(isNearestEven(line, tax), `${line.lineId} ${tax[0]}`).toBe(true);
    }
    expect(sumOf(result, (l) => l.taxCents)).toBe(result.totalTaxCents);
    expect(result.cbsCents + result.ibsCents).toBe(result.totalTaxCents);
  });

  it.each(SEEDS)("seed %i: a tax-inclusive price splits exactly — vProdLiq + tax = vProd, vBC the largest base that fits, vUnComLiq × qCom within ±0,01", (seed) => {
    const result = computeTax(basket(seed, "REGIME_REGULAR"));
    if (!result.taxInsidePrice) {
      expect(result.lines.every((l) => l.netValueCents === null && l.netUnitValue === null)).toBe(true);
      return;
    }
    for (const line of result.lines) {
      expect(line.netValueCents! + line.taxCents).toBe(line.valueCents);
      if (line.taxCents > 0) {
        expect(line.taxBaseCents + insideTaxes(line, line.taxBaseCents)).toBeLessThanOrEqual(line.valueCents);
        expect(line.taxBaseCents + 1 + insideTaxes(line, line.taxBaseCents + 1)).toBeGreaterThan(line.valueCents);
      }
      const unitTimesQuantity = Math.round(Number(line.netUnitValue) * line.quantity * 100);
      expect(Math.abs(unitTimesQuantity - line.netValueCents!)).toBeLessThanOrEqual(1);
    }
  });

  it.each(SEEDS)("seed %i: a Simples store is informative and shows the figures a regime store would", (seed) => {
    const regular = computeTax(basket(seed, "REGIME_REGULAR"));
    const simples = computeTax(basket(seed, "SIMPLES"));
    expect(simples.informative).toBe(true);
    expect(simples.treatment).toBe("INFORMATIVE");
    const period = TABLES.periods.find((p) => p.from <= regular.supplyDate && (p.to === null || regular.supplyDate <= p.to))!;
    if (period.appliesToSimplesNacional) {
      expect(simples.lines).toEqual(regular.lines);
      expect(simples.totalTaxCents).toBe(regular.totalTaxCents);
    } else {
      expect(simples.totalTaxCents).toBe(0);
    }
  });

  it.each(SEEDS)("seed %i: the gorjeta is excluded whole or not at all — only within 15% of food and drink, passed to staff, in the regime", (seed) => {
    const input = basket(seed, "REGIME_REGULAR");
    const result = computeTax(input);
    const charge = input.exclusions.serviceCharge;
    const line = result.lines.find((l) => l.lineId === "service");
    if (!charge) return expect(line).toBeUndefined();
    const foodAndDrink = input.lines.filter((l) => l.foodAndDrink).reduce((s, l) => s + l.valueCents, 0);
    const excluded = input.seller.restaurantRegime && charge.passedToStaff && charge.amountCents * 10_000 <= foodAndDrink * 1500;
    expect(result.gorjetaExcludedCents).toBe(excluded ? charge.amountCents : 0);
    expect(line!.source).toBe(excluded ? "GORJETA_EXCLUDED" : "SERVICE_CHARGE");
    if (excluded) expect(line).toMatchObject({ taxBaseCents: 0, taxCents: 0, taxClass: { cClassTrib: "410019" } });
    else expect(line!.taxClass).toBe(charge.taxClass);
  });

  it.each(SEEDS)("seed %i: the retained intermediation is its own 410020 item and no line's base moves for it", (seed) => {
    const input = basket(seed, "REGIME_REGULAR");
    const result = computeTax(input);
    const without = computeTax({ ...input, exclusions: { ...input.exclusions, retainedIntermediation: null } });
    expect(result.lines.filter((l) => l.source !== "INTERMEDIATION_EXCLUDED")).toEqual(without.lines);
    const retained = input.exclusions.retainedIntermediation;
    expect(result.intermediationExcludedCents).toBe(retained?.amountCents ?? 0);
    if (retained) {
      expect(result.lines.at(-1)).toMatchObject({ lineId: "platform", taxBaseCents: 0, taxCents: 0, taxClass: { cClassTrib: "410020" } });
    }
  });

  it.each(SEEDS)("seed %i: MEI pays nothing, whatever the basket", (seed) => {
    expect(computeTax(basket(seed, "MEI")).totalTaxCents).toBe(0);
  });
});
