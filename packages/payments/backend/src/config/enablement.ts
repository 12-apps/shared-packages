import { UnprovenProviderError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import type { MerchantRef, PaymentEnvironment, ProviderName } from '../core/types';

import type { PendingVerification, ProviderConfigStore, StoredProviderConfig } from './types';

/**
 * Everything that decides whether a provider is IN the failover chain.
 *
 * Lifted out of `service.ts` as one piece because the three functions here are
 * a single rule with three moving parts — what may be enabled, how the chain is
 * rewritten, and which door does the writing — and reading any of them alone
 * invites reintroducing the hole they close (FUT-463).
 */

/**
 * Refuse to enable a provider that has never charged — where charging is
 * actually possible for it.
 *
 * The capability check is not a loophole, it is what keeps the rule honest: an
 * adapter with no browser tokenization cannot produce `chargeVerifiedAt` by any
 * route, so requiring it would not make that provider's "Ativo" mean more, it
 * would make the provider permanently unactivatable. That is not hypothetical —
 * gating on the charge indiscriminately bricked three adapters at once.
 */
export function requireProven(
  adapter: PaymentProviderAdapter,
  config: StoredProviderConfig,
): void {
  if (adapter.capabilities.activationCharge !== true) return;
  if (!config.chargeVerifiedAt) throw new UnprovenProviderError(config.provider);
}

/**
 * Add or remove ONE provider from the chain.
 *
 * The new chain is deliberately NOT computed here. Reading the current chain in
 * this process and posting the result back would let two overlapping toggles
 * each start from the same snapshot and each write one missing the other's
 * change — silently flipping a provider the admin never touched. The store does
 * the read and the write in one transaction instead; this function only ensures
 * the row exists first, then re-reads to report the result.
 */
export async function toggleInChain(
  store: ProviderConfigStore,
  merchant: MerchantRef,
  config: StoredProviderConfig,
  enabled: boolean,
): Promise<StoredProviderConfig> {
  // Make sure the row exists before the rewrite — enabling a provider that
  // was never saved must still work. It is created DISABLED, so this write
  // can never momentarily collide on the rank index.
  if (!(await store.get(merchant, config.provider))) {
    await store.save(merchant, { ...config, enabled: false });
  }
  await store.setProviderEnabled(merchant, config.provider, enabled);
  // Report what the store actually landed on, not what we assumed it would.
  return (await store.get(merchant, config.provider)) ?? config;
}

/**
 * Apply the outcome of a REAL verification charge to a loaded config: stamp
 * the proof, clear the outstanding charge, PERSIST both, then settle chain
 * membership. The third door of the rule this file owns — `requireProven`
 * demands the stamp, `toggleInChain` moves the chain, this is what writes it.
 *
 * The `save` is the load-bearing line. `toggleInChain` persists only
 * enablement and rank (its one `save` covers a provider never saved at all),
 * so for an existing config — the normal case: configured first, proven later
 * — the stamp used to live on this in-memory object and die with it. In
 * production that meant a webhook-confirmed activation payment answered
 * `processed` and stamped nothing, on every path that ends here.
 */
export async function applyProof(
  store: ProviderConfigStore,
  merchant: MerchantRef,
  config: StoredProviderConfig,
  passed: boolean,
): Promise<StoredProviderConfig> {
  if (passed && !config.chargeVerifiedAt) config.chargeVerifiedAt = new Date();
  // Cleared either way — a refused charge must not leave the screen waiting.
  config.pendingVerification = null;
  await store.save(merchant, config);
  return toggleInChain(store, merchant, config, passed);
}

/**
 * Reading and writing the activation charge a connection has OUTSTANDING.
 *
 * Both live here rather than inline in the service so that function stays
 * inside its size budget, and both are deliberately separate from
 * `applyChargeVerification`: minting a charge settles nothing, and treating
 * the two as one event is what let a paid charge and an unpaid one look
 * identical to the screen.
 *
 * The read exists at all because the flow sends the owner away to the
 * provider's site to pay — "they left and came back" is the normal path, and
 * an attempt that did not survive it got charged for twice.
 */
export function pendingVerificationMethods(
  store: ProviderConfigStore,
  load: (merchant: MerchantRef, provider: ProviderName) => Promise<StoredProviderConfig>,
) {
  return {
    async getPendingVerification(
      merchant: MerchantRef,
      provider: ProviderName,
    ): Promise<PendingVerification | null> {
      const config = await store.get(merchant, provider);
      return config?.pendingVerification ?? null;
    },
    async setPendingVerification(
      merchant: MerchantRef,
      provider: ProviderName,
      pending: PendingVerification | null,
    ): Promise<void> {
      const config = await load(merchant, provider);
      config.pendingVerification = pending;
      await store.save(merchant, config);
    },
  };
}

/**
 * The active environment's decrypted fields, for whichever question asked.
 *
 * `stub` is DECIDED here, not read: the column says what the row was written
 * with, and a row outlives the deployment that wrote it. A dev dump restored
 * into staging, a demo tenant seeded on a shared database, or a host whose
 * stub inference flipped when an unrelated credential appeared all leave
 * `stub=true` rows behind — and on the read path that flag is what makes an
 * unsigned webhook delivery authenticate. So the deployment's own answer
 * (`allowStubMode`, from `resolveStubMode`) is required on every resolve, and
 * PRODUCTION credentials are excluded even when the answer is yes.
 */
export function resolvedFrom(config: StoredProviderConfig, allowStubMode: boolean) {
  const environment: PaymentEnvironment = config.environment;
  return {
    environment,
    fields: config.environments[environment],
    stub: allowStubMode && config.stub && environment === 'SANDBOX',
  };
}
