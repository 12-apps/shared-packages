import type { CredentialStore } from './credential-store';
import type { ProviderRegistry } from './registry';
import type { MerchantRef, ThreeDSecureSession } from './types';

/**
 * The 3-D Secure session for a merchant's debit charge (FUT-3754), minted by
 * the HEAD of the merchant's chain — the provider whose browser key the card
 * was encrypted with, and so the only one whose authentication id that card's
 * charge can carry. A debit charge does not fail over: the authentication is
 * bound to the provider that ran it.
 *
 * `null` when the head cannot do debit (no adapter claim, or no credentials):
 * the checkout then offers no debit, which is the honest answer, rather than
 * an authentication that no charge here could use.
 */
export async function debitSessionFor(
  deps: {
    providers: ProviderRegistry;
    credentials: Pick<CredentialStore, 'defaultProvider' | 'getCredentials'>;
  },
  merchant: MerchantRef,
): Promise<{ provider: string; session: ThreeDSecureSession } | null> {
  const provider = await deps.credentials.defaultProvider(merchant);
  if (!provider || !deps.providers.has(provider)) return null;
  const adapter = deps.providers.get(provider);
  if (!adapter.capabilities.debit || !adapter.debit) return null;
  const credentials = await deps.credentials.getCredentials(merchant, provider);
  if (!credentials) return null;
  return { provider, session: await adapter.debit.createSession(credentials) };
}
