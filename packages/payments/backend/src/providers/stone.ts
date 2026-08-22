import type { PaymentProviderAdapter } from '../core/provider';
import type { StoneCopy } from './copy';
import { stubDeliveryTrusted } from '../core/stub-mode';
import type {
  NormalizedWebhookEvent,
  ResolvedCredentials,
  WebhookDelivery,
} from '../core/types';
import { basicAuth } from './http';
import { secureEquals, sha256Hex } from './shared';
import { NAME } from './stone-http';
import {
  cancelCharge,
  createChargeWith,
  findChargeByReference,
  getCharge,
  refund,
  verifyCredentialsWith,
} from './stone-operations';
import { methodOf, orderSnapshot, settledCharge, type StoneCharge, type StoneOrder } from './stone-orders';
import { stoneSetupGuide } from './stone-setup-guide';

/**
 * Stone adapter — live against the Pagar.me v5 API (Pagar.me is Stone's
 * payments technology, and its v5 surface is what Stone's online products
 * speak).
 *
 * **No OAuth, deliberately.** Every Stone API — Connect Stone, Stone Online,
 * the Partner Hub — authenticates with a key; none of them has a
 * "merchant authorizes an application" flow. The alternative would be the
 * Pagar.me marketplace model, where the platform onboards stores as
 * *recebedores* and transacts under its OWN key with split rules — that needs
 * a commercial contract with Stone, not code. So a store pastes its secret
 * key, exactly as it does in Pagar.me's own dashboard.
 *
 * Same house rules as the other live adapters: a card decline is a RESULT,
 * not an exception; retries only ever happen pre-send; no PAN reaches here.
 */

/** Pagar.me event types that carry a charge state change. */
const CHARGE_EVENTS = new Set([
  'charge.paid',
  'charge.payment_failed',
  'charge.pending',
  'charge.processing',
  'charge.canceled',
  'charge.underpaid',
  'charge.overpaid',
  'order.paid',
  'order.payment_failed',
  'order.canceled',
]);

const REFUND_EVENTS = new Set(['charge.refunded', 'charge.partial_refunded']);

interface StoneWebhookBody {
  id?: string;
  type?: string;
  data?: StoneOrder & { order?: StoneOrder };
}

/**
 * Pagar.me authenticates webhook deliveries with HTTP Basic credentials the
 * merchant sets on the endpoint in their dashboard. FAIL CLOSED: a live
 * delivery with no configured credentials is always rejected — a forged
 * `paid` must never authenticate by omission.
 */
async function verifyStoneWebhook(
  delivery: WebhookDelivery,
  credentials: ResolvedCredentials,
): Promise<boolean> {
  const user = credentials.fields['webhookUser'];
  const password = credentials.fields['webhookPassword'] ?? '';
  if (!user) return stubDeliveryTrusted(credentials);
  const presented = delivery.headers['authorization'] ?? '';
  return secureEquals(presented, basicAuth(user, password));
}

/**
 * A delivery may carry either the order or a bare charge, depending on the
 * event family. Normalizing both into an order shape keeps one mapping path.
 */
function orderOf(body: StoneWebhookBody): StoneOrder {
  const data = body.data;
  if (!data) return {};
  if (data.order) return data.order;
  if (!data.charges && data.id) return { charges: [data as StoneCharge] };
  return data;
}

function parseStoneEvent(delivery: WebhookDelivery): NormalizedWebhookEvent[] {
  const body = JSON.parse(delivery.rawBody) as StoneWebhookBody;
  const type = body.type ?? '';
  // Pagar.me sends a delivery id; fall back to a body hash so redeliveries
  // stay idempotent even if it is ever absent.
  const eventId = body.id ?? sha256Hex(delivery.rawBody);
  const order = orderOf(body);
  const charge = settledCharge(order);

  if (CHARGE_EVENTS.has(type) && charge) {
    return [
      {
        provider: NAME,
        eventId,
        type: 'CHARGE_UPDATED',
        // No amount fallback: the delivery is the only account of this charge
        // there is, so a `paid` one that omits the amount must fail loudly
        // rather than settle an order for a fabricated zero.
        charge: orderSnapshot(order, {
          currency: charge.currency ?? 'BRL',
          method: methodOf(charge, 'PIX'),
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

export function stoneProvider(copy: StoneCopy): PaymentProviderAdapter {
  return {
    name: NAME,
    displayName: 'Stone',
    authMode: 'credentials',
    capabilities: {
      methods: ['PIX', 'CARD', 'BOLETO'],
      // Pagar.me can vault cards, but this adapter implements no vault seam —
      // the flag advertised a wallet no buyer could reach (caught by the
      // FUT-692 capabilities audit; the vault itself is Stone sub-epic work).
      savedCards: false,
      refunds: true,
      partialRefunds: true,
      // Split exists on Pagar.me, but only for a platform that onboarded the
      // store as a recebedor — not for a store using its own key here.
      splits: false,
      webhooks: true,
      tokenization: 'PUBLIC_KEY',
      activationCharge: true,
    },
    credentialSchema: [
      { key: 'secretKey', label: copy.fields.secretKey, secret: true, required: true },
      { key: 'publicKey', label: copy.fields.publicKey, secret: false, required: true },
      { key: 'webhookUser', label: copy.fields.webhookUser, secret: false, required: true },
      { key: 'webhookPassword', label: copy.fields.webhookPassword, secret: true, required: true },
    ],
    /**
     * What Stone asks of the buyer (FUT-595) — the honest reading of what
     * `customerPayload` sends: name, e-mail and the CPF/CNPJ (`document`) all
     * travel when present and are omitted when not, and no phone is sent at
     * all. Nothing is declared required until a live refusal proves it, the
     * same evidence standard `minimumChargeCents` set (FUT-557).
     */
    customerSchema: [
      { key: 'name', type: 'NAME', required: false },
      { key: 'email', type: 'EMAIL', required: false },
      { key: 'taxId', type: 'CPF', required: false },
    ],

    verifyCredentials: verifyCredentialsWith(copy),
    createCharge: createChargeWith(copy),
    getCharge,
    findChargeByReference,
    cancelCharge,
    refund,

    webhook: {
      verify: verifyStoneWebhook,
      parse: async (delivery) => parseStoneEvent(delivery),
    },

    setupGuide: (ctx) => stoneSetupGuide(copy.setupGuide, ctx),

    clientConfig(credentials) {
      return {
        provider: NAME,
        tokenization: 'PUBLIC_KEY',
        publicKey: credentials.fields['publicKey'],
      };
    },
  };
}
