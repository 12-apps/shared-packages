import type { ChargeSnapshot } from './types';

/**
 * A charge THIS PACKAGE replaced and could not void (FUT-4072).
 *
 * When a checkout walks past a parked hosted link and the provider cannot void
 * it — no `cancelCharge`, a void that failed, a void the provider did not
 * confirm — the link stays what it
 * was at the provider. What changes is OURS: the stored row is marked, so it is
 * never offered back as "the live charge" again (`ChargeQueryStore.listPayable`
 * leaves it out) and it is retired exactly once.
 *
 * It rides inside the stored SNAPSHOT rather than in a column, so no migration
 * is needed, and a later refresh or webhook keeps it (`snapshot-merge.ts`
 * inherits it): a payment of the superseded link still settles the ROW, and the
 * host's webhook reaction sees `snapshot.superseded` on it.
 */

/** Why a void left a charge payable at its provider. */
export type VoidOutcome =
  /** The provider has no `cancelCharge`. */
  | 'VOID_UNSUPPORTED'
  /** The void threw: network, credentials, a disabled provider, a refusal. */
  | 'VOID_FAILED'
  /** The provider answered the void with a charge that is still PENDING. */
  | 'VOID_NOT_CONFIRMED';

/**
 * Why a charge was superseded (`hosted-retire.ts`):
 *
 *  - a {@link VoidOutcome} — a moved-past link replaced by the charge the buyer
 *    holds now, which the void could not take back;
 *  - `PAID_ELSEWHERE` — the charge raised for the buyer in THIS attempt, made
 *    redundant because the void of an older link found that link already
 *    PAID; it could not be voided either (`voidOutcome` says why);
 *  - `DOUBLE_PAID` — BOTH were paid: the older link (the superseded one) and
 *    the charge the buyer paid in this attempt. Money moved twice; one must be
 *    refunded.
 */
export type SupersededWhy = VoidOutcome | 'PAID_ELSEWHERE' | 'DOUBLE_PAID';

export interface ChargeSupersession {
  /** ISO-8601 instant the replacement was recorded. */
  at: string;
  /** The `providerChargeId` of the charge that replaced this one. */
  replacedBy: string;
  why: SupersededWhy;
}

/** Whether this package already replaced the charge (and recorded it). */
export function isSuperseded(snapshot: Pick<ChargeSnapshot, 'superseded'>): boolean {
  return snapshot.superseded !== undefined;
}
