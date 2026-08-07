import type {
  ChargeInput,
  ChargeSnapshot,
  ClientTokenization,
  CredentialFieldSpec,
  CustomerSchema,
  NormalizedWebhookEvent,
  ProviderCapabilities,
  OAuthAuthorizeRequest,
  OAuthTokens,
  ProviderAuthMode,
  ProbeOutcome,
  ProviderName,
  ProviderSetupGuide,
  SetupGuideContext,
  RefundInput,
  RefundSnapshot,
  ResolvedCredentials,
  WebhookDelivery,
} from './types';
import type { SettlementHints } from './settlement-hints';
import type {
  VaultBeginInput,
  VaultCompleteInput,
  VaultedInstrument,
  VaultForgetInput,
  VaultSession,
} from './vault-types';

/**
 * How a provider's webhook deliveries can serve as PROOF OF PAYMENT — one
 * indivisible declaration, never two independent flags (FUT-726).
 *
 * Reconciliation settles a stranded activation charge from a PROCESSED inbox
 * row, and that takes two facts about the SAME provider: that a verified
 * delivery means money moved, and which host reference that delivery names.
 * As separate optional fields they can be half-written — an adapter that
 * declares the flag and forgets the reader typechecks, registers and serves
 * traffic, while every stranded activation of its merchants quietly stops
 * healing, with nothing thrown, nothing logged and no test red. That silent
 * half is the failure this pairing removes: the union has no member with one
 * without the other, so the day a second provider declares the flag the
 * compiler asks it for the reader too.
 */
export type DeliveryPaymentProof =
  | {
      /**
       * True when this adapter's `webhook.verify` step confirms THE PAYMENT
       * with the provider itself, not merely the sender of the delivery (the
       * case for an unsigned-webhook provider whose verify re-asks the
       * provider's own payment-check API). For such a provider, a delivery the
       * host has verified and processed is durable proof that money moved, and
       * reconciliation may settle state from it.
       */
      readonly verifyConfirmsPayment: true;
      /**
       * The host-side reference THIS provider's delivery payload names — the
       * `reference` `createCharge` sent, read back out of a raw webhook body —
       * or null when the payload names none.
       *
       * The correlation key is a fact about the provider's payload shape (for
       * InfinitePay it is `order_nsu`), so the adapter declares how to read it
       * rather than any caller parsing one vendor's field: such a parse would
       * answer confidently — and wrongly — for the second provider to arrive.
       * The flag says a PROCESSED row proves payment; this says WHICH charge it
       * proves. Takes the raw stored payload string, because that is what an
       * inbox durably holds; a body that does not parse answers null.
       */
      readonly referenceOfDelivery: (payload: string) => string | null;
    }
  | {
      /**
       * Signature-verified providers leave both unset: their verify proves who
       * sent the body, never that anything was paid, so their PROCESSED rows
       * are not proof and there is nothing to correlate.
       */
      readonly verifyConfirmsPayment?: false;
      readonly referenceOfDelivery?: never;
    };

/**
 * The adapter contract — the ONE seam every provider integration implements.
 * Adding a vendor means writing one object of this shape and registering it;
 * nothing in the core, the storage ports, or the host's UI changes.
 *
 * Rules adapters must follow:
 *   - Normalize EVERYTHING: statuses, decline reasons, webhook events. No
 *     provider vocabulary escapes the adapter (raw payloads ride along only
 *     in `raw` for audit).
 *   - Honor `credentials.stub`: when set, return deterministic fakes and make
 *     NO network call (local dev / CI parity — same contract as the existing
 *     PagBank integration's stub mode).
 *   - Be stateless. Credentials arrive per call; adapters never cache them,
 *     so one adapter instance safely serves every merchant and environment.
 *
 * An adapter is this shape PLUS a {@link DeliveryPaymentProof} declaration —
 * kept a separate union because those two members must move together.
 */
export type PaymentProviderAdapter = PaymentProviderAdapterBase & DeliveryPaymentProof;

