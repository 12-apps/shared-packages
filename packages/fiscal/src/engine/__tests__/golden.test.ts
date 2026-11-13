import { describe, expect, it } from "vitest";

import { computeTax } from "../compute";
import { GOLDEN_DATES, marketInput, restaurantInput } from "./fixtures/baskets";

/**
 * Golden figures per year, computed BY HAND from the table's rates (the
 * working is in each case's name and comment) — the ticket asks for them to be
 * reviewed against the official calculator, which this session could not
 * reach; `oracle.test.ts` replays the same figures as recorded calculator
 * answers.
 *
 * Per line: tax = round_half_up(taxBase × rate × (1 − reduction)), two
 * decimals, the NF-e per-item rounding; the order is the sum of its lines.
 *
 * Columns: [lineId, CBS, IBS-UF, IBS-Mun].
 */
type Row = readonly [string, number, number, number];

function figures(input: Parameters<typeof computeTax>[0]): Row[] {
  return computeTax(input).lines.map((line) => [line.lineId, line.cbsCents, line.ibsUfCents, line.ibsMunCents]);
}

describe("golden: restaurant basket (regime regular, restaurant regime, São Paulo, base R$ 81,30)", () => {
  it("2026 — CBS 0.9%, IBS-UF 0.1%; burger 3990×0.9%×60% = 21.546 → 22; total CBS 54 + IBS 6 = 60, informative", () => {
    const input = restaurantInput(GOLDEN_DATES[2026]);
    expect(figures(input)).toEqual([
      ["burger", 22, 2, 0], // 3990×0.54% = 21.546 → 22 · 3990×0.06% = 2.394 → 2
      ["juice", 6, 1, 0], // 1200×0.54% = 6.48 → 6 · 1200×0.06% = 0.72 → 1
      ["beer", 13, 1, 0], // alcohol, full rate: 1490×0.9% = 13.41 → 13 · 1.49 → 1
      ["soda-can", 6, 1, 0], // resale, full rate: 650×0.9% = 5.85 → 6 · 0.65 → 1
      ["delivery", 7, 1, 0], // 800×0.9% = 7.2 → 7 · 0.8 → 1
    ]);
    expect(computeTax(input)).toMatchObject({
      taxBaseCents: 8130,
      cbsCents: 54,
      ibsUfCents: 6,
      ibsMunCents: 0,
      ibsCents: 6,
      totalTaxCents: 60,
      treatment: "FULL",
      informative: true,
      provisional: false,
      tablesVersion: "ibs-cbs/2026-11-13",
    });
  });

  it("2027 — CBS 8.7%, IBS 0.05%+0.05%; burger 3990×8.7%×60% = 208.278 → 208; total 528 + 2 + 2 = 532", () => {
    expect(figures(restaurantInput(GOLDEN_DATES[2027]))).toEqual([
      ["burger", 208, 1, 1], // 3990×5.22% = 208.278 · 3990×0.03% = 1.197 → 1
      ["juice", 63, 0, 0], // 1200×5.22% = 62.64 → 63 · 0.36 → 0
      ["beer", 130, 1, 1], // 1490×8.7% = 129.63 → 130 · 1490×0.05% = 0.745 → 1
      ["soda-can", 57, 0, 0], // 650×8.7% = 56.55 → 57 · 0.325 → 0
      ["delivery", 70, 0, 0], // 800×8.7% = 69.6 → 70 · 0.4 → 0
    ]);
    expect(computeTax(restaurantInput(GOLDEN_DATES[2027]))).toMatchObject({
      cbsCents: 528,
      ibsUfCents: 2,
      ibsMunCents: 2,
      totalTaxCents: 532,
      informative: false,
      provisional: true,
    });
  });

  it("2029 — CBS 8.8%, IBS 1.0%+0.77%; soda 650×1.0% = 6.5 → 7 (half up); total 532 + 61 + 46 = 639", () => {
    expect(figures(restaurantInput(GOLDEN_DATES[2029]))).toEqual([
      ["burger", 211, 24, 18], // 3990×5.28% = 210.672 · ×0.6% = 23.94 · ×0.462% = 18.4338
      ["juice", 63, 7, 6], // 1200×5.28% = 63.36 · 7.2 · 5.544
      ["beer", 131, 15, 11], // 1490×8.8% = 131.12 · 14.9 · ×0.77% = 11.473
      ["soda-can", 57, 7, 5], // 650×8.8% = 57.2 · 6.5 → 7 · 5.005 → 5
      ["delivery", 70, 8, 6], // 800×8.8% = 70.4 · 8 · 6.16
    ]);
    expect(computeTax(restaurantInput(GOLDEN_DATES[2029])).totalTaxCents).toBe(639);
  });

  it("2033 — CBS 8.8%, IBS 10%+7.7%; burger IBS-Mun 3990×7.7%×60% = 184.338 → 184; total 532 + 605 + 466 = 1603", () => {
    expect(figures(restaurantInput(GOLDEN_DATES[2033]))).toEqual([
      ["burger", 211, 239, 184], // 210.672 · 3990×6% = 239.4 · 184.338
      ["juice", 63, 72, 55], // 63.36 · 72 · 1200×4.62% = 55.44
      ["beer", 131, 149, 115], // 131.12 · 149 · 1490×7.7% = 114.73
      ["soda-can", 57, 65, 50], // 57.2 · 65 · 50.05
      ["delivery", 70, 80, 62], // 70.4 · 80 · 61.6
    ]);
    expect(computeTax(restaurantInput(GOLDEN_DATES[2033]))).toMatchObject({
      cbsCents: 532,
      ibsUfCents: 605,
      ibsMunCents: 466,
      ibsCents: 1071,
      totalTaxCents: 1603,
    });
  });
});

