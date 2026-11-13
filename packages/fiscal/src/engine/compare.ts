/**
 * Where two breakdowns of the same supply disagree — the table mode against
 * the oracle mode, or a stored snapshot against a recomputation. Versions are
 * not compared: they differ by construction.
 */

import type { LineTax, TaxBreakdown } from "./types";

export interface BreakdownDisagreement {
  /** `null` for an order-level field. */
  readonly lineId: string | null;
  readonly field: string;
  readonly left: unknown;
  readonly right: unknown;
}

const LINE_FIELDS = [
  "baseCents",
  "taxBaseCents",
  "reductionBp",
  "cbsRateBp",
  "cbsCents",
  "ibsUfRateBp",
  "ibsUfCents",
  "ibsMunRateBp",
  "ibsMunCents",
] as const satisfies readonly (keyof LineTax)[];

const ORDER_FIELDS = [
  "taxBaseCents",
  "cbsCents",
  "ibsUfCents",
  "ibsMunCents",
  "totalTaxCents",
  "gorjetaExcludedCents",
  "intermediationExcludedCents",
  "treatment",
  "informative",
] as const satisfies readonly (keyof TaxBreakdown)[];

function lineDisagreements(left: LineTax, right: LineTax | undefined): BreakdownDisagreement[] {
  if (!right) return [{ lineId: left.lineId, field: "line", left: left.lineId, right: undefined }];
  return LINE_FIELDS.filter((field) => left[field] !== right[field]).map((field) => ({
    lineId: left.lineId,
    field,
    left: left[field],
    right: right[field],
  }));
}

/** Every per-line field that differs, by line id; then the order fields that the lines do not already explain. */
export function compareBreakdowns(left: TaxBreakdown, right: TaxBreakdown): BreakdownDisagreement[] {
  const rightById = new Map(right.lines.map((line) => [line.lineId, line]));
  const lines = left.lines.flatMap((line) => lineDisagreements(line, rightById.get(line.lineId)));
  const leftIds = new Set(left.lines.map((line) => line.lineId));
  const extra = right.lines
    .filter((line) => !leftIds.has(line.lineId))
    .map((line) => ({ lineId: line.lineId, field: "line", left: undefined, right: line.lineId }));
  const order = ORDER_FIELDS.filter((field) => left[field] !== right[field]).map((field) => ({
    lineId: null,
    field,
    left: left[field],
    right: right[field],
  }));
  return [...lines, ...extra, ...order];
}
