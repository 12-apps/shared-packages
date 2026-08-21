import type { CardDetails } from './card-details';
import type { CustomerInfo } from './customer-schema';
import type { SettlementHints } from './settlement-hints';
import type { WalletType } from './wallet-types';

export type { SettlementHints };
/** The probe verdict types, re-exported so `core/types` stays the one door. */
export type { ProbeCheck, ProbeFault, ProbeOutcome } from './probe';
/**
 * Domain types for the vendor-agnostic payments core.
 *
 * Everything a host app or a provider adapter exchanges goes through THESE
 * shapes — provider payloads never leak past an adapter boundary (they are
 * kept only as `raw` for audit). Amounts are integer minor units (cents),
 * matching the repo-wide "integer cents" house rule; there is no float money
 * anywhere in this package.
 */

/**
 * Open set of provider identifiers. Adapters self-describe their name; the
 * registry narrows it to a literal union per host (see `registry.ts`), so a
 * typo'd provider name fails typecheck in the host rather than at runtime.
 */
export type ProviderName = string;

/** Which credential set / API host an operation runs against. */
export type PaymentEnvironment = 'SANDBOX' | 'PRODUCTION';

/**
 * How the buyer pays. A closed union on purpose: hosts switch on it for UI
 * and adapters declare which kinds they support via capabilities. Growing it
 * is additive (adapters that don't list a kind simply never receive it).
 */
export type PaymentMethodKind = 'PIX' | 'CARD' | 'BOLETO';

/**
 * Normalized charge lifecycle. Every provider's status vocabulary is mapped
 * into this set by its adapter — hosts never branch on provider-specific
 * strings.
 *
 *   PENDING     created, awaiting payer action (PIX not yet paid, boleto open)
 *   AUTHORIZED  card authorized but not captured
 *   PAID        funds confirmed
 *   DECLINED    provider refused (see `declineReason`)
 *   CANCELED    voided before payment
 *   EXPIRED     payer window elapsed (PIX QR / boleto due date)
 *   REFUNDED    fully returned after payment
 *   PARTIALLY_REFUNDED  some amount returned, remainder kept
 */
export type ChargeStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'PAID'
  | 'DECLINED'
  | 'CANCELED'
  | 'EXPIRED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

/** Integer minor units + ISO-4217 currency. Never floats. */
export interface Money {
  amountCents: number;
  /** ISO 4217, e.g. 'BRL'. */
  currency: string;
}

/**
 * WHO is receiving the money for a given operation. This is the seam that
 * makes the library bidirectional:
 *
 *   - `PLATFORM` — the platform itself is the merchant (you charging your
 *     tenants: subscriptions, plan upgrades). Credentials come from the
 *     platform's own provider account.
 *   - `TENANT` — a tenant of the platform is the merchant (your customers
 *     charging THEIR buyers). Credentials come from that tenant's connected
 *     provider account, so funds land in the tenant's wallet, not yours.
 *
 * The core never hardcodes either direction; the host's `CredentialStore`
 * resolves a `MerchantRef` to whatever credential rows it keeps.
 */
export interface MerchantRef {
  kind: 'PLATFORM' | 'TENANT';
  /** Platform id (any stable constant) or the tenant/client id. */
  id: string;
}

/** The card-instrument shape, re-exported so `core/types` stays the one door. */
export type { CardDetails };
/** Everything needed to create a charge, provider-agnostically. */
export interface ChargeInput {
  /**
   * Host-side reference (e.g. the order id). Sent to the provider as its
   * reference/external id so provider dashboards correlate back to the host.
   */
  reference: string;
  amount: Money;
  method: PaymentMethodKind;
  customer: CustomerInfo;
  card?: CardDetails;
  pix?: { expiresInSeconds?: number };
  boleto?: { dueDate?: string };
  /**
   * What the buyer reads for this charge on a statement, a receipt or the
   * provider's dashboard — the host's own words, in the host's own language.
   *
   * All four adapters used to compose it themselves, each as `Pedido ${ref}`
   * capped at its provider's own limit. That put one product's Portuguese on
   * every adopter's card statements, and it was invisible to the copy gate
   * because "Pedido" carries no diacritic.
   *
   * Optional, and when it is absent the adapters send the bare
   * {@link ChargeInput.reference}: a reference alone is meaningful to whoever
   * reconciles it, and inventing a noun for a host that supplied none is the
   * exact silence this field replaces.
   */
  description?: string;
  /** Free-form pairs forwarded to the provider where supported. */
  metadata?: Record<string, string>;
  /**
   * Caller-supplied retry key (e.g. `${orderId}:${attempt}`), scoped to the
   * charging merchant. The gateway uses it to return the SAME stored charge
   * on a retried call, and adapters forward it to providers with native
   * idempotency support (e.g. Stripe's `Idempotency-Key` header) so even a
   * race that reaches the provider twice cannot double-charge.
   */
  idempotencyKey?: string;
}

