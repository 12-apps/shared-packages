import {
  cancelAcceptance,
  decideAcceptance,
  expireLapsedAcceptances,
  listPendingAcceptances,
  type AcceptanceDecision,
  type DecisionResult,
  type ExpirySweepResult,
  type PendingAcceptance,
} from "./acceptance";
import { recordStoreCancellation } from "./cancellation";
import type {
  AdapterTokenCache,
  CancellationReason,
  MarketplaceAdapter,
  OutboundOrderRef,
} from "./adapter";
import { listRetryableInboxEvents, type PendingInboxEvent } from "./inbox";
import { ingestMarketplaceOrder, type IngestResult, type IngestSettings } from "./ingest";
import {
  deleteMarketplaceIntegration,
  listMarketplaceIntegrations,
  resolveIngestionTarget,
  resolveTenantByMerchant,
  saveMarketplaceIntegration,
  type IngestionTarget,
  type MarketplaceIntegrationView,
  type SaveMarketplaceIntegrationInput,
} from "./integration";
import {
  listMarketplaceMenuLinks,
  setMarketplaceMenuLink,
  type MarketplaceMenuLinkView,
} from "./menu-links";
import { runOutbound, type OutboundAttempt, type OutboundOutcome } from "./outbound";
import type { OutboundJobPayload } from "./outbound-queue";
import {
  normalizeEvent,
  processDelivery,
  reprocessStoredDelivery,
  type DeliveryOutcome,
} from "./pipeline";
import type { EngineContext, MarketplaceEngineConfig } from "./ports";
import { createAdapterRegistry, suggestReason } from "./registry";
import { readOrderStates, type MarketplaceOrderState } from "./state";
import type { MarketplaceProvider, NormalizedEvent, NormalizedMarketplaceOrder } from "./types";

/** Everything the mounted engine can do, with the ports and adapters bound in. */
export interface MarketplaceEngine {
  /** Every registered marketplace, in registration order. */
  providers(): readonly MarketplaceProvider[];
  /** Whether a provider id (a URL segment, a body field) names a registered adapter. */
  knows(provider: string): provider is MarketplaceProvider;
  /** The adapter itself: its capabilities, reasons and app link. Null when unknown. */
  adapter(provider: string): MarketplaceAdapter | null;
  /** The marketplace's reasons, static and offline. Empty when unknown. */
  reasons(provider: string): readonly CancellationReason[];
  /** The reason a host preselects, given whether the order is short of an item. */
  suggestReason(provider: string, input: { itemUnavailable: boolean }): CancellationReason | null;
  /** Where a person goes to act on the marketplace's side. Null when unknown. */
  appLink(provider: string, order: Pick<OutboundOrderRef, "externalOrderId" | "externalDisplayId">): string | null;

  /** Turn a raw payload into the canonical shape, or null if nothing does. */
  normalize(provider: string, payload: unknown): NormalizedEvent | null;
  /** Read the provider's signature header off a request. */
  readSignature(provider: string, header: (name: string) => string | null): string | null;
  /** Verify a delivery. An unknown provider is never verified, so never accepted. */
  verifySignature(provider: string, rawBody: string, signature: string | null, secret: string | null): boolean;
  /** Which tenant a delivery belongs to, from the merchant id it names. */
  tenantFor(provider: MarketplaceProvider, externalMerchantId: string): Promise<string | null>;
  /** The connection behind one (tenant, marketplace), for the ingestion path. */
  target(clientId: string, provider: MarketplaceProvider): Promise<IngestionTarget | null>;
  /** Ingest ONE already-normalized order, bypassing the inbox. Idempotent. */
  ingest(input: {
    clientId: string;
    order: NormalizedMarketplaceOrder;
    settings: IngestSettings;
    now?: Date;
  }): Promise<IngestResult>;
  /** Record and act on one delivery. Never throws. */
  deliver(input: {
    clientId: string | null;
    event: NormalizedEvent;
    payload: unknown;
    settings: IngestSettings | null;
    now?: Date;
  }): Promise<DeliveryOutcome>;

  /** Every connection this store has, secrets withheld. */
  integrations(clientId: string): Promise<MarketplaceIntegrationView[]>;
  saveIntegration(input: SaveMarketplaceIntegrationInput): Promise<MarketplaceIntegrationView>;
  deleteIntegration(clientId: string, provider: MarketplaceProvider): Promise<void>;

  /** The SKU map. `unmappedOnly` is the store's attention list. */
  menuLinks(input: {
    clientId: string;
    provider?: MarketplaceProvider;
    unmappedOnly?: boolean;
  }): Promise<MarketplaceMenuLinkView[]>;
  /** Point a SKU at a catalog row, or unmap it. `null` = not this tenant's id. */
  setMenuLink(input: {
    clientId: string;
    provider: MarketplaceProvider;
    externalSku: string;
    externalName?: string;
    menuItemId: string | null;
  }): Promise<MarketplaceMenuLinkView | null>;

