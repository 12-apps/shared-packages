import type {
  ChargeInput,
  ChargeSnapshot,
  ChargeStatus,
  DeclineReason,
  ResolvedCredentials,
} from '../core/types';
import { capturedAmountCents } from './shared';
import { NAME } from './stripe-http';

/**
 * Stripe PaymentIntent ⇄ normalized snapshot mapping, kept apart from the
 * adapter so `stripe.ts` reads as wiring and this file reads as translation.
 *
 * The BR payment methods (PIX, boleto) are the reason this is not a two-line
 * status map: both settle asynchronously and both hand the buyer something to
 * act on — a QR payload or a voucher — that lives inside `next_action`.
 */

/** The slice of a PaymentIntent this adapter reads. */
export interface StripePaymentIntent {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  next_action?: {
    pix_display_qr_code?: {
      data?: string;
      image_url_png?: string;
      expires_at?: number;
      hosted_instructions_url?: string;
    };
    boleto_display_details?: {
      number?: string;
      pdf?: string;
      hosted_voucher_url?: string;
      expires_at?: number;
    };
    redirect_to_url?: { url?: string };
  };
  latest_charge?: {
    id?: string;
    payment_method_details?: {
      card?: { brand?: string; last4?: string; network_transaction_id?: string };
    };
  } | string;
  last_payment_error?: { code?: string; decline_code?: string; message?: string };
  /** Carries `reference` — what the reconciliation probe matches on. */
  metadata?: Record<string, string>;
}

/** Stripe's error envelope, as it arrives on a 402 decline. */
export interface StripeErrorBody {
  error?: {
    code?: string;
    decline_code?: string;
    message?: string;
    payment_intent?: StripePaymentIntent;
  };
}

const DECLINE_CODES: Record<string, DeclineReason> = {
  insufficient_funds: 'INSUFFICIENT_FUNDS',
  expired_card: 'EXPIRED_CARD',
  incorrect_number: 'INVALID_CARD',
  incorrect_cvc: 'INVALID_CARD',
  invalid_account: 'INVALID_CARD',
  invalid_expiry_month: 'INVALID_CARD',
  invalid_expiry_year: 'INVALID_CARD',
  fraudulent: 'FRAUD_SUSPECTED',
  lost_card: 'FRAUD_SUSPECTED',
  stolen_card: 'FRAUD_SUSPECTED',
  pickup_card: 'FRAUD_SUSPECTED',
  merchant_blacklist: 'FRAUD_SUSPECTED',
};

/**
 * Decline codes Stripe documents as worth ANOTHER ATTEMPT with the same card —
 * its "next steps" column, which is the same question PagBank answers with its
 * "Retentável" column (see `pagbank-declines.ts`).
 *
 * The list is deliberately short. Every other decline Stripe documents tells
 * the customer to contact their issuer or use a different card, and an
 * off-session subscription charge cannot ask them to do either mid-attempt.
 */
const RETRIABLE_DECLINE_CODES: ReadonlySet<string> = new Set([
  'processing_error',
  'issuer_not_available',
  'try_again_later',
  'approve_with_id',
  'reenter_transaction',
]);

/**
 * Decline codes that are terminal for the INSTRUMENT: the card itself will
 * never authorize again, so no amount of backoff helps and the tenant has to
 * supply a different one.
 *
 * `revocation_of_authorization` and `stop_payment_order` are the pair that
 * matters most for a subscription — they are the cardholder telling their bank
 * to stop this recurring debit, Stripe's equivalent of PagBank's 20118.
 * Presenting a revoked recurring charge again is how chargebacks are earned.
 */
const TERMINAL_DECLINE_CODES: ReadonlySet<string> = new Set([
  'card_not_supported',
  'currency_not_supported',
  'expired_card',
  'fraudulent',
  'incorrect_number',
  'invalid_account',
  'invalid_expiry_month',
  'invalid_expiry_year',
  'lost_card',
  'merchant_blacklist',
  'not_permitted',
  'pickup_card',
  'restricted_card',
  'revocation_of_all_authorizations',
  'revocation_of_authorization',
  'security_violation',
  'stolen_card',
  'stop_payment_order',
  'transaction_not_allowed',
]);

/**
 * Normalize Stripe's decline vocabulary. `decline_code` is the issuer's
 * reason and is the more specific of the two; `code` is Stripe's own.
 * Anything unrecognized is a plain CARD_DECLINED rather than UNKNOWN — the
 * buyer-facing message is the same, and pretending we know less than we do
 * helps nobody.
 */
export function declineReasonOf(error: {
  code?: string;
  decline_code?: string;
} | undefined): DeclineReason {
  if (!error) return 'CARD_DECLINED';
  const mapped = DECLINE_CODES[error.decline_code ?? ''] ?? DECLINE_CODES[error.code ?? ''];
  return mapped ?? 'CARD_DECLINED';
}

