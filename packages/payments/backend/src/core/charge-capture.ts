import { UnsupportedOperationError } from './errors';
import type { ChargeStore } from './ports';
import type { PaymentProviderAdapter } from './provider';
import type { ChargeSnapshot, MerchantRef, ResolvedCredentials } from './types';

/**
 * CAPTURING an AUTHORIZED charge (FUT-4082).
 *
 * An authorization holds the buyer's money without taking it, and it lapses
 * back to the buyer if nobody captures it. The host settles a pedido with a
 * charge the buyer paid earlier (`paidEarlier`, FUT-4072) or keeps one of two
 * captured charges (`DOUBLE_PAID`); when that charge is only AUTHORIZED, the
 * pedido would read PAID over money the store never received. This is the call
 * that takes it first.
 *
 * Same seam as `charge-cancel.ts`: a factory closed over the gateway's ports,
 * kept out of `gateway.ts`, which sits at its size ceiling.
 */

/** The gateway's `(merchant, provider) -> adapter + credentials` resolution. */
type ResolveFor = (
  merchant: MerchantRef,
  provider?: string,
) => Promise<{ adapter: PaymentProviderAdapter; creds: ResolvedCredentials }>;

/** The gateway's capture call. */
export interface CaptureChargeMethods<P extends string = string> {
  /**
   * Capture an AUTHORIZED charge in full and persist what the provider answers.
   *
   * Throws `UnsupportedOperationError` for a provider with no capture — a
   * state, not a refusal, so a caller can tell "this vendor cannot" (tell the
   * owner) from "the vendor said no" (a `ProviderRequestError`). The answer
   * is the charge as it now stands: a caller settles only on PAID.
   */
  captureCharge(merchant: MerchantRef, provider: P, providerChargeId: string): Promise<ChargeSnapshot>;
}

/**
 * Build the gateway's `captureCharge`.
 *
 * The stored row supplies what the adapter may need and the caller should not
 * have to know: the amount the charge authorized, and the settlement hints a
 * provider reads its charges back through (PagBank's order, FUT-3722). The
 * snapshot is PERSISTED, as `cancelCharge` and `refreshCharge` do, so the row
 * stops reading AUTHORIZED the moment the provider says PAID.
 */
export function captureChargeAt(charges: ChargeStore, resolve: ResolveFor) {
  return async function captureCharge(
    merchant: MerchantRef,
    provider: string,
    providerChargeId: string,
  ): Promise<ChargeSnapshot> {
    const { adapter, creds } = await resolve(merchant, provider);
    if (!adapter.captureCharge) {
      throw new UnsupportedOperationError(adapter.name, 'capturing a charge');
    }
    const stored = await charges.findByProviderChargeId(provider, providerChargeId);
    const snapshot = await adapter.captureCharge(
      { providerChargeId, ...(stored ? { amount: stored.snapshot.amount } : {}) },
      creds,
      stored?.snapshot.settlementHints,
    );
    await charges.upsertByProviderChargeId(merchant, snapshot);
    return snapshot;
  };
}
