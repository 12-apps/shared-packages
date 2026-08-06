/**
 * The chip text for a numeric bound (FUT-744).
 *
 * The chip is the ONLY place the applied window is stated once the popover
 * closes, so it is the one place that must not disagree with the field it was
 * typed into — neither on the separator nor on the precision.
 */
import { describe, expect, it } from "vitest";

import { formatBoundNumber, rangeChipLabel } from "../data-views-range-values";
import type { RangeFieldConfig } from "../data-views-types";

interface Row extends Record<string, unknown> {
  amount: number;
}
const MONEY: RangeFieldConfig<Row> = {
  id: "total",
  label: "Valor",
  unit: "R$",
  step: 0.01,
  accessor: (row) => row.amount,
};
const COUNT: RangeFieldConfig<Row> = {
  id: "qty",
  label: "Quantidade",
  step: 1,
  accessor: (row) => row.amount,
};

describe("formatBoundNumber", () => {
  it("writes money to the two decimals its step declares", () => {
    expect(formatBoundNumber(17.5, 0.01)).toBe("17,50");
    expect(formatBoundNumber(50, 0.01)).toBe("50,00");
  });

  it("groups thousands", () => {
    expect(formatBoundNumber(1234.56, 0.01)).toBe("1.234,56");
  });

  it("pads nothing when the step is whole", () => {
    expect(formatBoundNumber(12, 1)).toBe("12");
    expect(formatBoundNumber(12, undefined)).toBe("12");
  });

  it("still shows a decimal that exists on a whole-step field", () => {
    expect(formatBoundNumber(12.5, 1)).toBe("12,5");
  });
});

describe("rangeChipLabel — numbers", () => {
  it("reads money with a comma and its cents", () => {
    // Before this it read `Valor: ≥ R$ 17.5` — a decimal POINT, in a currency
    // that has none.
    expect(rangeChipLabel(MONEY, { min: 17.5 })).toBe("Valor: ≥ R$ 17,50");
  });

  it("reads a two-sided money window", () => {
    expect(rangeChipLabel(MONEY, { min: 20, max: 1234.56 })).toBe(
      "Valor: R$ 20,00–R$ 1.234,56",
    );
  });

  it("leaves a whole-step field unpadded", () => {
    expect(rangeChipLabel(COUNT, { min: 3 })).toBe("Quantidade: ≥ 3");
  });

  it("takes a bound restored from the URL as a string", () => {
    expect(rangeChipLabel(MONEY, { min: "50" as unknown as number })).toBe("Valor: ≥ R$ 50,00");
  });
});
