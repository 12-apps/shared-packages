import { CredentialsError, UnsupportedOperationError } from './errors';
import { isPermanentProviderRefusal } from './error-readers';
import { cardProviderFor } from './method-head';
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
    providerChain(merchant: MerchantRef): Promise<string[]>;
    defaultProvider(merchant: MerchantRef): Promise<string | null>;
    getCredentials(merchant: MerchantRef, provider: string): Promise<ResolvedCredentials | null>;
  };
}

type VaultingAdapter = PaymentProviderAdapter & {
  vault: NonNullable<PaymentProviderAdapter['vault']>;
};

/**
 * Resolve the merchant's CARD provider and prove it can vault.
 *
 * Pinned to ONE provider with no failover, and the reason is the same one
 * `core/card-instrument.ts` documents: an instrument minted at provider #2 is
 * garbage input to the provider we actually collect through. Vaulting
 * "wherever works" would succeed on the screen and fail months later on a
 * timer, with the tenant long gone.
 *
 * That provider is the first link that takes a CARD (`method-head.ts`), not
 * the chain head (FUT-3138): a head that takes no card (a PIX-only acquirer,
 * the store's own Pix key) never charges one, so a card vaulted there — or a
 * refusal to vault at all — is wrong for every buyer of a store whose cards
 * go to the next link.
 */
export async function activeVault(
  config: VaultConfig,
  merchant: MerchantRef,
): Promise<{ adapter: VaultingAdapter; creds: ResolvedCredentials }> {
  const name = await cardProviderFor(config, merchant);
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

/** One saved-card pointer a host holds — the handle on a provider-side vault entry. */
export interface VaultPointerRef {
  provider: string;
  instrumentId: string;
  customerRef?: string | null;
}

/**
 * Detach EVERY pointer a merchant holds, not the one on a screen — a card can
 * live at yesterday's acquirer as well as today's, and removing only the
 * visible one leaves a card on file the owner believes is gone, chargeable
 * again the day someone switches acquirer back (ported from the first
 * adopting host, FUT-760).
 *
 * Provider first, pointer second: the host's row holds the ONLY handle on the
 * vault entry, so `dropPointer` runs after the detach — a failed detach with
 * the row already gone would strand a stored card nothing can ever reach.
 *
 * When the provider will not co-operate, the pointer is dropped anyway UNLESS
 * a retry could plausibly fix it by itself. A permanent refusal — no detach
 * support, a disconnected acquirer, a rejected id — drops the pointer and
 * accepts residue at the provider's end, because it is the pointer that makes
 * a charge possible and the owner asked to stop being charged. A RETRIABLE
 * failure answers `{ ok: false }` instead: clicking again in ten seconds
 * genuinely works, and losing the handle costs more than a second click.
 * Anything that is not the provider's own verdict also stops the loop — a
 * bug on this side of the seam is never permission to delete a payment
 * record.
 */
export async function forgetVaultPointers(
  gateway: {
    forgetVault: (
      merchant: MerchantRef,
      provider: string,
      input: { instrumentId: string; customerRef?: string },
    ) => Promise<void>;
  },
  merchant: MerchantRef,
  pointers: readonly VaultPointerRef[],
  dropPointer: (pointer: VaultPointerRef) => Promise<void>,
): Promise<{ ok: boolean }> {
  for (const pointer of pointers) {
    try {
      await gateway.forgetVault(merchant, pointer.provider, {
        instrumentId: pointer.instrumentId,
        customerRef: pointer.customerRef ?? undefined,
      });
    } catch (error) {
      if (!isPermanentProviderRefusal(error)) return { ok: false };
    }
    // Reached on a clean detach and on a refusal judged permanent — in both
    // cases the provider is not going to hold this card for us.
    await dropPointer(pointer);
  }
  return { ok: true };
}
