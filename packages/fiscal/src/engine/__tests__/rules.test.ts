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
import { RECORDED_PAIRS, hundredths } from "./fixtures/calculator-replay";

/**
 * The rules, one at a time. Most cases run on the 2033 period of a variant
 * table whose tax is NOT inside the price, so the arithmetic reads as
 * value × rate (CBS 8.8%, IBS 10% + 7.7%); the tax-inside-price rules run on
 * the shipped table.
 */
const OUTSIDE: RateTables = {
  ...TABLES,
  version: "test/outside-price",
  periods: TABLES.periods.map((period) => ({ ...period, taxInsidePrice: false })),
};

const FOOD = (valueCents: number, taxClass: TaxClass = CLASSES.preparedFood): TaxLineInput => ({
  id: `food-${valueCents}`,
  valueCents,
  quantity: 1,
  foodAndDrink: true,
  taxClass,
});

function oneLine(line: TaxLineInput, overrides: Partial<TaxInput> = {}): TaxInput {
  return restaurantInput(GOLDEN_DATES[2033], { lines: [line], tables: OUTSIDE, ...overrides });
}

describe("rounding: the NF-e per-item two decimals, half-even like the official calculator, never a floor", () => {
  const { request, response } = RECORDED_PAIRS["half-cent"]!;
  const recorded = request.itens.map((item, index) => {
    const group = response.objetos[index]!.tribCalc.IBSCBS.gIBSCBS!;
    return [Math.round(item.baseCalculo * 100), hundredths(group.gCBS.vCBS), hundredths(group.gIBSUF.vIBSUF)] as const;
  });

  it.each(recorded)("matches the calculator's recorded answer at a half cent: base %i → CBS %i, IBS-UF %i", (base, cbs, ibsUf) => {
    expect([roundTaxCents(base, 90, 0), roundTaxCents(base, 10, 0)]).toEqual([cbs, ibsUf]);
  });

  it("rounds an exact half to the even cent: 500 × 0.9% = 4.5 → 4, 2500 × 0.9% = 22.5 → 22, 1500 × 0.9% = 13.5 → 14", () => {
    expect([roundTaxCents(500, 90, 0), roundTaxCents(2500, 90, 0), roundTaxCents(1500, 90, 0)]).toEqual([4, 22, 14]);
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

describe("the tax inside the price (NT 2026.008: IBS/CBS compose vProd from 2027)", () => {
  const inside = (line: TaxLineInput) => computeTax(restaurantInput(GOLDEN_DATES[2027], { lines: [line] })).lines[0]!;

  it("takes the tax out of a 2027 price: 10880 at 8.7% + 0.05% + 0.05% → vBC 10000, taxes 870 + 5 + 5, vProdLiq 10000", () => {
    expect(inside(FOOD(10880, CLASSES.household))).toMatchObject({
      valueCents: 10880,
      taxBaseCents: 10000,
      cbsCents: 870,
      ibsUfCents: 5,
      ibsMunCents: 5,
      taxCents: 880,
      netValueCents: 10000,
      netUnitValue: "100.0000000000",
    });
  });

  it("keeps vProdLiq + taxes = vProd to the cent, and vUnComLiq × qCom within ±0,01 of vProdLiq (I11c-20)", () => {
    const line = inside({ ...FOOD(1999, CLASSES.household), quantity: 3 });
    expect(line.netValueCents! + line.taxCents).toBe(1999);
    const netTimesQuantity = Math.round(Number(line.netUnitValue) * 3 * 100);
    expect(Math.abs(netTimesQuantity - line.netValueCents!)).toBeLessThanOrEqual(1);
  });

  it("computes 2026 on the value, with no vProdLiq: 10000 × 0.9% = 90", () => {
    const line = computeTax(restaurantInput(GOLDEN_DATES[2026], { lines: [FOOD(10000, CLASSES.household)] })).lines[0]!;
    expect(line).toMatchObject({ taxBaseCents: 10000, cbsCents: 90, ibsUfCents: 10, netValueCents: null, netUnitValue: null });
  });

  it("reads the switch from the table, not from a date in code", () => {
    const flipped: RateTables = { ...TABLES, periods: TABLES.periods.map((p) => ({ ...p, taxInsidePrice: p.from === "2026-01-01" })) };
    const line = computeTax(restaurantInput(GOLDEN_DATES[2026], { lines: [FOOD(10100, CLASSES.household)], tables: flipped })).lines[0]!;
    expect(line).toMatchObject({ taxBaseCents: 10000, taxCents: 100, netValueCents: 10000 }); // 10100 / 1.01
  });

  it("leaves an untaxed price whole: an MEI's 2027 line has vBC = vProdLiq = the price", () => {
    const line = computeTax(restaurantInput(GOLDEN_DATES[2027], { lines: [FOOD(1000)], seller: { ...RESTAURANT_SELLER, regime: "MEI" } })).lines[0]!;
    expect(line).toMatchObject({ taxBaseCents: 1000, taxCents: 0, netValueCents: 1000 });
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
    const tables: RateTables = { ...OUTSIDE, specialRegimes: { BARES_RESTAURANTES: { reductionBp: 5000, source: "a hypothetical table" } } };
    expect(computeTax(oneLine(FOOD(10000), { tables })).lines[0]).toMatchObject({ reductionBp: 5000, cbsCents: 440 });
  });
});

describe("regimes (art. 41)", () => {
  const regime = (r: TaxInput["seller"]["regime"], date: string = GOLDEN_DATES[2027]) =>
    computeTax(restaurantInput(date, { seller: { ...RESTAURANT_SELLER, regime: r } }));

  it("Simples inside the DAS: INFORMATIVE, with the regime store's own figures (376 in 2027)", () => {
    expect(regime("SIMPLES")).toMatchObject({ treatment: "INFORMATIVE", informative: true, totalTaxCents: 376 });
  });

  it("Simples híbrido: the FULL breakdown, not informative (376 in 2027)", () => {
    expect(regime("SIMPLES_IBS_CBS_REGULAR")).toMatchObject({ treatment: "FULL", informative: false, totalTaxCents: 376 });
  });

  it("MEI and não contribuinte: NONE, not informative, every figure and rate zero", () => {
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
    expect(regime("REGIME_REGULAR", GOLDEN_DATES[2026])).toMatchObject({ treatment: "FULL", informative: true, totalTaxCents: 46 });
  });

  it("refuses a supply before the regime's effective date — no regime is assumed", () => {
    const input = restaurantInput("2026-12-31", { seller: { ...RESTAURANT_SELLER, regimeEffectiveFrom: "2027-01-01" } });
    expect(() => computeTax(input)).toThrow(expect.objectContaining({ code: "REGIME_NOT_IN_EFFECT" }));
  });
});

describe("exclusions: segregated as their own items (art. 274 par. único; RCBS art. 399 §2, §4)", () => {
  const SERVICE_CLASS = CLASSES.deliveryFee;
  const withService = (amountCents: number, passedToStaff: boolean, seller = RESTAURANT_SELLER) =>
    computeTax(
      oneLine(FOOD(10000, CLASSES.alcoholicDrink), {
        seller,
        exclusions: { serviceCharge: { id: "service", amountCents, passedToStaff, taxClass: SERVICE_CLASS }, retainedIntermediation: null },
      }),
    );

  it("excludes a gorjeta of exactly 15.00% passed to staff, as its own 410019 item: 1500 of 10000", () => {
    const result = withService(1500, true);
    expect(result.gorjetaExcludedCents).toBe(1500);
    expect(result.lines[1]).toMatchObject({
      lineId: "service",
      source: "GORJETA_EXCLUDED",
      valueCents: 1500,
      taxBaseCents: 0,
      taxCents: 0,
      taxClass: { cClassTrib: "410019", cstIbsCbs: "410" },
    });
    expect(result.lines[0]).toMatchObject({ taxBaseCents: 10000, cbsCents: 880 });
  });

  it("does NOT exclude a 15.01% gorjeta at all: the whole 1501 is a taxed item under its class, 1501 × 8.8% = 132", () => {
    const result = withService(1501, true);
    expect(result.gorjetaExcludedCents).toBe(0);
    expect(result.lines[1]).toMatchObject({ source: "SERVICE_CHARGE", valueCents: 1501, taxBaseCents: 1501, cbsCents: 132, taxClass: SERVICE_CLASS });
  });

  it("does not exclude a charge the store keeps: 1000 × 8.8% = 88", () => {
    const result = withService(1000, false);
    expect(result.gorjetaExcludedCents).toBe(0);
    expect(result.lines[1]).toMatchObject({ source: "SERVICE_CHARGE", taxBaseCents: 1000, cbsCents: 88 });
  });

  it("excludes nothing outside the restaurant regime", () => {
    expect(withService(1000, true, MARKET_SELLER)).toMatchObject({ gorjetaExcludedCents: 0, lines: [{}, { source: "SERVICE_CHARGE" }] });
  });

  it("measures the ceiling against food and drink only: a 2000 delivery line does not raise it", () => {
    const result = computeTax(
      oneLine(FOOD(10000), {
        lines: [FOOD(10000), { ...FOOD(2000, CLASSES.deliveryFee), id: "delivery", foodAndDrink: false }],
        exclusions: { serviceCharge: { id: "service", amountCents: 1800, passedToStaff: true, taxClass: SERVICE_CLASS }, retainedIntermediation: null },
      }),
    );
    expect(result.gorjetaExcludedCents).toBe(0);
  });

  it("segregates the platform's retained intermediation as its own 410020 item, leaving every line's base whole", () => {
    const result = computeTax(
      oneLine(FOOD(3000), {
        lines: [FOOD(3000), { ...FOOD(3000, CLASSES.alcoholicDrink), id: "beer" }],
        exclusions: { serviceCharge: null, retainedIntermediation: { id: "platform", amountCents: 1000 } },
      }),
    );
    expect(result.intermediationExcludedCents).toBe(1000);
    expect(result.lines.map((l) => [l.lineId, l.source, l.valueCents, l.taxBaseCents])).toEqual([
      ["food-3000", "LINE", 3000, 3000],
      ["beer", "LINE", 3000, 3000],
      ["platform", "INTERMEDIATION_EXCLUDED", 1000, 0],
    ]);
    expect(result.lines[2]).toMatchObject({ taxCents: 0, taxClass: { cClassTrib: "410020", cstIbsCbs: "410" } });
  });

  it("keeps an excluded item's value whole in a tax-inside-price period: vProdLiq = value, no tax", () => {
    const result = computeTax(restaurantInput(GOLDEN_DATES[2027], { exclusions: { serviceCharge: null, retainedIntermediation: { id: "platform", amountCents: 500 } } }));
    expect(result.lines.at(-1)).toMatchObject({ valueCents: 500, taxBaseCents: 0, taxCents: 0, netValueCents: 500 });
  });

  it("refuses a retained intermediation outside the restaurant regime: there it belongs in the lines", () => {
    const input = oneLine(FOOD(500), { seller: MARKET_SELLER, exclusions: { serviceCharge: null, retainedIntermediation: { id: "p", amountCents: 100 } } });
    expect(() => computeTax(input)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});

describe("the destination (art. 11 I)", () => {
  const tables: RateTables = {
    ...OUTSIDE,
    periods: OUTSIDE.periods.map((p) =>
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

describe("refusals: no defaults, no guesses, never a TypeError", () => {
  const base = restaurantInput(GOLDEN_DATES[2027]);
  const malformed = (patch: Record<string, unknown>) => ({ ...base, ...patch }) as unknown as TaxInput;
  const cases: [string, string, TaxInput][] = [
    ["a date before any period", "NO_RATE_PERIOD", restaurantInput("2025-12-31", { seller: { ...RESTAURANT_SELLER, regimeEffectiveFrom: "2020-01-01" } })],
    ["a date that is not a day", "INVALID_INPUT", restaurantInput("2026-02-30")],
    ["a 6-digit IBGE code", "INVALID_INPUT", restaurantInput(GOLDEN_DATES[2027], { destinationIbge: "355030" })],
    ["fractional cents", "INVALID_INPUT", oneLine({ ...FOOD(100), valueCents: 100.5 })],
    ["negative cents", "INVALID_INPUT", oneLine({ ...FOOD(100), valueCents: -1 })],
    ["a zero quantity", "INVALID_INPUT", oneLine({ ...FOOD(100), quantity: 0 })],
    ["a quantity with five decimals", "INVALID_INPUT", oneLine({ ...FOOD(100), quantity: 0.51234 })],
    ["a reduction over 100%", "INVALID_INPUT", oneLine(FOOD(100, { ...CLASSES.listedFood, reductionBp: 10001 }))],
    ["a duplicated line id", "INVALID_INPUT", restaurantInput(GOLDEN_DATES[2027], { lines: [FOOD(1), FOOD(1)] })],
    [
      "a service charge sharing a line's id",
      "INVALID_INPUT",
      oneLine(FOOD(100), { exclusions: { serviceCharge: { id: "food-100", amountCents: 1, passedToStaff: true, taxClass: CLASSES.deliveryFee }, retainedIntermediation: null } }),
    ],
    ["an empty basket", "INVALID_INPUT", restaurantInput(GOLDEN_DATES[2027], { lines: [] })],
    ["a missing input", "INVALID_INPUT", undefined as unknown as TaxInput],
    ["missing exclusions", "INVALID_INPUT", malformed({ exclusions: undefined })],
    ["serviceCharge: undefined", "INVALID_INPUT", malformed({ exclusions: { serviceCharge: undefined, retainedIntermediation: null } })],
    ["a missing retainedIntermediation key", "INVALID_INPUT", malformed({ exclusions: { serviceCharge: null } })],
    ["retainedIntermediation: a number", "INVALID_INPUT", malformed({ exclusions: { serviceCharge: null, retainedIntermediation: 5 } })],
    ["a null line", "INVALID_INPUT", malformed({ lines: [null] })],
    ["a line with no class", "INVALID_INPUT", malformed({ lines: [{ ...FOOD(1), taxClass: undefined }] })],
    ["lines that are not an array", "INVALID_INPUT", malformed({ lines: "burger" })],
    ["a missing seller", "INVALID_INPUT", malformed({ seller: null })],
    ["missing tables", "INVALID_TABLES", malformed({ tables: undefined })],
    ["a null period", "INVALID_TABLES", malformed({ tables: { ...TABLES, periods: [null] } })],
    ["a period with no ibsUf", "INVALID_TABLES", malformed({ tables: { ...TABLES, periods: [{ ...TABLES.periods[0]!, ibsUf: undefined }] } })],
    ["a table with no exclusion classes", "INVALID_TABLES", malformed({ tables: { ...TABLES, exclusionClasses: undefined } })],
    ["a table with no special regimes", "INVALID_TABLES", malformed({ tables: { ...TABLES, specialRegimes: null } })],
  ];

  it.each(cases)("refuses %s (%s)", (_what, code, input) => {
    expect(() => computeTax(input)).toThrow(expect.objectContaining({ name: "FiscalEngineError", code }));
  });

  it("refuses a table whose periods overlap", () => {
    const tables: RateTables = { ...TABLES, periods: [TABLES.periods[0]!, { ...TABLES.periods[0]!, from: "2026-06-01" }] };
    expect(() => computeTax(restaurantInput("2026-07-01", { tables }))).toThrow(expect.objectContaining({ code: "INVALID_TABLES" }));
  });

  it("is pure: the same input gives the same output, and the input is not touched", () => {
    const input = restaurantInput(GOLDEN_DATES[2029], { exclusions: { ...NO_EXCLUSIONS, retainedIntermediation: { id: "p", amountCents: 333 } } });
    const snapshot = JSON.stringify(input);
    expect(computeTax(input)).toEqual(computeTax(input));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
