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