export interface PaymentProviderAdapterBase {
  readonly name: ProviderName;
  /** Human-facing label for config UIs ("Stone", "InfinitePay", ...). */
  readonly displayName: string;
  /**
   * The provider's URL spelling — how its name travels in a path segment
   * (the host's per-provider settings page, a hosted checkout's return URL).
   * Most names are one word and go unchanged; a provider whose name reads as
   * two words declares the hyphenated form here, because that is what someone
   * typing or reading the link expects. Defaults to `name`.
   *
   * Hosts resolve it through the registry (`urlSlugOf` / `providerForUrlSlug`),
   * which also keeps the raw name working as an alias so links built before an
   * adapter declared a slug do not 404.
   */
  readonly urlSlug?: string;
  /**
   * The smallest total this provider will actually create a charge for, in
   * minor units. Omitted means one cent. This is a fact about the provider's
   * own API — typically learned from its refusals — so it is declared by the
   * adapter rather than kept in a host-side table; the host's activation
   * charge raises its one-cent proof to this floor.
   */
  readonly minimumChargeCents?: number;
  /**
   * Historical per-merchant webhook PATH this provider's merchants registered
   * in its dashboard before the host's generic payments webhook route existed.
   * Declared per adapter because it is a fact about that provider's install
   * base: the URL lives in dashboards the platform cannot edit, so the host
   * must keep announcing (and serving) this exact path — byte-identical,
   * forever. Adapters without a legacy path omit it and land on the host's
   * generic route.
   */
  readonly webhookPath?: (tenantSlug: string) => string;
  readonly capabilities: ProviderCapabilities;
  /**
   * How merchants connect this provider. Defaults to `credentials` (paste
   * API keys) when omitted, which is what every adapter here does today.
   * `oauth` adapters implement the `oauth` block below and are rendered as
   * a connect button instead of a credential form.
   */
  readonly authMode?: ProviderAuthMode;
  /** What the host must collect/store to connect a merchant account. */
  readonly credentialSchema: readonly CredentialFieldSpec[];
  /**
   * What this provider asks OF THE BUYER, per field and per method (FUT-595) —
   * `credentialSchema`'s sibling for the checkout form. Three states: a spec
   * with `required: true`, a spec with `required: false`, or no spec at all
   * (not asked — never validated, never blocks a charge). Published to the
   * browser via the gateway's client config, so the checkout renders the buyer
   * form from the declaration and asks for nothing else; enforced server-side
   * by the charge walk before `createCharge` is ever called.
   *
   * Omitted means "asks the buyer for nothing" — same as `[]`. A REDIRECT
   * adapter should still declare what its own hosted page will demand (e.g.
   * InfinitePay's phone): the walk does not block on it, because the
   * provider's page is the collector, but the host may collect ahead to
   * pre-fill. See `core/customer-schema.ts` for the shape and the rules.
   */
  readonly customerSchema?: CustomerSchema;

  /**
   * The buyer CHECKOUT SCREEN this provider's flow needs (FUT-596), as an
   * opaque id the adapter and the checkout registry agree on — the same
   * contract as `SetupStep.action`, one layer down in the buyer's journey.
   *
   * It names the SHAPE OF THE FLOW, never the vendor: `'pix-and-card'` is a
   * store that shows a PIX code and takes a card typed here, `'hosted-link'`
   * is one that hands the buyer to the provider's own page. Two providers with
   * the same shape declare the same id and share one screen — which is the
   * point, and is not expressible if the id is a vendor name.
   *
   * Omitted means the CAPABILITY DEFAULT: the shell composes the pane from
   * `capabilities` exactly as it did before this field existed. So a new
   * adapter checks out on the day it is written, and an id THIS frontend has
   * never heard of degrades to that same default rather than to a blank pane.
   * The two packages version independently and a host may run a newer backend
   * than bundle — the buyer must never pay for that skew.
   */
  readonly checkoutScreen?: string;

  /**
   * Cheap authenticated call proving the credentials work (the "Verificar"
   * button). Never throws for bad credentials — that's a result, not a bug.
   */
  verifyCredentials(credentials: ResolvedCredentials): Promise<ProbeOutcome>;

  createCharge(input: ChargeInput, credentials: ResolvedCredentials): Promise<ChargeSnapshot>;

  /**
   * Poll the provider for a charge's current state (webhook fallback).
   *
   * `hints` carries what some providers DEMAND before they will answer at all —
   * see {@link SettlementHints}. InfinitePay's `payment_check` is the case:
   * asked with the reference alone it reports "not paid" indefinitely, so the
   * buyer's own checkout poll — the only reconciliation that runs when a
   * webhook goes missing — could never rescue a genuinely paid order.
   */
  getCharge(
    providerChargeId: string,
    credentials: ResolvedCredentials,
    hints?: SettlementHints,
  ): Promise<ChargeSnapshot>;

  /**
   * RECONCILIATION PROBE — look a charge up by the HOST's reference (the
   * `reference`/external-id the adapter sent when creating it), not by the
   * provider's own id, which an ambiguous failure never returned.
   *
   * This is what makes failover safe. When `createCharge` fails in a way that
   * could mean either "never arrived" or "created and the response was lost",
   * the gateway calls this before touching the next provider:
   *
   *   resolves to a snapshot → that charge EXISTS. Adopt it; do not fail over.
   *   resolves to null       → proven no charge. Safe to fail over.
   *   THROWS                 → the probe itself failed. The gateway stops the
   *                            walk with an `AmbiguousChargeError` rather than
   *                            guess. Do NOT swallow errors here and return
   *                            null: that would convert "unknown" into
   *                            "proven safe" and re-open the double-charge.
   *
   * OPTIONAL, and its absence has a real routing consequence: a provider that
   * cannot answer this question can never be failed over FROM on an ambiguous
   * error, so in practice it should sit LAST in a merchant's chain. The
   * gateway surfaces the gap as `probeResult: 'UNSUPPORTED'`.
   */
  findChargeByReference?(
    reference: string,
    credentials: ResolvedCredentials,
    hints?: SettlementHints,
  ): Promise<ChargeSnapshot | null>;

