import type { PaymentProviderAdapter } from '../core/provider';
import type { ConnectedOAuthAccount, StoredProviderConfig } from './types';

/**
 * The connected account's IDENTITY, read out of the stored OAuth fields
 * (FUT-300).
 *
 * The OAuth flow lands the provider's answer to "who just authorized" in the
 * same per-environment field blob the tokens live in — PagBank's exchange
 * stores `accountId` and `scope` beside the access token, and the connect
 * service stamps `connectedAt`. The masking layer only ever echoed
 * `credentialSchema` keys, so none of it reached the client and a connected
 * store could say no more than "configured". This module is the one place
 * those identity keys are copied out; everything else in the blob stays
 * sealed behind the mask.
 */

/**
 * The field keys the OAuth flow RESERVES for identity facts. Adapters that
 * learn more at exchange time (e.g. an `accounts.read` enrichment) publish it
 * by storing these keys; nothing else in the blob is ever surfaced.
 */
const OAUTH_IDENTITY_FIELDS = ['accountId', 'accountLabel', 'scope', 'connectedAt'] as const;

/**
 * Carry the identity keys through a token refresh whose response omits them.
 *
 * A refresh does not change WHO is connected — it renews the same grant — but
 * `refresh` replaces the whole field blob with what the adapter returned, and
 * an adapter that answers with tokens alone would silently erase the identity
 * recorded at connect time. Fresh values win: `next` is spread last.
 */
export function preserveIdentityFields(
  previous: Record<string, string>,
  next: Record<string, string>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const key of OAUTH_IDENTITY_FIELDS) {
    const value = previous[key];
    if (value) kept[key] = value;
  }
  return { ...kept, ...next };
}

/**
 * Scopes arrive as ONE string in whatever join the provider chose — OAuth2
 * says space, PagBank's authorize URL uses `+`, and a comma shows up in the
 * wild — so split on all three rather than guessing per vendor.
 */
function splitScopes(scope: string | undefined): string[] {
  if (!scope) return [];
  return scope.split(/[\s+,]+/).filter(Boolean);
}

/** A present, non-empty field value — or null, never the empty string. */
function valueOrNull(value: string | undefined): string | null {
  return value ? value : null;
}

/** Whether the summary says anything at all — an all-null one is withheld. */
function hasIdentity(account: ConnectedOAuthAccount): boolean {
  if (account.grantedScopes.length > 0) return true;
  return Boolean(account.accountId ?? account.accountLabel ?? account.connectedAt);
}

/**
 * Build the client-safe account summary for one connection, or null when
 * there is nothing to say.
 *
 * Gated on `authMode: 'oauth'` deliberately: for a credentials-mode provider
 * the blob holds PASTED SECRETS keyed by its own schema, and a schema that
 * happened to name a field `accountId` would see its value echoed unmasked.
 * Only the OAuth flow writes the reserved identity keys, so only it is read.
 */
export function connectedAccountFrom(
  adapter: PaymentProviderAdapter,
  config: StoredProviderConfig,
): ConnectedOAuthAccount | null {
  if ((adapter.authMode ?? 'credentials') !== 'oauth') return null;
  const fields = config.environments[config.environment] ?? {};
  const account: ConnectedOAuthAccount = {
    accountId: valueOrNull(fields['accountId']),
    accountLabel: valueOrNull(fields['accountLabel']),
    grantedScopes: splitScopes(fields['scope']),
    connectedAt: valueOrNull(fields['connectedAt']),
  };
  return hasIdentity(account) ? account : null;
}
