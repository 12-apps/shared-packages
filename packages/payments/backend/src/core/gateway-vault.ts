import { CredentialsError, UnsupportedOperationError } from './errors';
import type { PaymentProviderAdapter } from './provider';
import type { MerchantRef, ResolvedCredentials } from './types';

/**
 * The gateway's card-vaulting methods.
 *
 * Split out of `gateway.ts`, which had already factored this block into its own
 * function "to keep the gateway builder in budget" and has since reached the
 * same ceiling as a FILE. Nothing here changed in the move.
 */

/** The slice of the gateway config this module needs. */
interface VaultConfig {
  providers: {
    has(name: string): boolean;
    get(name: string): PaymentProviderAdapter;
  };
  credentials: {
    defaultProvider(merchant: MerchantRef): Promise<string | null>;
    getCredentials(merchant: MerchantRef, provider: string): Promise<ResolvedCredentials | null>;
  };
}

type VaultingAdapter = PaymentProviderAdapter & {
  vault: NonNullable<PaymentProviderAdapter['vault']>;
};

/**
 * Resolve the merchant's ACTIVE provider and prove it can vault.
 *
 * Pinned to the chain head with no failover, and the reason is the same one
 * `core/card-instrument.ts` documents: an instrument minted at provider #2 is
 * garbage input to the provider we actually collect through. Vaulting
 * "wherever works" would succeed on the screen and fail months later on a
 * timer, with the tenant long gone.
 */
export async function activeVault(
  config: VaultConfig,
  merchant: MerchantRef,
): Promise<{ adapter: VaultingAdapter; creds: ResolvedCredentials }> {
  const name = await config.credentials.defaultProvider(merchant);
  if (!name || !config.providers.has(name)) {
    throw new CredentialsError(
      name ?? 'none',
      `No payment provider configured for ${merchant.kind}:${merchant.id}`,
    );
  }
  const adapter = config.providers.get(name);
  if (!adapter.vault) throw new UnsupportedOperationError(adapter.name, 'card vaulting');
  const creds = await config.credentials.getCredentials(merchant, name);
  if (!creds) {
    throw new CredentialsError(
      name,
      `Provider ${name} is not connected for ${merchant.kind}:${merchant.id}`,
    );
  }
  return { adapter: adapter as VaultingAdapter, creds };
}

/** Detach a saved instrument at a NAMED provider. */
export async function forgetVaultAt(
  config: VaultConfig,
  merchant: MerchantRef,
  provider: string,
  input: Parameters<NonNullable<NonNullable<PaymentProviderAdapter['vault']>['forget']>>[0],
): Promise<void> {
  // NAMED provider, not the chain head — the one asymmetry between saving a
  // card and un-saving one. A vault id belongs to the provider that minted it,
  // so after an acquirer switch the card to detach lives at yesterday's
  // provider while `beginVault` correctly pins to today's. Resolving the active
  // one here would send a `pm_` to an acquirer that has never heard of it and
  // call the resulting 404 a removal.
  const adapter = config.providers.get(provider);
  const forget = adapter.vault?.forget;
  if (!forget) throw new UnsupportedOperationError(adapter.name, 'forgetting a saved card');
  const creds = await config.credentials.getCredentials(merchant, provider);
  if (!creds) {
    throw new CredentialsError(
      provider,
      `Provider ${provider} is not connected for ${merchant.kind}:${merchant.id}`,
    );
  }
  await forget(input, creds);
}
