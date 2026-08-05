import type { PaymentProviderAdapter } from '../core/provider';
import { ProviderRequestError } from '../core/errors';
import type { ChargeInput, ChargeSnapshot, ResolvedCredentials } from '../core/types';
import { pagbankDecline, type PagBankPaymentRawData } from './pagbank-declines';
import {
  customerPayload,
  customerSchema,
  NAME,
  notificationUrls,
  pagbankRequest,
} from './pagbank-http';
import { pagbankOAuth } from './pagbank-oauth';
import { verifyPagbankCredentials } from './pagbank-probe';
import { postTransactionEvents } from './pagbank-webhook';
import {
  capturedAmountCents,
  secureEquals,
  sha256Hex,
  stubCharge,
  stubPendingSnapshot,
  stubRefund,
} from './shared';

/**
 * PagBank (PagSeguro) Orders API adapter — a port of the integration this
 * repo already ran in production (`apps/web/lib/payments/pagbank.ts`), so the
 * request shapes below are the ones proven against PagBank, not guesses.
 *
 * Carried over verbatim from that client:
 *   - **Double-charge safety.** A charge POST retries ONLY on a pre-send
 *     network error, never on an HTTP response, and always carries
 *     `x-idempotency-key` so the provider dedupes a retried create.
 *   - **No PAN ever reaches here.** The browser SDK encrypts the card with
 *     the public key; we handle only the resulting blob, or a stored vault id.
 *   - **Card decline is a RESULT, not an error** — mapped to a `DECLINED`
 *     snapshot so checkout can show a message instead of a stack trace.
 *   - **Stub mode** keeps local dev and CI running the whole path with no
 *     live credentials.
 */

/** PIX charge window (matches the copy shown in the PIX view). */
const PIX_TTL_MS = 15 * 60 * 1000;

interface PagBankPixResponse {
  id?: string;
  charges?: Array<{ id?: string; qr_codes?: Array<{ text?: string }> }>;
  qr_codes?: Array<{ text?: string; expiration_date?: string }>;
}

interface PagBankCardCharge {
  id?: string;
  status?: string;
  /** The ABECS outcome — `code` is the refusal, `raw_data` says which of its
   *  issuer reasons, the only thing telling an expired card from a typo. */
  payment_response?: { code?: string; message?: string; raw_data?: PagBankPaymentRawData };
  payment_method?: { card?: { id?: string; brand?: string; last_digits?: string } };
}

interface PagBankCardResponse {
  id?: string;
  charges?: PagBankCardCharge[];
}

interface PagBankOrderResponse {
  reference_id?: unknown;
  charges?: Array<{ id?: unknown; status?: unknown; amount?: { value?: unknown } }>;
}

/**
 * The charge that decides an order's state: a PAID one if present, else the
 * first. Both the poll and the webhook read the SAME order object, so they
 * must agree on which charge speaks for it.
 */
function settledCharge(res: PagBankOrderResponse) {
  const charges = Array.isArray(res.charges) ? res.charges : [];
  return charges.find((c) => c.status === 'PAID') ?? charges[0];
}

/**
 * Normalize an order body's charge into the shared snapshot shape.
 *
 * A PAID charge with no `amount.value` is REFUSED rather than normalized to 0
 * ({@link capturedAmountCents}). An unpaid PIX order legitimately carries no
 * charge — and so no amount — on every status poll, and stays PENDING.
 */
function orderSnapshot(res: PagBankOrderResponse, fallbackChargeId: string): ChargeSnapshot {
  const paid = settledCharge(res);
  const value = paid?.amount?.value;
  const settled = paid?.status === 'PAID';
  const captured = typeof value === 'number' ? value : undefined;
  return {
    provider: NAME,
    providerChargeId: typeof paid?.id === 'string' ? paid.id : fallbackChargeId,
    // The `reference_id` we sent, echoed back — see `ChargeSnapshot.reference`.
    ...(typeof res.reference_id === 'string' ? { reference: res.reference_id } : {}),
    status: settled ? 'PAID' : 'PENDING',
    amount: { amountCents: capturedAmountCents(NAME, settled, captured), currency: 'BRL' },
    method: 'PIX',
    raw: res,
  };
}

function pixPayload(input: ChargeInput, credentials: ResolvedCredentials, expiresAt: string) {
  return {
    reference_id: input.reference,
    customer: customerPayload(input.customer),
    qr_codes: [{ amount: { value: input.amount.amountCents }, expiration_date: expiresAt }],
    notification_urls: notificationUrls(credentials),
  };
}

/** The single `charges[]` entry of a card order. */
function cardCharge(input: ChargeInput) {
  const savedCardToken = input.card?.savedCardToken;
  return {
    // PagBank requires a 1–64 char charge description.
    description: `Pedido ${input.reference}`.slice(0, 64),
    amount: { value: input.amount.amountCents, currency: input.amount.currency },
    payment_method: {
      type: 'CREDIT_CARD',
      installments: input.card?.installments ?? 1,
      capture: true,
      // A saved card charges by vault id; a fresh card sends the encrypted
      // blob and asks PagBank to store it for reuse.
      card: savedCardToken
        ? { id: savedCardToken }
        : { encrypted: input.card?.token ?? '', store: true },
    },
    // Declares the stored-credential agreement to the issuer. Omitted
    // entirely for an ordinary storefront charge, where there is none.
    ...(input.card?.merchantInitiated ? { recurring: { type: 'SUBSEQUENT' } } : {}),
  };
}

