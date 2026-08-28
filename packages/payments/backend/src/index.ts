/**
 * `@12-apps/payments-backend` — the server half of a portable, vendor-agnostic
 * payments platform.
 *
 * One normalized model (charge / refund / webhook / credential) behind a
 * per-provider adapter seam, so the host codes against ONE contract and a
 * new vendor is one adapter + one registry entry — zero changes anywhere
 * else. Two money directions share the code path via `MerchantRef`:
 *
 *   | direction                        | merchant           | credentials from       |
 *   |----------------------------------|--------------------|------------------------|
 *   | platform charges its tenants     | `PLATFORM`         | platform's own account |
 *   | tenant charges its own buyers    | `TENANT` (id)      | tenant's connected acct|
 *
 * Layers, outermost first:
 *   - `http/`     fetch-native Request→Response handlers for the checkout
 *                 and settings surfaces (mountable in any framework — or a
 *                 future standalone payments microservice)
 *   - `config/`   the settings-page domain: masked credential views,
 *                 write-only updates, verify probe, single active provider
 *   - `core/`     gateway, adapter contract, normalized types, storage ports
 *   - `providers/` adapter skeletons (Stone, InfinitePay, Stripe) — stub
 *                 mode fully functional, live call sites marked TODO
 *   - `prisma/`   port implementations over the OWNED schema fragment
 *                 (`prisma/payments.prisma` + migration, synced into hosts)
 *   - `memory.ts` in-memory ports for tests and hosts without a database
 *
 * The frontend half lives in `@12-apps/payments-frontend`.
 */

export { defineProviders, type ProviderRegistry } from './core/registry';
export { credentialSchemaOf } from './core/credential-schema';
export { resolvePaymentsCopy, type PaymentsCopyResolver, type PaymentsCopySource } from './copy-source';
export {
  createPaymentsGateway,
  type ChargeOptions,
  type PaymentsGateway,
  type PaymentsGatewayConfig,
} from './core/gateway';
// Pre-inbox refusal observability (FUT-761) — wire as `PaymentsGatewayConfig.webhookObserver`.
export type { WebhookPipelineObserver } from './core/webhook-pipeline';
export type { FailoverPolicy } from './core/charge-walk';
/**
 * The webhook-replay sweep's inputs and result. The entry point itself is
 * `gateway.replayWebhooks` — there is deliberately no exported function that
 * takes a raw body for replay: the sweep's whole input is rows the inbox
 * already recorded, which is what leaves an arbitrary body with exactly one way
 * in (`handleWebhook`) rather than two.
 */
export type { WebhookReplayOptions, WebhookReplayReport } from './core/webhook-replay';
export {
  classifyFailure,
  isPreSendNetworkError,
  isTransportError,
  type AttemptOutcome,
  type FailureBucket,
  type ProbeResult,
} from './core/failover';
export {
  createMemoryProviderHealth,
  isOutageSignal,
  type BreakerOptions,
  type ProviderHealth,
} from './core/provider-health';
export type {
  DeliveryPaymentProof,
  PaymentProviderAdapter,
  PaymentProviderAdapterBase,
} from './core/provider';
export type {
  AttemptLedger,
  ChargeAttemptRecord,
  ChargeQueryStore,
  ChargeStore,
  PayableChargeQuery,
  CredentialStore,
  StoredCharge,
  WebhookEventHandler,
  WebhookInbox,
} from './core/ports';
export { isForwardTransition, isTerminal } from './core/status';
// The pending-charge reconciliation sweep (FUT-761) — see `core/payable-sweep.ts`.
export {
  reconcilePendingCharges,
  type PendingChargeWindow,
  type PendingSweepDeps,
  type PendingSweepOptions,
  type PendingSweepReport,
} from './core/payable-sweep';
/** Adapter-declared field roles (FUT-761): which credential field authenticates inbound deliveries. */
export { webhookFieldOf } from './core/credential-roles';
export { withMerchantRedirectUrl, withMerchantWebhookUrl } from './core/webhook-url';
export type { MerchantWebhookUrlResolver } from './core/webhook-url';
/**
 * Resolve-time stamp of the platform's CURRENT webhook signing secret
 * (FUT-690) — what keeps Connect stores verifying deliveries after the
 * platform rolls its endpoint secret, without every store reconnecting.
 */
