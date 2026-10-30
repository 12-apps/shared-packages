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

/**
 * The adapter declares this method; a provider this deployment does not route
 * to never does, and neither does an adapter that declares no capabilities at
 * all. The type says every adapter has them, but a host can register one cast
 * from a partial object (a billing acquirer that only charges a saved card,
 * FUT-3138): reading through it would turn "nobody here takes a card" into a
 * TypeError, where every caller has an honest answer for that case.
 */
function takesMethod(providers: Adapters, name: ProviderName, method: PaymentMethodKind): boolean {
  if (!providers.has(name)) return false;
  const declared: Partial<PaymentProviderAdapter['capabilities']> | undefined = providers.get(name).capabilities;
  return declared?.methods?.includes(method) === true;
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
 * Falls back to the chain head (`defaultProvider`) when no link takes a card:
 * the answer every one of those callers gave before, so a chain whose head
 * takes cards, and a chain where nobody does, behave as they always did.
 *
 * The registry is REQUIRED: without one nothing can say who takes a card, and
 * a caller that guessed the head here while another part of the same flow
 * asked a registry would split one card across two providers. A caller with
 * no registry uses the head everywhere instead (`checkout/card-provider.ts`).
 */
export async function cardProviderFor(
  deps: {
    providers: Adapters;
    credentials: Pick<CredentialStore, 'providerChain' | 'defaultProvider'>;
  },
  merchant: MerchantRef,
): Promise<ProviderName | null> {
  const found = firstTaking(deps.providers, await deps.credentials.providerChain(merchant), 'CARD');
  return found ?? (await deps.credentials.defaultProvider(merchant));
}
