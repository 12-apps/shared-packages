import { describe, expect, it } from "vitest";

import { computeTax } from "../../engine/compute";
import type { TaxInput } from "../../engine/types";
import { CLASSES, RESTAURANT_SELLER, SAO_PAULO, TABLES } from "../../engine/__tests__/fixtures/baskets";
import { documentLines, type LineDetails } from "../lines";
import { SALE } from "./fixtures";

/**
 * The ticket's acceptance on the service charge, through the engine and onto
 * the document: at most 15% of the food and drink and passed to the staff, it
 * is segregated as its own item, class 410019, with no tax; over 15% nothing
 * is excluded and the whole charge is a taxed item under the host's class.
 */

const BASE = SALE.lines[0]!;
const ENGINE_FIELDS = new Set(["id", "quantity", "valueCents", "ibsCbs"]);
const detail = (code: string): LineDetails =>
  ({ ...Object.fromEntries(Object.entries(BASE).filter(([key]) => !ENGINE_FIELDS.has(key))), code }) as LineDetails;
const DETAILS = { burger: detail("BURGER"), juice: detail("JUICE"), service: detail("SERVICE") };

function sale(serviceChargeCents: number): TaxInput {
  return {
    lines: [
      { id: "burger", valueCents: 6000, quantity: 1, foodAndDrink: true, taxClass: CLASSES.preparedFood },
      { id: "juice", valueCents: 4000, quantity: 2, foodAndDrink: true, taxClass: CLASSES.preparedFood },
    ],
    seller: RESTAURANT_SELLER,
    destinationIbge: SAO_PAULO,
    exclusions: {
      serviceCharge:
        serviceChargeCents === 0
          ? null
          : { id: "service", amountCents: serviceChargeCents, passedToStaff: true, taxClass: CLASSES.household },
      retainedIntermediation: null,
    },
    tables: TABLES,
    supplyDate: "2026-11-20",
  };
}

describe("the document lines from the engine's breakdown", () => {
  it("segregates a service charge at 15% of the food and drink as its own untaxed item, class 410019", () => {
    const lines = documentLines(computeTax(sale(1500)), DETAILS);
    const charge = lines.find((line) => line.id === "service")!;
    expect(charge).toMatchObject({ code: "SERVICE", valueCents: 1500, quantity: 1 });
    expect(charge.ibsCbs).toEqual({ cst: TABLES.exclusionClasses.GORJETA.cstIbsCbs, classCode: "410019", figures: null });
    expect(lines.map((line) => line.id)).toEqual(["burger", "juice", "service"]);
  });

  it("excludes nothing over 15%: the whole charge is a taxed item under the host's class", () => {
    const lines = documentLines(computeTax(sale(1501)), DETAILS);
    expect(lines.some((line) => line.ibsCbs?.classCode === "410019")).toBe(false);
    const charge = lines.find((line) => line.id === "service")!;
    expect(charge.ibsCbs).toMatchObject({ classCode: CLASSES.household.cClassTrib, figures: { baseCents: 1501 } });
    expect(charge.ibsCbs?.figures?.cbsCents).toBeGreaterThan(0);
  });

  it("writes the engine's figures on a taxed line, the restaurant reduction included", () => {
    const burger = documentLines(computeTax(sale(0)), DETAILS).find((line) => line.id === "burger")!;
    expect(burger.ibsCbs).toMatchObject({ classCode: "200047", figures: { baseCents: 6000, reductionBp: 4000 } });
  });

  it("writes no IBS/CBS group where the engine answers NONE, and refuses a line it has no details for", () => {
    const mei = computeTax({ ...sale(0), seller: { ...RESTAURANT_SELLER, regime: "MEI" } });
    expect(documentLines(mei, DETAILS).every((line) => line.ibsCbs === null)).toBe(true);
    expect(() => documentLines(computeTax(sale(0)), { burger: DETAILS.burger })).toThrow(/juice has no document details/);
  });
});
