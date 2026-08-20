import type { CustomerSchema } from './customer-schema';
import type { PaymentProviderAdapter } from './provider';
import type {
  ChargeSnapshot,
  ChargeStatus,
  ClientTokenization,
  GooglePayClientConfig,
  Money,
  PaymentMethodKind,
  ProviderName,
  ResolvedCredentials,
  WalletType,
} from './types';

/**
 * The client-safe projection of a charge — the ONLY charge shape that may
 * cross the server→client boundary. Deliberately a subset of
 * {@link ChargeSnapshot}: no `raw` provider payload, no decline internals
 * beyond the normalized reason. Server routes build it with
 * {@link toClientChargeView}; the React binding consumes it.
 */
export interface ClientChargeView {
  provider: ProviderName;
  providerChargeId: string;
  status: ChargeStatus;
  amount: Money;
  method: PaymentMethodKind;
  pix?: { qrText: string; qrImageUrl?: string; expiresAt?: string };
  boleto?: { barcode?: string; documentUrl?: string; dueDate?: string };
  card?: { brand?: string; last4?: string };
  hostedCheckoutUrl?: string;
  declineReason?: ChargeSnapshot['declineReason'];
}

export function toClientChargeView(snapshot: ChargeSnapshot): ClientChargeView {
  return {
    provider: snapshot.provider,
    providerChargeId: snapshot.providerChargeId,
    status: snapshot.status,
    amount: snapshot.amount,
    method: snapshot.method,
    pix: snapshot.pix,
    boleto: snapshot.boleto,
    card: snapshot.card
      ? { brand: snapshot.card.brand, last4: snapshot.card.last4 }
      : undefined,
    hostedCheckoutUrl: snapshot.hostedCheckoutUrl,
    declineReason: snapshot.declineReason,
  };
}

/**
 * The provider's SECOND correlation id, when it has one distinct from the
 * charge id (PagBank's `ORDE_…`), falling back to the charge id.
 *
 * Hosts persist it because some providers' webhooks and status reconciles key
 * on it rather than on the charge id.
 *
 * ASKED OF THE ADAPTER FIRST. `settlementHints.orderId` is the NORMALIZED
 * answer — the adapter states which of its ids the read API is keyed by — and
 * it is preferred over everything below it. Reading a field named `id` off an
 * arbitrary vendor payload is a guess that happens to be right for one
 * provider; it was deleted from the first adopting host for exactly that
 * reason (FUT-760), and leaving it as the FIRST choice here would have kept
 * the same guess alive one layer down.
 *
 * The `raw` read stays as the fallback, for adapters that declare no hints
 * yet — for PagBank the two agree, so nothing moves. It remains guarded: a
 * payload with no top-level string `id` simply yields the charge id, no cast
 * and no crash.
 */
export function providerCorrelationId(snapshot: ChargeSnapshot): string {
  const declared = snapshot.settlementHints?.orderId;
  if (typeof declared === 'string' && declared !== '') return declared;

  const raw: unknown = snapshot.raw;
  if (raw && typeof raw === 'object') {
    const id = (raw as Record<string, unknown>).id;
    if (typeof id === 'string' && id !== '') return id;
  }
  return snapshot.providerChargeId;
}

/** Charge states the frontend should stop polling on. */
export function isSettled(status: ChargeStatus): boolean {
  return status !== 'PENDING' && status !== 'AUTHORIZED';
}

/**
 * The client-safe provider config the gateway hands to hosts — what the
 * adapter's `clientConfig` returns, plus the adapter's declared buyer
 * requirements (FUT-595). `customerSchema` rides here rather than in each
 * adapter's `clientConfig` because it is a static declaration, not a
 * per-credential fact: stamping it centrally means no adapter (nor any future
 * one) can forget to publish it, the same way the gateway owns capability
 * gating. Everything in it is client-safe by construction — field keys,
 * types and requiredness, no secrets — and it is exactly what the checkout
 * needs to render the buyer form from the declaration and ask for nothing
 * else.
 */
export interface ClientProviderConfig {
  provider: ProviderName;
  /**
   * The provider's own name, as a BUYER should read it ("InfinitePay").
   *
   * Stamped from `adapter.displayName` for the same reason `methods` is: the
   * adapter's declaration is the single source, and a second copy inside each
   * `clientConfig` is the one that drifts. It is published to the buyer — not
   * only to the merchant's settings page — because a checkout that hands the
   * buyer to another site owes them the site's name before they leave it.
   */
  displayName: string;
  tokenization: ClientTokenization;
  /** e.g. publishable/public key for PUBLIC_KEY and SDK flows. */
  publicKey?: string;
  /** Normalized: an adapter that declares nothing publishes `[]`. */
  customerSchema: CustomerSchema;
  /**
   * The METHODS the adapter's capabilities say it can charge (FUT-698).
   * Stamped by the gateway rather than declared by each adapter, for the same
   * reason refund gating reads `capabilities` there: the capability table is
   * the single source of what an adapter can do, and a second per-adapter
   * copy inside `clientConfig` would be the one that drifts — in the
   * direction of a checkout offering a method the walk then refuses.
   */
  methods: readonly PaymentMethodKind[];
  /**
   * The digital wallets the adapter's capabilities declare (FUT-471/472).
   * Stamped by the gateway for the same reason `methods` is: the capability
   * table is the single source, and a per-adapter copy inside `clientConfig`
   * would drift — in the direction of a wallet button the charge then refuses.
   * Normalized: an adapter that declares nothing publishes `[]`.
   */
  wallets: readonly WalletType[];
  /**
   * Google Pay's PAYMENT_GATEWAY parameters, or `null` when this provider
   * cannot run it (FUT-471). Unlike `wallets` this IS a per-credential fact —
   * the merchant id arrives with the connection — so it comes from the
   * adapter's `clientConfig`, normalized here so consumers never meet
   * `undefined`.
   */
  googlePay: GooglePayClientConfig | null;
  /**
   * The buyer screen this provider's flow needs (FUT-596), or `null` for the
   * capability default. Stamped here for the same reason `methods` is: the
   * adapter's declaration is the single source, and a second copy inside each
   * `clientConfig` is the one that drifts — here, in the direction of a
   * provider silently losing its own screen.
   */
  checkoutScreen: string | null;
}

/** Build the published config for one adapter — see {@link ClientProviderConfig}. */
export function toClientProviderConfig(
  adapter: PaymentProviderAdapter,
  credentials: ResolvedCredentials,
): ClientProviderConfig {
  const config = adapter.clientConfig(credentials);
  return {
    ...config,
    displayName: adapter.displayName,
    customerSchema: adapter.customerSchema ?? [],
    methods: adapter.capabilities.methods,
    wallets: adapter.capabilities.wallets ?? [],
    googlePay: config.googlePay ?? null,
    checkoutScreen: adapter.checkoutScreen ?? null,
  };
}
