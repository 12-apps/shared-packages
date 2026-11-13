/**
 * Everything the computation decides BEFORE a per-item figure is produced:
 * the regime's treatment on the date, which items are segregated exclusions,
 * each taxed item's reduction and base (`vBC`). Shared by the table mode and
 * the oracle mode, so the two can only ever disagree on the per-item figures —
 * the thing the oracle is there to check.
 */

import { FiscalEngineError } from "./errors";
import { effectiveRate, netUnitValue, splitTaxInclusivePrice } from "./rounding";
import { assertTaxInput, periodAt } from "./validate";
import type {
  LineFigures,
  LineSource,
  LineTax,
  RatePeriod,
  TaxBreakdown,
  TaxClass,
  TaxClassCode,
  TaxInput,
  TaxRegime,
  TaxTreatment,
} from "./types";

/** The three nominal rates at the destination. */
export interface DestinationRates {
  readonly cbsBp: number;
  readonly ibsUfBp: number;
  readonly ibsMunBp: number;
}

export interface PlannedLine {
  readonly lineId: string;
  readonly source: LineSource;
  readonly quantity: number;
  readonly valueCents: number;
  readonly taxClass: TaxClass;
  readonly reductionBp: number;
  /** False for a segregated exclusion and for a line whose rates do not apply. */
  readonly taxed: boolean;
  /** `vBC`: the value, the value less its inside tax, or 0 on an exclusion. */
  readonly taxBaseCents: number;
}

