import type {
  ChargeInput,
  ChargeSnapshot,
  ChargeStatus,
  DeclineReason,
  PaymentMethodKind,
} from '../core/types';
import { capturedAmountCents, chargeDescription } from './shared';
import { NAME, customerType, documentDigits } from './stone-http';

/**
 * Pagar.me v5 order ⇄ normalized snapshot mapping for the Stone adapter.
 * Kept apart from `stone.ts` so that file stays wiring and this one stays
 * translation.
 */

/** The slice of a Pagar.me charge this adapter reads. */
export interface StoneCharge {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  payment_method?: string;
  last_transaction?: {
    // PIX
    qr_code?: string;
    qr_code_url?: string;
    expires_at?: string;
    // Boleto
    line?: string;
    barcode?: string;
    pdf?: string;
    url?: string;
    due_at?: string;
    // Card
    card?: { brand?: string; last_four_digits?: string };
    acquirer_return_code?: string;
    acquirer_message?: string;
    gateway_response?: { code?: string };
  };
}

export interface StoneOrder {
  id?: string;
  code?: string;
  status?: string;
  charges?: StoneCharge[];
}

/**
 * Pagar.me charge status → normalized status.
 *
 * `failed` and `not_authorized` are DECLINES, not transport errors: the call
 * worked, the payment did not.
 */
const STATUS: Record<string, ChargeStatus> = {
  paid: 'PAID',
  pending: 'PENDING',
  processing: 'PENDING',
  waiting_payment: 'PENDING',
  authorized_pending_capture: 'AUTHORIZED',
  generated: 'PENDING',
  canceled: 'CANCELED',
  voided: 'CANCELED',
  refunded: 'REFUNDED',
  partial_refunded: 'PARTIALLY_REFUNDED',
  failed: 'DECLINED',
  not_authorized: 'DECLINED',
  with_error: 'DECLINED',
  overpaid: 'PAID',
};

function statusOf(charge: StoneCharge | undefined): ChargeStatus {
  return STATUS[charge?.status ?? ''] ?? 'PENDING';
}

/**
 * Map the acquirer's return code onto the normalized decline taxonomy. Codes
 * are the ISO-8583-ish set Pagar.me forwards from the acquirer.
 */
const DECLINE_CODES: Record<string, DeclineReason> = {
  '51': 'INSUFFICIENT_FUNDS',
  '54': 'EXPIRED_CARD',
  '14': 'INVALID_CARD',
  '15': 'INVALID_CARD',
  '43': 'FRAUD_SUSPECTED',
  '41': 'FRAUD_SUSPECTED',
  '62': 'FRAUD_SUSPECTED',
  '05': 'CARD_DECLINED',
  '57': 'CARD_DECLINED',
};

function declineReasonOf(charge: StoneCharge | undefined): DeclineReason {
  const code = charge?.last_transaction?.acquirer_return_code ?? '';
  return DECLINE_CODES[code] ?? 'CARD_DECLINED';
}

const METHODS: Record<string, PaymentMethodKind> = {
  pix: 'PIX',
  credit_card: 'CARD',
  debit_card: 'CARD',
  boleto: 'BOLETO',
};

export function methodOf(charge: StoneCharge | undefined, fallback: PaymentMethodKind): PaymentMethodKind {
  return METHODS[charge?.payment_method ?? ''] ?? fallback;
}

/**
 * The charge that speaks for an order: a PAID one if present, else the first.
 * The poll and the webhook read the SAME order object, so they must agree.
 */
export function settledCharge(order: StoneOrder): StoneCharge | undefined {
  const charges = Array.isArray(order.charges) ? order.charges : [];
  return charges.find((c) => c.status === 'paid') ?? charges[0];
}

