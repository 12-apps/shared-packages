import { CredentialsError, UnknownProviderError } from '../core/errors';
import type { CredentialStore } from '../core/ports';
import type { PaymentProviderAdapter } from '../core/provider';
import type { ProviderRegistry } from '../core/registry';
import type {
  MerchantRef,
  PaymentEnvironment,
  ProviderName,
  ProviderSetupGuide,
  SetupGuideContext,
} from '../core/types';
import type {
  MaskedFields,
  MerchantFailoverPolicy,
  MaskedProviderConfig,
  MerchantSettingsView,
  PendingVerification,
  ProviderConfigStore,
  ProviderDescriptor,
  SaveCredentialsInput,
  StoredProviderConfig,
} from './types';

import { connectedAccountFrom } from './connected-account';
import { assertSaveCredentialsInput } from './credential-input';
import {
  applyProof,
  assertReorderOnly,
  emptyConfig,
  inRotation,
  listeningSetsFrom,
  pendingVerificationMethods,
  requireProven,
  resolvedFrom,
  toggleInChain,
} from './enablement';
import { applySaveCredentials } from './save-credentials';
import { runVerify, type VerifiedProviderConfig } from './verify';

/**
 * The settings service — the server logic behind the per-provider config
 * page, provider-agnostic. Forms render from each adapter's
 * `credentialSchema`; this service owns masking, the write-only secret
 * update semantics, single-active-provider enablement, and the verify probe.
 */

export interface SettingsService {
  listProviders(): ProviderDescriptor[];
  getSettings(merchant: MerchantRef): Promise<MerchantSettingsView>;
  saveCredentials(
    merchant: MerchantRef,
    provider: ProviderName,
    input: SaveCredentialsInput,
  ): Promise<MaskedProviderConfig>;
  /**
   * Add a provider to the merchant's failover chain (appended LAST, so
   * enabling never silently outranks an established provider) or remove it.
   * Removing closes the gap so ranks stay dense.
   *
   * Enabling THROWS {@link UnprovenProviderError} unless a verification charge
   * has succeeded — see {@link applyChargeVerification}. Disabling is always
   * allowed: an owner must be able to pull a provider out of rotation
   * immediately, and a row enabled before that rule existed would otherwise be
   * stuck on.
   */
  setEnabled(merchant: MerchantRef, provider: ProviderName, enabled: boolean): Promise<MaskedProviderConfig>;
  /**
   * Settle enablement from a real verification charge (FUT-463) — the only
   * door to `enabled: true`.
   *
   * A pass stamps `chargeVerifiedAt` and joins the chain. A failure LEAVES it,
   * whatever it was before: the screen that prompted this showed a provider
   * reading `Ativo` directly above its own refusal, because a failed test had
   * no power over the state it was testing. The stamp survives that failure —
   * having once charged is history, and it is what lets an owner switch a
   * paused provider back on without re-proving it.
   */
  applyChargeVerification(
    merchant: MerchantRef,
    provider: ProviderName,
    passed: boolean,
  ): Promise<MaskedProviderConfig>;
  /** The activation charge outstanding on this connection — see `readPending`. */
  getPendingVerification(
    merchant: MerchantRef,
    provider: ProviderName,
  ): Promise<PendingVerification | null>;
  /** Record it, or clear it with null — see `writePending`. */
  setPendingVerification(
    merchant: MerchantRef,
    provider: ProviderName,
    pending: PendingVerification | null,
  ): Promise<void>;
  /**
   * Replace the whole chain in one atomic write — what drag-to-reorder calls.
   * `ordered` is the complete enabled set; anything omitted is disabled.
   *
   * It RANKS, it never grants. Naming a provider that is not already in the
   * chain is REFUSED — {@link UnprovenProviderError} when it has never charged,
   * `CredentialsError` when it is merely switched off — because enabling is
   * `setEnabled`'s job, and only that path is behind the plan's provider quota.
   * See `assertRankable`.
   *
   * Omitting one is how a provider leaves the chain, with one exception: a row
   * that could not be enabled again — enabled today only because it predates
   * the proof rule — is refused rather than stranded outside, as
   * `IrreversibleChainRemovalError`. Switching it off from `setEnabled` still
   * works; a list that drops it by accident no longer takes checkout offline
   * for good. See `assertDroppable`.
   */
  setPriorities(merchant: MerchantRef, ordered: readonly ProviderName[]): Promise<MerchantSettingsView>;
  /**
   * Choose whether a declined card may be retried on the next acquirer.
   * Defaults to TECHNICAL; cascading is a deliberate, per-merchant opt-in
   * because it carries fraud and interchange-fee consequences.
   */
  setFailoverPolicy(
    merchant: MerchantRef,
    policy: MerchantFailoverPolicy,
  ): Promise<MerchantSettingsView>;
  /**
   * Probe stored credentials. `environment` defaults to the active one; pass
   * it to test the set the caller is actually looking at (see {@link runVerify}
   * for why only an active-environment probe is persisted).
   */
  verify(
    merchant: MerchantRef,
    provider: ProviderName,
    environment?: PaymentEnvironment,
  ): Promise<VerifiedProviderConfig>;
  /** The provider's onboarding walkthrough, or null when it has none. */
  setupGuide(provider: ProviderName, ctx: SetupGuideContext): ProviderSetupGuide | null;
}

