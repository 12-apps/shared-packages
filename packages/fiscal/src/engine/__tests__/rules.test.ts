import { describe, expect, it } from "vitest";

import { computeTax } from "../compute";
import { roundTaxCents } from "../rounding";
import type { RateTables, TaxClass, TaxInput, TaxLineInput } from "../types";
import {
  CLASSES,
  GOLDEN_DATES,
  MARKET_SELLER,
  NO_EXCLUSIONS,
  RESTAURANT_SELLER,
  SAO_PAULO,
  TABLES,
  restaurantInput,
} from "./fixtures/baskets";

const FOOD = (baseCents: number, taxClass: TaxClass = CLASSES.preparedFood): TaxLineInput => ({
  id: `food-${baseCents}`,
  baseCents,
  quantity: 1,
  foodAndDrink: true,
  taxClass,
});

function oneLine(line: TaxLineInput, overrides: Partial<TaxInput> = {}): TaxInput {
  return restaurantInput(GOLDEN_DATES[2033], { lines: [line], ...overrides });
}

describe("rounding: the NF-e layout's per-item two decimals, half up, never a floor", () => {
  it("rounds 0.5 of a cent up: 650 × 1.0% = 6.5 → 7", () => {
    expect(roundTaxCents(650, 100, 0)).toBe(7);
  });

  it("rounds 0.499 down: 1499 × 0.1% / 100 = 1.499 → 1", () => {
    expect(roundTaxCents(1499, 10, 0)).toBe(1);
  });

  it("does not floor what is above the half: 1990 × 0.9% = 17.91 → 18 (a floor gives 17)", () => {
    expect(roundTaxCents(1990, 90, 0)).toBe(18);
  });

  it("applies the reduction to the rate, not to the rounded tax: 3990 × 0.1% × 60% = 2.394 → 2", () => {
    expect(roundTaxCents(3990, 10, 4000)).toBe(2);
  });

  it("stays exact past 2^53 intermediates: R$ 10.000.000,00 × 17.7% = R$ 1.770.000,00", () => {
    expect(roundTaxCents(1_000_000_000, 1770, 0)).toBe(177_000_000);
  });

  it("is zero on a 100% reduction", () => {
    expect(roundTaxCents(2790, 880, 10000)).toBe(0);
  });
});

describe("the restaurant regime (arts. 273–275)", () => {
  it("reduces prepared food by 40% in a restaurant store: 10000 × 8.8% × 60% = 528", () => {
    const line = computeTax(oneLine(FOOD(10000))).lines[0]!;
    expect(line).toMatchObject({ reductionBp: 4000, cbsRateBp: 880, cbsCents: 528 });
  });

  it("keeps alcohol and resale at the full rate in a restaurant store: 10000 × 8.8% = 880", () => {
    expect(computeTax(oneLine(FOOD(10000, CLASSES.alcoholicDrink))).lines[0]).toMatchObject({ reductionBp: 0, cbsCents: 880 });
    expect(computeTax(oneLine(FOOD(10000, CLASSES.resoldPackaged))).lines[0]).toMatchObject({ reductionBp: 0, cbsCents: 880 });
  });

  it("does not apply the 40% outside the regime: prepared food in a market store is 880", () => {
    const line = computeTax(oneLine(FOOD(10000), { seller: MARKET_SELLER })).lines[0]!;
    expect(line).toMatchObject({ reductionBp: 0, cbsCents: 880 });
  });

  it("takes a class's own reduction outside the special regime: Anexo VII 60% → 10000 × 8.8% × 40% = 352", () => {
    expect(computeTax(oneLine(FOOD(10000, CLASSES.listedFood))).lines[0]).toMatchObject({ reductionBp: 6000, cbsCents: 352 });
  });

  it("reads the 40% from the table, not from code", () => {
    const tables: RateTables = {
      ...TABLES,
      specialRegimes: { BARES_RESTAURANTES: { reductionBp: 5000, source: "a hypothetical table" } },
    };
    expect(computeTax(oneLine(FOOD(10000), { tables })).lines[0]).toMatchObject({ reductionBp: 5000, cbsCents: 440 });
  });
});

