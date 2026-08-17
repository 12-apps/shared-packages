import type { MerchantRef, ProviderName } from '../core/types';

import type { MerchantSettingsView, ProviderConfigStore } from './types';

/**
 * Move ONE enabled provider to the head of a merchant's failover chain,
 * keeping the rest in their current relative order — the "make this the
 * active one" verb every settings screen wants, expressed through the same
 * reorder-only validation `setPriorities` runs (so a name outside the
 * merchant's enabled set is refused there, not silently appended).
 *
 * A standalone seam rather than a service method on purpose: it composes two
 * things the caller already holds — the store's raw rows for the current
 * order, the service for the validated write — and adding it to the factory
 * would grow a closure that is at its size budget for one line of algebra.
 */
export async function promoteProvider(
  settings: { setPriorities(merchant: MerchantRef, ordered: readonly ProviderName[]): Promise<MerchantSettingsView> },
  store: Pick<ProviderConfigStore, 'list'>,
  merchant: MerchantRef,
  provider: ProviderName,
): Promise<MerchantSettingsView> {
  const rows = await store.list(merchant);
  const chain = rows
    .filter((row) => row.enabled)
    .sort((a, b) => a.priority - b.priority)
    .map((row) => row.provider);
  return settings.setPriorities(merchant, [provider, ...chain.filter((name) => name !== provider)]);
}