/**
 * Stripe's own verdict on retrying, or `undefined` when it offers none.
 *
 * Undefined is a real answer and not a failure to look: most declines fall in
 * neither list, and reporting "unknown" lets the caller apply its own bounded
 * policy instead of acting on a verdict Stripe never gave.
 */
export function declineRetriableOf(error: {
  code?: string;
  decline_code?: string;
} | undefined): boolean | undefined {
  for (const code of [error?.decline_code, error?.code]) {
    if (!code) continue;
    if (RETRIABLE_DECLINE_CODES.has(code)) return true;
    if (TERMINAL_DECLINE_CODES.has(code)) return false;
  }
  return undefined;
}

/**
 * PaymentIntent status → normalized status.
 *
 * `requires_payment_method` is the subtle one: after a confirm it means the
 * attempt FAILED and Stripe is asking for another card, which is a decline —
 * but on an intent that was never confirmed it just means "not started".
 * `last_payment_error` is what tells the two apart.
 */
function statusOf(intent: StripePaymentIntent): ChargeStatus {
  switch (intent.status) {
    case 'succeeded':
      return 'PAID';
    case 'requires_capture':
      return 'AUTHORIZED';
    case 'canceled':
      return 'CANCELED';
    case 'requires_payment_method':
      return intent.last_payment_error ? 'DECLINED' : 'PENDING';
    default:
      // processing | requires_action | requires_confirmation
      return 'PENDING';
  }
}

function expiryIso(epochSeconds: number | undefined): string | undefined {
  return epochSeconds ? new Date(epochSeconds * 1000).toISOString() : undefined;
}

function cardDetails(intent: StripePaymentIntent): ChargeSnapshot['card'] {
  // `latest_charge` is an id unless the request expanded it; only the
  // expanded form carries the brand/last4 worth showing the buyer.
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : undefined;
  const card = charge?.payment_method_details?.card;
  if (!card) return undefined;
  return { brand: card.brand, last4: card.last4 };
}

function pixFields(intent: StripePaymentIntent): Partial<ChargeSnapshot> | null {
  const pix = intent.next_action?.pix_display_qr_code;
  if (!pix?.data) return null;
  return {
    pix: {
      qrText: pix.data,
      qrImageUrl: pix.image_url_png,
      expiresAt: expiryIso(pix.expires_at),
    },
    hostedCheckoutUrl: pix.hosted_instructions_url,
  };
}

function boletoFields(intent: StripePaymentIntent): Partial<ChargeSnapshot> | null {
  const boleto = intent.next_action?.boleto_display_details;
  if (!boleto?.number && !boleto?.pdf) return null;
  return {
    boleto: {
      barcode: boleto?.number,
      documentUrl: boleto?.pdf,
      dueDate: expiryIso(boleto?.expires_at),
    },
    hostedCheckoutUrl: boleto?.hosted_voucher_url,
  };
}

/**
 * 3-D Secure: the buyer finishes on the issuer's page and the intent settles
 * asynchronously — the same shape as a hosted checkout, as far as the host is
 * concerned.
 */
function redirectFields(intent: StripePaymentIntent): Partial<ChargeSnapshot> | null {
  const url = intent.next_action?.redirect_to_url?.url;
  return url ? { hostedCheckoutUrl: url } : null;
}

/** PIX/boleto/3DS artifacts the buyer must act on, from `next_action`. */
function actionFields(intent: StripePaymentIntent): Partial<ChargeSnapshot> {
  return pixFields(intent) ?? boletoFields(intent) ?? redirectFields(intent) ?? {};
}

/**
 * A PaymentIntent as the rest of the system sees it. `fallback` supplies the
 * method, and the amount for responses that omit it (an error envelope's
 * embedded intent, mainly).
 *
 * `fallback.amountCents` is OPTIONAL: only a caller that already knows what it
 * asked to be charged may supply one. A caller merely READING intent state
 * passes nothing, so a `succeeded` intent with no amount is refused rather
 * than reported as 0 cents — see {@link capturedAmountCents}.
 */
export function intentSnapshot(
  intent: StripePaymentIntent,
  fallback: { amountCents?: number; currency: string; method: ChargeInput['method']; id?: string },
): ChargeSnapshot {
  const status = statusOf(intent);
  return {
    provider: NAME,
    providerChargeId: intent.id ?? fallback.id ?? '',
    // The reference `chargePayload` stamps into metadata — the same field
    // `findChargeByReference` already searches on.
    ...(intent.metadata?.['reference'] ? { reference: intent.metadata['reference'] } : {}),
    status,
    amount: {
      amountCents: capturedAmountCents(
        NAME,
        status === 'PAID',
        intent.amount,
        fallback.amountCents,
      ),
      currency: (intent.currency ?? fallback.currency).toUpperCase(),
    },
    method: fallback.method,
    card: cardDetails(intent),
    ...actionFields(intent),
    ...(status === 'DECLINED'
      ? {
          declineReason: declineReasonOf(intent.last_payment_error),
          declineRetriable: declineRetriableOf(intent.last_payment_error),
        }
      : {}),
    raw: intent,
  };
}

