import type { PaymentProviderAdapter } from '../core/provider';
import type { CredentialFieldSpec, ProviderCapabilities } from '../core/types';
import {
  resolvePaymentsCopy,
  type PaymentsCopySource,
} from '../copy-source';
import type { PagbankCopy } from './copy';
import { stubDeliveryTrusted } from '../core/stub-mode';
import type { ChargeInput, NormalizedWebhookEvent, ResolvedCredentials } from '../core/types';
import {
  customerPayload,
  customerSchema,
  NAME,
  notificationUrls,
  pagbankRequest,
} from './pagbank-http';
import { createPagbankThreeDSecureSession } from './pagbank-3ds';
import { pagbankApiBase } from './pagbank-api-base';
import { pagbankOAuth } from './pagbank-oauth';
import { pixPayload, summaryItems } from './pagbank-payloads';
import { captureCharge, findChargeByReference, getCharge, refund } from './pagbank-operations';
import { pagbankVault } from './pagbank-vault';
import { activateApplePayCertificate, requestApplePayCsr } from './pagbank-wallets';
import { verifyPagbankCredentials } from './pagbank-probe';
import { fetchPagbankCardPublicKey } from './pagbank-public-key';
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
import {
  consultedOrder,
  isConnectConnection,
  requireConsultedOrder,
  signerOf,
  signerSecrets,
  verifiedByConsult,
} from './pagbank-webhook-auth';
import { chargeDescription, sha256Hex, stubCharge } from './shared';

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
  // A debit card is not stored: the vault charges a saved card as CREDIT, so
  // keeping it would offer the buyer a card that later pays the wrong way.
  if (card?.funding === 'DEBIT') return { encrypted: card.token ?? '' };
  return { encrypted: card?.token ?? '', store: true };
}

/**
 * `payment_method`'s type and, for a debit charge, the 3-D Secure proof
 * PagBank requires on it (FUT-3754): `authentication_method` is mandatory on
 * `DEBIT_CARD`, and a debit is always a single installment.
 */
function fundingOf(card: NonNullable<ChargeInput['card']> | undefined) {
  if (card?.funding !== 'DEBIT') {
    return { type: 'CREDIT_CARD', installments: card?.installments ?? 1 };
  }
  return {
    type: 'DEBIT_CARD',
    installments: 1,
    authentication_method: { type: 'THREEDS', id: card.authenticationId ?? '' },
  };
}

/** The single `charges[]` entry of a card order. */
function cardCharge(input: ChargeInput) {
  return {
    // PagBank requires a 1–64 char charge description.
    description: chargeDescription(input, 64),
    amount: { value: input.amount.amountCents, currency: input.amount.currency },
    payment_method: {
      ...fundingOf(input.card),
      capture: true,
      card: cardInstrument(input.card),
    },
    // Declares the stored-credential agreement to the issuer. Omitted
    // entirely for an ordinary storefront charge, where there is none.
    ...(input.card?.merchantInitiated ? { recurring: { type: 'SUBSEQUENT' } } : {}),
  };
}

function cardPayload(input: ChargeInput, credentials: ResolvedCredentials, copy: PagbankCopy) {
  return {
    reference_id: input.reference,
    customer: customerPayload(input.customer),
    items: summaryItems(input, copy),
    charges: [cardCharge(input)],
    notification_urls: notificationUrls(credentials),
  };
}

function createChargeWith(
  copy: PagbankCopy,
): NonNullable<PaymentProviderAdapter['createCharge']> {
  return async (input, credentials) => {
    if (credentials.stub) return stubCharge(NAME, input, credentials);
    // The provider-side idempotency key: a retried create is deduped by PagBank
    // itself, on top of the gateway's own guarantees.
    const idempotencyKey = input.idempotencyKey ?? input.reference;
    if (input.method === 'PIX') {
      const expiresAt = new Date(Date.now() + PIX_TTL_MS).toISOString();
      const res = await pagbankRequest<PagBankPixResponse>('/orders', credentials, {
        method: 'POST',
        body: pixPayload(input, credentials, copy, expiresAt),
        idempotencyKey,
      });
      return mapPix(res, input, expiresAt);
    }
    const res = await pagbankRequest<PagBankCardResponse>('/orders', credentials, {
      method: 'POST',
      body: cardPayload(input, credentials, copy),
      idempotencyKey,
    });
    return mapCard(res, input);
  };
}

