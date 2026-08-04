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
 * A `notificationUrl` already present in the stored fields WINS — that is a
 * merchant's explicit override, and silently replacing it would take away the
 * only escape hatch for a host whose routing differs.
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
 * An existing value always WINS — that is a merchant's explicit override, and
 * silently replacing it would take away the only escape hatch for a host whose
 * routing differs. A resolver that answers null leaves the credentials
 * untouched rather than failing the charge: a charge that cannot be notified
 * about, or cannot return the buyer, is still better than a charge that never
 * happens.
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
      if (!resolved || resolved.fields[field]) return resolved;

      const url = await resolve(merchant, provider);
      if (!url) return resolved;
      return { ...resolved, fields: { ...resolved.fields, [field]: url } };
    },
  };
}