  /** Orders still on the clock, soonest deadline first. */
  pending(clientId: string): Promise<PendingAcceptance[]>;
  /** Accept or refuse an order on the clock. All-or-nothing; see `DecisionResult`. */
  decide(input: {
    clientId: string;
    orderId: string;
    decision: AcceptanceDecision;
    reasonCode?: string | null;
    now?: Date;
  }): Promise<DecisionResult>;
  /** The store cancelled through the host's own cancel: stamp and queue the request. */
  recordStoreCancellation(input: {
    clientId: string;
    orderId: string;
    reasonCode?: string | null;
    now?: Date;
  }): Promise<DecisionResult>;
  /** The marketplace cancelled an order we already have. */
  cancel(input: {
    clientId: string;
    provider: MarketplaceProvider;
    externalOrderId: string;
    now?: Date;
  }): Promise<boolean>;
  /** Where each of these orders' aceite and cancellation stand. */
  orderStates(clientId: string, orderIds: readonly string[]): Promise<Map<string, MarketplaceOrderState>>;

  /** Expire every order whose deadline has passed, across all tenants. */
  expireLapsed(now?: Date): Promise<ExpirySweepResult>;
  /** Deliveries recorded but never processed, oldest first. */
  retryable(): Promise<PendingInboxEvent[]>;
  /** Re-run one stored delivery against the store's CURRENT settings. */
  reprocess(event: PendingInboxEvent): Promise<DeliveryOutcome>;
  /** Run one queued outbound call (the `marketplace.outbound` job's body). */
  runOutbound(payload: OutboundJobPayload, attempt: OutboundAttempt): Promise<OutboundOutcome>;
}

/**
 * Mount the engine onto a host.
 *
 * Every port is REQUIRED and there are no defaults: a default would let a
 * second host silently inherit the first one's answers. The adapter list is
 * validated here (`createAdapterRegistry`), so a malformed adapter fails at
 * boot rather than on the first order it would have mangled.
 */
export function createMarketplaceEngine(config: MarketplaceEngineConfig): MarketplaceEngine {
  const { adapters, ...ports } = config;
  const registry = createAdapterRegistry(adapters);
  const tokens: AdapterTokenCache = new Map();
  const ctx: EngineContext = { ports, registry, tokens };

  return {
    providers: () => registry.providers(),
    knows: (provider): provider is MarketplaceProvider => registry.has(provider),
    adapter: (provider) => registry.get(provider),
    reasons: (provider) => registry.get(provider)?.cancellationReasons() ?? [],
    suggestReason: (provider, input) => {
      const adapter = registry.get(provider);
      return adapter ? suggestReason(adapter, input) : null;
    },
    appLink: (provider, order) => registry.get(provider)?.appLink(order) ?? null,

    normalize: (provider, payload) => normalizeEvent(ctx, provider, payload),
    readSignature: (provider, header) => registry.get(provider)?.readSignature(header) ?? null,
    // An unknown provider cannot be verified, so it is not accepted: trusting
    // what cannot be checked is how an unsigned endpoint ships by omission.
    verifySignature: (provider, rawBody, signature, secret) =>
      registry.get(provider)?.verifySignature(rawBody, signature, secret) ?? false,
    tenantFor: (provider, externalMerchantId) =>
      resolveTenantByMerchant(ctx, provider, externalMerchantId),
    target: (clientId, provider) => resolveIngestionTarget(ctx, clientId, provider),
    ingest: (input) => ingestMarketplaceOrder(ctx, input),
    deliver: (input) => processDelivery(ctx, input),

    integrations: (clientId) => listMarketplaceIntegrations(ctx, clientId),
    saveIntegration: (input) => saveMarketplaceIntegration(ctx, input),
    deleteIntegration: (clientId, provider) => deleteMarketplaceIntegration(ctx, clientId, provider),

    menuLinks: (input) => listMarketplaceMenuLinks(ctx, input),
    setMenuLink: (input) => setMarketplaceMenuLink(ctx, input),

    pending: (clientId) => listPendingAcceptances(ctx, clientId),
    decide: (input) => decideAcceptance(ctx, input),
    recordStoreCancellation: (input) => recordStoreCancellation(ctx, input),
    cancel: (input) => cancelAcceptance(ctx, input),
    orderStates: (clientId, orderIds) => readOrderStates(ctx, clientId, orderIds),

    expireLapsed: (now) => expireLapsedAcceptances(ctx, now ?? ports.clock.now()),
    retryable: () => listRetryableInboxEvents(ctx),
    reprocess: (event) => reprocessStoredDelivery(ctx, event),
    runOutbound: (payload, attempt) => runOutbound(ctx, payload, attempt),
  };
}
