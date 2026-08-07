import type { CredentialStore } from './ports';
import type { MerchantRef, ProviderName } from './types';

/**
 * Make every charge announce where the provider should call back.
 *
 * A provider that takes its webhook destination from the CHARGE — PagBank's
 * Orders API reads `notification_urls` off the order payload and documents no
 * dashboard-registered fallback — can only notify a merchant whose credentials
 * carry that URL. Nothing in this package could supply it: the address is a
 * merchant-addressed route on the HOST's public origin, which the package must
 * never learn to build.
 *
 * Leaving it to each host to remember is what produced the bug this exists to
 * stop: `notificationUrl` was in no `credentialSchema` and in no OAuth field
 * copy, so every tenant order went out with nowhere to be notified, and
 * confirmation silently fell to whatever polling the host happened to have.
 *
 * So the package owns the wiring and the host owns only the one thing it
 * alone knows — how to turn a merchant into a URL. Same split as
 * `failoverPolicyFor` and `setupContextFor`.
 */

/**
 * Resolve the webhook URL a merchant's charges must announce, or null when the
 * host cannot address this merchant (an unresolvable id, a provider it does not
 * route). Returning null leaves the credentials untouched rather than failing
 * the charge — a charge that cannot be notified about is still better than a
 * charge that never happens.
 */
export type MerchantWebhookUrlResolver = (
  merchant: MerchantRef,
  provider: ProviderName,
) => Promise<string | null>;

/**
 * Decorate a {@link CredentialStore} so resolved credentials carry the
 * merchant's own webhook URL.
 *
 * Resolved PER READ rather than stored on the connection: the address belongs
 * to the deployment, not to the merchant, so a renamed merchant or a moved
 * domain must not leave a stale URL baked into a credential row that keeps
 * being announced long after it stopped answering.
 *
 * The RESOLVER wins over anything stored on the row — see
 * {@link withResolvedUrlField}.
 */
export function withMerchantWebhookUrl(
  inner: CredentialStore,
  resolve: MerchantWebhookUrlResolver,
): CredentialStore {
  return withResolvedUrlField(inner, 'notificationUrl', resolve);
}

/**
 * Decorate a {@link CredentialStore} so resolved credentials carry where a
 * hosted checkout must send the BUYER back.
 *
 * The same split as the webhook URL, for the same reason, and it was missing in
 * the same way: `redirect_url` is read off the credentials when an InfinitePay
 * link is minted, but the field was in no `credentialSchema` and populated
 * nowhere, so every link ever created went out with none. A shopper who paid
 * landed on InfinitePay's receipt and stayed there — the store's tab, which
 * polls for confirmation, had already been navigated away from.
 *
 * Only hosted-checkout providers read it; for everyone else the extra field is
 * inert, which is why this stamps unconditionally rather than asking the
 * adapter.
 */
export function withMerchantRedirectUrl(
  inner: CredentialStore,
  resolve: MerchantWebhookUrlResolver,
): CredentialStore {
  return withResolvedUrlField(inner, 'redirectUrl', resolve);
}

/**
 * Stamp ONE host-resolved URL field onto resolved credentials.
 *
 * The RESOLVER wins; a stored value is the FALLBACK for a merchant it cannot
 * address. That order used to be the other way round, and reversing it is what
 * makes the paragraph above true rather than aspirational:
 *
 *  - "the address belongs to the deployment, not to the merchant" and "a moved
 *    domain must not leave a stale URL baked into a credential row" are both
 *    denials of a stored value out-ranking the live one. A row that wins keeps
 *    being announced long after it stopped answering, which is the exact
 *    failure the per-read resolution exists to prevent.
 *  - the escape hatch it was protecting is not lost, it moves to where it
 *    belongs: the resolver is the HOST's own function. A deployment whose
 *    routing differs says so in code, once, instead of through a value in a
 *    tenant-writable blob.
 *  - and that blob is writable. Until FUT-694 the settings body could name
 *    `notificationUrl` outright; every row that went through that hole still
 *    holds one, and stored-wins is what kept those rows pointing a store's
 *    callbacks wherever they were pointed — a fix that only blocks NEW writes
 *    leaves the old ones live forever. With the resolver on top they are inert
 *    the moment this ships, on every deployment, with no migration.
 *
 * A resolver that answers null leaves the credentials untouched rather than
 * failing the charge: a charge that cannot be notified about, or cannot return
 * the buyer, is still better than a charge that never happens. That is also the
 * PLATFORM merchant's permanent answer — it has no tenant-addressed route and
 * no storefront — so its stamped `notificationUrl`, the one the host writes
 * through `saveCredentials`, is exactly the case the fallback serves.
 */
function withResolvedUrlField(
  inner: CredentialStore,
  field: 'notificationUrl' | 'redirectUrl',
  resolve: MerchantWebhookUrlResolver,
): CredentialStore {
  return {
    ...inner,
    async getCredentials(merchant, provider) {
      const resolved = await inner.getCredentials(merchant, provider);
      if (!resolved) return resolved;

      const url = await resolve(merchant, provider);
      if (!url) return resolved;
      return { ...resolved, fields: { ...resolved.fields, [field]: url } };
    },
  };
}
