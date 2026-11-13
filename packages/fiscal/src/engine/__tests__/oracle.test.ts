import { describe, expect, it } from "vitest";

import { compareBreakdowns } from "../compare";
import { computeTax } from "../compute";
import { computeTaxWithOracle } from "../oracle";
import type { OfficialCalculator } from "../oracle";
import { GOLDEN_DATES, MARKET_SELLER, RESTAURANT_SELLER, marketInput, restaurantInput } from "./fixtures/baskets";
import { CALCULATOR_VERSION, RECORDED_PAIRS, recordedCalculator } from "./fixtures/calculator-replay";

/**
 * The oracle harness: the built-in tables and the official calculator over
 * ONE fixture set, asserted to agree on every class the baskets use. The
 * calculator's answers are REAL recordings (`fixtures/calculator/`, version
 * and date in `recording.json`), replayed through the port. Only 2026 can be
 * recorded: the calculator has no rates for 2027 and later, so those years
 * are ESTIMATE goldens with no oracle (`golden.test.ts`).
 */

const RESTAURANT_SERVICE_CLASS = { cClassTrib: "000001", cstIbsCbs: "000", regimeEspecifico: null, reductionBp: 0 } as const;

describe("2026: the tables agree with the official calculator's recorded answers", () => {
  it("restaurant basket: 200047 bares e restaurantes (−40%) twice, 000001 full rate twice", async () => {
    const input = restaurantInput(GOLDEN_DATES[2026]);
    const oracle = await computeTaxWithOracle(input, recordedCalculator());
    expect(compareBreakdowns(computeTax(input), oracle)).toEqual([]);
    expect(oracle.totalTaxCents).toBe(46);
  });

  it("market basket: 200003 Anexo I (zero), 200034 Anexo VII (−60%), 000001 full rate twice", async () => {
    const input = marketInput(GOLDEN_DATES[2026]);
    const oracle = await computeTaxWithOracle(input, recordedCalculator());
    expect(compareBreakdowns(computeTax(input), oracle)).toEqual([]);
    expect(oracle.totalTaxCents).toBe(67);
  });

  it("the excluded classes 410019 and 410020: the calculator answers no IBS/CBS group, the engine zero", () => {
    const { request, response } = RECORDED_PAIRS.exclusions!;
    expect(request.itens.map((item) => item.cClassTrib)).toEqual(["410019", "410020"]);
    expect(response.objetos.map((object) => object.tribCalc.IBSCBS.gIBSCBS)).toEqual([undefined, undefined]);
    const result = computeTax(
      restaurantInput(GOLDEN_DATES[2026], {
        exclusions: {
          serviceCharge: { id: "gorjeta", amountCents: 733, passedToStaff: true, taxClass: RESTAURANT_SERVICE_CLASS },
          retainedIntermediation: { id: "platform", amountCents: 500 },
        },
      }),
    );
    expect(result.lines.slice(-2)).toMatchObject([
      { lineId: "gorjeta", taxClass: { cClassTrib: "410019" }, taxBaseCents: 0, taxCents: 0 },
      { lineId: "platform", taxClass: { cClassTrib: "410020" }, taxBaseCents: 0, taxCents: 0 },
    ]);
  });
});

