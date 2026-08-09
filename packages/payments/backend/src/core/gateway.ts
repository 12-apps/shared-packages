import { cancelChargeAt } from './charge-cancel';
import { type ChargeWalkDeps, type FailoverPolicy, walkChargeChain } from './charge-walk';
import { type ClientProviderConfig, toClientProviderConfig } from './client-view';
import {
  CredentialsError,
  UnsupportedOperationError,
} from './errors';
import type {
  AttemptLedger,
  ChargeStore,
  CredentialStore,
  StoredCharge,
  WebhookEventHandler,
  WebhookInbox,
} from './ports';
import { activeVault, forgetVaultAt } from './gateway-vault';
import type { PaymentProviderAdapter } from './provider';
import type { ProviderHealth } from './provider-health';
import type { SettlementHints } from './settlement-hints';
import type { ProviderRegistry } from './registry';
import { runWebhookPipeline, type WebhookPipelineObserver } from './webhook-pipeline';
import {
  replayRetryableWebhooks,
  type WebhookReplayOptions,
  type WebhookReplayReport,
} from './webhook-replay';
import type {
  ChargeInput,
  ChargeSnapshot,
  MerchantRef,
  NormalizedWebhookEvent,
  ProviderName,
  RefundSnapshot,
  RefundInput,
  ResolvedCredentials,
  WebhookDelivery,
} from './types';
import type {
  VaultBeginInput,
  VaultCompleteInput,
  VaultedInstrument,
  VaultForgetInput,
  VaultSession,
} from './vault-types';

/** The vault methods, factored out to keep the gateway builder in budget. */
function vaultMethods(config: PaymentsGatewayConfig): Pick<
  PaymentsGateway,
  'beginVault' | 'completeVault' | 'forgetVault'
> {
  return {
    async beginVault(merchant, input) {
      const { adapter, creds } = await activeVault(config, merchant);
      return adapter.vault.begin(input, creds);
    },
    async completeVault(merchant, input) {
      const { adapter, creds } = await activeVault(config, merchant);
      return adapter.vault.complete(input, creds);
    },
    async forgetVault(merchant, provider, input) {
      await forgetVaultAt(config, merchant, provider, input);
    },
  };
}

/**
 * The gateway — the one object hosts talk to. It owns the cross-provider
 * invariants so no adapter and no host has to re-implement them:
 *
 *   - provider selection: charges walk the merchant's ORDERED chain and fail
 *     over, but only past a provider whose failure is proven to have created
 *     nothing (see `charge-walk.ts`); an explicit `options.provider` pins one
 *     provider and disables failover
 *   - capability gating (uniform `UnsupportedOperationError`s for single-
 *     provider operations; for charges it demotes to "try the next provider",
 *     since a chain member that cannot do boleto should not fail the charge)
 *   - credential resolution per (merchant, provider) via the host's port
 *   - charge idempotency: a retried `charge()` with the same
 *     `input.idempotencyKey` returns the existing charge. Three layers close
 *     the concurrent-retry window: (a) SAME-PROCESS concurrent calls with
 *     one key coalesce onto a single in-flight promise, so the adapter is
 *     called once; (b) the store's `(merchant, idempotencyKey)` uniqueness
 *     is atomic on insert, collapsing cross-process races to one row; and
 *     (c) the key is forwarded to providers with native idempotency, so a
 *     cross-process race that reaches the provider twice still cannot
 *     double-charge the buyer.
 *   - the webhook pipeline: verify → inbox dedup → parse → persist → notify
 *
 * It is deliberately thin over the ports: all durability lives in the host's
 * storage, all provider knowledge in the adapters.
 */
