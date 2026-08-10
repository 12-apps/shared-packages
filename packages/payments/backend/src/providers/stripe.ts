import { createHmac } from 'node:crypto';

import { ProviderRequestError } from '../core/errors';
import { stubDeliveryTrusted } from '../core/stub-mode';
import type { PaymentProviderAdapter } from '../core/provider';
import type { CustomerSchema } from '../core/customer-schema';
import type {
  IntakeFreshness,
  NormalizedWebhookEvent,
  ResolvedCredentials,
  WebhookDelivery,
} from '../core/types';
import { secureEquals, sha256Hex } from './shared';
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

/**
 * Stripe's documented tolerance for the signature timestamp — five minutes.
 * Enforced ONLY at live intake via `intakeFreshness`, never inside `verify`:
 * the replay sweep re-verifies rows the inbox stored hours earlier and must
 * keep succeeding forever (`core/webhook-replay.ts` documents why).
 */
const INTAKE_TOLERANCE_MS = 5 * 60_000;

/** A `Stripe-Signature` header, decomposed: the one `t`, EVERY `v1`. */
interface StripeSignatureHeader {
  timestamp: string;
  /**
   * All of them, not a map's last-wins one: while an endpoint secret is
   * being rolled Stripe signs with both secrets and sends `t=…,v1=A,v1=B`,
   * and the correct behaviour is to accept if ANY matches. The previous
   * `Map`-based parse kept only the final `v1`, so a delivery only
   * verifiable by an earlier one was refused — for the whole duration of
   * the roll (FUT-690).
   */
  signatures: readonly string[];
}

function parseSignatureHeader(header: string): StripeSignatureHeader | null {
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const pair of header.split(',')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim();
    if (key === 't') timestamp = pair.slice(eq + 1);
    if (key === 'v1') signatures.push(pair.slice(eq + 1));
  }
  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * The secrets a delivery may authenticate under. `webhookSecret` is the
 * merchant's own copy (pasted, or snapshotted from the platform at connect
 * time — see `stripe-http.ts`); `platformWebhookSecret` is the platform's
 * CURRENT endpoint secret, stamped at resolve time by
 * `withPlatformWebhookSecret`. Accepting either is what survives a platform
 * secret rotation without every connected store reconnecting.
 */
function webhookSecretsOf(credentials: ResolvedCredentials): string[] {
  const { fields } = credentials;
  return [fields['webhookSecret'], fields['platformWebhookSecret']].filter(
    (secret): secret is string => Boolean(secret),
  );
}

function signedBy(header: StripeSignatureHeader, rawBody: string, secret: string): boolean {
  const expected = createHmac('sha256', secret)
    .update(`${header.timestamp}.${rawBody}`)
    .digest('hex');
  return header.signatures.some((signature) => secureEquals(signature, expected));
}

/** The identity facts a signed Connect delivery may carry in its body. */
interface StripeDeliveryIdentity {
  account?: unknown;
  livemode?: unknown;
}

/**
 * Cross-tenant and cross-environment binding (FUT-690). Connect stores share
 * the platform's endpoint secret, so a GENUINE delivery about store A's money
 * also verifies cryptographically at store B's URL — and attribution is the
 * URL slug, so B's charge rows are what that event would then update. The
 * signed body itself names the account (`account`, on Connect events) and the
 * environment (`livemode`), so refuse a contradiction with the credentials.
 *
 * Fail OPEN on missing metadata (not every event carries `account`; a
 * pasted-key store has no `stripeUserId`), CLOSED on contradiction. A body
 * that does not parse carries no metadata to contradict — `parse` owns
 * answering the malformed case.
 */
function boundToCredentials(delivery: WebhookDelivery, credentials: ResolvedCredentials): boolean {
  let body: StripeDeliveryIdentity;
  try {
    body = JSON.parse(delivery.rawBody) as StripeDeliveryIdentity;
  } catch {
    return true;
  }
  const accountId = credentials.fields['stripeUserId'];
  if (typeof body.account === 'string' && accountId && body.account !== accountId) {
    return false;
  }
  if (typeof body.livemode === 'boolean') {
    return body.livemode === (credentials.environment === 'PRODUCTION');
  }
  return true;
}

/**
 * Verify a `Stripe-Signature` header against the RAW body.
 *
 * The scheme is `t=<unix>,v1=<hex hmac>` over `"<t>.<rawBody>"` keyed by the
 * endpoint secret. Verifying a re-serialized body is the classic way to get
 * this wrong, which is why the delivery carries raw bytes end to end.
 * Deliberately NO timestamp-tolerance here — that is `intakeFreshness`'s job,
 * on the live path only, so stored rows keep re-verifying under replay.
 */
async function verifyStripeSignature(
  delivery: WebhookDelivery,
  credentials: ResolvedCredentials,
): Promise<boolean> {
  const secrets = webhookSecretsOf(credentials);
  // Stub deliveries with no secret pass so stub charges can settle; LIVE
  // deliveries without a secret always fail closed.
  if (secrets.length === 0) return stubDeliveryTrusted(credentials);
  const header = delivery.headers['stripe-signature'];
  if (!header) return false;
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (!secrets.some((secret) => signedBy(parsed, delivery.rawBody, secret))) return false;
  return boundToCredentials(delivery, credentials);
}

/**
 * The live-intake skew window on `t=`. Missing or unreadable timestamps pass
 * (a stub delivery has no header at all, and `verify` still decides
 * authenticity either way); an attacker cannot mint a malformed `t` to dodge
 * the window, because `t` is under the HMAC that `verify` checks first.
 */
function stripeIntakeFreshness(delivery: WebhookDelivery, nowMs: number): IntakeFreshness {
  const header = delivery.headers['stripe-signature'];
  const timestamp = header ? parseSignatureHeader(header)?.timestamp : undefined;
  const signedAtMs = Number(timestamp) * 1000;
  if (!timestamp || !Number.isFinite(signedAtMs)) return { fresh: true };
  const skewMs = Math.abs(nowMs - signedAtMs);
  if (skewMs <= INTAKE_TOLERANCE_MS) return { fresh: true };
  return {
    fresh: false,
    reason:
      `Stripe delivery timestamp t=${timestamp} is ${Math.round(skewMs / 1000)}s from now, ` +
      `outside the ${INTAKE_TOLERANCE_MS / 1000}s intake tolerance`,
  };
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
      // Stripe Connect CAN split, but this adapter never sends
      // transfer_data/application_fee_amount and ChargeInput carries no split
      // instruction to forward — declaring it was a false claim the settings
      // API and the MCP manifest repeated (FUT-692).
      splits: false,
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
        role: 'webhookSecret',
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
