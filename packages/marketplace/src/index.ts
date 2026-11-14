/**
 * `@12-apps/marketplace` — ONE integration engine for every marketplace.
 *
 * The owner's two rules, which shape everything in this package:
 *
 * 1. "The integration engine must be the same for all integrations: iFood,
 *    Rappi, 99. Only an adapter is made for each one, to connect to the base
 *    engine."
 * 2. "This base engine must be a separate lib that implements the wiring
 *    package."
 *
 * So: the engine (this entry) holds the inbox, the pipeline, ingest, the
 * acceptance clock and its sweep, the SKU map, the integration settings and
 * the outbound engine, and knows no marketplace by name. Each marketplace is
 * an adapter at its own subpath (`@12-apps/marketplace/ifood`,
 * `@12-apps/marketplace/99food`, `@12-apps/marketplace/rappi`), registered at
 * mount. The wiring manifests are at `./manifest` and `./manifest/server`.
 *
 * Everything the engine needs from its host is a required port with no
 * default (`MarketplacePorts`); see ADOPTING.md for the full list.
 */

export { createMarketplaceEngine, type MarketplaceEngine } from "./core/engine";
export { stableUuid } from "./core/catalogue-ids";
export {
  answered,
  outboundResultOf,
  type AdapterCallContext,
  type AdapterTokenCache,
  type CancellationReason,
  type CancellationRequestInput,
  type FetchOrderResult,
  type MarketplaceAdapter,
  type MarketplaceCapabilities,
  type MarketplaceCredentials,
  type MarketplaceHttp,
  type MarketplaceHttpRequest,
  type MarketplaceHttpResponse,
  type OutboundOrderRef,
  type OutboundResult,
} from "./core/adapter";
export {
  createAdapterRegistry,
  MarketplaceAdapterRegistrationError,
  resolveReason,
  suggestReason,
  type AdapterRegistry,
} from "./core/registry";
export type {
  MarketplaceAdmission,
  MarketplaceAdmissionRequest,
  MarketplaceAdmissionResult,
  CancellationFailureReason,
  MarketplaceAuditEntry,
  MarketplaceAuditPort,
  MarketplaceCataloguePort,
  MarketplaceClockPort,
  MarketplaceDb,
  MarketplaceEngineConfig,
  MarketplaceEnqueuePort,
  MarketplaceLogger,
  MarketplaceOrderPort,
  MarketplaceOrderSummary,
  MarketplacePorts,
  MarketplaceRefusal,
  MarketplaceSecretsPort,
  ResolvedOrderLine,
} from "./core/ports";
export {
  PROVIDER_ID_PATTERN,
  type CancellationOutcome,
  type MarketplaceDeliveredBy,
  type MarketplaceOrderType,
  type MarketplaceProvider,
  type NormalizedAddress,
  type NormalizedBuyer,
  type NormalizedEvent,
  type NormalizedMarketplaceOrder,
  type NormalizedOrderLine,
} from "./core/types";
export type {
  AcceptanceStatus,
  CancellationStatus,
  ExpirySweepResult,
  PendingAcceptance,
} from "./core/acceptance";
export type {
  AcceptanceDecision,
  DecidedRow,
  DecideManyResult,
  DecisionInput,
  DecisionResult,
} from "./core/decisions";
export type { DecisionProblem, DecisionProblemCode } from "./core/cancellation";
export type {
  BulkProblem,
  BulkProblemCode,
  BulkResult,
  IntegrationRowInput,
  MenuLinkRowInput,
} from "./core/bulk";
export {
  OUTBOUND_GIVE_UP_MS,
  OUTBOUND_STALE_MS,
  type OutboundSweepResult,
} from "./core/outbound-sweep";
export type { PendingInboxEvent } from "./core/inbox";
export type { IngestResult, IngestSettings } from "./core/ingest";
export type {
  IngestionTarget,
  MarketplaceIntegrationView,
  SaveMarketplaceIntegrationInput,
} from "./core/integration";
export type { MarketplaceMenuLinkView } from "./core/menu-links";
export {
  OutboundRetryError,
  type OutboundAttempt,
  type OutboundOutcome,
} from "./core/outbound";
export {
  MARKETPLACE_OUTBOUND_JOB,
  outboundDedupeKey,
  type OutboundAction,
  type OutboundJobPayload,
} from "./core/outbound-queue";
export type { DeliveryOutcome } from "./core/pipeline";
export {
  FetchOrderRetryError,
  MARKETPLACE_FETCH_ORDER_JOB,
  type FetchOrderJobPayload,
  type FetchOrderOutcome,
} from "./core/fetch-order";
export type { MarketplaceOrderState } from "./core/state";
export {
  CatalogueRetryError,
  catalogueDedupeKey,
  MARKETPLACE_CATALOGUE_JOB,
  type CatalogueAction,
  type CatalogueJobPayload,
  type CatalogueOutcome,
} from "./core/catalogue-job";
export type {
  CatalogueActionResult,
  CatalogueDocumentResult,
  CataloguePublishInput,
  CatalogueRefusalCode,
  CatalogueTarget,
} from "./core/catalogue";
export type {
  CatalogueCallContext,
  CatalogueFailure,
  CatalogueImage,
  CatalogueItem,
  CatalogueItemOut,
  CatalogueItemRef,
  CatalogueMenuEntry,
  CatalogueMenuOptions,
  CatalogueStoredImage,
  CatalogueWarningCode,
  CataloguePublishResult,
  MarketplaceCatalogue,
  PullCatalogue,
  PushCatalogue,
} from "./core/catalogue-port";
export type {
  CatalogueFailedAction,
  CatalogueFailureCode,
  CataloguePublicationView,
  CatalogueStatus,
} from "./core/catalogue-store";
export { CATALOGUE_GIVE_UP_MS, CATALOGUE_STALE_MS } from "./core/catalogue-sweep";
export type {
  MarketplaceAvailability,
  StorePauseRef,
  StorePauseRequest,
  StorePauseResult,
} from "./core/pause-port";
export type {
  PauseOutcome,
  PauseStoreInput,
  PauseStoreResult,
  ResumeOutcome,
  StoreAvailabilityView,
} from "./core/pause";
export { AvailabilityRetryError, type AvailabilityOutcome } from "./core/pause-job";
export {
  MARKETPLACE_AVAILABILITY_JOB,
  STORE_PAUSE_LEASE_MS,
  availabilityDedupeKey,
  type AvailabilityJobPayload,
  type StorePauseFailureCode,
  type StorePauseState,
  type StorePauseWanted,
} from "./core/pause-store";
export type { AvailabilitySweepResult } from "./core/pause-sweep";