export { withPlatformWebhookSecret } from './core/webhook-secret';
export type { PlatformWebhookSecretResolver } from './core/webhook-secret';
export {
  toClientChargeView,
  isSettled,
  providerCorrelationId,
  type ClientChargeView,
  type ClientProviderConfig,
} from './core/client-view';
/**
 * Buyer-requirements helpers (FUT-595): resolve an adapter's `customerSchema`
 * per method, validate collected values against it, and union a chain's
 * requirements for an up-front form. The types travel via `core/types`.
 */
export {
  customerFieldsFor,
  unionCustomerFields,
  validateCustomer,
} from './core/customer-schema';
/**
 * The walk's TYPED failure channel (FUT-563). A host answering an exhausted
 * chain has to tell "nobody was even asked — the buyer is missing a field"
 * from "a provider was asked and refused", and those are opposite answers:
 * a fixable 4xx naming the field versus one honest payment-outage message.
 * The discriminant is what makes that decidable; it used to be a sentence the
 * host parsed back, which gave up on the first failure it did not recognise.
 */
export { gateIssuesOf, nothingWasAttempted } from './core/walk-failure';
export type { WalkFailure, WalkFailureKind } from './core/walk-failure';
export {
  AdapterContractError,
  AmbiguousChargeError,
  ChargeDeclinedError,
  ChargeNotPersistedError,
  CredentialsError,
  CustomerRequirementsError,
  InvalidCredentialsInputError,
  IrreversibleChainRemovalError,
  NoProviderSucceededError,
  PaymentsError,
  ProviderRequestError,
  UnknownProviderError,
  UnprovenProviderError,
  UnsupportedOperationError,
  WebhookVerificationError,
} from './core/errors';
export type { ProviderRequestSnapshot } from './core/errors';
// Error-taxonomy readers (FUT-761) — see `core/error-readers.ts`.
export {
  isAccountAccessError,
  isPermanentProviderRefusal,
  providerExchangeReport,
  providerRejectionReasons,
  type ProviderRejectionReason,
} from './core/error-readers';
// Decline verdicts as taxonomy properties (FUT-761); ladders stay host policy.
export { declineForbidsRetry, declineMeansInstrumentDead } from './core/decline-verdict';

/**
 * The deployment's stub-mode decision. A host resolves it ONCE at startup
 * from an explicit `PAYMENTS_STUB`, and passes the answer to
 * `createSettingsService`, `credentialStoreFrom` and the activation context.
 * Inferring it from some unrelated variable is what let an unsigned webhook
 * authenticate itself and settle real orders — see `core/stub-mode.ts`.
 */
export {
  resolveStubMode,
  stubDeliveryTrusted,
  StubModeRefusedError,
  STUB_MODE_ENV_VAR,
  type StubModeEnv,
} from './core/stub-mode';

// The FUT-477 legacy-notification capability — `resolvePagbankNotification`
// and, since FUT-764, the `pagbankLegacyResolver`/`legacyNotificationCode`
// that bind it — is deliberately NOT re-exported here. This ROOT entry is
// value-imported by the frontend package's stories, so any provider-module
// export placed on it drags `providers/shared.ts` — and its `node:crypto`
// import — into a browser bundle and breaks the Storybook build. It ships at
// its own subpath instead, `@12-apps/payments-backend/pagbank-legacy-notifications`
// (not under `./providers/*`, which the provider-catalog contract reserves for
// ADAPTER modules), and no browser build reaches any subpath.
//
// That last sentence is the whole rule, and it is worth knowing it has been
// broken once: FUT-764 put the binding on `./providers/pagbank-public`, which
// IS on the root, and the Storybook build was the only thing that noticed.
// Every other gate — lint, types, unit, the consumer verification — was green.

// The adapters' copy ports and pt-BR packs. Listed in `providers/index.ts`
// (this file is at the size gate), which also carries the reason those two
// modules are exempt from the rule above: neither has a runtime dependency.
export * from './providers/index';