export interface PaymentsGatewayConfig<P extends string = string> {
  providers: ProviderRegistry<P>;
  credentials: CredentialStore;
  charges: ChargeStore;
  webhooks: WebhookInbox;
  /**
   * Failover audit trail. REQUIRED: it is what lets a retried charge resume a
   * walk instead of restarting it, which after an ambiguous failure is the
   * difference between reconciling one charge and creating a second.
   */
  attempts: AttemptLedger;
  /**
   * Whether a DECLINE advances the chain. Defaults to `TECHNICAL` — technical
   * failures fail over, declines do not. Cascading a declined card onto a
   * second acquirer is a legitimate practice but carries fraud and
   * interchange-fee consequences, so it is never the silent default.
   */
  failoverPolicy?: FailoverPolicy;
  /**
   * Per-merchant policy lookup. Without it every merchant shares the
   * construction-time default above, which makes the setting unreachable to
   * the people it is actually for. Hosts wire this to the settings store.
   */
  failoverPolicyFor?: (merchant: MerchantRef) => Promise<FailoverPolicy>;
  /**
   * Outage breaker: stop sending NEW charges to a provider that has proven
   * itself down. Optional — omitted, every provider is always attempted, which
   * is the behaviour before this existed. See `core/provider-health.ts`.
   */
  health?: ProviderHealth;
  /** Domain reaction to webhook-driven state changes (mark order paid, ...). */
  onWebhookEvent?: WebhookEventHandler;
  /**
   * Observability for inbound deliveries refused BEFORE the durable inbox
   * (credential lookup, signature verification) — otherwise traceless; see
   * `WebhookPipelineObserver`. Optional, observational only.
   */
  webhookObserver?: WebhookPipelineObserver;
}

export interface ChargeOptions<P extends string = string> {
  /**
   * Pin one provider. Failover is disabled entirely for the call: a caller
   * that named a provider gets that provider or an error, never a silent
   * substitution onto someone else's account.
   */
  provider?: P;
  /** Override the gateway-wide decline-cascading policy for one charge. */
  failoverPolicy?: FailoverPolicy;
}

