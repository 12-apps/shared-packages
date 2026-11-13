/**
 * The document mapping's tax half: the engine's breakdown (`computeTax`)
 * onto the `SaleForDocument` lines a host's `SaleSource` answers. The engine
 * decides; this writes what it decided:
 *
 * - one document line per breakdown line, in the breakdown's order — so an
 *   exclusion the engine segregated (the service charge passed to the staff
 *   at most 15% of the food and drink, class 410019; a platform's retained
 *   intermediation, 410020) IS its own item, with its class and no tax
 *   (RCBS art. 399 §2), and a service charge the engine did not exclude is a
 *   taxed item under the class the host passed;
 * - the IBS/CBS group from the line's figures (`vBC`, the nominal rates, the
 *   reduction, the amounts), or no group at all where the engine answered
 *   `NONE` (MEI, não contribuinte).
 *
 * What the engine does not know — the product code, NCM, CFOP, unit, the
 * ICMS, PIS and COFINS — arrives per line id from the host. A breakdown line
 * with no details is refused, never invented.
 */

import type { LineTax, TaxBreakdown } from "../engine/types";
import type { LineIbsCbs, SaleLine } from "../sale/types";
import { FiscalDocumentError } from "./errors";

/** Everything a document line needs that the breakdown does not carry. */
export type LineDetails = Omit<SaleLine, "id" | "quantity" | "valueCents" | "ibsCbs">;

const SEGREGATED = new Set<LineTax["source"]>(["GORJETA_EXCLUDED", "INTERMEDIATION_EXCLUDED"]);

function ibsCbsOf(line: LineTax, breakdown: TaxBreakdown): LineIbsCbs | null {
  if (breakdown.treatment === "NONE") return null;
  const code = { cst: line.taxClass.cstIbsCbs, classCode: line.taxClass.cClassTrib };
  if (SEGREGATED.has(line.source)) return { ...code, figures: null };
  return {
    ...code,
    figures: {
      baseCents: line.taxBaseCents,
      reductionBp: line.reductionBp,
      cbsRateBp: line.cbsRateBp,
      cbsCents: line.cbsCents,
      ibsUfRateBp: line.ibsUfRateBp,
      ibsUfCents: line.ibsUfCents,
      ibsMunRateBp: line.ibsMunRateBp,
      ibsMunCents: line.ibsMunCents,
    },
  };
}

export function documentLines(breakdown: TaxBreakdown, details: Readonly<Record<string, LineDetails>>): SaleLine[] {
  return breakdown.lines.map((line) => {
    const detail = details[line.lineId];
    if (detail === undefined) {
      throw new FiscalDocumentError("INVALID_INPUT", `breakdown line ${line.lineId} has no document details.`);
    }
    return {
      ...detail,
      id: line.lineId,
      quantity: line.quantity,
      valueCents: line.valueCents,
      ibsCbs: ibsCbsOf(line, breakdown),
    };
  });
}
