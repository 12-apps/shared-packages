/**
 * The FUT-5094 contract: usage past an allowance, billed on the next cycle.
 *
 * Written BEFORE the implementation, as the reviewer's statement of what the
 * implementation must do. These are the shapes the package's root entry must
 * export; the suites reach them through {@link usagePricing} and
 * {@link collectionGuard}, which fail with one readable message for as long
 * as the export is missing. The implementer replaces both accessors with
 * plain imports from `../index` once the exports exist, and deletes this file
 * if the real types say the same.
 *
 * ## Where the count enters billing
 *
 * The package never counts anything. The host reads its own usage for the
 * period that just ended and hands it in as a {@link UsageReading} per meter
 * the policy declares: how many units, whether that count is FINAL, and
 * whether its overage is billed at all (`OFF`: the host's switch is off;
 * `EXEMPT`: the customer is out of scope, e.g. pays its own provider). The
 * meter key is the host's opaque name, so no product word reaches this
 * package. The numbers (allowance, price per unit) are required config.
 *
 * ## The cycle a period's overage lands on
 *
 * A cycle is charged in advance, so the cycle that STARTS at a period's end
 * carries that period's overage: `usagePeriod.end` equals `base.period.start`.
 * `base: null` composes a final settlement (no further cycle), whose charge is
 * the overage alone, or nothing.
 */
import * as root from "../index";
import * as server from "../server/index";

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

/** What the host counted for one meter over one period. */
export interface UsageReading {
  meter: string;
  /** The period the count covers — must be the composed `usagePeriod`. */
  period: UsagePeriod;
  /** Units used. A whole number, 0 or more. */
  used: number;
  /** True once nothing can still move the count (no late commit pending). */
  final: boolean;
  /** `BILLED` bills past the allowance; `OFF` and `EXEMPT` bill nothing past it. */
  overage: "BILLED" | "OFF" | "EXEMPT";
  /** A host-adjusted allowance for THIS period (e.g. a plan change), else the meter's. */
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
  /** `charge: null` only for a final settlement with nothing to bill. */
  | { ready: true; charge: CycleCharge | null }
  /** Some BILLED meter's count is not final yet: compose again later. */
  | { ready: false; waitingFor: readonly string[] };

export interface ComposeInput {
  /** The new cycle's own price; null for a final settlement (no further cycle). */
  base: { amountCents: number; currency: string; period: UsagePeriod } | null;
  /** The period whose usage this charge settles — the one that just ended. */
  usagePeriod: UsagePeriod;
  /** Exactly one reading per meter the policy declares. */
  readings: readonly UsageReading[];
  /**
   * Overage the host already carries on another live cycle (pending or paid)
   * of this subscription: never billed again. A FAILED cycle's lines are not
   * listed, so its retry carries the same overage.
   */
  alreadyBilled: readonly { meter: string; periodStart: Date }[];
}

export interface UsagePricing {
  compose(input: ComposeInput): CycleChargeResult;
}

/** What the root entry must export for FUT-5094. */
export interface UsagePricingModule {
  /** Validates the policy at construction: `BillingConfigError` on a bad number. */
  createUsagePricing(policy: UsagePricingPolicy): UsagePricing;
  /**
   * Throws `BillingBreakdownError` unless the lines are whole, non-negative,
   * in the charge's currency, without a repeated overage, and sum EXACTLY to
   * `amountCents`. The host runs it before persisting and on every read back.
   */
  checkBreakdown(charge: CycleCharge): void;
  /** Raised on a reading the host got wrong (named `BillingUsageError`). */
  BillingUsageError: new (...args: never[]) => Error;
  /** Raised by `checkBreakdown` and the collection guard (named `BillingBreakdownError`). */
  BillingBreakdownError: new (...args: never[]) => Error;
}

const MISSING =
  "@12-apps/billing does not export the FUT-5094 usage pricing yet " +
  "(createUsagePricing, checkBreakdown, BillingUsageError, BillingBreakdownError)";

/** The root entry's usage pricing, or a failure naming what is missing. */
export function usagePricing(): UsagePricingModule {
  const mod = root as unknown as Partial<UsagePricingModule>;
  if (
    typeof mod.createUsagePricing !== "function" ||
    typeof mod.checkBreakdown !== "function" ||
    typeof mod.BillingUsageError !== "function" ||
    typeof mod.BillingBreakdownError !== "function"
  ) {
    throw new Error(MISSING);
  }
  return mod as UsagePricingModule;
}

/**
 * The collection guard's port: the breakdown the host persisted for a cycle,
 * or null for a cycle that has none (every cycle before FUT-5094).
 * `createSubscriptionCollection` takes it as the optional `breakdowns` dep.
 */
export type CycleBreakdownLookup = (cycleId: string) => Promise<CycleCharge | null>;

/** The server entry must export the breakdown error as well, for the host's catch. */
export function collectionGuard(): { BillingBreakdownError: new (...args: never[]) => Error } {
  const mod = server as unknown as { BillingBreakdownError?: new (...args: never[]) => Error };
  if (typeof mod.BillingBreakdownError !== "function") {
    throw new Error("@12-apps/billing/server does not export BillingBreakdownError yet (FUT-5094)");
  }
  return { BillingBreakdownError: mod.BillingBreakdownError };
}

/** The name of what `run` threw, or null when it did not throw. */
export function thrownName(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.name : "non-error";
  }
  return null;
}
