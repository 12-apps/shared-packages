/**
 * `computeTax` — the table mode. Pure: no I/O, no clock, no defaults. The
 * same input gives the same breakdown, stamped with the table's version, so a
 * supply settled in March reproduces its own tax in December after the tables
 * moved.
 */

import { assembleBreakdown, planTax, zeroFigures } from "./plan";
import type { PlannedLine, TaxPlan } from "./plan";
import { roundTaxCents } from "./rounding";
import type { LineFigures, TaxBreakdown, TaxInput } from "./types";

/**
 * Each tax rounded on the item's base. In a tax-inside-price period the base
 * is the one the plan took out of the price, and these are the very taxes it
 * was taken out with.
 */
function tableFigures(plan: TaxPlan, line: PlannedLine): LineFigures {
  if (!line.taxed) return zeroFigures(line);
  const { cbsBp, ibsUfBp, ibsMunBp } = plan.rates;
  return {
    reductionBp: line.reductionBp,
    cbsRateBp: cbsBp,
    cbsCents: roundTaxCents(line.taxBaseCents, cbsBp, line.reductionBp),
    ibsUfRateBp: ibsUfBp,
    ibsUfCents: roundTaxCents(line.taxBaseCents, ibsUfBp, line.reductionBp),
    ibsMunRateBp: ibsMunBp,
    ibsMunCents: roundTaxCents(line.taxBaseCents, ibsMunBp, line.reductionBp),
  };
}

/** The IBS/CBS breakdown of one supply, from the rate tables it is given. */
export function computeTax(input: TaxInput): TaxBreakdown {
  const plan = planTax(input);
  return assembleBreakdown(
    plan,
    plan.lines.map((line) => tableFigures(plan, line)),
    input.tables.version,
  );
}
