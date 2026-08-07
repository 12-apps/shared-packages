import type { PaymentsGateway } from '../core/gateway';
import { UnsupportedOperationError } from '../core/errors';
import type { ChargeQueryStore } from '../core/ports';

import { supersededPixCharges } from './reuse';
import type { CheckoutLogger, Payable } from './types';

/**
 * Void the codes a reprice left behind (FUT-379), best-effort and never fatal.
 *
 * BEST-EFFORT IS NOT SILENT. Two outcomes are possible and both are reported:
 *
 *  - the provider CANNOT void — `cancelCharge` is optional on the adapter
 *    contract and several vendors implement nothing, so the gateway refuses with
 *    `UnsupportedOperationError` rather than pretending. The stale code stays
 *    payable until it expires, and the log says so by name. This is the
 *    documented, accepted outcome: the alternative — refusing the reprice —
 *    would block a coupon on a payable the buyer can still pay correctly, which
 *    is a worse trade than a code that lapses.
 *  - the void FAILED — network, credentials, a provider rejection. Logged as an
 *    error, because unlike the case above this one may well work on a retry and
 *    an operator can still void it by hand.
 *
 * NEVER THROWS. The new charge is already valid and the buyer is waiting on it;
 * failing their checkout because an OLD code could not be voided would turn a
 * stale-code risk into a total outage of the payment path.
 */
export async function voidSupersededPixCharges(
  deps: { gateway: PaymentsGateway; charges: ChargeQueryStore; log: CheckoutLogger },
  payable: Pick<Payable, 'ref' | 'merchant' | 'amount'>,
): Promise<void> {
  let stale: Awaited<ReturnType<typeof supersededPixCharges>>;
  try {
    stale = await supersededPixCharges(deps.charges, payable);
  } catch (error) {
    deps.log.error(
      `payments.void could not list superseded charges for ${payable.ref}: ${reason(error)}`,
    );
    return;
  }

  for (const charge of stale) {
    const what =
      `${charge.provider} charge ${charge.providerChargeId} ` +
      `(${charge.amount.amountCents} ${charge.amount.currency}) on ${payable.ref}`;
    try {
      await deps.gateway.cancelCharge(
        payable.merchant,
        charge.provider,
        charge.providerChargeId,
      );
    } catch (error) {
      if (error instanceof UnsupportedOperationError) {
        deps.log.warn(`payments.void unsupported: ${what} stays payable until it expires`);
      } else {
        deps.log.error(`payments.void failed for ${what}: ${reason(error)}`);
      }
    }
  }
}

/**
 * A STRING, never the error object. A host logger may inspect extra arguments
 * recursively, and `ProviderRequestError` retains the provider's parsed body —
 * which is how a payload echoing the buyer's name, e-mail and tax id ends up in
 * operational logs.
 */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
