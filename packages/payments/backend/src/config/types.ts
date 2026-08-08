import type {
  MerchantRef,
  PaymentEnvironment,
  ProviderAuthMode,
  ProviderCapabilities,
  ProviderName,
} from '../core/types';
import type { CredentialFieldSpec } from '../core/types';

/**
 * Merchant-facing provider-configuration domain — the server equivalent of
 * the "Pagamentos" settings page, made vendor-agnostic. Mirrors the proven
 * per-store PagBank integration semantics: both environments' credential
 * sets stored side by side, masked reads only, write-only secrets with
 * preserve/clear/replace update semantics, and an explicit verify step.
 */

/**
 * UNVERIFIED → saved but never proven; VERIFIED/FAILED after a probe;
 * RECONNECT_REQUIRED → an OAuth connection expired or was revoked at the
 * provider. It is deliberately distinct from FAILED because the remedy
 * differs: reauthorize (a button) rather than fix credentials (a form).
 */
/**
 * The activation charge a merchant has been sent to pay, and has not yet
 * (FUT-463).
 *
 * Two jobs, both learned only at creation time and both lost the moment this
 * is not persisted:
 *
 *   1. It is the receipt for "a charge already exists". Without it, coming
 *      back to the settings page offers to generate one — a SECOND real charge
 *      on the owner's own card, while the first, already paid, is abandoned.
 *   2. It carries what confirmation needs. InfinitePay's `payment_check` takes
 *      `handle`, `order_nsu`, `transaction_nsu` and `slug`; the `slug` (its
 *      invoice code) comes back only in the response that mints the link, so
 *      asking later with the reference alone answers "not paid" forever.
 */
export interface PendingVerification {
  /** The reference the charge was minted under — the correlation key. */
  reference: string;
  /** Where the merchant pays it. Empty for a card attempt — nothing to visit. */
  checkoutUrl: string;
  /** Provider-side invoice code, when the provider returns one. */
  slug?: string;
  /** ISO timestamp the charge was minted — what "how long has this been open" reads. */
  startedAt: string;
  /**
   * Which activation flow wrote it (FUT-679). `CARD` marks the card phase's
   * write-ahead intent: recorded BEFORE `createCharge`, cleared on any settled
   * answer, and therefore still present exactly when a create's response was
   * lost with a real cent possibly charged — the row the reconcile sweep and
   * the retry path resolve through `findChargeByReference`. Absent on redirect
   * rows (including every row written before this field existed), whose
   * lifecycle is unchanged.
   */
  phase?: 'CARD';
}

export type ProviderConfigStatus = 'UNVERIFIED' | 'VERIFIED' | 'FAILED' | 'RECONNECT_REQUIRED';

/**
 * Whether a DECLINE advances the merchant's chain, or only technical failures
 * do. Mirrors the gateway's `FailoverPolicy`; declared here too so the
 * settings domain does not have to import from `core/`.
 */
export type MerchantFailoverPolicy = 'TECHNICAL' | 'TECHNICAL_AND_DECLINE';

/**
 * The DECRYPTED stored state of one (merchant, provider) connection. Only
 * the `ProviderConfigStore` and the settings service ever see this shape —
 * it never crosses the server→client boundary (that's `MaskedProviderConfig`).
 */
export interface StoredProviderConfig {
  provider: ProviderName;
  /**
   * In the merchant's failover chain. A provider may be fully configured and
   * still sit out of rotation — enablement and rank are independent controls.
   */
  enabled: boolean;
  /**
   * Rank within the chain, ASCENDING (0 is tried first). Meaningful only
   * while `enabled`; distinct among a merchant's enabled rows, enforced by a
   * partial unique index in the owned migration.
   */
  priority: number;
  /** Which environment's credential set charge/webhook resolvers use. */
  environment: PaymentEnvironment;
  status: ProviderConfigStatus;
  lastVerifiedAt: Date | null;
  /**
   * When a REAL charge through this connection last succeeded — the gate on
   * entering the failover chain (FUT-463).
   *
   * `status: 'VERIFIED'` is not the same claim: it comes from the credential
   * probe, which asks whether the keys authenticate. PagBank answers yes to
   * that and still refuses every real charge until the integration is
   * homologated, so a probe-verified store can be switched on and decline
   * every shopper.
   *
   * Null means never proven. It outlives `enabled` on purpose — an owner who
   * proved it once and then paused the provider must not have to prove it
   * again to unpause.
   */
  chargeVerifiedAt: Date | null;
  /**
   * The activation charge currently OUTSTANDING, or null when none is
   * (FUT-463). Durable because it is about MONEY: held in the browser, it was
   * erased by a refresh — or by coming back to the tab after paying on the
   * provider's own site, which is what the flow asks the owner to do — and the
   * screen then offered to generate a charge again, minting a second real one.
   */
  pendingVerification: PendingVerification | null;
  /**
   * When the active connection stops working — OAuth access-token expiry.
   * Its own queryable column (not inside the encrypted blob) so a host can
   * ask "which connections expire soon" and refresh them in the background.
   * Always null for `credentials`-mode providers, which do not expire.
   */
  expiresAt: Date | null;
  /**
   * When true the provider adapter runs in stub mode (deterministic fakes,
   * no network) — local dev / demo tenants, same contract as PagBank's stub
   * mode. Never enable for a real merchant.
   */
  stub: boolean;
  /** Decrypted field values per environment, keyed by `credentialSchema` keys. */
  environments: Record<PaymentEnvironment, Record<string, string>>;
}

