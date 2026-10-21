import type { PaymentEnvironment, ResolvedCredentials } from '../core/types';

import type { OAuthAppCredentialsResolver } from './oauth';
import type { ProviderName } from '../core/types';
import type { CredentialStore } from '../core/ports';
import { withPlatformWebhookSecret, type PlatformWebhookSecretResolver } from '../core/webhook-secret';

/**
 * The platform's OAuth APPLICATION credentials, read from the environment
 * (ported from the first adopting host, FUT-760).
 *
 * {@link OAuthAppCredentialsResolver} is a port because a host may keep these
 * anywhere — a vault, a config table, a secret manager. But the overwhelmingly
 * common answer is "environment variables", and the two rules that make that
 * answer SAFE are not obvious enough to re-derive per host. So the port stays
 * and this is the implementation a host can just use.
 *
 * ## The naming convention
 *
 * ```
 * {PROVIDER}_OAUTH_CLIENT_ID          {PROVIDER}_OAUTH_CLIENT_ID_PROD
 * {PROVIDER}_OAUTH_CLIENT_SECRET      {PROVIDER}_OAUTH_CLIENT_SECRET_PROD
 * ```
 *
 * Sandbox is the UNSUFFIXED name and production carries `_PROD`, because a
 * provider issues a separate application per environment — different client id,
 * different secret — and a deployment that has gone live still needs its
 * sandbox application to test against.
 *
 * ## The two rules
 *
 * **The id/secret pair is looked up STRICTLY.** Production never falls back to
 * the sandbox names. A fallback would let a missing `_PROD` variable authorize
 * a merchant against the SANDBOX application and store the result as a LIVE
 * grant — a connection that looks real, belongs to a test application, and
 * fails only when money moves. Failing closed produces an honest "not
 * configured" instead, and the settings page then offers the credential form
 * rather than a dead connect button.
 *
 * **The extras DO fall back** to the unsuffixed name. A scope list is usually
 * identical across environments while a webhook secret is not, so a deployment
 * can set one shared value and override only what actually differs.
 */

/**
 * Extra PLATFORM-level fields an adapter copies into a merchant's row when the
 * connect completes, keyed by the env-var suffix that supplies them.
 *
 * The webhook entries are the load-bearing ones: an OAuth-connected merchant
 * never registers its own endpoint — Connect deliveries are signed with the
 * PLATFORM's secret — so without these a connected merchant could not verify a
 * single notification.
 *
 * `accountToken` is load-bearing for a different reason: a provider's token
 * endpoint may want the partner's own account token in an `Authorization:
 * Bearer` header ON TOP OF the application's id/secret pair. Without it every
 * exchange dies as `401 invalid_token`, which reads as a credential problem and
 * sends you auditing the id/secret — the one place the fault is not.
 */
export const DEFAULT_OAUTH_APP_EXTRAS: Readonly<Record<string, string>> = {
  OAUTH_SCOPE: 'scope',
  WEBHOOK_SECRET: 'webhookSecret',
  WEBHOOK_TOKEN: 'webhookToken',
  TOKEN: 'accountToken',
};

export interface EnvOAuthAppOptions {
  /**
   * Override the extra fields read per provider. Defaults to
   * {@link DEFAULT_OAUTH_APP_EXTRAS}; pass `{}` for id and secret only.
   */
  extras?: Readonly<Record<string, string>>;
}

/** `_PROD` on production, nothing on sandbox — see the module doc. */
function suffixOf(environment: PaymentEnvironment): string {
  return environment === 'PRODUCTION' ? '_PROD' : '';
}

/** What {@link envOAuthAppValues} found: the values, and which came from a fallback. */
export interface OAuthAppValues {
  values: Record<string, string>;
  /**
   * Fields read from the UNSUFFIXED name for a production lookup (extras fall
   * back — see the module doc). An operator looking at `PAGBANK_TOKEN_PROD`
   * must be told it is unset and the sandbox-or-shared value is standing in.
   */
  inherited: string[];
}

/**
 * Every value the naming convention finds for one provider and environment —
 * the same lookup as {@link envOAuthAppCredentials}, WITHOUT its strict refusal.
 *
 * Only for showing an operator what is set: a half-set pair (an id with no
 * secret) resolves to `null` above, which is right for authorizing and useless
 * for diagnosing — this reports the half that is there. Never hand its result
 * to anything that authorizes.
 */
