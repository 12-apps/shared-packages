import {
  CredentialsError,
  IrreversibleChainRemovalError,
  UnknownProviderError,
  UnprovenProviderError,
} from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import type { ProviderRegistry } from '../core/registry';
import { stubResolvedFor } from '../core/stub-mode';
import type { MerchantRef, PaymentEnvironment, ProviderName } from '../core/types';

import type { PendingVerification, ProviderConfigStore, StoredProviderConfig } from './types';

/**
 * Everything that decides whether a provider is IN the failover chain.
 *
 * Lifted out of `service.ts` as one piece because the functions here are a
 * single rule with several moving parts — what may be enabled, what may merely
 * be re-ranked, how the chain is rewritten, and which door does the writing —
 * and reading any of them alone invites reintroducing the hole they close
 * (FUT-463, and the reorder-shaped way back into it, FUT-693).
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
  if (proofMissing(adapter, config)) throw new UnprovenProviderError(config.provider);
}

/**
 * Whether the proof gate would refuse to (re-)enable this connection — the
 * predicate behind {@link requireProven}, named because the answer is also what
 * decides whether taking this provider OUT of the chain can be undone.
 */
function proofMissing(adapter: PaymentProviderAdapter, config: StoredProviderConfig): boolean {
  return adapter.capabilities.activationCharge === true && !config.chargeVerifiedAt;
}

/**
 * Why this ONE provider may not be RANKED, or nothing.
 *
 * The second half is the load-bearing one. The store writes `enabled: true` for
 * every name a chain rewrite is handed, so listing a switched-off provider used
 * to ACTIVATE it — through the one settings endpoint that applies neither gate
 * the enable switch does: the verification charge above, and the plan's
 * `payments.providers` quota the host spends on `setEnabled` (FUT-328). A drag,
 * or a bare PUT of the list, could put an unproven acquirer in front of every
 * buyer and take a store past the provider count its plan was sold with.
 *
 * So reordering RANKS; it never grants. That is not a new promise — the tool
 * that drives it has always told callers it "can only reference providers the
 * owner has already connected and enabled" — this is the first time the code
 * keeps it. A chain can therefore only shrink here, which is why no quota check
 * belongs on that path: the set being ranked is one the enable switch already
 * spent a slot on.
 *
 * The two refusals are both 409s and are still named apart, because they ask
 * the owner for different things — one for a verification charge, the other for
 * a deliberate enable that costs a plan slot. A single "not enabled" would send
 * an owner to the switch that is about to refuse them for a reason it never
 * mentioned.
 *
 * A provider already IN the chain passes untouched, proven or not. This gate is
 * on the TRANSITION, not on membership: a row enabled before `requireProven`
 * existed has to stay demotable, and demanding proof to re-rank it would pin it
 * exactly where it sits — at the head of the chain, if that is where it sits.
 * That pass is only safe because the same rewrite cannot quietly drop such a
 * row and leave it unable to come back — see {@link assertDroppable}.
 */
function assertRankable(
  adapter: PaymentProviderAdapter,
  name: ProviderName,
  config: StoredProviderConfig | null,
): void {
  if (!config) {
    throw new CredentialsError(name, `Provider ${name} is not configured for this merchant`);
  }
  if (config.enabled) return;
  requireProven(adapter, config);
  throw new CredentialsError(
    name,
    `Provider ${name} is not enabled; reordering ranks the chain and cannot enable it`,
  );
}

/**
 * Why this ONE provider may not be DROPPED from the chain BY A REWRITE — the
 * other half of `assertRankable`, and the reason that one is safe.
 *
 * `assertRankable` lets a grandfathered row (enabled, never proven — the state
 * the FUT-463 migration deliberately left every pre-existing store in) keep its
 * place in the chain. That protection lasts exactly as long as the row stays in
 * the chain. A rewrite that merely OMITS it disables it, and then both doors
 * back are shut: this endpoint now refuses to re-add it, and the enable switch
 * refuses it too, since `requireProven` is what it was grandfathered past.
 * Checkout is offline until the owner completes an activation charge they had
 * never been asked for.
 *
 * The chain rewrite is the one door where that can happen without anybody
 * deciding it. A list is a bulk statement — an agent enumerating a partial set,
 * or a client PUTting `[]` — so a provider nobody touched leaves rotation as a
 * side effect. `setEnabled(…, false)` is a statement ABOUT that provider, made
 * one at a time, in front of the owner; it stays allowed, and it is the way out
 * this refusal points at.
 *
 * So a rewrite may reorder anything, and may drop anything it could put back.
 * The one drop it will not make silently is the one it cannot undo.
 */
function assertDroppable(adapter: PaymentProviderAdapter, config: StoredProviderConfig): void {
  if (!config.enabled) return;
  if (!proofMissing(adapter, config)) return;
  throw new IrreversibleChainRemovalError(config.provider);
}

/**
 * The whole-chain verdict, and the only one `setPriorities` calls: reject a
 * rewrite we cannot apply BEFORE the atomic write runs.
 *
 * The store would refuse an unconfigured name too, but only after the
 * transaction has begun — and the error it raises names the store, not the
 * request, which is useless to the admin who just dragged the wrong provider
 * into the list.
 *
 * BOTH ends of the diff are checked, because a whole-chain rewrite says two
 * things at once: which providers are in it, and — by omission — which are out.
 * {@link assertRankable} owns the first, {@link assertDroppable} the second, and
 * neither is sound without the other: the first lets a grandfathered row stay in
 * the chain, which is worth nothing if the second lets the same call push it out
 * for good. One read of the merchant's rows answers both.
 */
export async function assertReorderOnly(
  providers: ProviderRegistry,
  store: ProviderConfigStore,
  merchant: MerchantRef,
  ordered: readonly ProviderName[],
): Promise<void> {
  const stored = new Map((await store.list(merchant)).map((c) => [c.provider, c]));
  for (const name of ordered) {
    if (!providers.has(name)) throw new UnknownProviderError(name);
    assertRankable(providers.get(name), name, stored.get(name) ?? null);
  }
  const keep = new Set<ProviderName>(ordered);
  for (const [name, config] of stored) {
    // A row whose adapter the registry no longer knows is already out of the
    // chain everywhere it is read — there is nothing to strand.
    if (keep.has(name) || !providers.has(name)) continue;
    assertDroppable(providers.get(name), config);
  }
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
    stub: stubResolvedFor(allowStubMode, config.stub, environment),
  };
}
