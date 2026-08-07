/**
 * How a merchant CONNECTS a provider:
 *
 *   credentials  the merchant pastes API keys into a form (PagBank token,
 *                Stripe secret key) — the shape `credentialSchema` describes
 *   oauth        the merchant clicks "connect" and authorizes the platform
 *                on the provider's own site (Stripe Connect, PagBank
 *                Connect); the platform holds application-level client
 *                credentials and stores per-merchant tokens that EXPIRE
 *
 * An adapter may support both — OAuth as the happy path with manual token
 * entry as a fallback. Adapters that omit `authMode` are `credentials`.
 */
export type ProviderAuthMode = 'credentials' | 'oauth';

/** Where to send the merchant to authorize, plus the CSRF state to echo. */
export interface OAuthAuthorizeRequest {
  url: string;
  state: string;
}

/**
 * Tokens returned by an OAuth exchange or refresh. `expiresAt` is what makes
 * proactive refresh possible — it is stored in its own queryable column, not
 * buried in the encrypted blob.
 */
export interface OAuthTokens {
  fields: Record<string, string>;
  expiresAt?: Date | null;
}
