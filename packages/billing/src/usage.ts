import { checkBreakdown, isWhole } from "./breakdown";
import { BillingConfigError, BillingUsageError } from "./errors";
import type {
  BilledOverage,
  ComposeBase,
  ComposeInput,
  CycleChargeLine,
  CycleChargeResult,
  MeteredAllowance,
  OverageLine,
  UsagePeriod,
  UsagePricing,
  UsagePricingPolicy,
  UsageReading,
} from "./usage-types";

/**
 * Usage past an allowance, billed on the next cycle (FUT-5094).
 *
 * The package never counts anything. The host reads its own usage for the
 * period that just ended and hands it in as one `UsageReading` per declared
 * meter; `compose` turns that and the new cycle's base price into ONE charge
 * whose breakdown sums to its amount, or answers "not ready" while a billed
 * count can still move. The meter key is the host's opaque name, and every
 * number (allowance, price per unit) is config asserted at construction.
 *
 * A cycle is charged in advance, so the cycle that STARTS at a period's end
 * carries that period's overage. `base: null` composes a final settlement —
 * a cancellation's last charge — whose charge is the overage alone, or none.
 *
 * Pure and deterministic: the same input composes the same charge, so a
 * charge job that runs twice cannot bill twice.
 */
export function createUsagePricing(policy: UsagePricingPolicy): UsagePricing {
  const currency = assertPolicy(policy);
  const meters = policy.meters.map((meter) => ({ ...meter }));

  return {
    compose(input: ComposeInput): CycleChargeResult {
      assertBase(input.base, input.usagePeriod, currency);
      const readings = readingsByMeter(meters, input.readings, input.usagePeriod);
      const waitingFor = meters
        .filter((meter) => isPending(readings.get(meter.meter) as UsageReading))
        .map((meter) => meter.meter);
      if (waitingFor.length > 0) return { ready: false, waitingFor };

      const lines: CycleChargeLine[] = [];
      if (input.base) lines.push({ kind: "BASE", amountCents: input.base.amountCents, period: input.base.period });
      for (const meter of meters) {
        const line = overageLine(meter, readings.get(meter.meter) as UsageReading, input);
        if (line) lines.push(line);
      }
      const amountCents = lines.reduce((total, line) => total + line.amountCents, 0);
      if (!Number.isSafeInteger(amountCents)) {
        throw new BillingUsageError(`a charge of ${amountCents} leaves safe integers`);
      }
      if (amountCents === 0) return { ready: true, charge: null };
      const charge = { amountCents, currency, lines };
      checkBreakdown(charge);
      return { ready: true, charge };
    },
  };
}

function assertPolicy(policy: UsagePricingPolicy): string {
  if (typeof policy.currency !== "string" || policy.currency.trim() === "") {
    throw new BillingConfigError("usage pricing", "`currency` is required");
  }
  const names = new Set<string>();
  for (const meter of policy.meters) {
    assertMeter(meter);
    if (names.has(meter.meter)) {
      throw new BillingConfigError("usage pricing", `meter "${meter.meter}" is declared twice`);
    }
    names.add(meter.meter);
  }
  return policy.currency;
}

function assertMeter(meter: MeteredAllowance): void {
  if (typeof meter.meter !== "string" || meter.meter.trim() === "") {
    throw new BillingConfigError("usage pricing", "every meter needs a name");
  }
  if (!isWhole(meter.allowance)) {
    throw new BillingConfigError("usage pricing", `meter "${meter.meter}" allowance must be a whole number, got ${meter.allowance}`);
  }
  if (!isWhole(meter.unitPriceCents)) {
    throw new BillingConfigError(
      "usage pricing",
      `meter "${meter.meter}" unitPriceCents must be whole minor units, got ${meter.unitPriceCents}`,
    );
  }
}

function assertBase(base: ComposeBase | null, usagePeriod: UsagePeriod, currency: string): void {
  if (!base) return;
  if (base.currency !== currency) {
    throw new BillingUsageError(`the base is in ${base.currency}, the policy in ${currency}`);
  }
  if (!isWhole(base.amountCents)) {
    throw new BillingUsageError(`a base of ${base.amountCents} is not a whole amount`);
  }
  if (base.period.start.getTime() !== usagePeriod.end.getTime()) {
    throw new BillingUsageError(
      `the overage of the period ending ${usagePeriod.end.toISOString()} goes on the cycle that starts then, not on one starting ${base.period.start.toISOString()}`,
    );
  }
}

/** Exactly one trustworthy reading per declared meter, keyed by meter. */
function readingsByMeter(
  meters: readonly MeteredAllowance[],
  readings: readonly UsageReading[],
  usagePeriod: UsagePeriod,
): Map<string, UsageReading> {
  const declared = new Set(meters.map((meter) => meter.meter));
  const byMeter = new Map<string, UsageReading>();
  for (const reading of readings) {
    if (!declared.has(reading.meter)) throw new BillingUsageError(`a reading of undeclared meter "${reading.meter}"`);
    if (byMeter.has(reading.meter)) throw new BillingUsageError(`two readings of meter "${reading.meter}"`);
    assertReading(reading, usagePeriod);
    byMeter.set(reading.meter, reading);
  }
  const missing = meters.find((meter) => !byMeter.has(meter.meter));
  if (missing) throw new BillingUsageError(`no reading of meter "${missing.meter}" — a missing count is not zero`);
  return byMeter;
}

function assertReading(reading: UsageReading, usagePeriod: UsagePeriod): void {
  if (!samePeriod(reading.period, usagePeriod)) {
    throw new BillingUsageError(`the reading of meter "${reading.meter}" covers another period`);
  }
  if (!isWhole(reading.used)) {
    throw new BillingUsageError(`meter "${reading.meter}" used ${reading.used}, not a whole count`);
  }
  if (reading.allowance !== undefined && !isWhole(reading.allowance)) {
    throw new BillingUsageError(`meter "${reading.meter}" allowance ${reading.allowance} is not a whole count`);
  }
}

/** Only a count that could be billed is worth waiting for. */
function isPending(reading: UsageReading): boolean {
  return reading.overage === "BILLED" && !reading.final;
}

function overageLine(meter: MeteredAllowance, reading: UsageReading, input: ComposeInput): OverageLine | null {
  if (reading.overage !== "BILLED") return null;
  if (isAlreadyBilled(input.alreadyBilled, meter.meter, input.usagePeriod)) return null;
  const allowance = reading.allowance ?? meter.allowance;
  const quantity = Math.max(0, reading.used - allowance);
  if (quantity === 0) return null;
  const amountCents = quantity * meter.unitPriceCents;
  if (!Number.isSafeInteger(amountCents)) {
    throw new BillingUsageError(`the overage of meter "${meter.meter}" (${quantity} × ${meter.unitPriceCents}) leaves safe integers`);
  }
  return {
    kind: "OVERAGE",
    meter: meter.meter,
    period: input.usagePeriod,
    used: reading.used,
    allowance,
    quantity,
    unitPriceCents: meter.unitPriceCents,
    amountCents,
  };
}

function isAlreadyBilled(billed: readonly BilledOverage[], meter: string, period: UsagePeriod): boolean {
  return billed.some((entry) => entry.meter === meter && entry.periodStart.getTime() === period.start.getTime());
}

function samePeriod(a: UsagePeriod, b: UsagePeriod): boolean {
  return a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime();
}
