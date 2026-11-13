/**
 * Everything the computation decides BEFORE a rate is looked up: the
 * regime's treatment on the date, the exclusions, each line's base and
 * reduction. Shared by the table mode and the oracle mode, so the two can only
 * ever disagree on the per-item figures — the thing the oracle is there to
 * check.
 */

import { FiscalEngineError } from "./errors";
import { assertTaxInput, periodAt } from "./validate";
import type {
  LineFigures,
  LineSource,
  RatePeriod,
  TaxBreakdown,
  TaxClass,
  TaxInput,
  TaxRegime,
  TaxTreatment,
} from "./types";

export interface PlannedLine {
  readonly lineId: string;
  readonly source: LineSource;
  readonly quantity: number;
  readonly baseCents: number;
  readonly taxBaseCents: number;
  readonly taxClass: TaxClass;
  readonly reductionBp: number;
}

export interface TaxPlan {
  readonly input: TaxInput;
  readonly period: RatePeriod;
  readonly treatment: TaxTreatment;
  readonly informative: boolean;
  /** False when the figures are zero by law: MEI/não contribuinte, or a Simples optant in a period that spares it. */
  readonly ratesApply: boolean;
  readonly lines: readonly PlannedLine[];
  readonly gorjetaExcludedCents: number;
  readonly intermediationExcludedCents: number;
}

const TREATMENT: Readonly<Record<TaxRegime, TaxTreatment>> = {
  REGIME_REGULAR: "FULL",
  SIMPLES_IBS_CBS_REGULAR: "FULL",
  SIMPLES: "INFORMATIVE",
  MEI: "NONE",
  NAO_CONTRIBUINTE: "NONE",
};

function isSimplesOptant(regime: TaxRegime): boolean {
  return regime === "SIMPLES" || regime === "SIMPLES_IBS_CBS_REGULAR";
}

/**
 * The gorjeta passed in full to the staff leaves the base up to 15% of the
 * food and drink (art. 274 par. único I) — the ceiling read from the table,
 * rounded DOWN so the exclusion never passes it. Restaurant regime only.
 */
function gorjetaExcluded(input: TaxInput): number {
  const charge = input.exclusions.serviceCharge;
  if (!charge || !charge.passedToStaff || !input.seller.restaurantRegime) return 0;
  const foodAndDrink = input.lines.filter((line) => line.foodAndDrink).reduce((sum, line) => sum + line.baseCents, 0);
  const cap = Number((BigInt(foodAndDrink) * BigInt(input.tables.gorjetaCapBp)) / 10_000n);
  return Math.min(charge.amountCents, cap);
}

/**
 * Split `amount` across `weights` in proportion, in whole cents that sum to
 * `amount` exactly: floors first, then the leftover cents to the largest
 * remainders, the earlier line first on a tie.
 */
function allocateProportionally(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (amount === 0 || total === 0) return weights.map(() => 0);
  const shares = weights.map((weight, index) => {
    const exact = BigInt(amount) * BigInt(weight);
    return { index, floor: Number(exact / BigInt(total)), remainder: exact % BigInt(total) };
  });
  let leftover = amount - shares.reduce((sum, share) => sum + share.floor, 0);
  const allocation = shares.map((share) => share.floor);
  const byRemainder = [...shares].sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const share of byRemainder) {
    if (leftover === 0) break;
    allocation[share.index]! += 1;
    leftover -= 1;
  }
  return allocation;
}

/**
 * What the platform retained and never passed to the restaurant leaves the
 * restaurant's base (art. 274 par. único II), spread over the lines by value.
 * Restaurant regime only.
 */
function intermediationAllocation(input: TaxInput): number[] {
  const retained = input.exclusions.retainedIntermediationCents;
  if (!input.seller.restaurantRegime || retained === 0) return input.lines.map(() => 0);
  const total = input.lines.reduce((sum, line) => sum + line.baseCents, 0);
  if (retained > total) {
    throw new FiscalEngineError(
      "INTERMEDIATION_EXCEEDS_BASE",
      `retained intermediation ${retained} is larger than the lines' ${total}`,
    );
  }
  return allocateProportionally(retained, input.lines.map((line) => line.baseCents));
}

