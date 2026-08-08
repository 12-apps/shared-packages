import type { MerchantRef, ProviderName, ResolvedCredentials } from './types';

/**
 * The credential-resolution port — moved out of `core/ports.ts` when the
 * FUT-678 listening read pushed that file past its size gate (the same split
 * `charge-queries.ts` made), and re-exported from there because `core/ports.ts`
 * is the one door every storage port has ever come through.
 *
 * Resolves which provider a merchant uses and its decrypted credentials.
 * This port is where the two money directions meet one code path: for
 * `kind: 'TENANT'` the host reads the tenant's connected-account row (the
 * existing `PaymentIntegration` table pattern); for `kind: 'PLATFORM'` it
 * reads the platform's own account (env/config). Encryption-at-rest is the
 * host's job — the core only ever sees decrypted fields, per call.
 */
export interface CredentialStore {
  /**
   * The merchant's enabled providers in FAILOVER ORDER — index 0 is tried
   * first. Empty when payments are off.
   *
   * This is the authoritative routing input; `defaultProvider` is just its
   * head, kept for the single-provider callers (client tokenization config,
   * "are payments configured at all" checks) that have no notion of a chain.
   */
  providerChain(merchant: MerchantRef): Promise<ProviderName[]>;
  /** The first provider in the chain, or null when payments are off. */
  defaultProvider(merchant: MerchantRef): Promise<ProviderName | null>;
  /**
   * Decrypted credentials for (merchant, provider), or null if not connected.
   *
   * For CHARGING: it refuses a provider that is connected but not enabled,
   * because enablement is what routing means.
   */
  getCredentials(merchant: MerchantRef, provider: ProviderName): Promise<ResolvedCredentials | null>;
  /**
   * Decrypted credentials for LISTENING to a provider — inbound webhooks and
   * reconciliation — ignoring whether it is enabled.
   *
   * Charging and listening are not the same question, and conflating them
   * loses money. Enablement decides where a NEW charge is routed. A delivery is
   * about money that has ALREADY moved, and the provider's willingness to tell
   * us has nothing to do with whether the owner currently wants new orders
   * going there.
   *
   * Two failures came from the single gate:
   *
   *   - the ACTIVATION charge (FUT-463) is paid while the provider is by
   *     definition NOT yet enabled — enabling is what the charge earns — so
   *     its confirmation was rejected before `webhook.verify` could run;
   *   - an owner pausing a provider with a PIX still outstanding had every
   *     inbound notification for it refused, and those orders never confirmed.
   *
   * Neither left a trace: verification precedes the inbox, so a delivery
   * refused here is never recorded.
   *
   * Optional — a host that does not implement it keeps the old behaviour.
   */
  getConnectedCredentials?(merchant: MerchantRef, provider: ProviderName): Promise<ResolvedCredentials | null>;
  /**
   * EVERY credential set an inbound delivery may authenticate against —
   * the active environment's first, then any other environment that holds
   * credentials. Empty when the provider is not connected at all.
   *
   * Exists because listening cannot assume the ACTIVE environment signed the
   * delivery (FUT-678). A store flipped SANDBOX→PRODUCTION still has sandbox
   * deliveries in flight — the provider redelivers for days — and verification
   * runs BEFORE the durable inbox, so a delivery refused for being signed
   * with last week's secret is not parked, it is GONE: no row, no replay, no
   * trace, and the order settles only if a reconciliation sweep happens to
   * rescue it. The webhook pipeline therefore tries `webhook.verify` against
   * each set in order and runs `parse` under the one that verified.
   *
   * Ordering is part of the contract: index 0 is the active environment, so
   * a delivery valid under both (a provider that reuses secrets) resolves to
   * the active one. Like `getConnectedCredentials`, this ignores enablement —
   * listening is not routing.
   *
   * Optional — a host without it keeps single-set verification through
   * `getConnectedCredentials` / `getCredentials`.
   */
  listListeningCredentials?(merchant: MerchantRef, provider: ProviderName): Promise<ResolvedCredentials[]>;
}