export type {
  CardDetails,
  ChargeInput,
  ChargeSnapshot,
  ChargeStatus,
  ClientTokenization,
  CredentialFieldSpec,
  CustomerFieldIssue,
  CustomerFieldKey,
  CustomerFieldSpec,
  CustomerFieldType,
  CustomerInfo,
  CustomerSchema,
  DeclineReason,
  IntakeFreshness,
  ProbeFault,
  ProbeOutcome,
  VaultBeginInput,
  VaultCompleteInput,
  VaultedInstrument,
  VaultForgetInput,
  VaultSession,
  MerchantRef,
  Money,
  NormalizedWebhookEvent,
  PaymentEnvironment,
  PaymentMethodKind,
  ProviderCapabilities,
  ProviderName,
  OAuthAuthorizeRequest,
  OAuthTokens,
  OnboardingStage,
  ProviderAuthMode,
  ProviderSetupGuide,
  RefundInput,
  RefundSnapshot,
  ResolvedCredentials,
  SetupCopy,
  SetupGuideContext,
  SetupLink,
  SetupProgress,
  SetupSection,
  SetupStep,
  WebhookDelivery,
} from './core/types';

export {
  createSettingsService,
  credentialStoreFrom,
  type SettingsService,
  type SettingsServiceOptions,
} from './config/service';
export { hasUsableCredentials } from './config/usable-credentials';
export { mintBrowserKey, storedBrowserKey, type BrowserKeyDeps } from './config/browser-key';
export { createCycleCollector } from './core/cycle-collection';
export { merchantWebhookUrl, type MerchantWebhookUrlOptions } from './config/webhook-url';
export { classifyFirstCharge } from './checkout/first-charge';
export type { FirstChargeSettlement, FirstChargeExpectation, FirstChargeOptions } from './checkout/first-charge';
export { envOAuthAppCredentials, DEFAULT_OAUTH_APP_EXTRAS, type EnvOAuthAppOptions } from './config/oauth-env';
export type { BillingInstrument, CollectableCycle, CollectionResult, CollectionSkip, CycleCollectionDeps, CycleCollector, CycleStore, InstrumentLookup } from './core/cycle-collection';
// Account-level downgrade rule (FUT-761) — see `config/account-downgrade.ts`.
export { downgradeOnAccountError } from './config/account-downgrade';
export { type VerifiedProviderConfig } from './config/verify';
// Platform credential bootstrap (FUT-761): env seeds, panel owns.
export { ensurePlatformCredentials, type PlatformCredentialSeed } from './config/platform-seed';
/**
 * The credential-write contract (FUT-694), exported so a host that mounts its
 * own settings route — rather than `createPaymentsHttp` — refuses the same
 * bodies this package does instead of re-deriving the rules from the schema.
 */
export { assertFieldsMatchSchema, assertSaveCredentialsInput, parseSaveCredentialsBody } from './config/credential-input';
export {
  createOAuthConnectService,
  type OAuthAppCredentialsResolver,
  type OAuthConnectService,
  type RevokeFailure,
  type RevokeFailureReporter,
} from './config/oauth';
export type {
  ConnectedOAuthAccount,
  MaskedFieldState,
  MerchantFailoverPolicy,
  MaskedFields,
  MaskedProviderConfig,
  MerchantSettingsView,
  ProviderConfigStatus,
  ProviderConfigStore,
  ProviderDescriptor,
  SaveCredentialsInput,
  PendingVerification,
  StoredProviderConfig,
} from './config/types';

export {
  createPaymentsHttp,
  type ChargeRequestDraft,
  type PaymentsHttpDeps,
  type VaultRequestResolvers,
  type PaymentsHttpHandlers,
  type PaymentsRequestContext,
} from './http/handlers';

export {
  mountPayments,
  type MountedPaymentsRoutes,
  type MountPaymentsOptions,
  type PaymentsIntentKind,
  type PaymentsRouteContext,
  type PaymentsRouteExtension,
  type PaymentsRouteExtensionArgs,
  type PaymentsRouteIntent,
  type PaymentsRouteMethod,
  type PaymentsRouteParams,
} from './http/router';

/**
 * The BUYER-CHECKOUT mount (FUT-740) — `mountPayments`' counterpart for the
 * other side of the till. The explicit export list lives in
 * `checkout/index.ts` (this file is at the size gate), exactly as the
 * activation and platform blocks below do.
 */