export interface TaxPlan {
  readonly input: TaxInput;
  readonly period: RatePeriod;
  readonly rates: DestinationRates;
  readonly treatment: TaxTreatment;
  readonly informative: boolean;
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

/** The destination's own rate where the table lists one, the reference rate everywhere else. */
function ownOrReference(rates: Readonly<Record<string, number>>, key: string, referenceBp: number): number {
  return Object.hasOwn(rates, key) ? rates[key]! : referenceBp;
}

/** The three nominal rates of the period at the destination (art. 11 I). */
export function ratesAt(period: RatePeriod, destinationIbge: string): DestinationRates {
  return {
    cbsBp: period.cbsBp,
    ibsUfBp: ownOrReference(period.ibsUf.byUf, destinationIbge.slice(0, 2), period.ibsUf.referenceBp),
    ibsMunBp: ownOrReference(period.ibsMun.byMunicipality, destinationIbge, period.ibsMun.referenceBp),
  };
}

/** The effective rates of one item, in the order CBS, IBS-UF, IBS-Mun. */
function effectiveRates(rates: DestinationRates, reductionBp: number): bigint[] {
  return [rates.cbsBp, rates.ibsUfBp, rates.ibsMunBp].map((rate) => effectiveRate(rate, reductionBp));
}

/**
 * The gorjeta is excluded only when it is passed in full to the staff and is
 * at most 15% of the food and drink (art. 274 par. único I, read as a
 * condition): above the ceiling nothing is excluded — the conservative
 * reading, which never under-states the tax. Restaurant regime only.
 */
function gorjetaIsExcluded(input: TaxInput): boolean {
  const charge = input.exclusions.serviceCharge;
  if (!charge || !charge.passedToStaff || !input.seller.restaurantRegime) return false;
  const foodAndDrink = input.lines.filter((line) => line.foodAndDrink).reduce((sum, line) => sum + line.valueCents, 0);
  return BigInt(charge.amountCents) * 10_000n <= BigInt(foodAndDrink) * BigInt(input.tables.gorjetaCapBp);
}

/** The 40% of art. 275 applies to the special regime's lines in a restaurant store; otherwise the class's own. */
function reductionFor(input: TaxInput, taxClass: TaxClass): number {
  if (input.seller.restaurantRegime && taxClass.regimeEspecifico === "BARES_RESTAURANTES") {
    return input.tables.specialRegimes.BARES_RESTAURANTES.reductionBp;
  }
  return taxClass.reductionBp;
}

function exclusionClass(code: TaxClassCode): TaxClass {
  return { cClassTrib: code.cClassTrib, cstIbsCbs: code.cstIbsCbs, regimeEspecifico: null, reductionBp: 0 };
}

interface LineDraft {
  readonly lineId: string;
  readonly source: LineSource;
  readonly quantity: number;
  readonly valueCents: number;
  readonly taxClass: TaxClass;
  readonly excluded: boolean;
}

function exclusionDrafts(input: TaxInput, gorjetaExcluded: boolean): LineDraft[] {
  const drafts: LineDraft[] = [];
  const charge = input.exclusions.serviceCharge;
  if (charge) {
    drafts.push({
      lineId: charge.id,
      source: gorjetaExcluded ? "GORJETA_EXCLUDED" : "SERVICE_CHARGE",
      quantity: 1,
      valueCents: charge.amountCents,
      taxClass: gorjetaExcluded ? exclusionClass(input.tables.exclusionClasses.GORJETA) : charge.taxClass,
      excluded: gorjetaExcluded,
    });
  }
  const retained = input.exclusions.retainedIntermediation;
  if (retained) {
    if (!input.seller.restaurantRegime) {
      throw new FiscalEngineError(
        "INVALID_INPUT",
        "a retained intermediation is excluded only when seller.restaurantRegime is set (art. 274 sole paragraph, II); otherwise the amount belongs in the lines",
      );
    }
    drafts.push({
      lineId: retained.id,
      source: "INTERMEDIATION_EXCLUDED",
      quantity: 1,
      valueCents: retained.amountCents,
      taxClass: exclusionClass(input.tables.exclusionClasses.INTERMEDIATION),
      excluded: true,
    });
  }
  return drafts;
}

function planLine(draft: LineDraft, input: TaxInput, context: { ratesApply: boolean; period: RatePeriod; rates: DestinationRates }): PlannedLine {
  const reductionBp = draft.excluded ? 0 : reductionFor(input, draft.taxClass);
  const taxed = !draft.excluded && context.ratesApply;
  let taxBaseCents = draft.excluded ? 0 : draft.valueCents;
  if (taxed && context.period.taxInsidePrice) {
    taxBaseCents = splitTaxInclusivePrice(draft.valueCents, effectiveRates(context.rates, reductionBp)).baseCents;
  }
  return {
    lineId: draft.lineId,
    source: draft.source,
    quantity: draft.quantity,
    valueCents: draft.valueCents,
    taxClass: draft.taxClass,
    reductionBp,
    taxed,
    taxBaseCents,
  };
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
  const rates = ratesAt(period, input.destinationIbge);
  const treatment = TREATMENT[regime];
  const ratesApply = treatment !== "NONE" && (!isSimplesOptant(regime) || period.appliesToSimplesNacional);
  const gorjetaExcluded = gorjetaIsExcluded(input);
  const drafts: LineDraft[] = [
    ...input.lines.map((line) => ({
      lineId: line.id,
      source: "LINE" as const,
      quantity: line.quantity,
      valueCents: line.valueCents,
      taxClass: line.taxClass,
      excluded: false,
    })),
    ...exclusionDrafts(input, gorjetaExcluded),
  ];
  return {
    input,
    period,
    rates,
    treatment,
    informative: treatment === "INFORMATIVE" || (treatment === "FULL" && period.informative),
    lines: drafts.map((draft) => planLine(draft, input, { ratesApply, period, rates })),
    gorjetaExcludedCents: gorjetaExcluded ? input.exclusions.serviceCharge!.amountCents : 0,
    intermediationExcludedCents: input.exclusions.retainedIntermediation?.amountCents ?? 0,
  };
}

/** Zero figures, for an excluded line or one whose rates do not apply. */
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

function lineTax(plan: TaxPlan, line: PlannedLine, figures: LineFigures): LineTax {
  const taxCents = figures.cbsCents + figures.ibsUfCents + figures.ibsMunCents;
  const netValueCents = plan.period.taxInsidePrice ? line.valueCents - taxCents : null;
  return {
    lineId: line.lineId,
    source: line.source,
    quantity: line.quantity,
    valueCents: line.valueCents,
    taxBaseCents: line.taxBaseCents,
    taxClass: line.taxClass,
    ...figures,
    taxCents,
    netValueCents,
    netUnitValue: netValueCents === null ? null : netUnitValue(netValueCents, line.quantity),
  };
}

/** The breakdown: each line with its figures, the order as the sum of its rounded lines. */
export function assembleBreakdown(plan: TaxPlan, figures: readonly LineFigures[], tablesVersion: string): TaxBreakdown {
  const lines = plan.lines.map((line, index) => lineTax(plan, line, figures[index]!));
  const sum = (pick: (line: LineTax) => number) => lines.reduce((total, line) => total + pick(line), 0);
  const cbsCents = sum((line) => line.cbsCents);
  const ibsUfCents = sum((line) => line.ibsUfCents);
  const ibsMunCents = sum((line) => line.ibsMunCents);
  return {
    lines,
    valueCents: sum((line) => line.valueCents),
    taxBaseCents: sum((line) => line.taxBaseCents),
    cbsCents,
    ibsUfCents,
    ibsMunCents,
    ibsCents: ibsUfCents + ibsMunCents,
    totalTaxCents: cbsCents + ibsUfCents + ibsMunCents,
    netValueCents: plan.period.taxInsidePrice ? sum((line) => line.netValueCents ?? 0) : null,
    gorjetaExcludedCents: plan.gorjetaExcludedCents,
    intermediationExcludedCents: plan.intermediationExcludedCents,
    regime: plan.input.seller.regime,
    treatment: plan.treatment,
    informative: plan.informative,
    provisional: plan.period.status === "ESTIMATE",
    taxInsidePrice: plan.period.taxInsidePrice,
    supplyDate: plan.input.supplyDate,
    destinationIbge: plan.input.destinationIbge,
    tablesVersion,
  };
}
