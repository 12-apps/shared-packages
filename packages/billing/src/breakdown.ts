import { BillingBreakdownError } from "./errors";
import type { CycleCharge, CycleChargeLine, OverageLine } from "./usage-types";

/**
 * The check every cycle breakdown passes (FUT-5094).
 *
 * A breakdown is what the receipt says the customer paid for, so it must
 * explain the amount to the centavo: whole, non-negative lines, each overage
 * line's own arithmetic true, one period's overage of one meter at most once,
 * at most one base, and a sum EXACTLY equal to `amountCents`. A zero-amount
 * charge is never a charge. The host runs this before persisting and on every
 * read back; the collection guard runs it before every charge.
 */
export function checkBreakdown(charge: CycleCharge): void {
  if (typeof charge.currency !== "string" || charge.currency.trim() === "") {
    throw new BillingBreakdownError("a breakdown needs its currency");
  }
  if (!isWhole(charge.amountCents) || charge.amountCents === 0) {
    throw new BillingBreakdownError(`a charge of ${charge.amountCents} is not a positive whole amount`);
  }
  if (charge.lines.length === 0) {
    throw new BillingBreakdownError("a charge with an amount needs at least one line");
  }
  const seen = new Set<string>();
  let total = 0;
  for (const line of charge.lines) {
    checkLine(line);
    const key = lineKey(line);
    if (seen.has(key)) throw new BillingBreakdownError(`the breakdown repeats ${key}`);
    seen.add(key);
    total += line.amountCents;
  }
  if (total !== charge.amountCents) {
    throw new BillingBreakdownError(`the lines sum to ${total}, not to the charge's ${charge.amountCents}`);
  }
}

function checkLine(line: CycleChargeLine): void {
  if (!isWhole(line.amountCents)) {
    throw new BillingBreakdownError(`a ${line.kind} line of ${line.amountCents} is not a whole amount`);
  }
  if (line.kind === "OVERAGE") checkOverageArithmetic(line);
}

function checkOverageArithmetic(line: OverageLine): void {
  const numbers = [line.used, line.allowance, line.quantity, line.unitPriceCents];
  if (!numbers.every(isWhole)) {
    throw new BillingBreakdownError(`the overage line of ${line.meter} carries a number that is not whole`);
  }
  const quantity = Math.max(0, line.used - line.allowance);
  if (line.quantity !== quantity || quantity === 0) {
    throw new BillingBreakdownError(
      `the overage line of ${line.meter} bills ${line.quantity} units, but ${line.used} used against ${line.allowance} is ${quantity}`,
    );
  }
  if (line.amountCents !== quantity * line.unitPriceCents) {
    throw new BillingBreakdownError(
      `the overage line of ${line.meter} says ${line.amountCents}, but ${quantity} × ${line.unitPriceCents} is ${quantity * line.unitPriceCents}`,
    );
  }
}

/** One BASE per breakdown; one OVERAGE per (meter, usage period). */
function lineKey(line: CycleChargeLine): string {
  return line.kind === "BASE" ? "the base" : `the overage of ${line.meter} for ${line.period.start.toISOString()}`;
}

/** A whole, non-negative, safe integer. */
export function isWhole(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