/**
 * Storage port for provider configurations. The host implements it (Prisma
 * adapter in `prisma/stores.ts`, in-memory in `memory.ts`); ENCRYPTION AT
 * REST is the implementation's job — the port speaks decrypted values, the
 * database must never see them in plaintext.
 */
export interface ProviderConfigStore {
  get(merchant: MerchantRef, provider: ProviderName): Promise<StoredProviderConfig | null>;
  list(merchant: MerchantRef): Promise<StoredProviderConfig[]>;
  save(merchant: MerchantRef, config: StoredProviderConfig): Promise<void>;
  /**
   * Connections whose grant lapses before `before` — the work list for a
   * renewal sweep, across every merchant.
   *
   * Cross-merchant on purpose: renewal is not something a merchant triggers,
   * so there is no merchant to scope the question to. `expiresAt` is a column
   * rather than a field inside the encrypted blob precisely so this can be a
   * query instead of a decrypt-everything scan.
   *
   * Only rows that CAN be renewed are returned: an expiry must be set (a
   * credential-mode provider never has one) and the connection must not
   * already be standing in `RECONNECT_REQUIRED`, whose stored token is dead —
   * presenting it again just spends a request to be told so.
   */
  listExpiring(before: Date, limit: number): Promise<ExpiringConnection[]>;
  /**
   * Replace the merchant's whole failover chain ATOMICALLY. `ordered` is the
   * complete enabled set in priority order: each listed provider becomes
   * enabled at rank = its index, and every provider NOT listed is disabled.
   * Pass `[]` to take payments offline.
   *
   * Whole-chain rather than per-provider on purpose — "move Stone above
   * PagBank" is one intent, and expressing it as two writes is what lets a
   * crash or a race leave ranks duplicated or gapped.
   *
   * REQUIRED, and required for a reason: sequential writes can leave two
   * providers sharing rank 0 under concurrency, or none enabled at all if a
   * later write fails — the second of which silently takes checkout offline.
   * There is deliberately no fallback for stores that skip this. The owned
   * migration also enforces distinct ranks with a partial unique index, so a
   * losing racer fails loudly rather than corrupting the order.
   */
  setProviderPriorities(merchant: MerchantRef, ordered: readonly ProviderName[]): Promise<void>;
  /**
   * The merchant's failover policy. Returns `TECHNICAL` for a merchant with
   * no stored row — cascading a decline is opt-in, never inherited.
   */
  getFailoverPolicy(merchant: MerchantRef): Promise<MerchantFailoverPolicy>;
  setFailoverPolicy(merchant: MerchantRef, policy: MerchantFailoverPolicy): Promise<void>;
  /**
   * Add one provider to the chain (appended LAST) or remove it, ATOMICALLY.
   *
   * Separate from `setProviderPriorities` because it is a read-modify-write
   * and that one is not: a reorder carries the merchant's complete intended
   * chain, whereas a toggle has to know the CURRENT chain to preserve it.
   * Computing that chain in the caller and posting the result back would let
   * two overlapping toggles each read the same chain and each write one
   * missing the other's change — silently leaving a provider enabled or
   * disabled that the admin did not touch. Implementations must therefore
   * read and write inside ONE transaction.
   */
  setProviderEnabled(
    merchant: MerchantRef,
    provider: ProviderName,
    enabled: boolean,
  ): Promise<void>;
}