/** `••••` + last 4 — enough to recognize a value, never to use it. */
function secretHint(value: string): string {
  return `••••${value.slice(-4)}`;
}

function maskEnvironment(adapter: PaymentProviderAdapter, fields: Record<string, string>): MaskedFields {
  const masked: MaskedFields = {};
  for (const spec of adapter.credentialSchema) {
    // `fulfilledBy` is the adapter-declared bridge from an OAuth exchange's
    // own field names to the schema keys this view is built from — without it
    // an OAuth-connected store masked as `configured: false` on every field,
    // reading as disconnected on the very screen about its connection
    // (FUT-691). Read-side only: writes still address `spec.key`.
    const value = fields[spec.key] || (spec.fulfilledBy && fields[spec.fulfilledBy]) || '';
    masked[spec.key] = {
      configured: value.length > 0,
      hint: value.length === 0 ? null : spec.secret ? secretHint(value) : value,
    };
  }
  return masked;
}

function toMasked(adapter: PaymentProviderAdapter, config: StoredProviderConfig): MaskedProviderConfig {
  return {
    provider: config.provider,
    enabled: config.enabled,
    priority: config.priority,
    environment: config.environment,
    status: config.status,
    lastVerifiedAt: config.lastVerifiedAt ? config.lastVerifiedAt.toISOString() : null,
    chargeVerifiedAt: config.chargeVerifiedAt ? config.chargeVerifiedAt.toISOString() : null,
    expiresAt: config.expiresAt ? config.expiresAt.toISOString() : null,
    stub: config.stub,
    environments: {
      SANDBOX: maskEnvironment(adapter, config.environments.SANDBOX),
      PRODUCTION: maskEnvironment(adapter, config.environments.PRODUCTION),
    },
    // WHO is connected (FUT-300) — identity facts only, never a credential.
    connectedAccount: connectedAccountFrom(adapter, config),
  };
}

function descriptorOf(providers: ProviderRegistry, name: string): ProviderDescriptor {
  const adapter = providers.get(name);
  return {
    name: adapter.name,
    displayName: adapter.displayName,
    urlSlug: providers.urlSlugOf(adapter.name),
    capabilities: adapter.capabilities,
    authMode: adapter.authMode ?? 'credentials',
    credentialSchema: adapter.credentialSchema,
  };
}

/**
 * Move a provider in or out of the failover chain and report the new state.
 *
 * Its two callers differ only in how they treat the proof: `setEnabled`
 * REQUIRES `chargeVerifiedAt` and refuses without it, `applyChargeVerification`
 * is what stamps it. No other path writes `enabled: true`.
 *
 * This persists ONLY the chain membership. A caller that mutated other fields
 * on `config` must `store.save` them itself, first — `toggleInChain` writes a
 * full row for a provider that has never been saved, and nothing else.
 */
async function settleEnablement(
  adapter: PaymentProviderAdapter,
  store: ProviderConfigStore,
  merchant: MerchantRef,
  config: StoredProviderConfig,
  enabled: boolean,
): Promise<MaskedProviderConfig> {
  return toMasked(adapter, await toggleInChain(store, merchant, config, enabled));
}

/** The whole settings payload: catalog, per-provider state, and the chain. */
async function buildSettingsView(
  providers: ProviderRegistry,
  store: ProviderConfigStore,
  merchant: MerchantRef,
): Promise<MerchantSettingsView> {
  const configs = await store.list(merchant);
  // Only providers the registry still knows can be routed to; a row left
  // behind by a removed adapter must not appear in the chain.
  const known = configs.filter((c) => providers.has(c.provider));
  // `inRotation`, not `enabled`: this chain is published as "what checkout
  // will actually walk", so it must agree with `credentialStoreFrom.chain`
  // about a row whose grant is dead (FUT-683).
  const chain = known
    .filter(inRotation)
    .sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider))
    .map((c) => c.provider);
  return {
    providers: providers.names.map((name) => descriptorOf(providers, name)),
    configs: known.map((c) => toMasked(providers.get(c.provider), c)),
    providerChain: chain,
    activeProvider: chain[0] ?? null,
    failoverPolicy: await store.getFailoverPolicy(merchant),
  };
}

/** Construction-time options — NOT reachable from any request body. */
export interface SettingsServiceOptions {
  /**
   * Allow SANDBOX configurations to run provider adapters in stub mode
   * (deterministic fakes, no network). Stub card charges report `PAID`
   * without money moving, so this is a deployment decision for local dev
   * and demo tenants: default OFF, and refused for PRODUCTION even when on.
   *
   * Take it from `resolveStubMode(process.env)` rather than inferring it from
   * whatever else happens to be in the environment — see `core/stub-mode.ts`.
   */
  allowStubMode?: boolean;
}

