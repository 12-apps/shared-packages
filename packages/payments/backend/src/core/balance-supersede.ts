import type { ChargeQueryStore } from './charge-queries';
import { pixChargePayable } from './charge-reuse';
import type { ChargeSnapshot, ChargeStatus, MerchantRef } from './types';

/**
 * A BALANCE RAISE retires every other live charge of its reference (FUT-612).
 *
 * A reprice voids only the PIX codes priced at what the reference USED to cost
 * (`voidSuperseded` in `charge-raise.ts`, `voidSupersededPixCharges` in
 * `checkout/supersede.ts`). A balance is different: the reference already
 * holds a capture and is now asked for only what is still missing, so EVERY
 * other live charge on it — the full-amount code a buyer could still scan, a
 * card still waiting on its 3-D Secure, a hosted link at the old price — would
 * settle money the reference no longer owes. The charge the buyer holds now is
 * the only one left payable.
 *
 * This module only FINDS them. They are retired by the one retirement the
 * library already has for a charge a newer one replaced — `answerHeld` in
 * `hosted-retire.ts` — by adding them to the raise's moved-past list, which is
 * what makes the void safe on a race:
 *
 *  - it runs ONLY while the held charge is live (PENDING, AUTHORIZED or PAID):
 *    a declined card never voids the difference code the buyer may be paying
 *    on another phone;
 *  - a void the provider answers PAID or AUTHORIZED — the old code was paid in
 *    the window — is not lost: it becomes the buyer's answer (`paidEarlier`,
 *    which the caller settles) and the charge raised in its place is retired
 *    against it, or both are recorded `DOUBLE_PAID` for a refund;
 *  - a void the provider cannot make, or did not confirm, MARKS the charge
 *    superseded and RECORDS it through the host's `SupersededRecorder`, so a
 *    late payment of it reaches the host's superseded handling instead of
 *    settling unnoticed.
 *
 * NEVER THROWS: a listing that fails is logged and retires nothing, because
 * failing the buyer's balance charge over an OLD code would turn a stale-code
 * risk into an outage of the one path that lets them finish paying.
 */

/** Which reference, and the charges of it the raise already accounts for. */
export interface BalanceScope {
  merchant: MerchantRef;
  reference: string;
  /**
   * `providerChargeId`s left out: the charge the buyer holds, and every link
   * the raise already retires on its own.
   */
  keep: ReadonlySet<string>;
}

/**
 * A live charge a void can still buy something on. A PIX code past its
 * deadline cannot be paid, so cancelling it only spends a provider call that is
 * likely to be refused; every other method has no local deadline to read.
 */
function worthRetiring(snapshot: ChargeSnapshot): boolean {
  return snapshot.method !== 'PIX' || !snapshot.pix?.qrText || pixChargePayable(snapshot);
}

/** The reference's other live charges, for the raise's moved-past list. Never throws. */
export async function otherLiveCharges(
  charges: Pick<ChargeQueryStore, 'listPayable'>,
  scope: BalanceScope,
  log: { error(message: string): void },
): Promise<ChargeSnapshot[]> {
  try {
    const rows = await charges.listPayable({ merchant: scope.merchant, reference: scope.reference });
    return rows
      .map((row) => row.snapshot)
      .filter((snapshot) => !scope.keep.has(snapshot.providerChargeId) && worthRetiring(snapshot));
  } catch (error) {
    const why = error instanceof Error ? error.message : 'unknown error';
    log.error(`payments.void could not list the live charges of ${scope.reference}: ${why}`);
    return [];
  }
}

/** A held charge a buyer holds or has paid — the only kind that retires others. */
const HOLDS: ReadonlySet<ChargeStatus> = new Set<ChargeStatus>(['PENDING', 'AUTHORIZED', 'PAID']);

/** The moved-past list of a raise, with a balance's other live charges added when it is one. */
export async function balanceMovedPast(
  deps: { charges: Pick<ChargeQueryStore, 'listPayable'>; log: { error(message: string): void } },
  input: { merchant: MerchantRef; reference: string; held: ChargeSnapshot; movedPast: readonly ChargeSnapshot[]; balance: boolean },
): Promise<ChargeSnapshot[]> {
  // A held charge that is not live voids nothing (`answerHeld`), so nothing is listed for it.
  if (!input.balance || !HOLDS.has(input.held.status)) return [...input.movedPast];
  const keep = new Set([input.held.providerChargeId, ...input.movedPast.map((link) => link.providerChargeId)]);
  const others = await otherLiveCharges(deps.charges, { merchant: input.merchant, reference: input.reference, keep }, deps.log);
  return [...input.movedPast, ...others];
}
