import { describe, expect, it } from "vitest";

import { computeTax } from "../compute";
import type { TaxInput } from "../types";
import { GOLDEN_DATES, marketInput, restaurantInput } from "./fixtures/baskets";

/**
 * Golden figures per year.
 *
 * - **2026 — checked against the official calculator.** The same baskets
 *   were sent to it and its answers are recorded in
 *   `fixtures/calculator/{restaurant,market}.response.json`; `oracle.test.ts`
 *   replays them. The tax is computed ON the value (not inside it in 2026).
 * - **2027, 2029, 2033 — ESTIMATE goldens.** The calculator has no rates for
 *   those years (it answers 404), so these are the engine's own figures on
 *   the table's estimated rates, cross-computed by an independent exact
 *   reference (fractions, half-even) and stamped `provisional`. From 2027 the
 *   value is the tax-inclusive price: vBC = the largest base whose rounded
 *   taxes fit inside it, the net value (vProdLiq) = price − taxes.
 *
 * Columns: [lineId, vBC, CBS, IBS-UF, IBS-Mun, vProdLiq].
 */
type Row = readonly [string, number, number, number, number, number | null];

function rows(input: TaxInput): Row[] {
  return computeTax(input).lines.map((l) => [l.lineId, l.taxBaseCents, l.cbsCents, l.ibsUfCents, l.ibsMunCents, l.netValueCents]);
}

describe("golden: restaurant basket (regime regular, restaurant regime, São Paulo, R$ 66,40)", () => {
  it("2026, as the official calculator answered — burger 39,90 × 0,9% × 60% = 0,21546 → 0,22; total CBS 41 + IBS 5 = 46", () => {
    const input = restaurantInput(GOLDEN_DATES[2026]);
    expect(rows(input)).toEqual([
      ["burger", 3990, 22, 2, 0, null], // 21.546 → 22 · 3990 × 0.06% = 2.394 → 2
      ["juice", 1200, 6, 1, 0, null], // 6.48 → 6 · 0.72 → 1
      ["chips", 650, 6, 1, 0, null], // full rate: 5.85 → 6 · 0.65 → 1
      ["delivery", 800, 7, 1, 0, null], // 7.2 → 7 · 0.8 → 1
    ]);
    expect(computeTax(input)).toMatchObject({
      taxBaseCents: 6640,
      cbsCents: 41,
      ibsUfCents: 5,
      ibsMunCents: 0,
      totalTaxCents: 46,
      netValueCents: null,
      taxInsidePrice: false,
      informative: true,
      provisional: false,
      tablesVersion: "ibs-cbs/2026-11-13",
    });
  });

  it("2027 estimate (provisional), tax inside the price — burger 39,90 → vBC 37,90 + CBS 1,98 + IBS 0,01 + 0,01; total 376", () => {
    expect(rows(restaurantInput(GOLDEN_DATES[2027]))).toEqual([
      ["burger", 3790, 198, 1, 1, 3790], // 3990 / (1 + 5.28%) = 3789.9 → 3790; 3790 × 5.22% = 197.8
      ["juice", 1140, 60, 0, 0, 1140], // 1200 / 1.0528 = 1139.8
      ["chips", 598, 52, 0, 0, 598], // 650 / 1.088 = 597.4; 598 × 8.7% = 52.03
      ["delivery", 736, 64, 0, 0, 736], // 800 / 1.088 = 735.3; 736 × 8.7% = 64.03
    ]);
    expect(computeTax(restaurantInput(GOLDEN_DATES[2027]))).toMatchObject({
      cbsCents: 374,
      ibsUfCents: 1,
      ibsMunCents: 1,
      totalTaxCents: 376,
      netValueCents: 6264,
      taxInsidePrice: true,
      informative: false,
      provisional: true,
    });
  });

  it("2029 estimate (provisional) — burger 39,90 → vBC 37,52 + 1,98 + 0,23 + 0,17; total 374 + 43 + 33 = 450", () => {
    expect(rows(restaurantInput(GOLDEN_DATES[2029]))).toEqual([
      ["burger", 3752, 198, 23, 17, 3752], // 3990 / (1 + 6.342%); 3752 × 5.28% = 198.1 · × 0.6% = 22.512 · × 0.462% = 17.334
      ["juice", 1128, 60, 7, 5, 1128],
      ["chips", 587, 52, 6, 5, 587], // 587 × 1.0% = 5.87 · 587 × 0.77% = 4.52
      ["delivery", 723, 64, 7, 6, 723],
    ]);
    expect(computeTax(restaurantInput(GOLDEN_DATES[2029])).totalTaxCents).toBe(450);
  });

  it("2033 estimate (provisional) — burger 39,90 → vBC 34,42 + 1,82 + 2,07 + 1,59; total 338 + 383 + 296 = 1017", () => {
    expect(rows(restaurantInput(GOLDEN_DATES[2033]))).toEqual([
      ["burger", 3442, 182, 207, 159, 3442], // 3990 / (1 + 15.9%) = 3442.6; 3442 × 6% = 206.52 → 207
      ["juice", 1035, 55, 62, 48, 1035],
      ["chips", 514, 45, 51, 40, 514], // 650 / 1.265 = 513.8
      ["delivery", 632, 56, 63, 49, 632],
    ]);
    expect(computeTax(restaurantInput(GOLDEN_DATES[2033]))).toMatchObject({ cbsCents: 338, ibsUfCents: 383, ibsMunCents: 296, totalTaxCents: 1017 });
  });
});

