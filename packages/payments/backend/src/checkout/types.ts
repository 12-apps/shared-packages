import type { PaymentsRouteParams } from '../http/route-table';

import type {
  CardDetails,
  ClientTokenization,
  CustomerInfo,
  CustomerSchema,
  MerchantRef,
  Money,
  PaymentMethodKind,
  ProviderName,
  ResolvedCredentials,
} from '../core/types';

/**
 * The BUYER-CHECKOUT surface's vocabulary (FUT-740).
 *
 * The admin half of this package has been mountable for a while; the buyer's
 * half — create a checkout, charge a card, poll it, re-mint the browser key —
 * lived in whichever host wrote it, ~5,500 lines of it in future-pay alone, and
 * every money rule inside it was re-derived per host. These are the types that
 * let it move: a `Payable` the library can charge without knowing what an order
 * is, and one port per fact only the host can answer.
 */

/**
 * THE PAYABLE — the library's only notion of "the thing being paid".
 *
 * NOT an order. There is no line item here, no cart, no tenant slug, no status
 * vocabulary, and no buyer identity: those are the host's domain in its
 * entirety, and a library that learned any of them would be portable to exactly
 * one storefront. What the library does with `ref` is concatenate a `--<n>`
 * attempt suffix onto it and compare it back (see `core/reference.ts`); it
 * parses it for nothing else, ever.
 */
export interface Payable {
  /** Opaque host handle. Concatenated and compared, never interpreted. */
  ref: string;
  /**
   * The payable names its own merchant. This is what makes `charge`, `status`
   * and `refresh-key` resolvable from the payable ALONE — merchant attribution
   * that a client-supplied handle can never forge, because the handle only
   * resolves through the host's own `load`.
   */
  merchant: MerchantRef;
  /**
   * Authoritative, read server-side. The browser has no way to send it: no
   * request shape the mount accepts carries an amount, which is the structural
   * form of "money is decided by our record, never by the client".
   */
  amount: Money;
  method: PaymentMethodKind;
  customer: Partial<CustomerInfo>;
  /**
   * `OPEN` is chargeable. Anything else is terminal and refuses a new charge.
   *
   * Three flat values on purpose, and NOT the host's own vocabulary
   * (`AWAITING_PAYMENT | PAID | FAILED | EXPIRED` in future-pay). The library
   * only ever has to know "may I raise a charge on this"; if a fourth value is
   * ever added to satisfy some host, this abstraction has leaked and the port
   * has become an order.
   */
  state: 'OPEN' | 'SETTLED' | 'CLOSED';
}

/** What the browser may choose. Money and identity are deliberately absent. */
export interface CheckoutChargeDraft {
  /** A fresh instrument, a saved-instrument id, or per-provider instruments. */
  card?: Pick<CardDetails, 'token' | 'savedCardToken' | 'tokensByProvider'>;
  /** Opt-in: vault this instrument for reuse once it authorizes. */
  saveInstrument?: boolean;
  /** Whatever display metadata the host stores alongside a vaulted token. */
  instrumentDisplay?: unknown;
}

/** ONE enabled provider, as the buyer's checkout sees it. */
export interface BuyerProviderLink {
  provider: ProviderName;
  tokenization: ClientTokenization;
  /** Its PUBLIC browser key, when it has one. Never a credential. */
  publicKey: string | null;
  /** Server-granted stub permission for THIS connection (never in production). */
  mockTokenization: boolean;
  methods: readonly PaymentMethodKind[];
  /**
   * The buyer fields THIS provider asks for (FUT-595), per entry rather than
   * once for the merchant: requiredness is a per-provider fact, so a chain the
   * buyer may be charged on anywhere has to publish each entry's declaration or
   * the form cannot be honest about what it needs.
   */
  customerSchema: CustomerSchema;
}

