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
export {
  createPaymentsGateway,
  type ChargeOptions,
  type PaymentsGateway,
  type PaymentsGatewayConfig,
} from './core/gateway';
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
export type { PaymentProviderAdapter } from './core/provider';
export type {
  AttemptLedger,
  ChargeAttemptRecord,
  ChargeStore,
  CredentialStore,
  StoredCharge,
  WebhookEventHandler,
  WebhookInbox,
} from './core/ports';
export { isForwardTransition, isTerminal } from './core/status';
export { withMerchantRedirectUrl, withMerchantWebhookUrl } from './core/webhook-url';
export type { MerchantWebhookUrlResolver } from './core/webhook-url';
export {
  toClientChargeView,
  isSettled,
  type ClientChargeView,
} from './core/client-view';
export {
  AmbiguousChargeError,
  ChargeDeclinedError,
  ChargeNotPersistedError,
  CredentialsError,
  NoProviderSucceededError,
  PaymentsError,
  ProviderRequestError,
  UnknownProviderError,
  UnsupportedOperationError,
  WebhookVerificationError,
} from './core/errors';
export type { ProviderRequestSnapshot } from './core/errors';

export type {
  CardDetails,
  ChargeInput,
  ChargeSnapshot,
  ChargeStatus,
  ClientTokenization,
  CredentialFieldSpec,
  CustomerInfo,
  DeclineReason,
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
export { type VerifiedProviderConfig } from './config/verify';
export {
  createOAuthConnectService,
  type OAuthAppCredentialsResolver,
  type OAuthConnectService,
  type RevokeFailure,
  type RevokeFailureReporter,
} from './config/oauth';
export type {
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
  type PaymentsHttpHandlers,
  type PaymentsRequestContext,
} from './http/handlers';

export {
  createPrismaAttemptLedger,
  type ChargeAttemptDelegate,
} from './prisma/attempt-ledger';
export { createPrismaChargeStore, type ChargeDelegate, type Cipher } from './prisma/stores';
export {
  createPrismaProviderConfigStore,
  type MerchantSettingsDelegate,
  type ProviderConfigDelegate,
  type TransactionRunner,
} from './prisma/config-store';
export {
  createPrismaWebhookInbox,
  type WebhookEventDelegate,
} from './prisma/webhook-inbox';

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
export {
  createMemoryWebhookInbox,
  type MemoryWebhookInbox,
} from './memory-webhook-inbox';
