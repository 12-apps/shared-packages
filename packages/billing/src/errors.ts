/**
 * The one error class this package raises on its own behalf.
 *
 * Every factory here asserts its config at CONSTRUCTION — the report-builder
 * doctrine: a host that mis-states its commercial policy finds out at boot,
 * where an operator is, rather than at the one renewal that needed the number.
 * Nothing in the money path throws this; by then the config has been valid for
 * the life of the process.
 */
export class BillingConfigError extends Error {
  constructor(what: string, message: string) {
    super(`@12-apps/billing: ${what} — ${message}`);
    this.name = "BillingConfigError";
  }
}

/**
 * A usage reading the host got wrong (FUT-5094): a missing, unknown, repeated
 * or mis-dated reading, a count that is not a whole number, a base in another
 * currency, or an overage past safe integers. Raised by `compose`, never
 * "billed as zero" — a reading the package cannot trust bills nothing.
 */
export class BillingUsageError extends Error {
  constructor(message: string) {
    super(`@12-apps/billing: ${message}`);
    this.name = "BillingUsageError";
  }
}

/**
 * A cycle's breakdown that does not explain its amount (FUT-5094): lines that
 * do not sum to it exactly, a fractional or negative line, an overage line
 * whose own arithmetic is wrong, one period's overage listed twice, or a
 * breakdown in another currency than the charge. Raised by `checkBreakdown`
 * and by the collection guard, which charges nothing when it fires.
 */
export class BillingBreakdownError extends Error {
  constructor(message: string) {
    super(`@12-apps/billing: ${message}`);
    this.name = "BillingBreakdownError";
  }
}
