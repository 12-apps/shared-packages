import type { CredentialStore } from './ports';
import type { MerchantRef, ProviderName, ResolvedCredentials } from './types';

/**
 * Stamp the platform's CURRENT webhook signing secret onto resolved
 * credentials — `webhook-url.ts`'s combinator pattern, applied to the one
 * secret a merchant's stored row cannot be trusted to keep fresh (FUT-690).
 *
 * Connect deliveries are signed with the PLATFORM's endpoint secret, so
 * `tokensToFields` (`providers/stripe-http.ts`) copies it into the merchant's
 * fields at connect time — without that copy an OAuth-connected store could
 * not verify its own deliveries at all. But the copy is a SNAPSHOT: rotate
 * the endpoint secret in the provider dashboard and every already-connected
 * store keeps comparing against the old value, so every delivery is refused —
 * silently, BEFORE the durable inbox, leaving no row and no replay — until
 * each store individually reconnects.
 *
 * So the host stamps the live value at RESOLVE time, exactly as
 * `withMerchantWebhookUrl` stamps `notificationUrl`: the secret belongs to
 * the deployment, not to the merchant row, and the resolver — the host's own
 * code — wins over any stale stored copy of `platformWebhookSecret`. Adapters
 * read the stamped field BESIDE the merchant's own `webhookSecret` and accept
 * a signature under either, so deliveries signed by the outgoing secret keep
 * verifying through the roll and stores connected before the rotation keep
 * verifying after it.
 *
 * Provider-agnostic like the URL combinators, and for the same reason: "the
 * platform's webhook signing secret" is a fact about any Connect-style
 * provider, the resolver receives the provider name so a host answers per
 * provider (null for the ones with no platform endpoint), and the field is
 * inert for adapters that never read it — which is why this stamps through a
 * resolver rather than asking the adapter.
 *
 * Unlike the URL combinators this must ALSO decorate the listening reads:
 * webhook verification resolves credentials through `listListeningCredentials`
 * / `getConnectedCredentials` (falling back to `getCredentials`), and a stamp
 * only on the charging read would miss the exact path the secret exists for.
 * It only wraps the optional methods the inner store implements — ADDING
 * `listListeningCredentials` to a store that lacks it would silently switch
 * the pipeline onto the multi-candidate path.
 */
export type PlatformWebhookSecretResolver = (
  merchant: MerchantRef,
  provider: ProviderName,
) => Promise<string | null>;

export function withPlatformWebhookSecret(
  inner: CredentialStore,
  resolve: PlatformWebhookSecretResolver,
): CredentialStore {
  const stampAll = async (
    merchant: MerchantRef,
    provider: ProviderName,
    resolved: ResolvedCredentials[],
  ): Promise<ResolvedCredentials[]> => {
    if (resolved.length === 0) return resolved;
    const secret = await resolve(merchant, provider);
    // A null answer leaves the credentials untouched (any stored copy stays
    // the fallback), same degradation rule as an unaddressable merchant in
    // `withMerchantWebhookUrl`.
    if (!secret) return resolved;
    return resolved.map((set) => ({
      ...set,
      fields: { ...set.fields, platformWebhookSecret: secret },
    }));
  };
  const stampOne = async (
    merchant: MerchantRef,
    provider: ProviderName,
    resolved: ResolvedCredentials | null,
  ): Promise<ResolvedCredentials | null> => {
    if (!resolved) return resolved;
    const [stamped] = await stampAll(merchant, provider, [resolved]);
    return stamped ?? resolved;
  };

  const getConnected = inner.getConnectedCredentials?.bind(inner);
  const listListening = inner.listListeningCredentials?.bind(inner);
  return {
    ...inner,
    async getCredentials(merchant, provider) {
      return stampOne(merchant, provider, await inner.getCredentials(merchant, provider));
    },
    ...(getConnected
      ? {
          async getConnectedCredentials(merchant: MerchantRef, provider: ProviderName) {
            return stampOne(merchant, provider, await getConnected(merchant, provider));
          },
        }
      : {}),
    ...(listListening
      ? {
          async listListeningCredentials(merchant: MerchantRef, provider: ProviderName) {
            return stampAll(merchant, provider, await listListening(merchant, provider));
          },
        }
      : {}),
  };
}