describe("regimes (art. 41)", () => {
  const regime = (r: TaxInput["seller"]["regime"], date: string = GOLDEN_DATES[2027]) =>
    computeTax(restaurantInput(date, { seller: { ...RESTAURANT_SELLER, regime: r } }));

  it("Simples inside the DAS: INFORMATIVE, with the regime store's own figures (532 in 2027)", () => {
    expect(regime("SIMPLES")).toMatchObject({ treatment: "INFORMATIVE", informative: true, totalTaxCents: 532 });
  });

  it("Simples híbrido: the FULL breakdown, not informative (532 in 2027)", () => {
    expect(regime("SIMPLES_IBS_CBS_REGULAR")).toMatchObject({ treatment: "FULL", informative: false, totalTaxCents: 532 });
  });

  it("MEI and não contribuinte: NONE, every figure zero, every rate zero", () => {
    for (const r of ["MEI", "NAO_CONTRIBUINTE"] as const) {
      const result = regime(r);
      expect(result).toMatchObject({ treatment: "NONE", informative: false, totalTaxCents: 0 });
      expect(result.lines.every((l) => l.cbsRateBp + l.ibsUfRateBp + l.ibsMunRateBp === 0)).toBe(true);
    }
  });

  it("2026: the test rates are not applied to Simples optants (art. 348 III c) — informative and zero", () => {
    expect(regime("SIMPLES", GOLDEN_DATES[2026])).toMatchObject({ treatment: "INFORMATIVE", informative: true, totalTaxCents: 0 });
  });

  it("2026: a regime-regular store carries the test amount, informative (payment waived, art. 348 §1)", () => {
    expect(regime("REGIME_REGULAR", GOLDEN_DATES[2026])).toMatchObject({ treatment: "FULL", informative: true, totalTaxCents: 60 });
  });

  it("refuses a supply before the regime's effective date — no regime is assumed", () => {
    const input = restaurantInput("2026-12-31", { seller: { ...RESTAURANT_SELLER, regimeEffectiveFrom: "2027-01-01" } });
    expect(() => computeTax(input)).toThrow(expect.objectContaining({ code: "REGIME_NOT_IN_EFFECT" }));
  });
});

describe("exclusions (art. 274 par. único)", () => {
  const withService = (amountCents: number, passedToStaff: boolean, seller = RESTAURANT_SELLER) =>
    computeTax(
      oneLine(FOOD(10000, CLASSES.alcoholicDrink), {
        seller,
        exclusions: {
          serviceCharge: { id: "service", amountCents, passedToStaff, taxClass: CLASSES.deliveryFee },
          retainedIntermediationCents: 0,
        },
      }),
    );

  it("excludes a 10% service charge passed to staff entirely: 1000 excluded, 0 taxed", () => {
    const result = withService(1000, true);
    expect(result.gorjetaExcludedCents).toBe(1000);
    expect(result.lines[1]).toMatchObject({ lineId: "service", source: "SERVICE_CHARGE", baseCents: 1000, taxBaseCents: 0, cbsCents: 0 });
  });

  it("excludes a 15.01% service charge only up to 15%: 1501 charged, 1500 excluded, 1 cent taxed", () => {
    const result = withService(1501, true);
    expect(result.gorjetaExcludedCents).toBe(1500);
    expect(result.lines[1]).toMatchObject({ baseCents: 1501, taxBaseCents: 1 });
  });

  it("excludes exactly 15%: 1500 of 10000 → 1500 excluded", () => {
    expect(withService(1500, true).gorjetaExcludedCents).toBe(1500);
  });

  it("keeps a charge the store keeps inside the base: 1000 × 8.8% = 88", () => {
    const result = withService(1000, false);
    expect(result.gorjetaExcludedCents).toBe(0);
    expect(result.lines[1]).toMatchObject({ taxBaseCents: 1000, cbsCents: 88 });
  });

  it("excludes nothing outside the restaurant regime", () => {
    expect(withService(1000, true, MARKET_SELLER).gorjetaExcludedCents).toBe(0);
  });

  it("measures the ceiling against food and drink only: a 2000 delivery line does not raise it", () => {
    const result = computeTax(
      restaurantInput(GOLDEN_DATES[2033], {
        lines: [FOOD(10000), { ...FOOD(2000, CLASSES.deliveryFee), id: "delivery", foodAndDrink: false }],
        exclusions: {
          serviceCharge: { id: "service", amountCents: 1800, passedToStaff: true, taxClass: CLASSES.deliveryFee },
          retainedIntermediationCents: 0,
        },
      }),
    );
    expect(result.gorjetaExcludedCents).toBe(1500);
  });

  it("removes the platform's retained intermediation from the base, split by value with exact cents", () => {
    const result = computeTax(
      restaurantInput(GOLDEN_DATES[2033], {
        lines: [
          { ...FOOD(3000), id: "a" },
          { ...FOOD(3000), id: "b" },
          { ...FOOD(3000), id: "c" },
        ],
        exclusions: { serviceCharge: null, retainedIntermediationCents: 1000 },
      }),
    );
    expect(result.intermediationExcludedCents).toBe(1000);
    expect(result.lines.map((l) => l.taxBaseCents)).toEqual([2666, 2667, 2667]);
    expect(result.taxBaseCents).toBe(8000);
  });

  it("refuses a retained intermediation larger than the lines", () => {
    const input = oneLine(FOOD(500), { exclusions: { serviceCharge: null, retainedIntermediationCents: 501 } });
    expect(() => computeTax(input)).toThrow(expect.objectContaining({ code: "INTERMEDIATION_EXCEEDS_BASE" }));
  });

  it("excludes no intermediation outside the restaurant regime", () => {
    const input = oneLine(FOOD(500), { seller: MARKET_SELLER, exclusions: { serviceCharge: null, retainedIntermediationCents: 100 } });
    expect(computeTax(input)).toMatchObject({ intermediationExcludedCents: 0, taxBaseCents: 500 });
  });
});

