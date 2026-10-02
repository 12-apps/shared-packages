import { UnsupportedOperationError } from './errors';
import { isManualConfirmation, ManualChargeNotFoundError } from './manual-charge';
import type { ChargeStore } from './ports';
import type { PaymentProviderAdapter } from './provider';
import type { ChargeSnapshot, MerchantRef, ResolvedCredentials } from './types';

/**
 * VOIDING a not-yet-paid charge (FUT-379).
 *
 * The case this exists for is a SUPERSEDED charge. Once every checkout attempt
 * raises its own charge, a repriced order leaves the previous one live at the
 * OLD amount — still PENDING at the provider, and on PIX still a scannable
 * code. A host-side status guard can stop that settling wrongly, but only the
 * provider can stop the buyer paying it, which is the difference between
 * refusing money and refunding it.
 *
 * It lives in its own module rather than inline in `gateway.ts` because that
 * file sits at its 400-line ceiling; the seam is the same one `charge-walk.ts`
 * uses, a factory closed over the gateway's ports.
 */

/** The gateway's `(merchant, provider) -> adapter + credentials` resolution. */
type ResolveFor = (
  merchant: MerchantRef,
  provider?: string,
) => Promise<{ adapter: PaymentProviderAdapter; creds: ResolvedCredentials }>;

/**
 * Build the gateway's `cancelCharge`.
 *
 * CAPABILITY-GATED ON THE METHOD, like `vault.forget` and unlike `refunds`:
 * "can void a charge" is a fact about a vendor's API, not a flag a merchant
 * turns on. PagBank and InfinitePay implement none, so they throw
 * `UnsupportedOperationError` — and that refusal is the whole point. A silent
 * no-op would let a caller believe a charge the buyer can still pay had been
 * voided, and stop guarding it.
 *
 * The returned snapshot is PERSISTED, exactly as `refreshCharge` does. Voiding
 * at the provider while our own row still says PENDING would leave the host
 * offering a code that no longer exists.
 */
export function cancelChargeAt(charges: ChargeStore, resolve: ResolveFor) {
  return async function cancelCharge(
    merchant: MerchantRef,
    provider: string,
    providerChargeId: string,
  ): Promise<ChargeSnapshot> {
    const { adapter, creds } = await resolve(merchant, provider);
    if (isManualConfirmation(adapter)) return cancelManually(charges, merchant, provider, providerChargeId);
    if (!adapter.cancelCharge) {
      throw new UnsupportedOperationError(adapter.name, 'cancelling a charge');
    }
    const snapshot = await adapter.cancelCharge(providerChargeId, creds);
    await charges.upsertByProviderChargeId(merchant, snapshot);
    return snapshot;
  };
}

/**
 * Voiding a charge only the STORE can settle (`capabilities.confirmation:
 * 'MANUAL'`): nothing to call — a static Pix code cannot be revoked at any
 * bank, so the void is the store's own refusal to honour it — and it goes
 * through the same compare-and-set as a staff "Não recebi"
 * (`ChargeStore.transitionPending`). The read-then-write upsert would let a
 * buyer's release land CANCELED over a PAID a staff confirm had just set. A
 * charge the store already confirmed is answered as it stands (PAID), so the
 * caller learns it was paid rather than that it was voided.
 */
async function cancelManually(
  charges: ChargeStore,
  merchant: MerchantRef,
  provider: string,
  providerChargeId: string,
): Promise<ChargeSnapshot> {
  if (!charges.transitionPending) throw new UnsupportedOperationError(provider, 'cancelling without transitionPending');
  const stored = await charges.findByProviderChargeId(provider, providerChargeId);
  const ours = stored && stored.merchant.kind === merchant.kind && stored.merchant.id === merchant.id;
  if (!stored || !ours) throw new ManualChargeNotFoundError(provider, providerChargeId);
  const outcome = await charges.transitionPending(merchant, { ...stored.snapshot, status: 'CANCELED' });
  return (outcome.stored ?? stored).snapshot;
}
