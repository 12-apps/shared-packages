/**
 * The shapes of usage pricing (FUT-5094): usage past an allowance, billed on
 * the next cycle. See `./usage.ts` for the composer and `./breakdown.ts` for
 * the check every persisted breakdown passes.
 */

/** One metered allowance — the host's commercial numbers, as config. */
export interface MeteredAllowance {
  /** The host's own name for what is counted. Opaque to the package. */
  meter: string;
  /** Units included in every period. A whole number, 0 or more. */
  allowance: number;
  /** The price of each unit past the allowance, in whole minor units (centavos). */
  unitPriceCents: number;
}

export interface UsagePricingPolicy {
  /** The one currency every line is in (ISO 4217). */
  currency: string;
  meters: readonly MeteredAllowance[];
}

export interface UsagePeriod {
  start: Date;
  end: Date;
}

/**
 * What the host counted for one meter over one period.
 *
 * `overage` is how a host switches billing past the allowance off without the
 * package knowing why: `OFF` (its own switch — per customer or platform-wide)
 * and `EXEMPT` (a customer out of scope) both bill nothing past the allowance,
 * and neither waits on a count that is not final.
 */
export interface UsageReading {
  meter: string;
  /** The period the count covers — must be the composed `usagePeriod`. */
  period: UsagePeriod;
  /** Units used. A whole number, 0 or more. */
  used: number;
  /**
   * True once nothing can still move the count. A host that dates each unit
   * by the moment it COMMITS (a late commit counts in the period it commits
   * in) can declare an ended period final at its boundary, with no grace
   * window.
   */
  final: boolean;
  /** `BILLED` bills past the allowance; `OFF` and `EXEMPT` bill nothing past it. */
  overage: "BILLED" | "OFF" | "EXEMPT";
  /**
   * A host-adjusted allowance for THIS period, else the meter's. Omit it to
   * bill a period cut short (a downgrade) against the FULL allowance.
   */
  allowance?: number;
}

export interface BaseLine {
  kind: "BASE";
  amountCents: number;
  /** The period this base price pays for (the new cycle). */
  period: UsagePeriod;
}

export interface OverageLine {
  kind: "OVERAGE";
  meter: string;
  /** The period whose usage this line bills (the one that ended). */
  period: UsagePeriod;
  used: number;
  allowance: number;
  /** `max(0, used - allowance)`. A line exists only when this is above 0. */
  quantity: number;
  unitPriceCents: number;
  /** `quantity * unitPriceCents`, exact. */
  amountCents: number;
}

export type CycleChargeLine = BaseLine | OverageLine;

export interface CycleCharge {
  amountCents: number;
  currency: string;
  lines: readonly CycleChargeLine[];
}

export type CycleChargeResult =
  /** `charge: null` when there is nothing to bill — never a zero-amount charge. */
  | { ready: true; charge: CycleCharge | null }
  /** Some BILLED meter's count is not final yet: compose again later. */
  | { ready: false; waitingFor: readonly string[] };

/** The new cycle's own price. */
export interface ComposeBase {
  amountCents: number;
  currency: string;
  period: UsagePeriod;
}

/** One period's overage of one meter, already carried by a cycle. */
export interface BilledOverage {
  meter: string;
  periodStart: Date;
}

export interface ComposeInput {
  /**
   * The new cycle's own price; null for a final settlement (no further cycle,
   * e.g. a cancellation), whose charge is the overage alone, or nothing.
   */
  base: ComposeBase | null;
  /** The period whose usage this charge settles — the one that just ended. */
  usagePeriod: UsagePeriod;
  /** Exactly one reading per meter the policy declares. */
  readings: readonly UsageReading[];
  /**
   * Overage already carried by another cycle of this subscription that is
   * pending, paid OR REFUNDED: never billed again. A refund returns the whole
   * charge, overage included, and that overage is waived, not re-billed. Only
   * a FAILED cycle's lines are left out, so its retry carries the same overage.
   */
  alreadyBilled: readonly BilledOverage[];
}

export interface UsagePricing {
  compose(input: ComposeInput): CycleChargeResult;
}
