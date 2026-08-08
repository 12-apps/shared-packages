import type { PaymentProviderAdapter } from '../core/provider';
import { stubDeliveryTrusted } from '../core/stub-mode';
import type { ChargeInput, NormalizedWebhookEvent, ResolvedCredentials } from '../core/types';
import {
  customerPayload,
  customerSchema,
  NAME,
  notificationUrls,
  pagbankRequest,
} from './pagbank-http';
import { pagbankOAuth } from './pagbank-oauth';
import { findChargeByReference, getCharge, refund } from './pagbank-operations';
import { verifyPagbankCredentials } from './pagbank-probe';
import {
  mapCard,
  mapPix,
  orderSnapshot,
  refundedCents,
  settledCharge,
  type PagBankCardResponse,
  type PagBankOrderResponse,
  type PagBankPixResponse,
} from './pagbank-snapshots';
import { postTransactionEvents } from './pagbank-webhook';
import { secureEquals, sha256Hex, stubCharge } from './shared';

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

function pixPayload(input: ChargeInput, credentials: ResolvedCredentials, expiresAt: string) {
  return {
    reference_id: input.reference,
    customer: customerPayload(input.customer),
    qr_codes: [{ amount: { value: input.amount.amountCents }, expiration_date: expiresAt }],
    notification_urls: notificationUrls(credentials),
  };
}

/**
 * The `card` object of a card charge's `payment_method` — which of PagBank's
 * three instrument spellings this charge carries.
 *
 * A WALLET wins outright (FUT-471/472): `{ wallet: { type, key } }` per the
 * "Pagando com Google Pay / Apple Pay" guides, both fields mandatory, and
 * nothing else rides beside it — the wallet token IS the card, so an encrypted
 * blob or vault id next to it would be a second instrument in one charge.
 * A saved card charges by vault id; a fresh card sends the encrypted blob and
 * asks PagBank to store it for reuse.
 */
function cardInstrument(card: NonNullable<ChargeInput['card']> | undefined) {
  if (card?.wallet) return { wallet: { type: card.wallet.type, key: card.wallet.key } };
  if (card?.savedCardToken) return { id: card.savedCardToken };
  return { encrypted: card?.token ?? '', store: true };
}

