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

/**
 * Why a moved-past charge is still the buyer's to pay. A link the void found
 * already PAID is not superseded: it is the payment (`hosted-retire.ts`).
 */
export type SupersededWhy =
  /** The provider has no `cancelCharge`. */
  | 'VOID_UNSUPPORTED'
  /** The void threw: network, credentials, a disabled provider, a refusal. */
  | 'VOID_FAILED'
  /** The provider answered the void with a charge that is still PENDING. */
  | 'VOID_NOT_CONFIRMED';

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
