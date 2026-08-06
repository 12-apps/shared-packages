import { createHmac } from 'node:crypto';

import { ProviderRequestError } from '../core/errors';
import { stubDeliveryTrusted } from '../core/stub-mode';
import type { PaymentProviderAdapter } from '../core/provider';
import type { CustomerSchema } from '../core/customer-schema';
import type {
  NormalizedWebhookEvent,
  ResolvedCredentials,
  WebhookDelivery,
} from '../core/types';
import { secureEquals } from './shared';
import { intentSnapshot, type StripePaymentIntent } from './stripe-charges';
import {
  NAME,
  authorizeUrl,
  oauthDeauthorize,
  oauthToken,
  tokensToFields,
} from './stripe-http';
import {
  cancelCharge,
  createCharge,
  findChargeByReference,
  getCharge,
  methodOf,
  refund,
  verifyCredentials,
} from './stripe-operations';
import { stripeSetupGuide } from './stripe-setup-guide';
import { stripeVault } from './stripe-vault';

/**
 * Stripe adapter — Connect OAuth onboarding + live PaymentIntents.
 *
 * **Why OAuth and not Connect Onboarding.** Stripe steers new platforms to
 * hosted/embedded onboarding, which CREATES accounts the platform controls.
 * Our stores already have their own Stripe accounts and want to keep them, and
 * OAuth is the only flow that connects an existing account. It is documented
 * and supported; it does pin us to Accounts V1, which is the accepted trade.
 *
 * **Authentication.** The OAuth exchange returns an `access_token` that IS a
 * secret key for the connected account, so charges authenticate as that key
 * with no `Stripe-Account` header. A store that instead pasted its own
 * `sk_...` works identically (see `stripe-http.ts`).
 *
 * **Webhooks.** Connect deliveries are signed with the PLATFORM's endpoint
 * secret, which is copied into the merchant's stored fields at connect time —
 * otherwise a connected store would have no way to verify its own deliveries.
 */

/** Events worth normalizing; everything else is recorded as UNKNOWN. */
const CHARGE_EVENTS = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.processing',
  'payment_intent.canceled',
  'payment_intent.requires_action',
  'payment_intent.amount_capturable_updated',
]);

const REFUND_EVENTS = new Set(['charge.refunded', 'refund.updated', 'charge.refund.updated']);

interface StripeEventBody {
  id?: string;
  type?: string;
  data?: { object?: StripePaymentIntent & { amount?: number } };
}

/**
 * Verify a `Stripe-Signature` header against the RAW body.
 *
 * The scheme is `t=<unix>,v1=<hex hmac>` over `"<t>.<rawBody>"` keyed by the
 * endpoint secret. Verifying a re-serialized body is the classic way to get
 * this wrong, which is why the delivery carries raw bytes end to end.
 */