const webhook: PaymentProviderAdapter['webhook'] = {
  async verify(delivery, credentials) {
    if (signerSecrets(credentials).length === 0) return stubDeliveryTrusted(credentials);
    if (signerOf(delivery, credentials) !== null) return true;
    return (await consultedOrder(delivery, credentials)) !== null;
  },

  signer: (delivery, credentials) =>
    signerOf(delivery, credentials) ?? (isConnectConnection(credentials) ? 'orderConsult' : null),

  refusalDetail(delivery, credentials) {
    const header = delivery.headers['x-authenticity-token'] ? 'present' : 'absent';
    const tried = signerSecrets(credentials).map(([field]) => field).join(', ') || 'none';
    const consult = isConnectConnection(credentials) ? '; order consult failed' : '';
    return `x-authenticity-token ${header}; tried ${tried}${consult}`;
  },

  /**
   * PagBank posts the ORDER object. The signature (`pagbank-webhook-auth.ts`)
   * is what makes the body trustworthy — or, for an unsigned Connect delivery,
   * the order PagBank answered replaces it outright; `eventId` falls back to a body hash because PagBank sends no
   * delivery id, which still makes redeliveries idempotent. Post-transaction
   * events reach this same URL form-encoded, which the `JSON.parse` below
   * throws on — see `pagbank-webhook.ts`.
   */
  async parse(delivery, credentials) {
    const eventId = sha256Hex(delivery.rawBody);
    const postTransaction = postTransactionEvents(delivery.rawBody, eventId);
    if (postTransaction) return postTransaction;
    const body = verifiedByConsult(delivery, credentials)
      ? await requireConsultedOrder(delivery, credentials)
      : (JSON.parse(delivery.rawBody) as PagBankOrderResponse & { id?: string });
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
function credentialSchemaFor(copy: PagbankCopy): readonly CredentialFieldSpec[] {
  return [
    { key: 'token', label: copy.fields.token, secret: true, required: true },
    { key: 'publicKey', label: copy.fields.publicKey, secret: false, required: false },
    // Optional since FUT-678: webhook verification defaults to the account
    // token (PagBank's documented signing secret); this field is only an
    // explicit override for deployments that configured a dedicated one.
    { key: 'webhookToken', label: copy.fields.webhookToken, secret: true, required: false, role: 'webhookSecret' },
    // The merchant's id at PagBank as Google Pay's `gatewayMerchantId`
    // (FUT-471). Optional and NOT secret — it is baked into every integrating
    // page. PagBank answered the Connect question (FUT-3756): it is the
    // connected seller's account id, which `clientConfig` falls back to, so
    // this field is only an override for a store connected by token.
    {
      key: 'googlePayMerchantId',
      label: copy.fields.googlePayMerchantId,
      secret: false,
      required: false,
    },
  ];
}

/**
 * The card-encryption public key, minted with the store's OWN token when none
 * is stored (FUT-174) — an OAuth-connected store never pastes one, and copying
 * the platform's own key in would name a different account. Declaring it here
 * is what lets a host stop asking `provider === 'pagbank'` on its checkout
 * path. Hoisted for the size gate, like `credentialSchema` above.
 */
const browserKey = {
  field: 'publicKey',
  mint: (credentials: ResolvedCredentials) =>
    fetchPagbankCardPublicKey({
      apiBase: pagbankApiBase(credentials.environment),
      token: credentials.fields['token'],
    }),
};

/** What PagBank can do. Hoisted for the size gate, like `browserKey` above. */
const capabilities: ProviderCapabilities = {
  methods: ['PIX', 'CARD'],
  // Both wallets ride the card charge as `card.wallet` (FUT-471/472).
  // Declared here — the single capability source — so the gateway skips a
  // wallet charge on any provider that never made this claim, and the
  // checkout gates its buttons on the same fact. Apple Pay additionally
  // needs the certificate round-trip (`applePay` below) completed for the
  // merchant account before a charge can authorize.
  wallets: ['GOOGLE_PAY', 'APPLE_PAY'],
  // DEBIT_CARD with PagBank's own 3-D Secure (FUT-3754); `debit` below
  // mints the browser's session.
  debit: true,
  savedCards: true,
  refunds: true,
  partialRefunds: false,
  splits: false,
  webhooks: true,
  tokenization: 'PUBLIC_KEY',
  activationCharge: true,
};

/**
 * The smallest card charge PagBank PRODUCTION will create. Its reference
 * states no minimum and the sandbox takes one cent, so the refusal is the
 * specification (FUT-4048, the first live activation):
 *
 *     400 {"code":"40002","error":"THIS CHARGE DOES NOT COMPLY WITH THE MIN
 *          AND MAX AMOUNT VALUE REQUIREMENTS",
 *          "parameter_name":"charges[0].amount.value"}
 *
 * for `value: 1`. R$ 1,00 is the owner's call for the proof; the activation
 * screens name the figure from here, never a cent.
 */
const MINIMUM_CHARGE_CENTS = 100;

// `copy` is resolved at each BOUNDARY below, never once here — `src/copy-source.ts`.
export function pagbankProvider(source: PaymentsCopySource<PagbankCopy>): PaymentProviderAdapter {
  const copy = (locale?: string): PagbankCopy => resolvePaymentsCopy(source, locale);

  return {
    name: NAME,
    displayName: 'PagBank',
    webhookPath,
    minimumChargeCents: MINIMUM_CHARGE_CENTS,
    // Connect is the happy path; the credential form below stays as the
    // fallback for stores connected before Connect, and for deployments with
    // no registered PagBank application.
    authMode: 'oauth',
    capabilities,
    credentialSchema: ({ locale }) => credentialSchemaFor(copy(locale ?? undefined)),
    customerSchema,
    // A PIX code and a card typed on OUR page (FUT-596). Named for the SHAPE,
    // not for this vendor: Stone's flow is the same shape and declares the same
    // id rather than forking a second screen.
    checkoutScreen: 'pix-and-card',

    verifyCredentials: (credentials, locale) => verifyPagbankCredentials(copy(locale))(credentials),
    createCharge: (input, credentials) => createChargeWith(copy(input.locale))(input, credentials),
    oauth: pagbankOAuth,

    // Card vaulting WITHOUT a purchase (FUT-478/FUT-183) — the dedicated
    // `POST /tokens/cards` validation-and-storage call; see `pagbank-vault.ts`.
    // No `forget`: PagBank documents no token delete, and the omission is the
    // contract's honest way to say so.
    vault: pagbankVault,

    browserKey,

    debit: { createSession: createPagbankThreeDSecureSession },

    // Apple Pay's certificate round-trip (FUT-472) — see `pagbank-wallets.ts`.
    applePay: {
      requestCsr: requestApplePayCsr,
      activateCertificate: activateApplePayCertificate,
    },

    // The read/refund operations live in `pagbank-operations.ts`, which is
    // where the FUT-681 identity rule (charge id vs order id) is enforced.
    getCharge,
    findChargeByReference,
    refund,
    captureCharge,

    webhook,

    // No walkthrough: homologação is the PLATFORM's, once. PagBank exempts
    // "clientes que usam plataformas de e-commerce ou módulos", so a store
    // owner here must never be handed the form — see FUT-483.

    clientConfig(credentials) {
      // PagBank defines `gatewayMerchantId` as the seller's account id
      // (`ACCO_…`, FUT-3756). Connect stores it as `accountId`, so a store
      // connected by OAuth has it without anyone typing the field; the
      // field stays as the override for a store connected by token.
      const gatewayMerchantId = credentials.fields['googlePayMerchantId'] || credentials.fields['accountId'];
      return {
        provider: NAME,
        tokenization: 'PUBLIC_KEY',
        publicKey: credentials.fields['publicKey'],
        // Google Pay's PAYMENT_GATEWAY parameters (FUT-471). `gateway` is
        // PagBank's id in Google's processor registry — a fact about PagBank,
        // spelled once here; the merchant id is per connection and `null`
        // until configured, which the button reads as "do not render".
        googlePay: {
          gateway: 'pagbank',
          gatewayMerchantId: gatewayMerchantId || null,
          environment: credentials.environment === 'PRODUCTION' ? 'PRODUCTION' : 'TEST',
        },
      };
    },
  };
}
