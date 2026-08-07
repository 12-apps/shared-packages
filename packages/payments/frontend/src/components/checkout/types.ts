/**
 * The buyer checkout's payment vocabulary (FUT-7 / FUT-44 / FUT-58, moved into
 * the library by FUT-564).
 *
 * Pure types with no runtime imports. Everything here is PAYMENT: what a
 * charge, an order-in-payment, a buyer identity or a provider protocol looks
 * like to the screens in this folder. The host-side halves — the cart, the
 * catalog, order CREATION — stay in the host app and reach the flow through
 * the ports declared on `CheckoutFlowProps`.
 */

/** Payment methods offered at checkout. Mirrors `Payment.method` (FUT-42). */
export type PaymentMethod = "PIX" | "CARD";

/**
 * Order lifecycle, aligned with the FUT-43 backend:
 * - `AWAITING_PAYMENT` — order created, charge raised, not yet reconciled (the
 *   "pending" UI state). Payment confirmation is **async** (provider webhook),
 *   so the client polls until a terminal state.
 * - `PAID` — webhook confirmed; stock decremented in the same DB transaction.
 * - `FAILED` — charge declined or the paid-transaction rolled back.
 * - `EXPIRED` — the PIX charge (or checkout window) lapsed before payment.
 */
export type OrderStatus = "AWAITING_PAYMENT" | "PAID" | "FAILED" | "EXPIRED";

/** Terminal states — polling stops once the order reaches one of these. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = ["PAID", "FAILED", "EXPIRED"];

/** Buyer contact captured at checkout. */
export interface BuyerInfo {
  name?: string;
  email?: string;
  phone?: string;
  /**
   * Buyer CPF (Brazilian taxpayer id) — REQUIRED by PagBank for every PIX/card
   * charge (`customer.tax_id`).
   *
   * Persisted when the buyer opts in via "salvar meus dados" (LGPD consent),
   * through the host's `saveBuyerContact` port at the end of the "Dados" step.
   * It is never returned by any read — the host's profile API answers with
   * `hasTaxId` only — so a returning buyer re-enters it. Order creation
   * deliberately does NOT write it: that surface is MCP-exposed, and CPF must
   * stay unwritable through the agent surface.
   */
  taxId?: string;
}

/**
 * A raised PIX charge. `copyPaste` is the EMV "copia e cola" payload — it is both
 * what the QR code encodes and what the copy button copies. The real backend also
 * returns a provider QR image; the client renders its own QR from `copyPaste`, so
 * no image URL is needed here.
 */
export interface PixCharge {
  copyPaste: string;
  /** ISO-8601 instant when the charge expires. */
  expiresAt: string;
}

/**
 * One discount as it was applied to an order (FUT-235), frozen at order time so
 * it still reads correctly after the promotion is renamed, repriced or deleted.
 */
export interface CheckoutDiscount {
  /** The discount's id, or null once the discount itself has been deleted. */
  discountId: string | null;
  /** The merchant's name for the promotion, as it was when it applied. */
  name: string;
  /** The coupon the buyer typed to get it, when it was a coupon. */
  code: string | null;
  /** Cents this discount removed from the order. Always > 0. */
  amountCents: number;
}

/** An order as seen by the checkout client after creation. */
export interface CheckoutOrder {
  orderId: string;
  status: OrderStatus;
  method: PaymentMethod;
  /**
   * NET grand total in integer cents — the amount actually charged, and the
   * source of truth for math. Discounts are already deducted.
   */
  totalCents: number;
  /**
   * GROSS total before discounts, or null when the discount engine never ran
   * for this order (every order predating FUT-235, and the comanda path): the
   * subtotal then simply IS {@link totalCents}.
   */
  subtotalCents: number | null;
  /** Σ of every applied discount, in integer cents. 0 when none applied. */
  discountTotalCents: number;
  /** The discounts that fired, so the client can itemize the saving. */
  appliedDiscounts: CheckoutDiscount[];
  /** Pre-formatted BRL grand total (e.g. `R$ 42,90`). */
  totalLabel: string;
  /** Present only when {@link method} is `"PIX"`. */
  pix?: PixCharge;
  /**
   * Where to send the buyer when the store's provider settles on its own page
   * (FUT-556) — InfinitePay mints a checkout link rather than a PIX payload or
   * a tokenizable card form. Present for a redirect provider only, and for
   * either method: the provider's page offers its own.
   *
   * Not persisted. The link belongs to one raised charge, so it is answered
   * from that charge's snapshot and never read back from the order row.
   */
  hostedCheckoutUrl?: string;
}

