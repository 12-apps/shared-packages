import type { ChargeSnapshot } from '../core/types';

import type { RaiseChargeDeps } from './raise';
import { attachedChargeOf, type CheckoutRuntime } from './runtime';
import type { Payable } from './types';

/**
 * The checkout's half of a raise that is not the charge itself (FUT-4072):
 * what `raiseCharge` runs on, and settling a payable whose moved-past link the
 * raise found already PAID. Split out of `flows-charge.ts` for its size gate.
 */

type Runtime<C, V extends object, D> = CheckoutRuntime<C, V, D>;

/**
 * What `raiseCharge` runs on. A moved-past hosted link the provider could not
 * void is recorded through the host's `correlation.supersede` (FUT-4072).
 */
export async function raiseDeps<C, V extends object, D>(runtime: Runtime<C, V, D>): Promise<RaiseChargeDeps> {
  const supersede = runtime.config.correlation.supersede?.bind(runtime.config.correlation);
  return {
    gateway: await runtime.gateway(),
    charges: runtime.charges,
    log: runtime.log,
    ...(runtime.config.onProviderFailure ? { onProviderFailure: runtime.config.onProviderFailure } : {}),
    ...(supersede
      ? {
          onSuperseded: ({ reference, snapshot, replacedBy, why, voidOutcome }) =>
            supersede({
              ref: reference,
              charge: attachedChargeOf(snapshot),
              amount: snapshot.amount,
              replacedBy: attachedChargeOf(replacedBy),
              why,
              ...(voidOutcome ? { voidOutcome } : {}),
            }),
        }
      : {}),
  };
}

/**
 * A moved-past link the raise found already PAID (FUT-4072): the buyer paid
 * THAT one, so the payable is settled with it — exactly as a poll would — and
 * the buyer is shown paid rather than a fresh QR or page.
 */
export function settleEarlier<C, V extends object, D>(
  runtime: Runtime<C, V, D>,
  payable: Payable,
  paid: ChargeSnapshot,
): Promise<string> {
  return runtime.config.correlation.settle({
    ref: payable.ref,
    charge: attachedChargeOf(paid),
    capturedAmount: paid.amount,
    method: paid.method,
  });
}
