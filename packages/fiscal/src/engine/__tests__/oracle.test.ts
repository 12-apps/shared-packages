import { describe, expect, it } from "vitest";

import { compareBreakdowns } from "../compare";
import { computeTax } from "../compute";
import { computeTaxWithOracle } from "../oracle";
import type { OfficialCalculator, OfficialCalculatorItemRequest } from "../oracle";
import { GOLDEN_DATES, MARKET_SELLER, marketInput, restaurantInput, RESTAURANT_SELLER } from "./fixtures/baskets";
import { RECORDED_ANSWERS, RECORDED_CALCULATOR_VERSION } from "./fixtures/official-calculator-recorded";

/**
 * The oracle harness: the built-in tables and the official calculator over
 * ONE fixture set, asserted to agree on every class the fixture baskets use.
 * The calculator here REPLAYS recorded answers (see the fixture's provenance
 * note: hand-computed, because the calculator was unreachable); pointing the
 * same port at the live calculator is the host's adapter, not this test's.
 */

function recordedCalculator(calls: OfficialCalculatorItemRequest[] = []): OfficialCalculator {
  return {
    version: RECORDED_CALCULATOR_VERSION,
    async calculateItem(request) {
      calls.push(request);
      const key = `${request.supplyDate}|${request.destinationIbge}|${request.cClassTrib}|${request.taxBaseCents}`;
      const tuple = RECORDED_ANSWERS[key];
      if (!tuple) throw new Error(`no recorded answer for ${key}`);
      const [reductionBp, cbsRateBp, cbsCents, ibsUfRateBp, ibsUfCents, ibsMunRateBp, ibsMunCents] = tuple;
      return { reductionBp, cbsRateBp, cbsCents, ibsUfRateBp, ibsUfCents, ibsMunRateBp, ibsMunCents };
    },
  };
}

const YEARS = Object.entries(GOLDEN_DATES);

describe("the tables agree with the official calculator on every fixture class", () => {
  it.each(YEARS)("%s, restaurant basket: prepared food (−40%), alcohol, resale, delivery", async (_year, date) => {
    const input = restaurantInput(date);
    const oracle = await computeTaxWithOracle(input, recordedCalculator());
    expect(compareBreakdowns(computeTax(input), oracle)).toEqual([]);
  });

  it.each(YEARS)("%s, market basket: cesta (zero), Anexo VII (−60%), household, wine", async (_year, date) => {
    const input = marketInput(date);
    const oracle = await computeTaxWithOracle(input, recordedCalculator());
    expect(compareBreakdowns(computeTax(input), oracle)).toEqual([]);
  });
});

describe("the oracle mode", () => {
  it("stamps both versions on the result", async () => {
    const oracle = await computeTaxWithOracle(restaurantInput(GOLDEN_DATES[2027]), recordedCalculator());
    expect(oracle.tablesVersion).toBe(`ibs-cbs/2026-11-13+oracle:${RECORDED_CALCULATOR_VERSION}`);
  });

  it("asks the calculator per line, with the base after exclusions", async () => {
    const calls: OfficialCalculatorItemRequest[] = [];
    await computeTaxWithOracle(marketInput(GOLDEN_DATES[2029]), recordedCalculator(calls));
    expect(calls.map((c) => [c.cClassTrib, c.taxBaseCents, c.quantity])).toEqual([
      ["200003", 2790, 1],
      ["200034", 1850, 0.512],
      ["000001", 1377, 3],
      ["000001", 4590, 1],
    ]);
  });

  it("keeps the regime rules its own: an MEI asks the calculator nothing and owes zero", async () => {
    const calls: OfficialCalculatorItemRequest[] = [];
    const result = await computeTaxWithOracle(
      marketInput(GOLDEN_DATES[2033], { seller: { ...MARKET_SELLER, regime: "MEI" } }),
      recordedCalculator(calls),
    );
    expect(calls).toEqual([]);
    expect(result).toMatchObject({ treatment: "NONE", totalTaxCents: 0 });
  });

  it("keeps 2026's Simples rule its own: nothing asked, zero figures, informative", async () => {
    const calls: OfficialCalculatorItemRequest[] = [];
    const result = await computeTaxWithOracle(
      restaurantInput(GOLDEN_DATES[2026], { seller: { ...RESTAURANT_SELLER, regime: "SIMPLES" } }),
      recordedCalculator(calls),
    );
    expect(calls).toEqual([]);
    expect(result).toMatchObject({ informative: true, totalTaxCents: 0 });
  });

  it("names every disagreement: a calculator that does not reduce prepared food differs on burger and juice", async () => {
    const input = restaurantInput(GOLDEN_DATES[2033]);
    const honest = recordedCalculator();
    const disagreeing: OfficialCalculator = {
      version: "disagreeing",
      async calculateItem(request) {
        const answer = await honest.calculateItem(request);
        return request.cClassTrib === "200030" ? { ...answer, reductionBp: 0 } : answer;
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
    await expect(computeTaxWithOracle(marketInput(GOLDEN_DATES[2033]), broken)).rejects.toMatchObject({ code: "INVALID_ORACLE_ANSWER" });
  });
});
