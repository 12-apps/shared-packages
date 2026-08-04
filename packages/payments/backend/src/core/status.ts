import type { ChargeStatus } from './types';

/**
 * Charge-status ordering helpers, shared by every `ChargeStore`
 * implementation (the in-memory one here and the host's real one) so "status
 * only moves forward" means the same thing everywhere.
 *
 * Webhooks are at-least-once and unordered: a PENDING emitted before payment
 * can be DELIVERED after the PAID one. Ranks encode which transitions are
 * regressions to ignore. Terminal states never regress to live ones;
 * refunds outrank PAID (they happen after it).
 */
const RANK: Record<ChargeStatus, number> = {
  PENDING: 0,
  AUTHORIZED: 1,
  PAID: 2,
  DECLINED: 2,
  CANCELED: 2,
  EXPIRED: 2,
  PARTIALLY_REFUNDED: 3,
  REFUNDED: 4,
};

/**
 * True when moving `from` → `to` goes strictly forward (or restates the same
 * status). Equal-rank transitions between DIFFERENT statuses are rejected:
 * PAID / DECLINED / CANCELED / EXPIRED are mutually contradictory outcomes,
 * and a late contradiction must never overwrite a confirmed one — a genuine
 * post-payment reversal is a refund (higher rank), not a decline.
 */
export function isForwardTransition(from: ChargeStatus, to: ChargeStatus): boolean {
  return to === from || RANK[to] > RANK[from];
}

/** True for states that can never change again except by refund. */
export function isTerminal(status: ChargeStatus): boolean {
  return status !== 'PENDING' && status !== 'AUTHORIZED';
}
