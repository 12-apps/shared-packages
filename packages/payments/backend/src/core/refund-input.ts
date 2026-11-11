import type { Money } from './types';

/** Refund request against a previously paid charge. */
export interface RefundInput {
  providerChargeId: string;
  /** Omit for a full refund; set for partial (capability-gated). */
  amount?: Money;
  reason?: string;
  /**
   * The caller owns the retry of this refund and reports a give-up itself, once
   * per charge (FUT-4360), so the gateway does not report this call's refusal.
   * Opt-in: every other caller keeps the gateway's REFUND report as it was.
   */
  retriedByCaller?: boolean;
  /** A deadline the adapter honours on every call it makes for this refund. */
  signal?: AbortSignal;
}