export function createSettingsService(
  providers: ProviderRegistry,
  store: ProviderConfigStore,
  options: SettingsServiceOptions = {},
): SettingsService {
  const allowStubMode = options.allowStubMode ?? false;

  async function load(merchant: MerchantRef, provider: ProviderName): Promise<StoredProviderConfig> {
    if (!providers.has(provider)) throw new UnknownProviderError(provider);
    return (await store.get(merchant, provider)) ?? emptyConfig(provider);
  }

  return {
    listProviders() {
      return providers.names.map((name) => descriptorOf(providers, name));
    },

    getSettings: (merchant) => buildSettingsView(providers, store, merchant),

    async saveCredentials(merchant, provider, input) {
      const adapter = providers.get(provider);
      // Before the load, so a malformed body cannot even cost a store read —
      // and before `applySaveCredentials`, which INVALIDATES on any change it
      // is handed: a write it should never have accepted would take the
      // connection to UNVERIFIED and out of the chain on its way to failing.
      //
      // What gets WRITTEN is what came back from the check, not what came in:
      // the values are normalized there (trimmed), and storing the raw copy
      // would put on record a value nothing ever validated.
      const checked = assertSaveCredentialsInput(adapter, input);
      const config = applySaveCredentials(await load(merchant, provider), checked, allowStubMode);
      await store.save(merchant, config);
      return toMasked(adapter, config);
    },

    async setEnabled(merchant, provider, enabled) {
      const config = await load(merchant, provider);
      const adapter = providers.get(provider);
      if (enabled) requireProven(adapter, config);
      return settleEnablement(adapter, store, merchant, config, enabled);
    },

    async applyChargeVerification(merchant, provider, passed) {
      // `applyProof` persists the stamp itself — see its note on why the
      // chain toggle alone loses it for an existing config.
      const config = await applyProof(store, merchant, await load(merchant, provider), passed);
      return toMasked(providers.get(provider), config);
    },

    ...pendingVerificationMethods(store, load),
    async setFailoverPolicy(merchant, policy) {
      await store.setFailoverPolicy(merchant, policy);
      return this.getSettings(merchant);
    },

    async setPriorities(merchant, ordered) {
      await assertReorderOnly(providers, store, merchant, ordered);
      await store.setProviderPriorities(merchant, ordered);
      return this.getSettings(merchant);
    },

    setupGuide(provider, ctx) {
      return providers.get(provider).setupGuide?.(ctx) ?? null;
    },

    async verify(merchant, provider, environment) {
      const config = await load(merchant, provider);
      const target = environment ?? config.environment;
      return runVerify(
        providers.get(provider),
        store,
        merchant,
        config,
        target,
        allowStubMode,
        toMasked,
      );
    },
  };
}

/**
 * Bridge a `ProviderConfigStore` into the gateway's read-only
 * `CredentialStore` port, so one storage implementation powers both the
 * settings page and the charge/webhook paths.
 *
 * It takes the SAME `allowStubMode` the settings service takes, and defaults
 * it to off: the write path deciding "no new stub rows" is not enough on its
 * own, because the rows already in the table are what the webhook path reads.
 */
export function credentialStoreFrom(
  store: ProviderConfigStore,
  options: SettingsServiceOptions = {},
): CredentialStore {
  const allowStubMode = options.allowStubMode ?? false;

  async function chain(merchant: MerchantRef): Promise<ProviderName[]> {
    const configs = await store.list(merchant);
    return configs
      .filter(inRotation)
      .sort(
        (a, b) =>
          // Rank first; provider name only as a tie-break. The partial unique
          // index makes ties impossible in the database, but a corrupted or
          // half-migrated row must still route DETERMINISTICALLY rather than
          // by whichever row the query happened to return first.
          a.priority - b.priority || a.provider.localeCompare(b.provider),
      )
      .map((c) => c.provider);
  }

  return {
    providerChain: chain,
    async defaultProvider(merchant) {
      return (await chain(merchant))[0] ?? null;
    },
    async getCredentials(merchant, provider) {
      const config = await store.get(merchant, provider);
      if (!config) return null;
      if (!config.enabled) {
        throw new CredentialsError(provider, `Provider ${provider} is configured but not enabled`);
      }
      // The chain already routes around this row; refusing here too stops a
      // DIRECT charge (explicit provider, no chain consulted). Listening
      // stays open — `getConnectedCredentials` below.
      if (config.status === 'RECONNECT_REQUIRED') {
        throw new CredentialsError(provider, `Provider ${provider} requires reauthorization to charge`);
      }
      return resolvedFrom(config, allowStubMode);
    },
    async getConnectedCredentials(merchant, provider) {
      // No enablement check — listening is not routing (see the port).
      const config = await store.get(merchant, provider);
      return config ? resolvedFrom(config, allowStubMode) : null;
    },
    async listListeningCredentials(merchant, provider) {
      const config = await store.get(merchant, provider);
      return config ? listeningSetsFrom(config, allowStubMode) : [];
    },
  };
}

