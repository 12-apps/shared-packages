import type { CredentialStore } from '../core/credential-store';
import type { ProviderRegistry } from '../core/registry';
import type { MerchantRef } from '../core/types';
import type { ApplePayActivation, ApplePayCsr } from '../core/wallet-types';

/**
 * A provider's Apple Pay certificate round trip (FUT-3757), for ONE merchant:
 * `requestCsr` mints the `.csr` the operator uploads to the Merchant ID in
 * Apple's portal, and `activateCertificate` hands Apple's `.cer` (base64 DER,
 * or PEM) back to the provider. Both are the adapter's `applePay`; this only
 * resolves WHOSE account they run against.
 *
 * `null` when the provider has no round trip, or the merchant has no
 * credentials for it — the host answers that as "not connected".
 */
export interface ApplePayEnrolment {
  requestCsr(): Promise<ApplePayCsr>;
  activateCertificate(certificate: string): Promise<ApplePayActivation>;
}

export async function applePayEnrolmentFor(
  deps: { providers: ProviderRegistry; credentials: Pick<CredentialStore, 'getCredentials'> },
  merchant: MerchantRef,
  provider: string,
): Promise<ApplePayEnrolment | null> {
  if (!deps.providers.has(provider)) return null;
  const applePay = deps.providers.get(provider).applePay;
  const credentials = await deps.credentials.getCredentials(merchant, provider);
  if (!applePay || !credentials) return null;
  return {
    requestCsr: () => applePay.requestCsr(credentials),
    activateCertificate: (certificate) => applePay.activateCertificate(certificate, credentials),
  };
}
