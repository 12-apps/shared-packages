import { ProviderRequestError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import type { StripeCopy } from './copy';
import type { CustomerSchema } from '../core/customer-schema';
import type { NormalizedWebhookEvent, WebhookDelivery } from '../core/types';
import { sha256Hex } from './shared';
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
  verifyCredentialsWith,
} from './stripe-operations';
import { stripeSetupGuide } from './stripe-setup-guide';
import { stripeIntakeFreshness, verifyStripeSignature } from './stripe-webhook-verify';
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
 * That copy is a snapshot, so `verify` ALSO accepts a host-stamped
 * `platformWebhookSecret` (see `core/webhook-secret.ts`): when the platform
 * rolls its endpoint secret, the resolve-time stamp is what keeps every
 * already-connected store verifying (FUT-690).
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

function parseStripeEvent(delivery: WebhookDelivery): NormalizedWebhookEvent[] {
  let body: StripeEventBody;
  try {
    body = JSON.parse(delivery.rawBody) as StripeEventBody;
  } catch {
    // A signed-but-malformed body used to escape as a bare `SyntaxError`,
    // which is not a `PaymentsError` and so slipped past `guardedWebhook` into
    // a 500 about our server. A `PaymentsError` is what the webhook guard
    // answers as the 400 every provider redelivers on, and retriable is
    // honest: the truncation may be transport damage a redelivery repairs.
    throw new ProviderRequestError(NAME, 'Stripe webhook body is not valid JSON.', {
      retriable: true,
    });
  }
  // Stripe always sends `id`, but the inbox dedups on a unique index, so two
  // deliveries defaulted to '' would collide and the second would be silently
  // swallowed as a duplicate. Hash the body instead, as pagbank does.
  const eventId = body.id ? body.id : sha256Hex(delivery.rawBody);
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

/**
 * What a store types when it connects with its OWN keys.
 *
 * A module constant rather than an inline literal: it is data, it never varies
 * per call, and inlining it pushed `stripeProvider` past the size gate — the
 * adapter's shape is what that function is for, not four field descriptions.
 */
function credentialSchemaFor(copy: StripeCopy): PaymentProviderAdapter['credentialSchema'] {
  return [
    { key: 'secretKey', label: 'Secret key (sk_...)', secret: true, required: false, fulfilledBy: 'accessToken' },
    { key: 'publishableKey', label: 'Publishable key (pk_...)', secret: false, required: false },
    {
      key: 'webhookSecret',
      label: 'Webhook signing secret (whsec_...)',
      secret: true,
      required: false,
      role: 'webhookSecret',
    },
    {
      key: 'connectedAccountId',
      label: 'Connected account (acct_...)',
      secret: false,
      required: false,
      // Sends `Stripe-Account:` — only meaningful for a platform charging on
      // behalf of an account it onboarded. A store using its own key must
      // leave this empty; its own id here makes Stripe refuse every call.
      advanced: true,
      helperText: copy.fields.connectedAccountHelp,
    },
  ];
}

export function stripeProvider(copy: StripeCopy): PaymentProviderAdapter {
  return {
    name: NAME,
    displayName: 'Stripe',
    authMode: 'oauth',
    capabilities: {
      methods: ['PIX', 'CARD', 'BOLETO'],
      savedCards: true,
      refunds: true,
      partialRefunds: true,
      // Stripe Connect CAN split, but this adapter never sends
      // transfer_data/application_fee_amount and ChargeInput carries no split
      // instruction to forward — declaring it was a false claim the settings
      // API and the MCP manifest repeated (FUT-692).
      splits: false,
      webhooks: true,
      tokenization: 'SDK',
      // Runnable end to end (FUT-689): the browser mints a PaymentMethod with
      // the publishable key (FUT-698's `stripe-pm`), the generic CARD branch
      // charges and refunds it. Declaring it is what makes `proofMissing`
      // fire — without it a connection could be enabled with zero proof.
      activationCharge: true,
    },
    // OAuth fills these in itself; they stay declared because a store MAY
    // paste its own keys instead (and because the settings page renders the
    // stored connection from this schema either way). The exchange stores its
    // key under `accessToken`, never `secretKey` (`apiKeyOf` says why the two
    // must not share a slot) — `fulfilledBy` is what keeps the masked view
    // reading that store as configured, not as empty fields (FUT-691).
    credentialSchema: credentialSchemaFor(copy),
    customerSchema,

    verifyCredentials: verifyCredentialsWith(copy),
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
      intakeFreshness: stripeIntakeFreshness,
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
