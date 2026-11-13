/**
 * The ORACLE mode: the same interface as `computeTax`, with the per-item
 * figures asked of an injected `OfficialCalculator` — the port a host points
 * at the RFB's Calculadora de Tributos (open source, with an API and a local
 * component; `docs/tax/04` §3 in the origin host). Everything else — the
 * regime's treatment, the exclusions, each line's base — is the engine's own
 * plan, so running both modes over one fixture set checks exactly the rates,
 * the reductions and the rounding against the official figures.
 */

import { FiscalEngineError } from "./errors";
import { assembleBreakdown, planTax, zeroFigures } from "./plan";
import type { LineFigures, TaxBreakdown, TaxClass, TaxInput } from "./types";

/** One item, as the calculator is asked about it. */
export interface OfficialCalculatorItemRequest {
  readonly supplyDate: string;
  readonly destinationIbge: string;
  readonly cClassTrib: string;
  readonly cstIbsCbs: string;
  /** The base after the engine's exclusions (`vBC`). */
  readonly taxBaseCents: number;
  readonly quantity: number;
}

/** The calculator's answer for one item: nominal rates, the reduction, and the rounded taxes. */
export type OfficialCalculatorItemAnswer = LineFigures;

/** The port. The host's adapter owns the transport, the retries and the unit conversion. */
export interface OfficialCalculator {
  /** Stamped on the result next to the tables' version. */
  readonly version: string;
  calculateItem(request: OfficialCalculatorItemRequest): Promise<OfficialCalculatorItemAnswer>;
}

const ANSWER_FIELDS = ["reductionBp", "cbsRateBp", "cbsCents", "ibsUfRateBp", "ibsUfCents", "ibsMunRateBp", "ibsMunCents"] as const;

function assertAnswer(answer: OfficialCalculatorItemAnswer, lineId: string): OfficialCalculatorItemAnswer {
  for (const field of ANSWER_FIELDS) {
    const value = answer?.[field];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new FiscalEngineError(
        "INVALID_ORACLE_ANSWER",
        `the calculator answered ${String(value)} for ${field} of line "${lineId}" — expected integer cents or basis points`,
      );
    }
  }
  return answer;
}

function requestFor(input: TaxInput, taxClass: TaxClass, taxBaseCents: number, quantity: number): OfficialCalculatorItemRequest {
  return {
    supplyDate: input.supplyDate,
    destinationIbge: input.destinationIbge,
    cClassTrib: taxClass.cClassTrib,
    cstIbsCbs: taxClass.cstIbsCbs,
    taxBaseCents,
    quantity,
  };
}

/** `computeTax`, with the per-item figures from the official calculator. */
export async function computeTaxWithOracle(input: TaxInput, calculator: OfficialCalculator): Promise<TaxBreakdown> {
  const plan = planTax(input);
  const figures: LineFigures[] = [];
  for (const line of plan.lines) {
    if (!plan.ratesApply) {
      figures.push(zeroFigures(line));
      continue;
    }
    const answer = await calculator.calculateItem(requestFor(input, line.taxClass, line.taxBaseCents, line.quantity));
    figures.push(assertAnswer(answer, line.lineId));
  }
  return assembleBreakdown(plan, figures, `${input.tables.version}+oracle:${calculator.version}`);
}