function cardPayload(input: ChargeInput, credentials: ResolvedCredentials) {
  return {
    reference_id: input.reference,
    customer: customerPayload(input.customer),
    // The Orders API requires `items` on a card order; one summary line whose
    // amount equals the total (line-item detail stays in the host's DB).
    items: [
      {
        reference_id: input.reference,
        name: 'Pedido',
        quantity: 1,
        unit_amount: input.amount.amountCents,
      },
    ],
    charges: [cardCharge(input)],
    notification_urls: notificationUrls(credentials),
  };
}

/** The QR payload, wherever this response shape happens to carry it. */
function pixQrText(res: PagBankPixResponse): string | undefined {
  return res.qr_codes?.[0]?.text ?? res.charges?.[0]?.qr_codes?.[0]?.text;
}

function mapPix(res: PagBankPixResponse, input: ChargeInput, expiresAt: string): ChargeSnapshot {
  const providerOrderId = res.id;
  const qrText = pixQrText(res);
  const providerChargeId = res.charges?.[0]?.id ?? providerOrderId;
  if (!providerOrderId || !providerChargeId || !qrText) {
    throw new ProviderRequestError(NAME, 'PagBank PIX response missing order/charge/qr fields.');
  }
  return {
    provider: NAME,
    providerChargeId,
    status: 'PENDING',
    amount: input.amount,
    method: 'PIX',
    pix: { qrText, expiresAt: res.qr_codes?.[0]?.expiration_date ?? expiresAt },
    raw: res,
  };
}

/**
 * A card charge's outcome. A decline is a business OUTCOME, never an
 * exception: checkout shows the buyer a message, not a stack trace.
 *
 * The reason comes from `payment_response.code`, not from the status — the
 * status only says "not paid". See `pagbank-declines.ts` for why the
 * provider's own retriability verdict is carried alongside the reason instead
 * of being folded into it.
 */
function cardOutcome(
  charge: PagBankCardCharge | undefined,
): Pick<ChargeSnapshot, 'status' | 'declineReason' | 'declineRetriable'> {
  if (charge?.status === 'PAID') return { status: 'PAID' };
  if (charge?.status === 'AUTHORIZED') return { status: 'AUTHORIZED' };
  const response = charge?.payment_response;
  const decline = pagbankDecline(response?.code, response?.raw_data);
  return {
    status: 'DECLINED',
    declineReason: decline.reason,
    declineRetriable: decline.retriable,
  };
}

function mapCard(res: PagBankCardResponse, input: ChargeInput): ChargeSnapshot {
  if (!res.id) throw new ProviderRequestError(NAME, 'PagBank card response missing order id.');
  const charge = res.charges?.[0];
  if (!charge?.id) {
    throw new ProviderRequestError(NAME, 'PagBank card response missing charge id.');
  }
  return {
    provider: NAME,
    providerChargeId: charge.id,
    // `input.reference` is what `chargePayload` sent as `reference_id`; the
    // card response is built from the request, so it is authoritative here.
    reference: input.reference,
    ...cardOutcome(charge),
    amount: input.amount,
    method: 'CARD',
    card: {
      brand: charge.payment_method?.card?.brand,
      last4: charge.payment_method?.card?.last_digits,
    },
    raw: res,
  };
}

/**
 * Reconciliation probe. PagBank indexes orders by the `reference_id` we set
 * at creation, so an order created moments before a timeout is findable
 * immediately — this reads the orders collection directly, with no search
 * index in between and therefore no staleness window.
 *
 * Errors deliberately propagate: the walk must be able to tell "PagBank says
 * there is no such order" from "PagBank did not answer", and only the former
 * is proof that it is safe to charge somewhere else.
 */
const findChargeByReference: NonNullable<
  PaymentProviderAdapter['findChargeByReference']
> = async (reference, credentials) => {
  if (credentials.stub) return null;
  const res = await pagbankRequest<{ orders?: Array<PagBankOrderResponse & { id?: string }> }>(
    `/orders?reference_id=${encodeURIComponent(reference)}`,
    credentials,
    { method: 'GET' },
  );
  const order = res.orders?.[0];
  if (!order?.id) return null;
  return orderSnapshot(order, order.id);
};

const createCharge: PaymentProviderAdapter['createCharge'] = async (input, credentials) => {
  if (credentials.stub) return stubCharge(NAME, input);
  // The provider-side idempotency key: a retried create is deduped by PagBank
  // itself, on top of the gateway's own guarantees.
  const idempotencyKey = input.idempotencyKey ?? input.reference;
  if (input.method === 'PIX') {
    const expiresAt = new Date(Date.now() + PIX_TTL_MS).toISOString();
    const res = await pagbankRequest<PagBankPixResponse>('/orders', credentials, {
      method: 'POST',
      body: pixPayload(input, credentials, expiresAt),
      idempotencyKey,
    });
    return mapPix(res, input, expiresAt);
  }
  const res = await pagbankRequest<PagBankCardResponse>('/orders', credentials, {
    method: 'POST',
    body: cardPayload(input, credentials),
    idempotencyKey,
  });
  return mapCard(res, input);
};

