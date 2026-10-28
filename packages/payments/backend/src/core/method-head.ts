import type { CredentialStore } from './credential-store';
import type { PaymentProviderAdapter } from './provider';
import type { MerchantRef, PaymentMethodKind, ProviderName } from './types';

/**
 * WHO IN THE CHAIN TAKES A METHOD — the one rule behind every "which provider
 * does this card belong to" question (FUT-4109, FUT-3138).
 *
 * The head of a merchant's chain is who a charge is tried at FIRST, not who a
 * card belongs to. A head that takes no card — the store's own Pix key, a
 * PIX-only acquirer — sits in front of the provider that actually
 * tokenizes, charges and vaults the card. Every card question therefore asks
 * for the first link that takes CARD: the 3-D Secure session
 * (`debit-session.ts`), the owner of a bare instrument in the charge walk
 * (`charge-walk.ts`), the vault and the saved-instrument list (`checkout/`).
 */

/** The registry's two questions — structural, so a gateway's own adapter slice fits. */
interface Adapters {
  has(name: string): boolean;
  get(name: string): PaymentProviderAdapter;
}

/** The adapter declares this method; a provider this deployment does not route to never does. */
function takesMethod(providers: Adapters, name: ProviderName, method: PaymentMethodKind): boolean {
  return providers.has(name) && providers.get(name).capabilities.methods.includes(method);
}

/** The first link of `chain` that takes `method`, or `undefined` when none does. */
export function firstTaking(
  providers: Adapters,
  chain: readonly ProviderName[],
  method: PaymentMethodKind,
): ProviderName | undefined {
  return chain.find((name) => takesMethod(providers, name, method));
}

/**
 * The merchant's CARD provider: who vaults a card, whose saved cards are
 * offered, and whose saved card a charge may use — the provider that would
 * actually charge it (FUT-3138).
 *
 * Falls back to the chain head (`defaultProvider`) when no link takes a card,
 * or when the caller holds no adapter registry to ask: exactly the answer
 * every one of those callers gave before, so a chain whose head takes cards,
 * and a chain where nobody does, behave as they always did.
 */
export async function cardProviderFor(
  deps: {
    providers?: Adapters;
    credentials: Pick<CredentialStore, 'providerChain' | 'defaultProvider'>;
  },
  merchant: MerchantRef,
): Promise<ProviderName | null> {
  const { providers, credentials } = deps;
  const found = providers ? firstTaking(providers, await credentials.providerChain(merchant), 'CARD') : undefined;
  return found ?? (await credentials.defaultProvider(merchant));
}