/** Method-specific artifacts the buyer acts on (QR payload, boleto line). */
function instrumentFields(charge: StoneCharge | undefined, method: PaymentMethodKind): Partial<ChargeSnapshot> {
  const tx = charge?.last_transaction;
  if (!tx) return {};
  if (method === 'PIX' && tx.qr_code) {
    return { pix: { qrText: tx.qr_code, qrImageUrl: tx.qr_code_url, expiresAt: tx.expires_at } };
  }
  if (method === 'BOLETO') {
    return { boleto: { barcode: tx.line ?? tx.barcode, documentUrl: tx.pdf ?? tx.url, dueDate: tx.due_at } };
  }
  if (method === 'CARD' && tx.card) {
    return { card: { brand: tx.card.brand, last4: tx.card.last_four_digits } };
  }
  return {};
}

/**
 * `fallback.amountCents` is OPTIONAL by design: only a caller that already
 * knows what it asked to be charged (`createCharge`) may supply one. A caller
 * merely READING provider state passes nothing, so a `paid` charge that
 * arrives without an amount is refused rather than reported as 0 cents — see
 * {@link capturedAmountCents}.
 */
export function orderSnapshot(
  order: StoneOrder,
  fallback: { amountCents?: number; currency: string; method: PaymentMethodKind; id?: string },
): ChargeSnapshot {
  const charge = settledCharge(order);
  const status = statusOf(charge);
  const method = methodOf(charge, fallback.method);
  return {
    provider: NAME,
    providerChargeId: charge?.id ?? order.id ?? fallback.id ?? '',
    // `code` is the reference `orderPayload` sends, echoed back verbatim.
    ...(order.code ? { reference: order.code } : {}),
    status,
    amount: {
      amountCents: capturedAmountCents(
        NAME,
        status === 'PAID',
        charge?.amount,
        fallback.amountCents,
      ),
      currency: (charge?.currency ?? fallback.currency).toUpperCase(),
    },
    method,
    ...instrumentFields(charge, method),
    ...(status === 'DECLINED' ? { declineReason: declineReasonOf(charge) } : {}),
    raw: order,
  };
}

function customerPayload(input: ChargeInput): Record<string, unknown> {
  return {
    name: input.customer.name || undefined,
    email: input.customer.email || undefined,
    document: documentDigits(input.customer.taxId),
    type: customerType(input.customer.taxId),
  };
}

/** One summary line whose amount equals the total; detail stays in our DB. */
function itemsPayload(input: ChargeInput): Array<Record<string, unknown>> {
  return [
    {
      amount: input.amount.amountCents,
      description: chargeDescription(input, 255),
      quantity: 1,
      code: input.reference,
    },
  ];
}

function pixPayment(input: ChargeInput): Record<string, unknown> {
  return {
    payment_method: 'pix',
    pix: { expires_in: input.pix?.expiresInSeconds ?? 900 },
  };
}

function boletoPayment(input: ChargeInput): Record<string, unknown> {
  return {
    payment_method: 'boleto',
    boleto: { instructions: 'Pagar até o vencimento', due_at: input.boleto?.dueDate },
  };
}

function cardPayment(input: ChargeInput): Record<string, unknown> {
  return {
    payment_method: 'credit_card',
    credit_card: {
      installments: input.card?.installments ?? 1,
      statement_descriptor: 'PEDIDO',
      // A saved card charges by its vault id; a fresh one by the token the
      // browser minted with the PUBLIC key. No PAN ever reaches this process.
      ...(input.card?.savedCardToken
        ? { card_id: input.card.savedCardToken }
        : { card_token: input.card?.token ?? '' }),
    },
  };
}

const BY_METHOD = {
  PIX: pixPayment,
  BOLETO: boletoPayment,
  CARD: cardPayment,
} as const;

function paymentPayload(input: ChargeInput): Record<string, unknown> {
  return BY_METHOD[input.method](input);
}

/** The full `POST /orders` body for one charge. */
export function orderPayload(input: ChargeInput): Record<string, unknown> {
  return {
    code: input.reference,
    customer: customerPayload(input),
    items: itemsPayload(input),
    payments: [paymentPayload(input)],
    metadata: { ...input.metadata, reference: input.reference },
    closed: true,
  };
}