/** Normalized decline taxonomy (superset of common acquirer reasons). */
export type DeclineReason =
  | 'INSUFFICIENT_FUNDS'
  | 'CARD_DECLINED'
  | 'INVALID_CARD'
  | 'EXPIRED_CARD'
  | 'FRAUD_SUSPECTED'
  | 'PROVIDER_ERROR'
  | 'UNKNOWN';

/**
 * The normalized view of a charge as the provider reports it — returned by
 * `createCharge`/`getCharge` and rebuilt from webhooks. This is what hosts
 * persist and render; `raw` carries the verbatim provider payload for audit
 * only.
 */
export interface ChargeSnapshot {
  provider: ProviderName;
  /** The provider's id for this charge — the cross-system idempotency key. */
  providerChargeId: string;
  /**
   * OUR reference (the order id), echoed back by the provider — the only field
   * here that can name the thing being paid for.
   *
   * `providerChargeId` cannot: what it means is a per-vendor accident (unique
   * per charge for PagBank/Stripe/Stone, EQUAL to this reference for
   * InfinitePay). A core that resolves orders through it is correct only while
   * vendors mint fresh ids; the first one that doesn't makes every attempt on
   * an order collide, and the order can then never be settled or re-paid. That
   * took a store's checkout down for a week.
   *
   * Every adapter already SENDS it (`reference_id`, `code`, `order_nsu`,
   * `metadata.reference`); `__tests__/snapshot-reference.test.ts` is where a new
   * provider finds out it must echo it back. Optional, because a payload may
   * omit it — callers then fall back to the `(provider, providerChargeId)`
   * lookup, exactly today's behaviour.
   */
  reference?: string;
  status: ChargeStatus;
  amount: Money;
  method: PaymentMethodKind;
  /** Present for PIX charges: what the buyer scans/copies. */
  pix?: { qrText: string; qrImageUrl?: string; expiresAt?: string };
  /** Present for boleto charges. */
  boleto?: { barcode?: string; documentUrl?: string; dueDate?: string };
  /**
   * Present for card charges. `vaultToken` is the REUSABLE token for a card the
   * provider agreed to store — never the one-time blob, which providers reject
   * on a second charge — normalized by the ADAPTER (FUT-740) so no host digs one
   * vendor's payload out of `raw`. Absent when nothing was vaulted.
   */
  card?: { brand?: string; last4?: string; authorizationCode?: string; vaultToken?: string };
  /**
   * Present when the provider runs a redirect/hosted checkout (e.g.
   * InfinitePay checkout links): send the buyer here instead of rendering a
   * native form.
   */
  hostedCheckoutUrl?: string;
  /**
   * Correlation the provider DEMANDS back when asked whether this charge
   * settled, and that only THIS response carries ({@link SettlementHints}).
   */
  settlementHints?: SettlementHints;
  declineReason?: DeclineReason;
  /**
   * The provider's OWN verdict on whether another attempt with the same
   * instrument could ever succeed — PagBank's "Retentável" column, Stripe's
   * documented next-step per decline code. Undefined when the provider offers
   * no such guidance.
   *
   * Separate from {@link declineReason} because the two answer different
   * questions and the reason cannot carry both: a malformed request and a
   * cancelled recurring mandate are terminal for completely different causes,
   * and a seven-value taxonomy has to flatten one of them into a lie. A caller
   * retrying on a timer reads THIS; a caller writing a message to a human
   * reads the reason.
   */
  declineRetriable?: boolean;
  /** Verbatim provider payload, for audit/debugging. Never branch on it. */
  raw?: unknown;
}

/** Refund request against a previously paid charge. */
export interface RefundInput {
  providerChargeId: string;
  /** Omit for a full refund; set for partial (capability-gated). */
  amount?: Money;
  reason?: string;
}

export interface RefundSnapshot {
  provider: ProviderName;
  providerChargeId: string;
  providerRefundId: string;
  /**
   * OUR reference (the order id), when the payload names it —
   * `ChargeSnapshot.reference`'s counterpart (FUT-477): a chargeback reported
   * through a LEGACY surface carries a transaction code no stored row is
   * keyed by, so this is the only handle to the order whose money went back.
   * Optional; absent, callers fall back to `(provider, providerChargeId)`.
   */
  reference?: string;
  status: 'PENDING' | 'REFUNDED' | 'FAILED';
  amount: Money;
  raw?: unknown;
}