/** The client-safe protocol read. Nothing in it is secret. */
export interface BuyerCheckoutConfig {
  provider: ProviderName | null;
  tokenization: ClientTokenization | null;
  publicKey: string | null;
  mockTokenization: boolean;
  /**
   * The union of the CHAIN's declared methods in failover order (FUT-698) — the
   * walk skips a provider that cannot take the chosen method and tries the
   * next, so a picker built from the head alone offers methods the walk then
   * refuses.
   */
  methods: readonly PaymentMethodKind[];
  /** Every enabled provider, in the merchant's own failover order (FUT-563). */
  chain: readonly BuyerProviderLink[];
}

/** The correlation the host must write to find this charge again. */
export interface AttachedCharge {
  provider: ProviderName;
  providerChargeId: string;
  /**
   * The provider's SECOND correlation id where it has one (PagBank's `ORDE_…`),
   * else the charge id. Derived by the library from the snapshot, so no host
   * reads a provider payload to get it.
   */
  providerOrderId: string;
}

/**
 * Bringing a payable into existence, finding one, and rendering it — the port
 * that keeps "what an order is" entirely outside this package.
 */
export interface PayablePort<Caller, View extends object> {
  /**
   * The payable this caller may pay, or null.
   *
   * THIS IS THE AUTHORIZATION SCOPE, and after FUT-740 it is a single,
   * unmissable point of failure: it is the only thing standing between one
   * buyer and another buyer's payable, expressed in the host's own identity
   * model. `null` must mean BOTH "no such payable" and "not yours" — the
   * library answers 404 either way, so the two are indistinguishable from
   * outside and nothing leaks.
   */
  load(caller: Caller, ref: string): Promise<Payable | null>;
  /**
   * Bring a payable into existence for THIS checkout. The library hands over
   * the raw request body untouched: carts, comandas, tables, discounts, buyer
   * profiles and price snapshots are the host's, in full. `view` is echoed to
   * the client verbatim and the library never reads it — if any library code
   * ever branches on a `View`, this port has become an order.
   *
   * Required only if the mount serves `createCheckout`.
   */
  create?(
    caller: Caller,
    body: unknown,
    merchant: MerchantRef,
  ): Promise<{ payable: Payable; view: View }>;
  /** Re-read `view` after a correlation write, so the answer reflects it. */
  view?(ref: string): Promise<View | null>;
  /** The host's own state token for a poll answer when nothing changed. */
  stateToken(payable: Payable): string;
}

/**
 * Writing a charge back onto the payable.
 *
 * Every method is the host's because confirming a payment is a TRANSACTION only
 * the host can compose — future-pay's writes the payment row, decrements stock
 * with exact COGS, rolls the payable onto the customer profile, emits the
 * buyer's notification and closes a fully-paid table session, all at once, with
 * a shortfall guard that parks a short payment for reconciliation. What the
 * library owns is WHEN each is called and WITH WHAT AMOUNT.
 */
export interface ChargeCorrelationPort {
  /**
   * A charge exists and is PAYABLE — a live QR, a hosted link, a pending 3-D
   * Secure. The payable stays OPEN; only a webhook or a poll settles it.
   */
  attachPending(ref: string, charge: AttachedCharge): Promise<void>;
  /**
   * A CARD charge that settled synchronously. Returns the host's state token.
   */
  recordCardOutcome(input: {
    ref: string;
    charge: AttachedCharge;
    approved: boolean;
    amount: Money;
  }): Promise<string>;
  /**
   * A settlement the library has proof of. `capturedAmount` is what the
   * PROVIDER reported, never the payable's total (FUT-373) — echoing our own
   * total back would settle any capture however small, and would make the
   * host's shortfall guard compare a number with itself. The one exception is
   * the offline stub path, where the library passes the payable's own amount
   * and says so, because a stub snapshot hardcodes zero (FUT-374).
   */
  settle(input: {
    ref: string;
    charge: AttachedCharge;
    capturedAmount: Money;
    method: PaymentMethodKind;
  }): Promise<string>;
  /** A payable whose payment window lapsed. Omit to never expire. */
  expire?(ref: string): Promise<string>;
}