  /**
   * VAULTING — save an instrument for later off-session use, without charging
   * (FUT-340). Optional, and its absence is meaningful: a provider that cannot
   * vault a card without taking money is one a subscription cannot be set up
   * on, and the gateway says so with `UnsupportedOperationError` rather than
   * inventing a charge nobody agreed to.
   *
   * `complete` MUST verify the session it is handed belongs to the given
   * `customerRef`. It is reached from a browser, so the session id is
   * attacker-controlled and names an object at the PROVIDER — without that
   * check a tenant could complete a stranger's vaulting session and attach
   * their card. See `core/vault-types.ts`.
   */
  vault?: {
    begin(input: VaultBeginInput, credentials: ResolvedCredentials): Promise<VaultSession>;
    complete(
      input: VaultCompleteInput,
      credentials: ResolvedCredentials,
    ): Promise<VaultedInstrument>;
    /**
     * Stop storing an instrument the host vaulted earlier. Optional INSIDE an
     * adapter that can vault, and the split is deliberate: "can save a card"
     * and "can un-save one" are separate facts about a vendor, and a host that
     * assumed the second from the first would silently leave cards on file at
     * a provider after the tenant asked for them to be removed.
     *
     * Its input is host-side (see `core/vault-types.ts`), so unlike `complete`
     * there is nothing here to authenticate. What it must get right is the
     * failure vocabulary: an id the provider will never act on has to arrive
     * as a NON-retriable `ProviderRequestError`, because the host reads that
     * to mean "retrying will not help" and drops its pointer regardless.
     */
    forget?(input: VaultForgetInput, credentials: ResolvedCredentials): Promise<void>;
  };

  /** Void a not-yet-paid charge. Optional: capability-gated by the gateway. */
  cancelCharge?(providerChargeId: string, credentials: ResolvedCredentials): Promise<ChargeSnapshot>;

  /** Optional: capability-gated by the gateway (`capabilities.refunds`). */
  refund?(input: RefundInput, credentials: ResolvedCredentials): Promise<RefundSnapshot>;

  /**
   * Webhook handling, split in two so the gateway can dedup between the
   * steps: `verify` authenticates the delivery against the merchant's
   * webhook secret; `parse` extracts normalized events from an
   * already-verified body.
   */
  webhook: {
    verify(delivery: WebhookDelivery, credentials: ResolvedCredentials): Promise<boolean>;
    /**
     * Credentials are passed because a body is not always its own authority:
     * an adapter for an UNSIGNED provider can only report an amount it re-read
     * from the provider, and the amount is load-bearing (a host's shortfall
     * guard compares it against what the order is worth). Adapters whose
     * deliveries are signed simply ignore the second argument.
     */
    parse(
      delivery: WebhookDelivery,
      credentials: ResolvedCredentials,
    ): Promise<NormalizedWebhookEvent[]>;
  };

  /**
   * OAuth connect flow — present only on `authMode: 'oauth'` adapters.
   * Deliberately typed now, ahead of the first implementation, so adding
   * Stripe Connect / PagBank Connect later is not a breaking change to a
   * package that other repositories already depend on.
   *
   * `appCredentials` are the PLATFORM's application credentials
   * (client id/secret), which are shared across merchants — distinct from
   * the per-merchant tokens the flow produces.
   */
  oauth?: {
    /** Where to send the merchant, plus the CSRF state the host must echo. */
    buildAuthorizeUrl(
      appCredentials: ResolvedCredentials,
      ctx: { state: string; redirectUri: string },
    ): Promise<OAuthAuthorizeRequest>;
    /** Trade the callback code for per-merchant tokens. */
    exchangeCode(
      code: string,
      appCredentials: ResolvedCredentials,
      ctx: { redirectUri: string },
    ): Promise<OAuthTokens>;
    /** Renew before `expiresAt`; hosts schedule this off the stored column. */
    refresh(current: ResolvedCredentials, appCredentials: ResolvedCredentials): Promise<OAuthTokens>;
    /** Disconnect at the provider (best effort) when the merchant revokes. */
    revoke?(current: ResolvedCredentials, appCredentials: ResolvedCredentials): Promise<void>;
  };

  /**
   * The provider's step-by-step onboarding screen (stepper stages +
   * walkthrough sections with links and copy-paste fields). Optional; the
   * settings UI renders it when present.
   */
  setupGuide?(ctx: SetupGuideContext): ProviderSetupGuide;

  /**
   * The client-safe config the frontend needs to start this provider's
   * tokenization flow (publishable key, checkout base URL, ...). MUST NOT
   * include secrets — this object crosses the server→client boundary.
   */
  clientConfig(credentials: ResolvedCredentials): {
    provider: ProviderName;
    tokenization: ClientTokenization;
    /** e.g. publishable/public key for PUBLIC_KEY and SDK flows. */
    publicKey?: string;
  };
}