describe("golden: market basket (regime regular, no restaurant regime, Rio, base R$ 106,07)", () => {
  it("2026 — rice is cesta (zero), cheese 1850×0.9%×40% = 6.66 → 7; total CBS 60 + IBS 7 = 67", () => {
    expect(figures(marketInput(GOLDEN_DATES[2026]))).toEqual([
      ["rice-5kg", 0, 0, 0],
      ["cheese", 7, 1, 0], // 1850×0.36% = 6.66 · 1850×0.04% = 0.74 → 1
      ["detergent", 12, 1, 0], // 1377×0.9% = 12.393 · 1.377 → 1
      ["wine", 41, 5, 0], // 4590×0.9% = 41.31 · 4.59 → 5
    ]);
    expect(computeTax(marketInput(GOLDEN_DATES[2026]))).toMatchObject({
      taxBaseCents: 10607,
      cbsCents: 60,
      ibsUfCents: 7,
      totalTaxCents: 67,
    });
  });

  it("2027 — detergent 1377×8.7% = 119.799 → 120; total 583 + 3 + 3 = 589", () => {
    expect(figures(marketInput(GOLDEN_DATES[2027]))).toEqual([
      ["rice-5kg", 0, 0, 0],
      ["cheese", 64, 0, 0], // 1850×3.48% = 64.38 · 1850×0.02% = 0.37 → 0
      ["detergent", 120, 1, 1], // 119.799 · 1377×0.05% = 0.6885 → 1
      ["wine", 399, 2, 2], // 4590×8.7% = 399.33 · 2.295 → 2
    ]);
    expect(computeTax(marketInput(GOLDEN_DATES[2027])).totalTaxCents).toBe(589);
  });

  it("2029 — wine 4590×8.8% = 403.92 → 404; total 590 + 67 + 52 = 709", () => {
    expect(figures(marketInput(GOLDEN_DATES[2029]))).toEqual([
      ["rice-5kg", 0, 0, 0],
      ["cheese", 65, 7, 6], // 1850×3.52% = 65.12 · ×0.4% = 7.4 · ×0.308% = 5.698
      ["detergent", 121, 14, 11], // 121.176 · 13.77 · 10.6029
      ["wine", 404, 46, 35], // 403.92 · 45.9 · 35.343
    ]);
    expect(computeTax(marketInput(GOLDEN_DATES[2029])).totalTaxCents).toBe(709);
  });

  it("2033 — wine IBS-Mun 4590×7.7% = 353.43 → 353; total 590 + 671 + 516 = 1777", () => {
    expect(figures(marketInput(GOLDEN_DATES[2033]))).toEqual([
      ["rice-5kg", 0, 0, 0],
      ["cheese", 65, 74, 57], // 65.12 · 1850×4% = 74 · ×3.08% = 56.98
      ["detergent", 121, 138, 106], // 121.176 · 137.7 · 106.029
      ["wine", 404, 459, 353], // 403.92 · 459 · 353.43
    ]);
    expect(computeTax(marketInput(GOLDEN_DATES[2033])).totalTaxCents).toBe(1777);
  });
});
