import { AdapterContractError } from '../core/errors';

import type { PaymentProviderAdapter } from '../core/provider';
import { credentialSchemaOf } from '../core/provider';
import type { ProviderRegistry } from '../core/registry';
import type { MerchantRef, ResolvedCredentials } from '../core/types';
import type { ProviderConfigStore } from './types';

/**
 * The PUBLIC browser key a connection tokenizes with: which field holds it,
 * how a key-less connection gets one, and where the minted value is cached.
 *
 * All three used to live in the host, once per caller. That was defensible
 * while the vendor call was the host's too, but the call has been this
 * package's since 2.1.0 (`fetchPagbankCardPublicKey`), and what was left
 * behind was the same rule written three times in three vocabularies — for
 * the buyer's checkout, for the activation form, and for the manual refresh —
 * plus a `provider === 'pagbank'` check on the checkout path, plus a
 * hand-written credential-row write that had to know what a save must NOT
 * invalidate.
 *
 * ASKED OF THE CAPABILITY, NEVER OF THE NAME. An adapter that can mint one
 * declares `browserKey`; every other adapter omits it and every function here
 * answers null. That is the same shape as `vault` and `applePay`, and it is
 * what removes the last provider name from a host's checkout path.
 */

/** What a connection's browser key is called and how to mint a fresh one. */
export interface BrowserKeyDeps {
  providers: ProviderRegistry;
  /** The stored connection: read for the row, written to cache a minted key. */
  connections: Pick<ProviderConfigStore, 'get' | 'save'>;
}

/**
 * The browser key already on this connection, or null.
 *
 * Asked of `clientConfig`, which is the adapter's own answer to "what key does
 * a browser start your tokenization with" and already serves the buyer's page.
 * Callers used to read `fields['publicKey'] ?? fields['publishableKey']` — the
 * union of the two spellings anyone had needed so far, correct for exactly as
 * long as no adapter picks a third, and blind to any adapter that derives the
 * value rather than storing it verbatim.
 *
 * Independent of `browserKey` on purpose: an adapter whose merchants PASTE
 * their key can never mint one, and must still report the one it holds.
 */
export function storedBrowserKey(
  adapter: PaymentProviderAdapter,
  credentials: ResolvedCredentials,
): string | null {
  return adapter.clientConfig(credentials).publicKey || null;
}

/**
 * Cache a MACHINE-FETCHED, non-secret value onto the merchant's ACTIVE
 * environment, invalidating nothing.
 *
 * This is deliberately NOT `saveCredentials`. That path resets `status` to
 * UNVERIFIED, drops the provider out of the failover chain and clears both
 * `chargeVerifiedAt` and the outstanding `pendingVerification` — correct for
 * an owner typing new keys, catastrophic here: a key this package fetched with
 * the merchant's own token names the same account it already proved, so
 * routing the backfill through the ordinary save would switch off every
 * connection it touched, on the buyer's first checkout load after a rotation.
 *
 * The value must be a NON-SECRET field: a browser key is handed to every
 * shopper's page, and it is the only kind of value that has no business
 * invalidating a proof. Anything the adapter marks `secret` is refused rather
 * than quietly written down a path with no invalidation — the host copy of
 * this could express no such rule, being a spread of the row.
 *
 * A merchant with no stored connection is a NO-OP, not an error: there is
 * nothing to cache onto, and the caller still gets the minted key back.
 */
export async function cacheFetchedField(
  deps: BrowserKeyDeps,
  merchant: MerchantRef,
  provider: string,
  field: string,
  value: string,
): Promise<void> {
  const adapter = deps.providers.get(provider);
  const spec = credentialSchemaOf(adapter).find((entry) => entry.key === field);
  if (!spec) throw new AdapterContractError(provider, `no credential field '${field}' to cache into`);
  if (spec.secret) {
    throw new AdapterContractError(provider, `'${field}' is secret and must not be cached this way`);
  }

  const stored = await deps.connections.get(merchant, provider);
  if (!stored) return;

  await deps.connections.save(merchant, {
    ...stored,
    environments: {
      ...stored.environments,
      [stored.environment]: { ...stored.environments[stored.environment], [field]: value },
    },
  });
}

/**
 * Mint this connection's browser key with the merchant's OWN credentials and
 * cache it, or null when the adapter cannot mint one.
 *
 * The merchant's own credentials, never the platform's: a key belongs to the
 * account it was minted under, and a card encrypted with a foreign one is
 * rejected at authorization — a decline whose cause is invisible from every
 * screen involved.
 *
 * Best-effort by contract, like the vendor call underneath it: a failed mint
 * answers null. Caching is likewise never fatal to the read — the caller asked
 * for a key, and a row that could not be written is a slower next call, not a
 * blocked checkout.
 */
export async function mintBrowserKey(
  deps: BrowserKeyDeps,
  merchant: MerchantRef,
  provider: string,
  credentials: ResolvedCredentials,
): Promise<string | null> {
  const adapter = deps.providers.get(provider);
  const capability = adapter.browserKey;
  if (!capability) return null;

  const minted = await capability.mint(credentials);
  if (!minted) return null;

  await cacheFetchedField(deps, merchant, provider, capability.field, minted).catch(() => undefined);
  return minted;
}