describe("the oracle mode", () => {
  it("stamps both versions on the result", async () => {
    const oracle = await computeTaxWithOracle(restaurantInput(GOLDEN_DATES[2026]), recordedCalculator());
    expect(oracle.tablesVersion).toBe(`ibs-cbs/2026-11-13+oracle:${CALCULATOR_VERSION}`);
  });

  it("asks the calculator per item, with its base and quantity", async () => {
    const calls: { cClassTrib: string; taxBaseCents: number; quantity: number }[] = [];
    await computeTaxWithOracle(marketInput(GOLDEN_DATES[2026]), recordedCalculator(calls));
    expect(calls.map((c) => [c.cClassTrib, c.taxBaseCents, c.quantity])).toEqual([
      ["200003", 2790, 1],
      ["200034", 1850, 0.512],
      ["000001", 1377, 3],
      ["000001", 4590, 1],
    ]);
  });

  it("asks nothing for an excluded item", async () => {
    const calls: { cClassTrib: string; taxBaseCents: number; quantity: number }[] = [];
    await computeTaxWithOracle(
      restaurantInput(GOLDEN_DATES[2026], { exclusions: { serviceCharge: null, retainedIntermediation: { id: "platform", amountCents: 500 } } }),
      recordedCalculator(calls),
    );
    expect(calls.map((c) => c.cClassTrib)).not.toContain("410020");
  });

  it("keeps the regime rules its own: an MEI asks the calculator nothing and owes zero", async () => {
    const calls: { cClassTrib: string; taxBaseCents: number; quantity: number }[] = [];
    const result = await computeTaxWithOracle(
      marketInput(GOLDEN_DATES[2026], { seller: { ...MARKET_SELLER, regime: "MEI" } }),
      recordedCalculator(calls),
    );
    expect(calls).toEqual([]);
    expect(result).toMatchObject({ treatment: "NONE", totalTaxCents: 0 });
  });

  it("keeps 2026's Simples rule its own: nothing asked, zero figures, informative", async () => {
    const calls: { cClassTrib: string; taxBaseCents: number; quantity: number }[] = [];
    const result = await computeTaxWithOracle(
      restaurantInput(GOLDEN_DATES[2026], { seller: { ...RESTAURANT_SELLER, regime: "SIMPLES" } }),
      recordedCalculator(calls),
    );
    expect(calls).toEqual([]);
    expect(result).toMatchObject({ informative: true, totalTaxCents: 0 });
  });

  it("in a tax-inside-price period, nets the calculator's taxes out of the price", async () => {
    const input = marketInput(GOLDEN_DATES[2027], { lines: [marketInput(GOLDEN_DATES[2027]).lines[3]!] });
    const fixed: OfficialCalculator = {
      version: "fixed",
      async calculateItem(request) {
        expect(request.taxBaseCents).toBe(4219); // 4590 / (1 + 8.8%), from the table's rates
        return { reductionBp: 0, cbsRateBp: 870, cbsCents: 367, ibsUfRateBp: 5, ibsUfCents: 2, ibsMunRateBp: 5, ibsMunCents: 2 };
      },
    };
    expect((await computeTaxWithOracle(input, fixed)).lines[0]).toMatchObject({ taxBaseCents: 4219, taxCents: 371, netValueCents: 4219 });
  });

  it("names every disagreement: a calculator that does not reduce prepared food differs on burger and juice", async () => {
    const input = restaurantInput(GOLDEN_DATES[2026]);
    const honest = recordedCalculator();
    const disagreeing: OfficialCalculator = {
      version: "disagreeing",
      async calculateItem(request) {
        const answer = await honest.calculateItem(request);
        return request.cClassTrib === "200047" ? { ...answer, reductionBp: 0 } : answer;
      },
    };
    const diffs = compareBreakdowns(computeTax(input), await computeTaxWithOracle(input, disagreeing));
    expect(diffs).toEqual([
      { lineId: "burger", field: "reductionBp", left: 4000, right: 0 },
      { lineId: "juice", field: "reductionBp", left: 4000, right: 0 },
    ]);
  });

  it("refuses an answer that is not integer cents and basis points", async () => {
    const broken: OfficialCalculator = {
      version: "broken",
      async calculateItem() {
        return { reductionBp: 0, cbsRateBp: 88.5, cbsCents: 1, ibsUfRateBp: 0, ibsUfCents: 0, ibsMunRateBp: 0, ibsMunCents: 0 };
      },
    };
    await expect(computeTaxWithOracle(marketInput(GOLDEN_DATES[2026]), broken)).rejects.toMatchObject({ code: "INVALID_ORACLE_ANSWER" });
  });
});