async function verifyStripeSignature(
  delivery: WebhookDelivery,
  credentials: ResolvedCredentials,
): Promise<boolean> {
  const secret = credentials.fields['webhookSecret'];
  // Stub deliveries with no secret pass so stub charges can settle; LIVE
  // deliveries without a secret always fail closed.
  if (!secret) return stubDeliveryTrusted(credentials);
  const header = delivery.headers['stripe-signature'];
  if (!header) return false;
  const parts = new Map(
    header.split(',').map((pair) => {
      const eq = pair.indexOf('=');
      return [pair.slice(0, eq).trim(), pair.slice(eq + 1)] as const;
    }),
  );
  const timestamp = parts.get('t');
  const signature = parts.get('v1');
  if (!timestamp || !signature) return false;
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${delivery.rawBody}`)
    .digest('hex');
  return secureEquals(signature, expected);
}

function parseStripeEvent(delivery: WebhookDelivery): NormalizedWebhookEvent[] {
  const body = JSON.parse(delivery.rawBody) as StripeEventBody;
  const eventId = body.id ?? '';
  const object = body.data?.object;
  const type = body.type ?? '';

  if (object && CHARGE_EVENTS.has(type)) {
    return [
      {
        provider: NAME,
        eventId,
        type: 'CHARGE_UPDATED',
        // No amount fallback: the delivery is the only account of this intent
        // there is, so a succeeded one that omits the amount must fail loudly
        // rather than settle an order for a fabricated zero.
        charge: intentSnapshot(object, {
          currency: object.currency ?? 'BRL',
          method: methodOf(object),
        }),
        raw: body,
      },
    ];
  }
  return [
    {
      provider: NAME,
      eventId,
      type: REFUND_EVENTS.has(type) ? 'REFUND_UPDATED' : 'UNKNOWN',
      raw: body,
    },
  ];
}

/**
 * What Stripe asks of the buyer (FUT-595). Card and PIX need nothing —
 * `billing_details` and `receipt_email` are optional pre-fill — which is
 * why name and e-mail are optional there. The real demands are per
 * METHOD: boleto refuses without a CPF/CNPJ (`boleto.tax_id`, see
 * `boletoIntent`) AND without `billing_details` name + e-mail, so those
 * three are required for BOLETO only.
 *
 * KNOWN GAP the schema cannot yet express: Stripe's boleto additionally
 * demands a full billing address (line1/city/state/postal_code/country —
 * `boletoIntent`'s own comment: "Stripe requires a CPF/CNPJ and a full
 * billing address for boleto"), but `CustomerInfo` has no address block,
 * so `boletoIntent` sends none and a boleto charge still 400s at Stripe
 * even with every declared field present. Extending `CustomerInfo` (and
 * the FUT-596 schema-driven form) with the address is the prerequisite
 * for actually offering boleto; until then the declaration below is the
 * closest truth the type can state.
 */
const customerSchema: CustomerSchema = [
  { key: 'name', type: 'NAME', required: false, methods: ['PIX', 'CARD'] },
  { key: 'email', type: 'EMAIL', required: false, methods: ['PIX', 'CARD'] },
  { key: 'name', type: 'NAME', required: true, methods: ['BOLETO'] },
  { key: 'email', type: 'EMAIL', required: true, methods: ['BOLETO'] },
  { key: 'taxId', type: 'CPF', required: true, methods: ['BOLETO'] },
];

/** Connect OAuth: authorize → exchange → refresh → deauthorize. */
const oauth: NonNullable<PaymentProviderAdapter['oauth']> = {
  async buildAuthorizeUrl(appCredentials, ctx) {
    return { url: authorizeUrl(appCredentials, ctx), state: ctx.state };
  },

  async exchangeCode(code, appCredentials) {
    const res = await oauthToken(appCredentials, { grant_type: 'authorization_code', code });
    if (!res.stripe_user_id) {
      throw new ProviderRequestError(NAME, 'Stripe OAuth response carried no account id.', {
        retriable: false,
      });
    }
    // Standard-account access tokens do not expire; the refresh token exists
    // to ROLL them, not to renew an expiring grant — hence `expiresAt: null`.
    return { fields: tokensToFields(res, appCredentials), expiresAt: null };
  },

  async refresh(current, appCredentials) {
    const refreshToken = current.fields['refreshToken'];
    if (!refreshToken) {
      throw new ProviderRequestError(NAME, 'Stripe connection has no refresh token.', {
        retriable: false,
      });
    }
    const res = await oauthToken(appCredentials, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return { fields: tokensToFields(res, appCredentials, current.fields), expiresAt: null };
  },

  async revoke(current, appCredentials) {
    const stripeUserId = current.fields['stripeUserId'];
    if (!stripeUserId) return;
    await oauthDeauthorize(appCredentials, stripeUserId);
  },
};

export function stripeProvider(): PaymentProviderAdapter {
  return {
    name: NAME,
    displayName: 'Stripe',
    authMode: 'oauth',
    capabilities: {
      methods: ['PIX', 'CARD', 'BOLETO'],
      savedCards: true,
      refunds: true,
      partialRefunds: true,
      splits: true,
      webhooks: true,
      tokenization: 'SDK',
    },
    // OAuth fills these in itself; they stay declared because a store MAY
    // paste its own keys instead (and because the settings page renders the
    // stored connection from this schema either way).
    credentialSchema: [
      { key: 'secretKey', label: 'Secret key (sk_...)', secret: true, required: false },
      { key: 'publishableKey', label: 'Publishable key (pk_...)', secret: false, required: false },
      {
        key: 'webhookSecret',
        label: 'Webhook signing secret (whsec_...)',
        secret: true,
        required: false,
      },
      {
        key: 'connectedAccountId',
        label: 'Connected account (acct_...)',
        secret: false,
        required: false,
      },
    ],
    customerSchema,

    verifyCredentials,
    createCharge,
    getCharge,
    findChargeByReference,

    // Card vaulting for off-session subscription charges (FUT-340).
    vault: stripeVault,
    cancelCharge,
    refund,
    oauth,

    webhook: {
      verify: verifyStripeSignature,
      parse: async (delivery) => parseStripeEvent(delivery),
    },

    setupGuide: stripeSetupGuide,

    clientConfig(credentials) {
      return {
        provider: NAME,
        tokenization: 'SDK',
        publicKey: credentials.fields['publishableKey'],
      };
    },
  };
}