export interface PaymentsGateway<P extends string = string> {
  /**
   * Create a charge, walking the merchant's provider chain until one
   * succeeds. Throws `AmbiguousChargeError` when a provider's outcome cannot
   * be determined — that is NOT a retryable failure, it is a charge that
   * needs reconciling — and `NoProviderSucceededError` when the chain is
   * exhausted. A decline is returned as a stored charge, not thrown.
   */
  charge(merchant: MerchantRef, input: ChargeInput, options?: ChargeOptions<P>): Promise<StoredCharge>;
  /** Poll the provider and persist the fresh snapshot (webhook fallback). */
  refreshCharge(
    merchant: MerchantRef,
    provider: P,
    providerChargeId: string,
    hints?: SettlementHints,
  ): Promise<ChargeSnapshot>;
  cancelCharge(merchant: MerchantRef, provider: P, providerChargeId: string): Promise<ChargeSnapshot>;
  refund(merchant: MerchantRef, provider: P, input: RefundInput): Promise<RefundSnapshot>;
  verifyCredentials(merchant: MerchantRef, provider: P): Promise<{ ok: boolean; message?: string }>;
  /**
   * VAULT a card for later off-session use, on the merchant's ACTIVE provider
   * (FUT-340). Two steps, because the middle one happens in the browser.
   *
   * Pinned to the chain HEAD on purpose, with no failover. An instrument is
   * bound to the provider that minted it, so "vault it wherever works" would
   * produce a card the acquirer we actually collect through cannot read —
   * failing later, on a timer, with the tenant long gone from the screen.
   *
   * Throws `UnsupportedOperationError` for a provider with no vault, which is
   * the honest answer: some cannot save a card without taking money, and
   * charging somebody to store their card is not a substitution to make
   * silently.
   */
  beginVault(merchant: MerchantRef, input: VaultBeginInput): Promise<VaultSession>;
  completeVault(merchant: MerchantRef, input: VaultCompleteInput): Promise<VaultedInstrument>;
  /**
   * Take a vaulted card back off file at the provider that holds it.
   *
   * The provider is NAMED rather than resolved, and that is the one place
   * removal and saving disagree: an instrument is bound to its minter, so the
   * card a tenant wants gone may sit at an acquirer the platform stopped
   * collecting through months ago.
   *
   * Throws `UnsupportedOperationError` when that provider cannot detach and
   * `CredentialsError` when it is no longer connected. Both are real states —
   * the host decides whether to drop its own pointer anyway, because only the
   * host knows whether an undetachable vault entry is worse than a pointer it
   * can no longer honour.
   */
  forgetVault(merchant: MerchantRef, provider: P, input: VaultForgetInput): Promise<void>;
  /**
   * Client-safe config for the merchant's active provider: tokenization plus
   * the adapter's declared buyer requirements (`customerSchema`, FUT-595) —
   * what the checkout renders the buyer form from.
   */
  clientConfig(merchant: MerchantRef): Promise<ClientProviderConfig | null>;
  /**
   * Client config for EVERY provider in the chain, in failover order.
   *
   * This is what makes card failover possible. A card instrument is bound to
   * the provider that minted it, so a checkout that only tokenizes for the
   * head of the chain has produced something the remaining providers cannot
   * read — and the gateway will skip them rather than send it. A checkout
   * that wants a card charge to survive its first provider failing mints one
   * instrument per entry here and submits them as `card.tokensByProvider`.
   *
   * It also carries each member's `customerSchema`, so a checkout can collect
   * the UNION of the chain's buyer requirements up front (`unionCustomerFields`)
   * — the documented answer to "failover must not strand a charge for want of
   * a field nobody collected".
   */
  clientConfigChain(merchant: MerchantRef): Promise<ClientProviderConfig[]>;
  /**
   * Full inbound-webhook pipeline for a delivery already attributed to a
   * merchant (hosts attribute via the webhook URL, e.g. a per-merchant
   * connect key in the path). Returns the normalized events that were newly
   * processed ([] for duplicates).
   */
  handleWebhook(merchant: MerchantRef, delivery: WebhookDelivery): Promise<NormalizedWebhookEvent[]>;
  /**
   * Re-run the pipeline over inbox rows that are still owed work: handlers that
   * threw (FAILED) and deliveries whose process died before settling them
   * (PENDING — the provider already got its 2xx and will never redeliver).
   * Hosts schedule this as a single-flight sweep.
   *
   * It takes NO delivery — the rows come from the inbox — but it does re-run
   * `webhook.verify` over each one, exactly as `handleWebhook` does. For an
   * unsigned provider that check IS the payment confirmation, so a replay that
   * skipped it would assert PAID on a payment nobody re-confirmed;
   * `webhook-replay.ts` carries the full reasoning.
   */
  replayWebhooks(options?: WebhookReplayOptions): Promise<WebhookReplayReport>;
}

interface Resolved {
  adapter: PaymentProviderAdapter;
  creds: ResolvedCredentials;
}

type Resolver = (merchant: MerchantRef, provider?: string) => Promise<Resolved>;

function makeResolver<P extends string>(config: PaymentsGatewayConfig<P>): Resolver {
  return async (merchant, provider) => {
    const name: ProviderName | null =
      provider ?? (await config.credentials.defaultProvider(merchant));
    if (!name) {
      throw new CredentialsError('none', `No payment provider configured for ${merchant.kind}:${merchant.id}`);
    }
    const adapter = config.providers.get(name);
    const creds = await config.credentials.getCredentials(merchant, name);
    if (!creds) {
      throw new CredentialsError(name, `Provider ${name} is not connected for ${merchant.kind}:${merchant.id}`);
    }
    return { adapter, creds };
  };
}

/**
 * Re-read one charge from the provider and store what it says.
 *
 * The stored snapshot is where a hint learned at CREATION lives, and merging it
 * in is what makes the re-read answerable at all: InfinitePay's `payment_check`
 * will not confirm without the invoice `slug`. A CALLER's hints win — they
 * carry what only the return trip knows, the `transaction_nsu` that does not
 * exist until somebody has paid.
 */