/** The single `charges[]` entry of a card order. */
function cardCharge(input: ChargeInput) {
  return {
    // PagBank requires a 1–64 char charge description.
    description: `Pedido ${input.reference}`.slice(0, 64),
    amount: { value: input.amount.amountCents, currency: input.amount.currency },
    payment_method: {
      type: 'CREDIT_CARD',
      installments: input.card?.installments ?? 1,
      capture: true,
      card: cardInstrument(input.card),
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

const createCharge: PaymentProviderAdapter['createCharge'] = async (input, credentials) => {
  if (credentials.stub) return stubCharge(NAME, input, credentials);
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
 * SHA-256(`${secret}-${rawBody}`), where the documented secret is the ACCOUNT
 * token ("token da conta") — so the API `token` is the default and a stored
 * `webhookToken` is the platform's explicit override, not a requirement
 * (FUT-678). Requiring `webhookToken` alone is what killed Connect stores:
 * an OAuth connection only ever gets that field by env-var copy, and without
 * it every delivery died fail-closed BEFORE the durable inbox — no row, no
 * replay, no trace. The `??` order keeps an explicitly configured override
 * authoritative where one exists.
 *
 * Which account signs a CONNECT store's deliveries (the store's own token vs
 * the platform's) is still to be measured against a live sandbox Connect
 * store; both secrets reach this verify through the pipeline's candidate
 * sets, so either answer authenticates.
 *
 * The URL itself carries no secret because `notification_urls` is capped at
 * 150 chars, so this header IS the authentication — hence fail-closed when it
 * is absent or no secret is configured at all (stub mode excepted).
 */
const webhook: PaymentProviderAdapter['webhook'] = {
  async verify(delivery, credentials) {
    const secret = credentials.fields['webhookToken'] ?? credentials.fields['token'];
    if (!secret) return stubDeliveryTrusted(credentials);
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
    const charge = orderSnapshot(body, providerChargeId);
    const events: NormalizedWebhookEvent[] = [
      { provider: NAME, eventId, type: 'CHARGE_UPDATED', charge, raw: body },
    ];
    // A canceled charge whose summary shows money RETURNED is a refund, and
    // the host must be able to see it as one (FUT-681 — "estornos são
    // invisíveis ao host"). The charge event above already moves the row to
    // REFUNDED; this names the refund itself, the way Stone and Stripe do.
    // Its own event id, because the inbox dedups per event.
    const refunded = refundedCents(paid);
    if (refunded > 0) {
      events.push({
        provider: NAME,
        eventId: `${eventId}:refund`,
        type: 'REFUND_UPDATED',
        refund: {
          provider: NAME,
          providerChargeId,
          // PagBank's order body names no separate refund object; the charge
          // id is the only stable handle the delivery carries.
          providerRefundId: providerChargeId,
          ...(typeof body.reference_id === 'string' ? { reference: body.reference_id } : {}),
          status: 'REFUNDED',
          amount: { amountCents: refunded, currency: 'BRL' },
          raw: body,
        },
        raw: body,
      });
    }
    return events;
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

/** What connecting a PagBank account collects. Hoisted for the size gate. */
const credentialSchema = [
  { key: 'token', label: 'Token do PagBank', secret: true, required: true },
  { key: 'publicKey', label: 'Chave pública (cartão)', secret: false, required: false },
  // Optional since FUT-678: webhook verification defaults to the account
  // token (PagBank's documented signing secret); this field is only an
  // explicit override for deployments that configured a dedicated one.
  { key: 'webhookToken', label: 'Token de webhook', secret: true, required: false },
  // The merchant's id at PagBank as Google Pay's `gatewayMerchantId`
  // (FUT-471). Optional and NOT secret — it is baked into every integrating
  // page — and the Google Pay button simply does not render for a connection
  // that has none. Whose id applies under Connect (platform vs connected
  // seller) is undocumented by PagBank and still an open question on the
  // ticket; a per-connection field can hold either answer.
  {
    key: 'googlePayMerchantId',
    label: 'Google Pay: ID do lojista (gatewayMerchantId)',
    secret: false,
    required: false,
  },
] as const;

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
      // Google Pay rides the card charge as `card.wallet` (FUT-471). Declared
      // here — the single capability source — so the gateway skips a wallet
      // charge on any provider that never made this claim, and the checkout
      // gates its buttons on the same fact.
      wallets: ['GOOGLE_PAY'],
      savedCards: true,
      refunds: true,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: 'PUBLIC_KEY',
      activationCharge: true,
    },
    credentialSchema,
    customerSchema,
    // A PIX code and a card typed on OUR page (FUT-596). Named for the SHAPE,
    // not for this vendor: Stone's flow is the same shape and declares the same
    // id rather than forking a second screen.
    checkoutScreen: 'pix-and-card',

    verifyCredentials: verifyPagbankCredentials,
    createCharge,
    oauth: pagbankOAuth,

    // The read/refund operations live in `pagbank-operations.ts`, which is
    // where the FUT-681 identity rule (charge id vs order id) is enforced.
    getCharge,
    findChargeByReference,
    refund,

    webhook,

    // No walkthrough: homologação is the PLATFORM's, once. PagBank exempts
    // "clientes que usam plataformas de e-commerce ou módulos", so a store
    // owner here must never be handed the form — see FUT-483.

    clientConfig(credentials) {
      const gatewayMerchantId = credentials.fields['googlePayMerchantId'];
      return {
        provider: NAME,
        tokenization: 'PUBLIC_KEY',
        publicKey: credentials.fields['publicKey'],
        // Google Pay's PAYMENT_GATEWAY parameters (FUT-471). `gateway` is
        // PagBank's id in Google's processor registry — a fact about PagBank,
        // spelled once here; the merchant id is per connection and `null`
        // until configured, which the button reads as "do not render".
        googlePay: { gateway: 'pagbank', gatewayMerchantId: gatewayMerchantId || null },
      };
    },
  };
}