/** A vaulted instrument only means anything to this pair (FUT-697). */
export interface InstrumentScope {
  merchant: MerchantRef;
  provider: ProviderName;
}

export interface SavedInstrumentPort<Caller, Display> {
  /** Display metadata only. The library never sees a vault token here. */
  list(caller: Caller, scope: InstrumentScope): Promise<readonly Display[]>;
  /**
   * The vault token for `instrumentId`, scoped to (merchant, provider).
   *
   * `{ token: null, owned: true }` means the id IS this caller's instrument,
   * just not one this scope can charge — the library then answers 409 with its
   * own copy rather than letting a scope mismatch become a decline that blames
   * the buyer's card.
   */
  resolve(
    caller: Caller,
    scope: InstrumentScope,
    instrumentId: string,
  ): Promise<{ token: string } | { token: null; owned: boolean }>;
  /** Persist a vault token the provider just minted. Best-effort, never fatal. */
  save?(
    caller: Caller,
    scope: InstrumentScope,
    token: string,
    display: unknown,
  ): Promise<void>;
}

/**
 * Re-mint the PUBLIC browser key for a provider that can produce one on demand.
 *
 * The library asks only when `tokenization === 'PUBLIC_KEY'` and the connection
 * is not a stub; WHICH providers can actually do it, and the env + caching that
 * does it, are the host's. This is the one place a provider NAME legitimately
 * lives on the checkout path, and it lives in the HOST — exactly as
 * `ActivationContext.mintCardPublicKey` already does for activation. Returning
 * `null` means "this provider cannot mint one", which is not an error.
 */
export type BrowserKeyPort = (
  merchant: MerchantRef,
  provider: ProviderName,
  credentials: ResolvedCredentials,
) => Promise<string | null>;

/** The structured refusal body every checkout failure is worded into. */
export interface CheckoutErrorBody {
  /** Stable machine code the client reacts on, e.g. `MISSING_BUYER_FIELD`. */
  code: string;
  /** User-safe message for display. Comes from `CheckoutCopy`, never from here. */
  message: string;
  /** Which buyer input to highlight, or null when not field-scoped. */
  field: string | null;
}

export interface CheckoutResponder {
  ok(data: unknown, status?: number): Response;
  fail(body: CheckoutErrorBody, status: number): Response;
}

/**
 * The host's logger. It must be the host's for two reasons that are not style:
 * a `console.error` is invisible to future-pay's server-side Sentry, and
 * `ProviderRequestError` retains the provider's parsed body — buyer CPF and all
 * — so WHAT gets written down is a host policy, not a library one.
 */
export interface CheckoutLogger {
  warn(line: string): void;
  error(line: string): void;
  /** A provider exchange worth an operator's attention, request + response. */
  providerFailure(line: string, error: unknown): void;
}

/** The six buyer-checkout intents. */
export type CheckoutIntentKind =
  | 'getCheckoutConfig'
  | 'listInstruments'
  | 'createCheckout'
  | 'chargeInstrument'
  | 'getStatus'
  | 'refreshBrowserKey';

/**
 * WHO a row serves. A property of the TABLE, never of the host callback — see
 * `checkout/route-table.ts` for why the direction of that decision matters.
 */
export type CheckoutPrincipal = 'BUYER' | 'PUBLIC';

/** What a checkout request MEANS, decided before anything runs. */
export interface CheckoutRouteIntent {
  kind: CheckoutIntentKind | string;
  method: 'GET' | 'POST';
  principal: CheckoutPrincipal;
  segments: readonly string[];
  params: PaymentsRouteParams;
}

/** One row of the checkout table, exposed so a host can assert its URL map. */
export interface CheckoutRouteSpec {
  kind: CheckoutIntentKind;
  method: 'GET' | 'POST';
  /** Relative to the mount point. */
  pattern: readonly string[];
  principal: CheckoutPrincipal;
  /** True when the row resolves its merchant from a LOADED payable. */
  payableScoped: boolean;
}
