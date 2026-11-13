import { describe, expect, it } from "vitest";

import { computeTax } from "../compute";
import type { TaxClass, TaxInput, TaxLineInput, TaxRegime } from "../types";
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
    baseCents: Math.floor(random(100 + i * 4) * 50_000),
    quantity: 1 + Math.floor(random(101 + i * 4) * 5),
    foodAndDrink: random(102 + i * 4) < 0.8,
    taxClass: pick(CLASS_POOL, 103 + i * 4),
  }));
  const total = lines.reduce((sum, line) => sum + line.baseCents, 0);
  return {
    lines,
    seller: { ...RESTAURANT_SELLER, regime, restaurantRegime: random(1) < 0.7 },
    destinationIbge: SAO_PAULO,
    exclusions: {
      serviceCharge:
        random(2) < 0.6
          ? { id: "service", amountCents: Math.round(total * random(3) * 0.25), passedToStaff: random(4) < 0.7, taxClass: CLASSES.deliveryFee }
          : null,
      retainedIntermediationCents: random(5) < 0.4 ? Math.floor(random(6) * total) : 0,
    },
    tables: TABLES,
    supplyDate: pick(DATES, 7),
  };
}

describe("properties over 200 seeded baskets", () => {
  it.each(SEEDS)("seed %i: Σ line tax equals the order tax, per tax and in total", (seed) => {
    const result = computeTax(basket(seed, "REGIME_REGULAR"));
    const sum = (pick: (line: (typeof result.lines)[number]) => number) => result.lines.reduce((s, l) => s + pick(l), 0);
    expect(sum((l) => l.cbsCents)).toBe(result.cbsCents);
    expect(sum((l) => l.ibsUfCents)).toBe(result.ibsUfCents);
    expect(sum((l) => l.ibsMunCents)).toBe(result.ibsMunCents);
    expect(sum((l) => l.taxBaseCents)).toBe(result.taxBaseCents);
    expect(sum((l) => l.cbsCents + l.ibsUfCents + l.ibsMunCents)).toBe(result.totalTaxCents);
    expect(result.ibsCents).toBe(result.ibsUfCents + result.ibsMunCents);
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

  it.each(SEEDS)("seed %i: the gorjeta exclusion never passes 15% of food and drink, nor the charge itself", (seed) => {
    const input = basket(seed, "REGIME_REGULAR");
    const result = computeTax(input);
    const foodAndDrink = input.lines.filter((l) => l.foodAndDrink).reduce((s, l) => s + l.baseCents, 0);
    expect(result.gorjetaExcludedCents * 10_000).toBeLessThanOrEqual(foodAndDrink * 1500);
    expect(result.gorjetaExcludedCents).toBeLessThanOrEqual(input.exclusions.serviceCharge?.amountCents ?? 0);
    const exclusionsApply = input.seller.restaurantRegime && input.exclusions.serviceCharge?.passedToStaff === true;
    if (!exclusionsApply) expect(result.gorjetaExcludedCents).toBe(0);
  });

  it.each(SEEDS)("seed %i: the base loses exactly the exclusions, and no line goes negative", (seed) => {
    const input = basket(seed, "REGIME_REGULAR");
    const result = computeTax(input);
    const gross = input.lines.reduce((s, l) => s + l.baseCents, 0) + (input.exclusions.serviceCharge?.amountCents ?? 0);
    expect(result.taxBaseCents).toBe(gross - result.gorjetaExcludedCents - result.intermediationExcludedCents);
    expect(result.lines.every((l) => l.taxBaseCents >= 0 && l.taxBaseCents <= l.baseCents)).toBe(true);
  });

  it.each(SEEDS)("seed %i: MEI pays nothing, whatever the basket", (seed) => {
    expect(computeTax(basket(seed, "MEI")).totalTaxCents).toBe(0);
  });
});