/** One connection due for renewal, with just enough to go and renew it. */
export interface ExpiringConnection {
  merchant: MerchantRef;
  provider: ProviderName;
  expiresAt: Date;
}

/**
 * Client-safe identity of the account an OAuth connection was granted for —
 * what lets the settings page answer "connected as WHOM", not merely
 * "configured" (FUT-300). Never a credential: these are the identity facts the
 * provider reported beside the tokens at exchange time, copied out of the
 * stored fields by the masking path (see `config/connected-account.ts`).
 */
export interface ConnectedOAuthAccount {
  /** Provider-side account id (e.g. PagBank's `ACCO_…`), or null if unreported. */
  accountId: string | null;
  /** Human-recognizable name/email, when the provider supplied one. */
  accountLabel: string | null;
  /** The scopes the owner granted, as the provider reported them. */
  grantedScopes: readonly string[];
  /** ISO timestamp of when the authorization completed; null for legacy rows. */
  connectedAt: string | null;
}

/** Client-safe state of ONE credential field: never the secret itself. */
export interface MaskedFieldState {
  configured: boolean;
  /** `••••1234`-style tail hint for secrets; full value for non-secrets. */
  hint: string | null;
}

/** Client-safe view of one environment's credential set. */
export type MaskedFields = Record<string, MaskedFieldState>;

/** Client-safe view of one (merchant, provider) connection. */
export interface MaskedProviderConfig {
  provider: ProviderName;
  enabled: boolean;
  /** Rank in the failover chain (ascending); meaningful only when enabled. */
  priority: number;
  environment: PaymentEnvironment;
  status: ProviderConfigStatus;
  lastVerifiedAt: string | null;
  /**
   * ISO timestamp of the last SUCCESSFUL real charge, or null if never — what
   * the settings screen gates the "Ativo" switch on. See the stored twin.
   */
  chargeVerifiedAt: string | null;
  /** ISO timestamp when an OAuth connection expires; null when it cannot. */
  expiresAt: string | null;
  stub: boolean;
  /** Masked hints for BOTH environments, so the form can switch without reload. */
  environments: Record<PaymentEnvironment, MaskedFields>;
  /**
   * WHO is connected, for an OAuth-mode provider that reported it — see
   * {@link ConnectedOAuthAccount}. Null for credentials-mode providers, for
   * rows that are not connected, and for grants made before the identity was
   * recorded.
   */
  connectedAccount: ConnectedOAuthAccount | null;
}

/** Static description of a provider, for rendering its settings form. */
export interface ProviderDescriptor {
  name: ProviderName;
  displayName: string;
  /**
   * The provider's URL spelling — the adapter's declared `urlSlug`, resolved
   * to `name` when none is. Carried in the catalog so a host whose settings
   * screen puts each provider on its own page can build and parse those paths
   * from the adapter's own knowledge rather than a hardcoded map.
   */
  urlSlug: string;
  capabilities: ProviderCapabilities;
  /** Drives the settings UI: credential form vs. connect button. */
  authMode: ProviderAuthMode;
  credentialSchema: readonly CredentialFieldSpec[];
}

/** The whole settings-page payload: catalog + per-provider state. */
export interface MerchantSettingsView {
  providers: ProviderDescriptor[];
  configs: MaskedProviderConfig[];
  /**
   * The enabled providers in failover order — what checkout will actually
   * walk. The reorder UI renders from this.
   */
  providerChain: ProviderName[];
  /** Head of the chain, or null when payments are off. */
  activeProvider: ProviderName | null;
  /**
   * Whether a declined card may be retried on the next acquirer. Defaults to
   * TECHNICAL — technical failures fail over, declines do not.
   */
  failoverPolicy: MerchantFailoverPolicy;
}

/**
 * Credential update payload. Field semantics (same contract as the PagBank
 * settings form): `undefined` PRESERVES the stored value (rotation without
 * re-entry), empty string CLEARS it, non-empty REPLACES it.
 *
 * NOTE: there is deliberately NO `stub` field here. Stub mode makes card
 * charges report `PAID` with no provider call, so it must never be
 * reachable from a request body — it is a deployment-level decision passed
 * to {@link createSettingsService} and refused outright in PRODUCTION.
 */
export interface SaveCredentialsInput {
  environment: PaymentEnvironment;
  fields: Record<string, string | undefined>;
}
