/**
 * Every refusal the engine makes. A refusal is a THROW, on purpose: the
 * engine has no fallback for an input it cannot read, and a figure computed
 * from a guess would be printed on a fiscal document as a confession of the
 * tax due (LC 214/2025 art. 60 §1).
 */

export type FiscalEngineErrorCode =
  /** A field is missing, out of range or of the wrong shape. */
  | "INVALID_INPUT"
  /** The rate table is malformed: a bad rate, a bad date, overlapping periods. */
  | "INVALID_TABLES"
  /** No period of the table covers the date of the supply. */
  | "NO_RATE_PERIOD"
  /** The supply precedes the seller's `regimeEffectiveFrom`. */
  | "REGIME_NOT_IN_EFFECT"
  /** The official calculator answered something that is not integer cents and basis points. */
  | "INVALID_ORACLE_ANSWER";

export class FiscalEngineError extends Error {
  readonly code: FiscalEngineErrorCode;

  constructor(code: FiscalEngineErrorCode, message: string) {
    super(`[fiscal/engine] ${code}: ${message}`);
    this.name = "FiscalEngineError";
    this.code = code;
  }
}
