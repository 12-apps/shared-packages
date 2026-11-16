import type { ChargeQueryStore } from './charge-queries';
import { pixChargePayable } from './charge-reuse';
import { UnsupportedOperationError } from './errors';
import type { ChargeSnapshot, MerchantRef } from './types';

/**
 * A BALANCE RAISE retires every other live charge of its reference (FUT-612).
 *
 * A reprice voids only the PIX codes priced at what the reference USED to cost
 * (`voidSuperseded` in `charge-raise.ts`, `voidSupersededPixCharges` in
 * `checkout/supersede.ts`): a card attempt carries its own instrument and a
 * code at the current price is the one being reused. A balance is different.
 * The reference already holds a capture and is now asked for only what is
 * still missing, so EVERY other live charge on it — the full-amount code a
 * buyer could still scan, a card still waiting on its 3-D Secure, a hosted
 * link at the old price — would settle money the reference no longer owes.
 * The charge the buyer holds now is the only one left payable.
 *
 * Same rules as the reprice's void, and for the same reasons:
 *
 *  - ONLY AFTER the held charge is proven good: the buyer is never left with
 *    every code voided and none to pay.
 *  - BEST EFFORT, NEVER SILENT: a provider that cannot void (`cancelCharge` is
 *    optional on the adapter) leaves the code payable until it lapses, and the
 *    log says so by name; a void that failed is an error an operator can act
 *    on. A capture of a code that survived is the host's over-payment to
 *    record, never something this raise could prevent on such a provider.
 *  - NEVER THROWS: failing the buyer's balance charge because an OLD code could
 *    not be voided would turn a stale-code risk into an outage of the one path
 *    that lets them finish paying.
 */

/** The gateway call a void needs. */
export interface BalanceVoidGateway {
  cancelCharge(merchant: MerchantRef, provider: string, providerChargeId: string): Promise<ChargeSnapshot>;
}

export interface BalanceVoidDeps {
  gateway: BalanceVoidGateway;
  charges: Pick<ChargeQueryStore, 'listPayable'>;
  log: { warn(message: string): void; error(message: string): void };
}

/** Which reference, and the charges of it that stay payable. */
export interface BalanceVoidScope {
  merchant: MerchantRef;
  reference: string;
  /**
   * `providerChargeId`s left alone: the charge the buyer now holds, and any
   * hosted link the raise already retires on its own (`answerHeld`), which a
   * second cancel would only report twice.
   */
  keep: ReadonlySet<string>;
}

/**
 * A live charge a void can still buy something on. A PIX code past its
 * deadline cannot be paid, so cancelling it only spends a provider call that is
 * likely to be refused; every other method has no local deadline to read.
 */
function worthVoiding(snapshot: ChargeSnapshot): boolean {
  return snapshot.method !== 'PIX' || pixChargePayable(snapshot) || !snapshot.pix?.qrText;
}

/** Void every live charge of the reference that is not in `keep`. Never throws. */
export async function voidOtherLiveCharges(deps: BalanceVoidDeps, scope: BalanceVoidScope): Promise<void> {
  const { merchant, reference, keep } = scope;
  let others: ChargeSnapshot[];
  try {
    const rows = await deps.charges.listPayable({ merchant, reference });
    others = rows
      .map((row) => row.snapshot)
      .filter((snapshot) => !keep.has(snapshot.providerChargeId) && worthVoiding(snapshot));
  } catch (error) {
    deps.log.error(`payments.void could not list the live charges of ${reference}: ${reason(error)}`);
    return;
  }

  for (const charge of others) {
    const what =
      `${charge.provider} ${charge.method} charge ${charge.providerChargeId} ` +
      `(${charge.amount.amountCents} cents) on ${reference}`;
    try {
      await deps.gateway.cancelCharge(merchant, charge.provider, charge.providerChargeId);
    } catch (error) {
      if (error instanceof UnsupportedOperationError) {
        deps.log.warn(`payments.void unsupported: ${what} stays payable until it expires`);
      } else {
        deps.log.error(`payments.void failed for ${what}: ${reason(error)}`);
      }
    }
  }
}

/** A STRING, never the error object: a provider error retains the buyer's data. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
