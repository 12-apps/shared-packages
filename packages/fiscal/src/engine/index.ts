/**
 * `@12-apps/fiscal/engine` — the IBS/CBS engine.
 *
 * Pure TypeScript: no I/O, no clock, no defaults. A host hands it the priced
 * lines, the seller's regime, the destination, the exclusions, a versioned
 * rate table (`@12-apps/fiscal/tables/*.json`, or its own) and the date of the
 * supply, and gets the per-line and per-order breakdown back.
 */

export { computeTax } from "./compute";
export { ratesAt } from "./plan";
export { computeTaxWithOracle } from "./oracle";
export type { OfficialCalculator, OfficialCalculatorItemAnswer, OfficialCalculatorItemRequest } from "./oracle";
export { compareBreakdowns } from "./compare";
export type { BreakdownDisagreement } from "./compare";
export { FiscalEngineError } from "./errors";
export type { FiscalEngineErrorCode } from "./errors";
export { roundTaxCents } from "./rounding";
export { assertRateTables } from "./validate";
export type * from "./types";
