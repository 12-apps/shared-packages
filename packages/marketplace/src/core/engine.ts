import {
  cancelAcceptance,
  expireLapsedAcceptances,
  listPendingAcceptances,
  type ExpirySweepResult,
  type PendingAcceptance,
} from "./acceptance";
import {
  upsertIntegrations,
  upsertMenuLinks,
  type BulkResult,
  type IntegrationRowInput,
  type MenuLinkRowInput,
} from "./bulk";
import {
  decideMany,
  decideOne,
  recordStoreCancellation,
  type DecideManyResult,
  type DecisionInput,
  type DecisionResult,
} from "./decisions";
import {
  publishToCatalogue,
  readCatalogueDocument,
  readCatalogueState,
  withdrawFromCatalogue,
  type CatalogueActionResult,
  type CatalogueDocumentResult,
  type CataloguePublishInput,
  type CatalogueTarget,
} from "./catalogue";
import { runCatalogue, type CatalogueJobPayload, type CatalogueOutcome } from "./catalogue-job";
import type { CatalogueMenuOptions } from "./catalogue-port";
import type { CataloguePublicationView } from "./catalogue-store";
import {
  runFetchOrder,
  type FetchOrderJobPayload,
  type FetchOrderOutcome,
} from "./fetch-order";
import { sweepOutbound, type OutboundSweepResult } from "./outbound-sweep";
import type {
  AdapterTokenCache,
  CancellationReason,
  MarketplaceAdapter,
  OutboundOrderRef,
} from "./adapter";
import { listRetryableInboxEvents, type PendingInboxEvent } from "./inbox";
import { ingestMarketplaceOrder, type IngestResult, type IngestSettings } from "./ingest";
import {
  listMarketplaceIntegrations,
  resolveIngestionTarget,
  resolveTenantByMerchant,
  saveMarketplaceIntegration,
  type IngestionTarget,
  type MarketplaceIntegrationView,
  type SaveMarketplaceIntegrationInput,
} from "./integration";
import { listMarketplaceMenuLinks, type MarketplaceMenuLinkView } from "./menu-links";
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

  /** This store's connections, secrets withheld; archived ones only when asked. */
  integrations(
    clientId: string,
    options?: { providers?: readonly string[]; includeArchived?: boolean },
  ): Promise<MarketplaceIntegrationView[]>;
  /** Create or patch ONE connection (the bulk call's single-row form, with no audit). */
  saveIntegration(input: SaveMarketplaceIntegrationInput): Promise<MarketplaceIntegrationView>;
  /** Create, patch, archive or unarchive many connections, all-or-nothing. */
  upsertIntegrations(input: {
    clientId: string;
    actorId: string | null;
    rows: readonly IntegrationRowInput[];
    validateOnly?: boolean;
  }): Promise<BulkResult<MarketplaceIntegrationView>>;

  /** The SKU map. `unmappedOnly` is the store's attention list; `ids` narrows. */
  menuLinks(input: {
    clientId: string;
    provider?: MarketplaceProvider;
    unmappedOnly?: boolean;
    ids?: readonly string[];
  }): Promise<MarketplaceMenuLinkView[]>;
  /** Map or unmap many SKUs, all-or-nothing. */
  upsertMenuLinks(input: {
    clientId: string;
    rows: readonly MenuLinkRowInput[];
    validateOnly?: boolean;
  }): Promise<BulkResult<MarketplaceMenuLinkView>>;
  /** Map or unmap ONE SKU. `null` = the catalog id is not this tenant's. */
  setMenuLink(input: { clientId: string } & MenuLinkRowInput): Promise<MarketplaceMenuLinkView | null>;

  /** Orders still on the clock, soonest deadline first; `orderIds` narrows. */
  pending(clientId: string, orderIds?: readonly string[]): Promise<PendingAcceptance[]>;
  /** Decide many orders, all-or-nothing, the host admitting each inside the claim's transaction. */
  decideMany(input: {
    clientId: string;
    decisions: readonly DecisionInput[];
    validateOnly?: boolean;
    now?: Date;
  }): Promise<DecideManyResult>;
  /** Decide ONE order (`decideMany` with one decision). */
  decide(input: { clientId: string; now?: Date } & DecisionInput): Promise<DecisionResult>;
  /** The store cancelled through the host's own cancel: stamp and queue the request. */
  recordStoreCancellation(input: {
    clientId: string;
    orderId: string;
    reasonCode?: string | null;
    offendingSkus?: readonly string[];
    now?: Date;
  }): Promise<DecisionResult>;
  /** The marketplace cancelled an order we already have. */
  cancel(input: {
    clientId: string;
    provider: MarketplaceProvider;
    externalOrderId: string;
    now?: Date;
  }): Promise<boolean>;
  /** Where each of these orders' acceptance and cancellation stand. */
  orderStates(clientId: string, orderIds: readonly string[]): Promise<Map<string, MarketplaceOrderState>>;

  /** Expire every order whose deadline has passed, across all tenants. */
  expireLapsed(now?: Date): Promise<ExpirySweepResult>;
  /** Deliveries recorded but never processed, oldest first. */
  retryable(): Promise<PendingInboxEvent[]>;
  /** Re-run one stored delivery against the store's CURRENT settings. */
  reprocess(event: PendingInboxEvent): Promise<DeliveryOutcome>;
  /** Re-queue every outbound call still owed (the `marketplace.outbound-sweep` job's body). */
  sweepOutbound(now?: Date): Promise<OutboundSweepResult>;
  /** Run one queued outbound call (the `marketplace.outbound` job's body). */
  runOutbound(payload: OutboundJobPayload, attempt: OutboundAttempt): Promise<OutboundOutcome>;
  /** Fetch and ingest one announced order (the `marketplace.fetch-order` job's body). */
  runFetchOrder(payload: FetchOrderJobPayload, attempt: OutboundAttempt): Promise<FetchOrderOutcome>;

  /**
   * How this marketplace's catalogue is published (`push`, `pull`), or null
   * when it cannot be: the adapter states no catalogue, or the host bound no
   * catalogue port (FUT-4768).
   */
  catalogueMode(provider: string): "push" | "pull" | null;
  /** Put a product in a marketplace's catalogue (or send it again), with an optional price for it. Queued. */
  publish(input: CataloguePublishInput): Promise<CatalogueActionResult>;
  /** Take a product out of a marketplace's catalogue. Queued. */
  withdraw(input: CatalogueTarget): Promise<CatalogueActionResult>;
  /** Where these products stand on these marketplaces, in one read. */
  catalogueState(input: {
    clientId: string;
    productIds: readonly string[];
    providers?: readonly string[];
  }): Promise<CataloguePublicationView[]>;
  /** The menu part of the document a PULL marketplace reads, for the host to serve. */
  catalogueDocument(input: {
    clientId: string;
    provider: MarketplaceProvider;
    options: CatalogueMenuOptions;
  }): Promise<CatalogueDocumentResult>;
  /** Run one queued publish or withdraw (the `marketplace.catalogue` job's body). */
  runCatalogue(payload: CatalogueJobPayload, attempt: OutboundAttempt): Promise<CatalogueOutcome>;
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

    integrations: (clientId, options) => listMarketplaceIntegrations(ctx, clientId, options),
    saveIntegration: async (input) => saveMarketplaceIntegration(ctx, input, await ports.db()),
    upsertIntegrations: (input) => upsertIntegrations(ctx, input),

    menuLinks: (input) => listMarketplaceMenuLinks(ctx, input),
    upsertMenuLinks: (input) => upsertMenuLinks(ctx, input),
    setMenuLink: async ({ clientId, ...row }) => {
      const result = await upsertMenuLinks(ctx, { clientId, rows: [row] });
      return result.kind === "saved" ? (result.rows[0] ?? null) : null;
    },

    pending: (clientId, orderIds) => listPendingAcceptances(ctx, clientId, orderIds),
    decideMany: (input) => decideMany(ctx, input),
    decide: (input) => decideOne(ctx, input),
    recordStoreCancellation: (input) => recordStoreCancellation(ctx, input),
    cancel: (input) => cancelAcceptance(ctx, input),
    orderStates: (clientId, orderIds) => readOrderStates(ctx, clientId, orderIds),

    expireLapsed: (now) => expireLapsedAcceptances(ctx, now ?? ports.clock.now()),
    retryable: () => listRetryableInboxEvents(ctx),
    reprocess: (event) => reprocessStoredDelivery(ctx, event),
    sweepOutbound: (now) => sweepOutbound(ctx, now ?? ports.clock.now()),
    runOutbound: (payload, attempt) => runOutbound(ctx, payload, attempt),
    runFetchOrder: (payload, attempt) => runFetchOrder(ctx, payload, attempt),

    // Null too when the host bound no catalogue port: nothing could be published.
    catalogueMode: (provider) => (ports.catalogue ? (registry.get(provider)?.catalogue?.mode ?? null) : null),
    publish: (input) => publishToCatalogue(ctx, input),
    withdraw: (input) => withdrawFromCatalogue(ctx, input),
    catalogueState: (input) => readCatalogueState(ctx, input),
    catalogueDocument: (input) => readCatalogueDocument(ctx, input),
    runCatalogue: (payload, attempt) => runCatalogue(ctx, payload, attempt),
  };
}
