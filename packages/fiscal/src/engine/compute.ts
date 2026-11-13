/**
 * `computeTax` — the table mode. Pure: no I/O, no clock, no defaults. The
 * same input gives the same breakdown, stamped with the table's version, so a
 * supply settled in March reproduces its own tax in December after the tables
 * moved.
 */

import { assembleBreakdown, planTax, zeroFigures } from "./plan";
import type { PlannedLine, TaxPlan } from "./plan";
import { roundTaxCents } from "./rounding";
import type { LineFigures, RatePeriod, TaxBreakdown, TaxInput } from "./types";

/** The destination's own rate where the table lists one, the reference rate everywhere else. */
function ownOrReference(rates: Readonly<Record<string, number>>, key: string, referenceBp: number): number {
  return Object.hasOwn(rates, key) ? rates[key]! : referenceBp;
}

/** The three nominal rates of the period at the destination (art. 11 I). */
export function ratesAt(period: RatePeriod, destinationIbge: string): { cbsBp: number; ibsUfBp: number; ibsMunBp: number } {
  return {
    cbsBp: period.cbsBp,
    ibsUfBp: ownOrReference(period.ibsUf.byUf, destinationIbge.slice(0, 2), period.ibsUf.referenceBp),
    ibsMunBp: ownOrReference(period.ibsMun.byMunicipality, destinationIbge, period.ibsMun.referenceBp),
  };
}

function tableFigures(plan: TaxPlan, line: PlannedLine): LineFigures {
  if (!plan.ratesApply) return zeroFigures(line);
  const rates = ratesAt(plan.period, plan.input.destinationIbge);
  return {
    reductionBp: line.reductionBp,
    cbsRateBp: rates.cbsBp,
    cbsCents: roundTaxCents(line.taxBaseCents, rates.cbsBp, line.reductionBp),
    ibsUfRateBp: rates.ibsUfBp,
    ibsUfCents: roundTaxCents(line.taxBaseCents, rates.ibsUfBp, line.reductionBp),
    ibsMunRateBp: rates.ibsMunBp,
    ibsMunCents: roundTaxCents(line.taxBaseCents, rates.ibsMunBp, line.reductionBp),
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