export function envOAuthAppValues(
  env: Readonly<Record<string, string | undefined>>,
  options: EnvOAuthAppOptions = {},
): (provider: string, environment: PaymentEnvironment) => OAuthAppValues {
  const extras = options.extras ?? DEFAULT_OAUTH_APP_EXTRAS;

  return (provider, environment) => {
    const prefix = provider.toUpperCase();
    const suffix = suffixOf(environment);
    const fields: Record<string, string> = {};
    const inherited: string[] = [];
    // STRICT — no unsuffixed fallback. See the module doc for what a fallback
    // would authorize.
    const clientId = env[`${prefix}_OAUTH_CLIENT_ID${suffix}`];
    const clientSecret = env[`${prefix}_OAUTH_CLIENT_SECRET${suffix}`];
    if (clientId) fields.clientId = clientId;
    if (clientSecret) fields.clientSecret = clientSecret;
    for (const [name, field] of Object.entries(extras)) {
      const own = env[`${prefix}_${name}${suffix}`];
      const value = own ?? env[`${prefix}_${name}`];
      if (!value) continue;
      fields[field] = value;
      if (own === undefined && suffix !== '') inherited.push(field);
    }
    return { values: fields, inherited };
  };
}

/**
 * Build the resolver over an environment bag.
 *
 * The bag is passed in rather than read off `process.env` here: this package
 * is framework-free and must run where there is no `process`, and a host that
 * loads its config through anything else can hand that in instead.
 */
export function envOAuthAppCredentials(
  env: Readonly<Record<string, string | undefined>>,
  options: EnvOAuthAppOptions = {},
): OAuthAppCredentialsResolver {
  const valuesOf = envOAuthAppValues(env, options);

  return (provider, environment): ResolvedCredentials | null => {
    const fields = valuesOf(provider, environment).values;
    // The pair is required; extras are not.
    if (!fields.clientId || !fields.clientSecret) return null;
    return { environment, fields };
  };
}

/**
 * The platform webhook secret a host stamps through `withPlatformWebhookSecret`,
 * read off the platform's OAuth application credentials for each candidate
 * set's environment: the app's `webhookSecret` (Stripe's endpoint secret)
 * where one is configured, else its `accountToken` — the platform ACCOUNT
 * token PagBank's notification signature is documented over (FUT-678,
 * FUT-3722). Limited to `providers`, so a host turns it on one provider at a
 * time; every other provider resolves null and its credentials pass untouched.
 */
export function oauthAppWebhookSecret(
  appCredentials: OAuthAppCredentialsResolver,
  providers: readonly ProviderName[],
): PlatformWebhookSecretResolver {
  return async (_merchant, provider, environment) => {
    if (!providers.includes(provider)) return null;
    const fields = (await appCredentials(provider, environment))?.fields;
    return fields?.['webhookSecret'] || fields?.['accountToken'] || null;
  };
}

/**
 * A {@link PlatformWebhookSecretResolver} answering one named field of the
 * platform's OAuth application credentials, per environment — for a provider
 * whose signing secret may be an app field other than its webhook secret
 * (PagBank's `clientSecret`, FUT-3722). Limited to `providers`.
 */
export function oauthAppField(
  appCredentials: OAuthAppCredentialsResolver,
  providers: readonly ProviderName[],
  field: string,
): PlatformWebhookSecretResolver {
  return async (_merchant, provider, environment) => {
    if (!providers.includes(provider)) return null;
    return (await appCredentials(provider, environment))?.fields?.[field] || null;
  };
}

/**
 * Stamp every secret a Connect delivery may be signed with, read off the
 * platform's OAuth application credentials per environment, for the providers
 * named: `platformWebhookSecret` (`oauthAppWebhookSecret`) and
 * `platformClientSecret` (the app's `clientSecret`). One call for a host, so
 * the composition lives here rather than in every host (FUT-3722).
 */
export function withOAuthAppSigningSecrets(
  inner: CredentialStore,
  appCredentials: OAuthAppCredentialsResolver,
  providers: readonly ProviderName[],
): CredentialStore {
  return withPlatformWebhookSecret(
    withPlatformWebhookSecret(inner, oauthAppWebhookSecret(appCredentials, providers)),
    oauthAppField(appCredentials, providers, 'clientSecret'),
    'platformClientSecret',
  );
}
