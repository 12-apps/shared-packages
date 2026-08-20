import type { PaymentEnvironment, ResolvedCredentials } from '../core/types';

import type { OAuthAppCredentialsResolver } from './oauth';

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
  const extras = options.extras ?? DEFAULT_OAUTH_APP_EXTRAS;

  return (provider, environment): ResolvedCredentials | null => {
    const prefix = provider.toUpperCase();
    const suffix = suffixOf(environment);

    // STRICT — no unsuffixed fallback. See the module doc for what a fallback
    // would authorize.
    const clientId = env[`${prefix}_OAUTH_CLIENT_ID${suffix}`];
    const clientSecret = env[`${prefix}_OAUTH_CLIENT_SECRET${suffix}`];
    if (!clientId || !clientSecret) return null;

    const fields: Record<string, string> = { clientId, clientSecret };
    for (const [name, field] of Object.entries(extras)) {
      const value = env[`${prefix}_${name}${suffix}`] ?? env[`${prefix}_${name}`];
      if (value) fields[field] = value;
    }
    return { environment, fields };
  };
}