describe("the destination (art. 11 I)", () => {
  const tables: RateTables = {
    ...TABLES,
    periods: TABLES.periods.map((p) =>
      p.from === "2033-01-01"
        ? { ...p, ibsUf: { referenceBp: 1000, byUf: { "35": 1200 } }, ibsMun: { referenceBp: 770, byMunicipality: { [SAO_PAULO]: 500 } } }
        : p,
    ),
  };

  it("takes the state's and the municipality's own rates where the table lists them", () => {
    const line = computeTax(oneLine(FOOD(10000, CLASSES.alcoholicDrink), { tables })).lines[0]!;
    expect(line).toMatchObject({ ibsUfRateBp: 1200, ibsUfCents: 1200, ibsMunRateBp: 500, ibsMunCents: 500 });
  });

  it("takes the reference rates elsewhere (Rio: 1000 + 770)", () => {
    const line = computeTax(oneLine(FOOD(10000, CLASSES.alcoholicDrink), { tables, destinationIbge: "3304557" })).lines[0]!;
    expect(line).toMatchObject({ ibsUfRateBp: 1000, ibsMunRateBp: 770 });
  });
});

describe("refusals: no defaults, no guesses", () => {
  const cases: [string, string, TaxInput][] = [
    [
      "a date before any period",
      "NO_RATE_PERIOD",
      restaurantInput("2025-12-31", { seller: { ...RESTAURANT_SELLER, regimeEffectiveFrom: "2020-01-01" } }),
    ],
    ["a date that is not a day", "INVALID_INPUT", restaurantInput("2026-02-30")],
    ["a 6-digit IBGE code", "INVALID_INPUT", restaurantInput(GOLDEN_DATES[2027], { destinationIbge: "355030" })],
    ["fractional cents", "INVALID_INPUT", oneLine({ ...FOOD(100), baseCents: 100.5 })],
    ["negative cents", "INVALID_INPUT", oneLine({ ...FOOD(100), baseCents: -1 })],
    ["a zero quantity", "INVALID_INPUT", oneLine({ ...FOOD(100), quantity: 0 })],
    ["a reduction over 100%", "INVALID_INPUT", oneLine(FOOD(100, { ...CLASSES.listedFood, reductionBp: 10001 }))],
    ["a duplicated line id", "INVALID_INPUT", restaurantInput(GOLDEN_DATES[2027], { lines: [FOOD(1), FOOD(1)] })],
    [
      "a service charge sharing a line's id",
      "INVALID_INPUT",
      oneLine(FOOD(100), {
        exclusions: { serviceCharge: { id: "food-100", amountCents: 1, passedToStaff: true, taxClass: CLASSES.deliveryFee }, retainedIntermediationCents: 0 },
      }),
    ],
    ["an empty basket", "INVALID_INPUT", restaurantInput(GOLDEN_DATES[2027], { lines: [] })],
  ];

  it.each(cases)("refuses %s (%s)", (_what, code, input) => {
    expect(() => computeTax(input)).toThrow(expect.objectContaining({ code }));
  });

  it("refuses a table whose periods overlap", () => {
    const tables: RateTables = { ...TABLES, periods: [TABLES.periods[0]!, { ...TABLES.periods[0]!, from: "2026-06-01" }] };
    expect(() => computeTax(restaurantInput("2026-07-01", { tables }))).toThrow(expect.objectContaining({ code: "INVALID_TABLES" }));
  });

  it("is pure: the same input gives the same output, and the input is not touched", () => {
    const input = restaurantInput(GOLDEN_DATES[2029], {
      exclusions: { ...NO_EXCLUSIONS, retainedIntermediationCents: 333 },
    });
    const snapshot = JSON.stringify(input);
    expect(computeTax(input)).toEqual(computeTax(input));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
