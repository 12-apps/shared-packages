import type { CredentialStore } from './credential-store';
import { firstTaking } from './method-head';
import type { ProviderRegistry } from './registry';
import type { MerchantRef, ThreeDSecureSession } from './types';

/**
 * The 3-D Secure session for a merchant's debit charge (FUT-3754), minted by
 * the CARD head of the merchant's chain — the first provider that takes a card
 * (FUT-4109), whose browser key the card was encrypted with, and so the only
 * one whose authentication id that card's charge can carry. Not `chain[0]`: a
 * head that takes no card (the store's own Pix key) would hide debit from
 * every buyer. A debit charge does not fail over: the authentication is
 * bound to the provider that ran it.
 *
 * `null` when the head cannot do debit (no adapter claim, or no credentials):
 * the checkout then offers no debit, which is the honest answer, rather than
 * an authentication that no charge here could use.
 */
export async function debitSessionFor(
  deps: {
    providers: ProviderRegistry;
    credentials: Pick<CredentialStore, 'providerChain' | 'getCredentials'>;
  },
  merchant: MerchantRef,
): Promise<{ provider: string; session: ThreeDSecureSession } | null> {
  const chain = await deps.credentials.providerChain(merchant);
  const provider = firstTaking(deps.providers, chain, 'CARD');
  if (!provider) return null;
  const adapter = deps.providers.get(provider);
  if (!adapter.capabilities.debit || !adapter.debit) return null;
  const credentials = await deps.credentials.getCredentials(merchant, provider);
  if (!credentials) return null;
  return { provider, session: await adapter.debit.createSession(credentials) };
}