/**
 * How card data gets from the buyer's browser to the provider without
 * touching the host's servers:
 *
 *   NONE        no client-side step (PIX/boleto only, or hosted checkout)
 *   PUBLIC_KEY  encrypt the card in-browser with the provider's public key
 *   SDK         load the provider's JS SDK / elements to mint a token
 *   REDIRECT    hosted checkout page; no card data in the host at all
 */
export type ClientTokenization = 'NONE' | 'PUBLIC_KEY' | 'SDK' | 'REDIRECT';

/**
 * The digital-wallet descriptors (FUT-471/472) — their own module for the
 * same reason as {@link SettlementHints} (this file's size gate); consumers
 * keep importing from `core/types`, the one door.
 */
export type {
  ApplePayActivation, ApplePayCsr, GooglePayClientConfig, WalletInstrument, WalletType,
} from './wallet-types';

/**
 * What a provider adapter can actually do. The gateway consults this BEFORE
 * calling an adapter, so "provider X can't do boleto" is a typed, uniform
 * `UnsupportedOperationError` — not a provider 400 with a vendor-specific
 * message.
 */
export interface ProviderCapabilities {
  methods: readonly PaymentMethodKind[];
  /**
   * The digital wallets this provider's card charge accepts (FUT-471/472).
   * Optional and defaulting to NONE at every gate — absence is never read as
   * "probably fine". Declaring one is a claim that `createCharge` understands
   * `card.wallet` of that type.
   */
  wallets?: readonly WalletType[];
  savedCards: boolean;
  refunds: boolean;
  partialRefunds: boolean;
  /** Marketplace-style split of one charge across recipients. */
  splits: boolean;
  webhooks: boolean;
  tokenization: ClientTokenization;
  /**
   * A browser can mint a card token for this provider, so the R$0,01
   * activation charge (FUT-463) is actually runnable.
   *
   * Separate from {@link tokenization} because that field does not answer the
   * question: PagBank and Stone both report `PUBLIC_KEY` while speaking
   * different protocols, and a browser scheme actually being WRITTEN is a
   * client-integration fact — Stripe reported `SDK` long before `stripe-pm`
   * existed (FUT-698), and only with it could the adapter honestly declare
   * the charge (FUT-689). Gating on `tokenization` alone bricked three.
   *
   * Optional and defaulting to FALSE at the gate: a new adapter cannot be
   * accidentally held to a proof it has no means of producing.
   */
  activationCharge?: boolean;
}

/**
 * A resolved credential set for one (merchant, provider, environment). The
 * `fields` keys correspond to the adapter's `credentialSchema`. Produced by
 * the host's `CredentialStore` — the core never reads env vars or a database
 * itself.
 */
export interface ResolvedCredentials {
  environment: PaymentEnvironment;
  fields: Record<string, string>;
  /**
   * When true the adapter must not call the real provider: it returns
   * deterministic fake results so local dev / CI run with no network and no
   * real account (mirrors the existing PagBank integration's stub mode).
   */
  stub?: boolean;
}

/**
 * The provider-CONNECTION descriptors — how a merchant authorizes an account,
 * OAuth included. Their own module for the same reason as {@link SettlementHints}
 * (this file's size gate), and re-exported here so every adapter and host keeps
 * importing them from `core/types`, which is the only path any of them uses.
 */
export type {
  OAuthAuthorizeRequest,
  OAuthTokens,
  ProviderAuthMode,
} from './connect-types';

// The buyer's identity and the BUYER-REQUIREMENTS descriptors (FUT-595) live
// in their own module; re-exported so consumers keep importing from here.
export type {
  CustomerFieldIssue, CustomerFieldKey, CustomerFieldSpec, CustomerFieldType,
  CustomerInfo, CustomerSchema,
} from './customer-schema';

/**
 * The provider ONBOARDING descriptors — how a merchant connects an account,
 * not how money moves. They live in their own module and are re-exported here
 * so every consumer keeps importing them from `core/types`, which is the only
 * path any adapter or host has ever used.
 */
export type {
  CredentialFieldSpec, OnboardingStage, ProviderSetupGuide, SetupCopy, SetupGuideContext,
  SetupLink, SetupProgress, SetupSection, SetupStep,
} from './setup-guide-types';

/**
 * Vaulting descriptors — saving an instrument for later off-session use. Their
 * own module for the same reason as the setup-guide types, and re-exported
 * here so adapters and hosts keep importing from `core/types`.
 */
export type {
  VaultBeginInput,
  VaultCompleteInput,
  VaultedInstrument,
  VaultForgetInput,
  VaultSession,
} from './vault-types';

/**
 * The webhook DELIVERY/EVENT shapes — their own module for the same reason as
 * {@link SettlementHints} (this file's size gate), re-exported here so every
 * adapter and host keeps importing them from `core/types`, the one door.
 */
export type { IntakeFreshness, NormalizedWebhookEvent, WebhookDelivery } from './webhook-event-types';