async function refreshOneCharge<P extends string>(
  config: PaymentsGatewayConfig<P>,
  resolve: Resolver,
  merchant: MerchantRef,
  provider: P,
  providerChargeId: string,
  hints?: SettlementHints,
): Promise<ChargeSnapshot> {
  const { adapter, creds } = await resolve(merchant, provider);
  const stored = await config.charges.findByProviderChargeId(provider, providerChargeId);
  const merged = { ...stored?.snapshot.settlementHints, ...hints };
  const snapshot = await adapter.getCharge(providerChargeId, creds, merged);
  await config.charges.upsertByProviderChargeId(merchant, snapshot);
  return snapshot;
}

function walkDepsOf<P extends string>(config: PaymentsGatewayConfig<P>): ChargeWalkDeps {
  return {
    providers: config.providers,
    credentials: config.credentials,
    charges: config.charges,
    attempts: config.attempts,
    failoverPolicy: config.failoverPolicy ?? 'TECHNICAL',
    failoverPolicyFor: config.failoverPolicyFor,
    health: config.health,
  };
}

export function createPaymentsGateway<P extends string>(
  config: PaymentsGatewayConfig<P>,
): PaymentsGateway<P> {
  const resolve = makeResolver(config);
  const walkDeps = walkDepsOf(config);
  // Same-process single-flight per (merchant, idempotencyKey): concurrent
  // calls with one key share ONE WALK instead of racing to it. Coalescing at
  // this level rather than per-provider is deliberate — two concurrent calls
  // must not each start their own failover walk down the same chain.
  const inFlight = new Map<string, Promise<StoredCharge>>();

  return {
    async charge(merchant, input, options = {}) {
      if (!input.idempotencyKey) return walkChargeChain(walkDeps, merchant, input, options);
      // JSON tuple, not delimiter concatenation — distinct (merchant, key)
      // tuples must never collide on an id/key containing the delimiter.
      const flightKey = JSON.stringify([merchant.kind, merchant.id, input.idempotencyKey]);
      const pending = inFlight.get(flightKey);
      if (pending) return pending;
      const run = walkChargeChain(walkDeps, merchant, input, options);
      inFlight.set(flightKey, run);
      void run.catch(() => undefined).finally(() => inFlight.delete(flightKey));
      return run;
    },

    refreshCharge: (merchant, provider, chargeId, hints) =>
      refreshOneCharge(config, resolve, merchant, provider, chargeId, hints),

    cancelCharge: cancelChargeAt(config.charges, resolve),
    async refund(merchant, provider, input) {
      const { adapter, creds } = await resolve(merchant, provider);
      if (!adapter.capabilities.refunds || !adapter.refund) {
        throw new UnsupportedOperationError(adapter.name, 'refunds');
      }
      if (input.amount && !adapter.capabilities.partialRefunds) {
        throw new UnsupportedOperationError(adapter.name, 'partial refunds');
      }
      return adapter.refund(input, creds);
    },

    async verifyCredentials(merchant, provider) {
      const { adapter, creds } = await resolve(merchant, provider);
      return adapter.verifyCredentials(creds);
    },

    ...vaultMethods(config),

    async clientConfig(merchant) {
      const name = await config.credentials.defaultProvider(merchant);
      if (!name) return null;
      const creds = await config.credentials.getCredentials(merchant, name);
      if (!creds) return null;
      return toClientProviderConfig(config.providers.get(name), creds);
    },

    async clientConfigChain(merchant) {
      const chain = await config.credentials.providerChain(merchant);
      const configs: ClientProviderConfig[] = [];
      for (const name of chain) {
        if (!config.providers.has(name)) continue;
        // A provider whose credentials cannot be resolved is simply absent
        // from the list rather than failing the whole call: the checkout can
        // still tokenize for the ones that ARE reachable.
        const creds = await config.credentials
          .getCredentials(merchant, name)
          .catch(() => null);
        if (!creds) continue;
        configs.push(toClientProviderConfig(config.providers.get(name), creds));
      }
      return configs;
    },

    handleWebhook: (m, d) => runWebhookPipeline(config, (p) => resolve(m, p), m, d),
    replayWebhooks: (options) => replayRetryableWebhooks(config, options),
  };
}