/** Stripe wants the currency lower-cased; the rest of this package uppercases it. */
function currencyOf(input: ChargeInput): string {
  return input.amount.currency.toLowerCase();
}

function billingDetails(input: ChargeInput): Record<string, unknown> {
  return {
    name: input.customer.name || undefined,
    email: input.customer.email || undefined,
  };
}

/**
 * Card intents confirm inline with a PaymentMethod minted by Stripe.js. A
 * saved card charges by its stored `pm_...` id; either way no PAN reaches
 * this process.
 *
 * `customer` and `off_session` travel together and only for a vaulted card.
 * Stripe rejects a `pm_…` that belongs to a customer unless the customer is
 * named, and without `off_session` it may hold the intent at
 * `requires_action` waiting for an authentication nobody is there to give —
 * which a scheduled charge would read as a pending PIX-shaped limbo rather
 * than as the failure it is.
 */
function cardIntent(input: ChargeInput): Record<string, unknown> {
  const card = input.card;
  return {
    payment_method_types: ['card'],
    payment_method: card?.savedCardToken ?? card?.token,
    ...(card?.customerRef ? { customer: card.customerRef } : {}),
    ...(card?.merchantInitiated ? { off_session: true } : {}),
    // Confirm inline so the create call already returns the outcome, instead
    // of leaving an unconfirmed intent the host would have to chase.
    confirm: true,
  };
}

function pixIntent(input: ChargeInput): Record<string, unknown> {
  const seconds = input.pix?.expiresInSeconds;
  return {
    payment_method_types: ['pix'],
    payment_method_data: { type: 'pix', billing_details: billingDetails(input) },
    confirm: true,
    ...(seconds ? { payment_method_options: { pix: { expires_after_seconds: seconds } } } : {}),
  };
}

function boletoIntent(input: ChargeInput): Record<string, unknown> {
  return {
    payment_method_types: ['boleto'],
    payment_method_data: {
      type: 'boleto',
      // Stripe requires a CPF/CNPJ and a full billing address for boleto.
      boleto: { tax_id: (input.customer.taxId ?? '').replace(/\D/g, '') },
      billing_details: billingDetails(input),
    },
    confirm: true,
  };
}

const BY_METHOD = {
  CARD: cardIntent,
  PIX: pixIntent,
  BOLETO: boletoIntent,
} as const;

/**
 * Where a card confirm may send the buyer for 3-D Secure (FUT-698).
 *
 * Confirmed server-side with no `return_url`, an intent that needs
 * authentication parks at `requires_action` with a `use_stripe_sdk` action
 * nothing in this host can drive — the buyer polls a PENDING order forever.
 * With one, Stripe answers `redirect_to_url` instead, which {@link
 * redirectFields} already maps to `hostedCheckoutUrl` — the exact shape the
 * host's hosted-return machinery settles.
 *
 * The URL is the merchant's `redirectUrl` credential field — the same host-
 * stamped "send the buyer back here" address the InfinitePay handoff uses
 * (`withMerchantRedirectUrl`). CUSTOMER-PRESENT charges only: an off-session
 * subscription charge has nobody to redirect, and Stripe's `off_session` flag
 * already declares that no authentication can happen.
 */
function cardReturnUrl(
  input: ChargeInput,
  credentials: ResolvedCredentials | undefined,
): Record<string, unknown> {
  if (input.method !== 'CARD' || input.card?.merchantInitiated) return {};
  const url = credentials?.fields['redirectUrl'];
  return url ? { return_url: url } : {};
}

/** The full `POST /v1/payment_intents` body for one charge. */
export function intentPayload(
  input: ChargeInput,
  credentials?: ResolvedCredentials,
): Record<string, unknown> {
  return {
    amount: input.amount.amountCents,
    currency: currencyOf(input),
    description: `Pedido ${input.reference}`.slice(0, 350),
    // Correlates the Stripe dashboard back to the host's order, and is what a
    // reconciliation lookup searches on.
    metadata: { ...input.metadata, reference: input.reference },
    receipt_email: input.customer.email || undefined,
    // Expanded so the created intent already carries brand/last4.
    expand: ['latest_charge'],
    ...BY_METHOD[input.method](input),
    ...cardReturnUrl(input, credentials),
  };
}