/**
 * Comanda settlement context for the checkout (FUT-comandas): the scope plus
 * the host-resolved totals shown in place of the cart total when settling a
 * comanda. HOW a comanda is resolved is the host's business; the flow only
 * renders the answer.
 */
export interface ComandaCheckout {
  scope: "MINE" | "TABLE";
  totalLabel: string;
  totalItems: number;
}

/** A buyer input field the checkout can highlight on a validation failure. */
export type BuyerField = "cpf" | "email" | "name" | "phone";

/**
 * Structured, machine-readable checkout failure. The backend always returns
 * these three fields (never a bare string) so the UI can react on `code`/`field`
 * — highlight the offending input, disable payment when the gateway is down —
 * without parsing a human message.
 */
export interface CheckoutError {
  /** Stable machine code, e.g. `EMAIL_EQUALS_MERCHANT`, `GATEWAY_UNAVAILABLE`. */
  code: string;
  /** User-safe PT-BR message for display. */
  message: string;
  /** Which buyer field to highlight, or `null` when the failure isn't field-scoped. */
  field: BuyerField | null;
}

/** Result of the host's `createOrder` port: the order, or a structured failure. */
export type CreateOrderResult =
  | { ok: true; data: CheckoutOrder }
  | { ok: false; error: CheckoutError };

/**
 * What the flow hands the host's `createOrder` port. Everything else an order
 * needs — WHICH cart, WHICH comanda scope, WHICH tenant — is the host's own
 * context, closed over by its port implementation.
 */
export interface CreateOrderRequest {
  method: PaymentMethod;
  buyer: BuyerInfo;
  /** Opt-in: save buyer name/phone (not CPF — never persisted here) for next-checkout pre-fill. */
  saveProfile: boolean;
}

/** What the flow hands the host's `saveBuyerContact` port on "Continuar". */
export interface BuyerContact {
  name?: string;
  phone?: string;
  taxId?: string;
}

/** Display metadata needed to persist a card for reuse (never includes the PAN). */
export interface SavedCardMeta {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  holder: string;
}

/** Input to charge a tokenized card against an order. */
export interface ChargeCardInput {
  orderId: string;
  /** A fresh token, or a saved card's id for reuse. */
  token: string;
  /**
   * One instrument per provider, keyed by provider name (FUT-563).
   *
   * A card token is bound to whoever minted it, so a store with a failover
   * chain needs one per entry: without them the server can only ever attempt
   * the provider the browser tokenized for, and the walk skips the rest rather
   * than hand them a blob they cannot read. Omitted for a saved card (its owner
   * is the vault that holds it) and for a store with a single provider.
   */
  tokensByProvider?: Record<string, string>;
  /** Persist the token for future purchases (backend saves it against the buyer). */
  saveCard: boolean;
  /**
   * Display metadata for the card being saved. Sent only when {@link saveCard} is
   * true and a fresh card is used — the server persists it alongside the encrypted
   * reusable token. Derived in the browser (the PAN never leaves it).
   */
  cardMeta?: SavedCardMeta;
  /** Buyer CPF for the provider charge (`customer.tax_id`); never persisted. */
  taxId?: string;
}

/** A buyer field a provider asks for, as `/config` publishes it (FUT-595). */
export interface CheckoutCustomerField {
  key: "name" | "email" | "taxId" | "phone";
  /** Which validation rule applies. `MOBILE` is the strictly narrower `PHONE`. */
  type: "NAME" | "EMAIL" | "PHONE" | "MOBILE" | "CPF";
  /** The provider refuses (or its own page stalls) without this field. */
  required: boolean;
  /** Methods this spec applies to; omitted means every method the adapter takes. */
  methods?: ("PIX" | "CARD" | "BOLETO")[];
}

