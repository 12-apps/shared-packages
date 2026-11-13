/**
 * Replays the official calculator's RECORDED answers (`./calculator/`, see its
 * `recording.json`) through the engine's `OfficialCalculator` port. The
 * mapping from the calculator's JSON (percentages and reais as decimal
 * strings) to basis points and cents is the adapter a host writes; the
 * answers themselves are the calculator's, byte for byte.
 */

import exclusionsRequest from "./calculator/exclusions.request.json";
import exclusionsResponse from "./calculator/exclusions.response.json";
import halfCentRequest from "./calculator/half-cent.request.json";
import halfCentResponse from "./calculator/half-cent.response.json";
import marketRequest from "./calculator/market.request.json";
import marketResponse from "./calculator/market.response.json";
import recording from "./calculator/recording.json";
import restaurantRequest from "./calculator/restaurant.request.json";
import restaurantResponse from "./calculator/restaurant.response.json";
import type { OfficialCalculator, OfficialCalculatorItemAnswer } from "../../oracle";

interface RecordedItem {
  readonly baseCalculo: number;
  readonly cClassTrib: string;
}

interface RecordedRequest {
  readonly dataHoraEmissao: string;
  readonly municipio: number;
  readonly itens: readonly RecordedItem[];
}

interface RecordedTax {
  readonly gRed?: { readonly pRedAliq: string };
}

interface RecordedObject {
  readonly tribCalc: {
    readonly IBSCBS: {
      readonly cClassTrib: string;
      readonly gIBSCBS?: {
        readonly vBC: string;
        readonly gCBS: RecordedTax & { readonly pCBS: string; readonly vCBS: string };
        readonly gIBSUF: RecordedTax & { readonly pIBSUF: string; readonly vIBSUF: string };
        readonly gIBSMun: RecordedTax & { readonly pIBSMun: string; readonly vIBSMun: string };
      };
    };
  };
}

interface RecordedResponse {
  readonly objetos: readonly RecordedObject[];
}

export const RECORDED_PAIRS: Readonly<Record<string, { request: RecordedRequest; response: RecordedResponse }>> = {
  restaurant: { request: restaurantRequest, response: restaurantResponse },
  market: { request: marketRequest, response: marketResponse },
  "half-cent": { request: halfCentRequest, response: halfCentResponse },
  exclusions: { request: exclusionsRequest, response: exclusionsResponse },
};

export const CALCULATOR_VERSION = `${recording.calculatorVersion.versaoApp}/${recording.calculatorVersion.versaoDb}`;

/** "0.90" (a percentage) → 90 bp; "0.22" (reais) → 22 cents. Both are two-decimal strings. */
export function hundredths(decimal: string): number {
  return Math.round(Number(decimal) * 100);
}

function answerOf(object: RecordedObject): OfficialCalculatorItemAnswer | null {
  const group = object.tribCalc.IBSCBS.gIBSCBS;
  if (!group) return null;
  return {
    reductionBp: group.gCBS.gRed ? hundredths(group.gCBS.gRed.pRedAliq) : 0,
    cbsRateBp: hundredths(group.gCBS.pCBS),
    cbsCents: hundredths(group.gCBS.vCBS),
    ibsUfRateBp: hundredths(group.gIBSUF.pIBSUF),
    ibsUfCents: hundredths(group.gIBSUF.vIBSUF),
    ibsMunRateBp: hundredths(group.gIBSMun.pIBSMun),
    ibsMunCents: hundredths(group.gIBSMun.vIBSMun),
  };
}

function keyOf(date: string, municipality: string, cClassTrib: string, baseCents: number): string {
  return `${date}|${municipality}|${cClassTrib}|${baseCents}`;
}

/** Every recorded item, keyed by date, municipality, class and base. */
const RECORDED_ANSWERS: ReadonlyMap<string, OfficialCalculatorItemAnswer | null> = new Map(
  Object.values(RECORDED_PAIRS).flatMap(({ request, response }) =>
    request.itens.map((item, index) => [
      keyOf(request.dataHoraEmissao.slice(0, 10), String(request.municipio), item.cClassTrib, Math.round(item.baseCalculo * 100)),
      answerOf(response.objetos[index]!),
    ]),
  ),
);

/** The port, answering only what was recorded; anything else throws. */
export function recordedCalculator(calls: { cClassTrib: string; taxBaseCents: number; quantity: number }[] = []): OfficialCalculator {
  return {
    version: CALCULATOR_VERSION,
    async calculateItem(request) {
      calls.push({ cClassTrib: request.cClassTrib, taxBaseCents: request.taxBaseCents, quantity: request.quantity });
      const key = keyOf(request.supplyDate, request.destinationIbge, request.cClassTrib, request.taxBaseCents);
      const answer = RECORDED_ANSWERS.get(key);
      if (!answer) throw new Error(`the calculator was never asked ${key}`);
      return answer;
    },
  };
}