/**
 * PagBank signs deliveries with `x-authenticity-token` =
 * SHA-256(`${webhookToken}-${rawBody}`). The URL itself carries no secret
 * because `notification_urls` is capped at 150 chars, so this header IS the
 * authentication — hence fail-closed when it is absent or the token is unset
 * (stub mode excepted).
 */
const webhook: PaymentProviderAdapter['webhook'] = {
  async verify(delivery, credentials) {
    const secret = credentials.fields['webhookToken'];
    if (!secret) return credentials.stub === true;
    const presented = delivery.headers['x-authenticity-token'];
    if (!presented) return false;
    return secureEquals(presented, sha256Hex(`${secret}-${delivery.rawBody}`));
  },

  /**
   * PagBank posts the ORDER object. The signature above is what makes the body
   * trustworthy; `eventId` falls back to a body hash because PagBank sends no
   * delivery id, which still makes redeliveries idempotent. Post-transaction
   * events reach this same URL form-encoded, which the `JSON.parse` below
   * throws on — see `pagbank-webhook.ts`.
   */
  async parse(delivery) {
    const eventId = sha256Hex(delivery.rawBody);
    const postTransaction = postTransactionEvents(delivery.rawBody, eventId);
    if (postTransaction) return postTransaction;
    const body = JSON.parse(delivery.rawBody) as PagBankOrderResponse & { id?: string };
    const paid = settledCharge(body);
    const providerChargeId =
      typeof paid?.id === 'string' ? paid.id : typeof body.id === 'string' ? body.id : null;
    if (!providerChargeId) {
      return [{ provider: NAME, eventId, type: 'UNKNOWN', raw: body }];
    }
    return [
      {
        provider: NAME,
        eventId,
        type: 'CHARGE_UPDATED',
        charge: orderSnapshot(body, providerChargeId),
        raw: body,
      },
    ];
  },
};

/**
 * The historical per-store webhook path this integration has always used —
 * store owners registered it in their PagBank dashboards, which the platform
 * cannot edit, so it must stay BYTE-IDENTICAL forever. Declared on the
 * adapter rather than special-cased in a host (FUT-557): it is a fact about
 * this provider's install base, and every adapter without such history simply
 * omits the override and lands on the host's generic webhook route.
 */
const webhookPath = (tenantSlug: string): string =>
  `/api/webhooks/pagseguro/${tenantSlug}/notifications`;

export function pagbankProvider(): PaymentProviderAdapter {
  return {
    name: NAME,
    displayName: 'PagBank',
    webhookPath,
    // Connect is the happy path; the credential form below stays as the
    // fallback for stores connected before Connect, and for deployments with
    // no registered PagBank application.
    authMode: 'oauth',
    capabilities: {
      methods: ['PIX', 'CARD'],
      savedCards: true,
      refunds: true,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: 'PUBLIC_KEY',
      activationCharge: true,
    },
    credentialSchema: [
      { key: 'token', label: 'Token do PagBank', secret: true, required: true },
      { key: 'publicKey', label: 'Chave pública (cartão)', secret: false, required: false },
      { key: 'webhookToken', label: 'Token de webhook', secret: true, required: true },
    ],
    customerSchema,

    verifyCredentials: verifyPagbankCredentials,
    createCharge,
    oauth: pagbankOAuth,

    async getCharge(providerChargeId, credentials) {
      if (credentials.stub) return stubPendingSnapshot(NAME, providerChargeId);
      const res = await pagbankRequest<PagBankOrderResponse>(
        `/orders/${encodeURIComponent(providerChargeId)}`,
        credentials,
        { method: 'GET' },
      );
      return orderSnapshot(res, providerChargeId);
    },

    findChargeByReference,

    async refund(input, credentials) {
      if (credentials.stub) return stubRefund(NAME, input);
      const res = await pagbankRequest<{ id?: string }>(
        `/charges/${encodeURIComponent(input.providerChargeId)}/cancel`,
        credentials,
        { method: 'POST', body: { amount: { value: input.amount?.amountCents } } },
      );
      return {
        provider: NAME,
        providerChargeId: input.providerChargeId,
        providerRefundId: res.id ?? input.providerChargeId,
        status: 'REFUNDED',
        amount: input.amount ?? { amountCents: 0, currency: 'BRL' },
        raw: res,
      };
    },

    webhook,

    // No walkthrough: homologação is the PLATFORM's, once. PagBank exempts
    // "clientes que usam plataformas de e-commerce ou módulos", so a store
    // owner here must never be handed the form — see FUT-483.

    clientConfig(credentials) {
      return {
        provider: NAME,
        tokenization: 'PUBLIC_KEY',
        publicKey: credentials.fields['publicKey'],
      };
    },
  };
}
