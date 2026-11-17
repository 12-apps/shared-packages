import { chargeDeadlinePassed, type ChargeSnapshot } from "@12-apps/payments-backend";

import type { PurchaseFailure, UnansweredPurchaseCharge } from "./purchase-ports";

/**
 * The provider's refusal, lapse or reversal of an UNSETTLED purchase's
 * charge, or null while it can still be paid (FUT-5094).
 *
 * A pending push code fails only once its deadline has passed — the
 * provider's own deadline first, the one recorded at the raise otherwise. A
 * charge refunded before the purchase settled fails as CANCELED, so a retry
 * can raise a fresh one.
 */
export function failureOf(
  snapshot: ChargeSnapshot,
  open: UnansweredPurchaseCharge,
  at: Date,
): PurchaseFailure["reason"] | null {
  if (snapshot.status === "PENDING" || snapshot.status === "AUTHORIZED") {
    const deadline = snapshot.pix?.expiresAt ?? open.expiresAt?.toISOString();
    return chargeDeadlinePassed(deadline, at.getTime()) ? "EXPIRED" : null;
  }
  return FAILED_AS[snapshot.status] ?? null;
}

/** The terminal statuses that fail an unsettled attempt, and as what. */
const FAILED_AS: Partial<Record<ChargeSnapshot["status"], PurchaseFailure["reason"]>> = {
  DECLINED: "DECLINED",
  CANCELED: "CANCELED",
  REFUNDED: "CANCELED",
  PARTIALLY_REFUNDED: "CANCELED",
  EXPIRED: "EXPIRED",
};

/** A thrown value's message for a log line — the message only, never the payload. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