export * from './checkout/index';
/**
 * The charge-identity guards (FUT-378) and the `--` attempt-reference
 * convention (FUT-669). Exported because a host that has not yet moved onto the
 * mount still needs the REAL implementations rather than its own copy — a copy
 * that differs by one byte silently stops finding every charge already on disk.
 */
export {
  ChargeIdentityError,
  chargeIdentityMismatch,
  chargeSnapshotMismatch,
  hostedSnapshotMismatch,
} from './core/charge-identity';

export { createChargeRaiser } from './core/charge-raise';
export type {
  ChargeRaiseDeps,
  ChargeRaiseGateway,
  ChargeRaiseLog,
  RaiseChargeRequest,
} from './core/charge-raise';
export { isValidCpf } from './core/cpf';
// Caller-side charge questions (FUT-760): what a reversal event reversed,
// whether a charge already raised is still payable, and the two instrument
// questions a checkout asks BEFORE any failover walk begins.
// Reacting to a verified webhook: which reversal shape a delivery is, and the
// FAN-IN deciding the order the reactions run in. See `./core/webhook-public`.
export * from './core/webhook-public';
export { chargeDeadlinePassed, hostedChargePayable, pixChargePayable } from './core/charge-reuse';
export { attributedCard, chainTokenizesInBrowser, holdsInstrumentFor } from './core/card-instrument';
// What a host may need to know about PagBank — its published Orders API hosts
// (FUT-760) and the variables that carry its credentials (FUT-764). Both are
// the adapter's facts, and the first adopting host wrote each out a sixth time
// before they moved. Listed in `./providers/pagbank-public`, which says why.
export * from './providers/pagbank-public';
export { promoteProvider } from './config/promote';
export { forgetVaultPointers, type VaultPointerRef } from './core/gateway-vault';
export {
  createConnectState,
  parseEnvironment,
  type ConnectAttribution,
  type ConnectState,
  type ConnectStateConfig,
  type MintedConnectState,
} from './config/connect-state';
export { attemptIdempotencyKey, attemptReference, baseReference, attemptReferencePrefix, ownsReference, suffixedReference } from './core/reference';

export { createPrismaAttemptLedger, type ChargeAttemptDelegate } from './prisma/attempt-ledger';
export { createPrismaChargeStore, type ChargeDelegate, type Cipher } from './prisma/stores';
export {
  createPrismaProviderConfigStore,
  type MerchantSettingsDelegate,
  type ProviderConfigDelegate,
  type TransactionRunner,
} from './prisma/config-store';
export { createPrismaWebhookInbox, type WebhookEventDelegate } from './prisma/webhook-inbox';

// ---- The wiring producer half (FUT-889) ----------------------------------
// Countable views over the two mounts and the receipt-mailer seam. The
// explicit export list lives in `wire/index.ts` (this file is at the size
// gate), exactly as the activation and platform blocks below do.
export * from './wire/index';

export {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
  createMemoryProviderConfigStore,
  type MemoryAttemptLedger,
  type MemoryChargeStore,
  type MemoryCredentialStore,
  type MemoryProviderConfigStore,
} from './memory';
export { createMemoryWebhookInbox, type MemoryWebhookInbox } from './memory-webhook-inbox';

// ---- Activation & verification (FUT-558) ---------------------------------
// The "prove a real charge actually moved" flow (FUT-463): probe amounts,
// the card and redirect verification charges, the pending-verification
// lifecycle, webhook settlement and the stranded-proof reconcile sweep.
// Hosts keep their routes and persistence and wire an ActivationContext.
// ---- Provider activation (the R$0,01 verification charge and its lifecycle)
// The explicit export list lives in `activation/index.ts` (this file is at the
// size gate), exactly as the platform block below does.
export * from './activation/index';

// ---- Platform operations (FUT-479 / FUT-483, packaged by FUT-573) ---------
// The PLATFORM's own PagBank surfaces — the Connect application consult with
// its redirect-URI mismatch verdict, and the homologação (paste-ready guide,
// sandbox evidence generator, outcome record). The explicit export list lives
// in `platform/index.ts` (this file is at the size gate); the matching
// screens live in `@12-apps/payments-frontend`.
export * from './platform/index';