/**
 * ONE enabled provider of the store's chain (FUT-563), as the buyer's config
 * answers it. The same protocol facts as the head, stated per provider —
 * which is what lets the card path mint an instrument for each of them.
 */
export interface CheckoutChainLink {
  provider: string;
  tokenization: "NONE" | "PUBLIC_KEY" | "SDK" | "REDIRECT";
  publicKey: string | null;
  mockTokenization: boolean;
  methods: ("PIX" | "CARD" | "BOLETO")[];
  /**
   * What this provider needs to know about the buyer (FUT-595).
   *
   * `GET /api/checkout/config` has published this since FUT-740; this mirror
   * type simply dropped it, so the buyer form could not be honest about what
   * the chain requires and a missing field was only discoverable as a 400 AFTER
   * the buyer had finished filling it in — the third FUT-740 critical, one
   * layer up.
   *
   * Optional, and the DEGRADE DIRECTION IS LOAD-BEARING: absent (an older host,
   * a hand-written config) must mean today's behaviour — CPF required — never
   * "this chain asks for nothing". Asking for nothing produces a form the buyer
   * completes and a charge the server then refuses for a document they were
   * never shown a field for.
   */
  customerSchema?: CheckoutCustomerField[];
  /**
   * The buyer screen THIS provider's flow needs (FUT-596) — an opaque id the
   * adapter declares and `providers/registry.ts` resolves to a component.
   *
   * Optional, and the DEGRADE DIRECTION IS THE OPPOSITE of `customerSchema`'s
   * above — spelled out because a reader will otherwise assume symmetry from
   * the neighbouring comment. Absent, `null`, or an id THIS bundle has never
   * heard of all mean the CAPABILITY DEFAULT: the pane composed from
   * `tokenization` + `methods`, exactly as it was before this field existed.
   *
   * That is the safe direction here. Treating an unknown id as "render
   * nothing" would blank the pane for every buyer of a store whose backend is
   * one release ahead of this bundle — and the two packages version
   * independently, so that skew is normal, not exceptional.
   */
  checkoutScreen?: string | null;
}

/**
 * The store's payment protocol, as `GET /api/checkout/config` answers it
 * (FUT-697 / FUT-563). Extends the tokenization triple the card path consumes
 * with `tokenization`, which the method picker reads (`REDIRECT` ⇒ the
 * provider's hosted page takes the card, so no in-browser card form is
 * needed), and with the whole enabled `chain`.
 */
export interface CheckoutProviderConfig {
  /** Active provider's name, or `null` when the store has none connected. */
  provider: string | null;
  /** How the browser produces a card instrument (adapter vocabulary). */
  tokenization: "NONE" | "PUBLIC_KEY" | "SDK" | "REDIRECT" | null;
  /** The provider's PUBLIC browser key, when it has one. */
  publicKey: string | null;
  /** Server-granted stub-mode permission — the ONLY license to mock-tokenize. */
  mockTokenization: boolean;
  /**
   * The methods the store's provider chain declares it can charge (FUT-698) —
   * the picker derives its options from this, so a provider that cannot PIX
   * never offers PIX. Empty when no provider is connected.
   */
  methods: ("PIX" | "CARD" | "BOLETO")[];
  /**
   * EVERY enabled provider, in the merchant's own failover order (FUT-563) —
   * the order the server will walk. The client is a READER of it: it never
   * sorts, filters or re-heads this list, because the order is the merchant's
   * decision and the server has already truncated it to the plan's ceiling.
   *
   * Optional so a config served by an older host (or a mocked one) still
   * renders: absent, the card path behaves exactly as it did before, minting
   * for the head alone.
   */
  chain?: CheckoutChainLink[];
}

/**
 * What `POST /api/checkout/charge` answers (FUT-698). `hostedCheckoutUrl` is
 * present when the provider demands the buyer finish the charge on ITS page —
 * Stripe's redirect-based 3-D Secure — and the client then hands the buyer
 * over exactly as it does for a redirect provider's link (FUT-556).
 */
export interface ChargeOutcome {
  status: OrderStatus;
  hostedCheckoutUrl?: string;
}