describe("golden: market basket (regime regular, no restaurant regime, Rio, R$ 106,07)", () => {
  it("2026, as the official calculator answered — rice zero, honey 18,50 × 0,9% × 40% = 0,0666 → 0,07; total 60 + 7 = 67", () => {
    expect(rows(marketInput(GOLDEN_DATES[2026]))).toEqual([
      ["rice-5kg", 2790, 0, 0, 0, null],
      ["honey", 1850, 7, 1, 0, null], // 6.66 · 0.74
      ["detergent", 1377, 12, 1, 0, null], // 12.393 · 1.377
      ["notebook", 4590, 41, 5, 0, null], // 41.31 · 4.59
    ]);
    expect(computeTax(marketInput(GOLDEN_DATES[2026]))).toMatchObject({ taxBaseCents: 10607, cbsCents: 60, ibsUfCents: 7, totalTaxCents: 67 });
  });

  it("2027 estimate (provisional) — notebook 45,90 → vBC 42,19 + 3,67 + 0,02 + 0,02; total 539 + 3 + 3 = 545", () => {
    expect(rows(marketInput(GOLDEN_DATES[2027]))).toEqual([
      ["rice-5kg", 2790, 0, 0, 0, 2790], // a 100% reduction: nothing inside the price
      ["honey", 1788, 62, 0, 0, 1788], // 1850 / (1 + 3.52%) = 1787.1
      ["detergent", 1265, 110, 1, 1, 1265],
      ["notebook", 4219, 367, 2, 2, 4219], // 4590 / 1.088 = 4218.75
    ]);
    expect(computeTax(marketInput(GOLDEN_DATES[2027])).totalTaxCents).toBe(545);
  });

  it("2029 estimate (provisional) — honey's taxes skip a cent: vBC 17,75, vProdLiq 17,76; total 537 + 61 + 47 = 645", () => {
    expect(rows(marketInput(GOLDEN_DATES[2029]))).toEqual([
      ["rice-5kg", 2790, 0, 0, 0, 2790],
      ["honey", 1775, 62, 7, 5, 1776], // vBC 1776 would give 1776 + 75 = 1851 > 1850; 1775 gives 1849, so vProdLiq = 1850 − 74
      ["detergent", 1245, 110, 12, 10, 1245],
      ["notebook", 4151, 365, 42, 32, 4151],
    ]);
    expect(computeTax(marketInput(GOLDEN_DATES[2029])).totalTaxCents).toBe(645);
  });

  it("2033 estimate (provisional) — notebook 45,90 → vBC 36,29 + 3,19 + 3,63 + 2,79; total 474 + 539 + 414 = 1427", () => {
    expect(rows(marketInput(GOLDEN_DATES[2033]))).toEqual([
      ["rice-5kg", 2790, 0, 0, 0, 2790],
      ["honey", 1672, 59, 67, 51, 1673],
      ["detergent", 1088, 96, 109, 84, 1088],
      ["notebook", 3629, 319, 363, 279, 3629], // 4590 / 1.265 = 3628.5
    ]);
    expect(computeTax(marketInput(GOLDEN_DATES[2033])).totalTaxCents).toBe(1427);
  });
});