/** The 40% of art. 275 applies to the special regime's lines in a restaurant store; otherwise the class's own. */
function reductionFor(input: TaxInput, taxClass: TaxClass): number {
  if (input.seller.restaurantRegime && taxClass.regimeEspecifico === "BARES_RESTAURANTES") {
    return input.tables.specialRegimes.BARES_RESTAURANTES.reductionBp;
  }
  return taxClass.reductionBp;
}

function plannedLines(input: TaxInput, gorjeta: number, allocation: readonly number[]): PlannedLine[] {
  const lines: PlannedLine[] = input.lines.map((line, index) => ({
    lineId: line.id,
    source: "LINE",
    quantity: line.quantity,
    baseCents: line.baseCents,
    taxBaseCents: line.baseCents - allocation[index]!,
    taxClass: line.taxClass,
    reductionBp: reductionFor(input, line.taxClass),
  }));
  const charge = input.exclusions.serviceCharge;
  if (charge) {
    lines.push({
      lineId: charge.id,
      source: "SERVICE_CHARGE",
      quantity: 1,
      baseCents: charge.amountCents,
      taxBaseCents: charge.amountCents - gorjeta,
      taxClass: charge.taxClass,
      reductionBp: reductionFor(input, charge.taxClass),
    });
  }
  return lines;
}

export function planTax(input: TaxInput): TaxPlan {
  assertTaxInput(input);
  const { regime, regimeEffectiveFrom } = input.seller;
  if (input.supplyDate < regimeEffectiveFrom) {
    throw new FiscalEngineError(
      "REGIME_NOT_IN_EFFECT",
      `the supply on ${input.supplyDate} precedes the seller's ${regime} regime, effective ${regimeEffectiveFrom}`,
    );
  }
  const period = periodAt(input.tables, input.supplyDate);
  const treatment = TREATMENT[regime];
  const gorjeta = gorjetaExcluded(input);
  const allocation = intermediationAllocation(input);
  return {
    input,
    period,
    treatment,
    informative: treatment === "INFORMATIVE" || (treatment === "FULL" && period.informative),
    ratesApply: treatment !== "NONE" && (!isSimplesOptant(regime) || period.appliesToSimplesNacional),
    lines: plannedLines(input, gorjeta, allocation),
    gorjetaExcludedCents: gorjeta,
    intermediationExcludedCents: allocation.reduce((sum, cents) => sum + cents, 0),
  };
}

/** Zero figures, for a line whose rates do not apply. */
export function zeroFigures(line: PlannedLine): LineFigures {
  return {
    reductionBp: line.reductionBp,
    cbsRateBp: 0,
    cbsCents: 0,
    ibsUfRateBp: 0,
    ibsUfCents: 0,
    ibsMunRateBp: 0,
    ibsMunCents: 0,
  };
}

/** The breakdown: each line with its figures, the order as the sum of its rounded lines. */
export function assembleBreakdown(plan: TaxPlan, figures: readonly LineFigures[], tablesVersion: string): TaxBreakdown {
  const lines = plan.lines.map((line, index) => ({ ...line, ...figures[index]! }));
  const sum = (pick: (line: (typeof lines)[number]) => number) => lines.reduce((total, line) => total + pick(line), 0);
  const cbsCents = sum((line) => line.cbsCents);
  const ibsUfCents = sum((line) => line.ibsUfCents);
  const ibsMunCents = sum((line) => line.ibsMunCents);
  return {
    lines,
    taxBaseCents: sum((line) => line.taxBaseCents),
    cbsCents,
    ibsUfCents,
    ibsMunCents,
    ibsCents: ibsUfCents + ibsMunCents,
    totalTaxCents: cbsCents + ibsUfCents + ibsMunCents,
    gorjetaExcludedCents: plan.gorjetaExcludedCents,
    intermediationExcludedCents: plan.intermediationExcludedCents,
    regime: plan.input.seller.regime,
    treatment: plan.treatment,
    informative: plan.informative,
    provisional: plan.period.status === "ESTIMATE",
    supplyDate: plan.input.supplyDate,
    destinationIbge: plan.input.destinationIbge,
    tablesVersion,
  };
}
