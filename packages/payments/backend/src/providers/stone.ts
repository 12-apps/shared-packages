import type { PaymentProviderAdapter } from '../core/provider';
import {
  resolvePaymentsCopy,
  type PaymentsCopySource,
} from '../copy-source';
import type { StoneCopy } from './copy';
import { stubDeliveryTrusted } from '../core/stub-mode';
import type {
  NormalizedWebhookEvent,
  RefundSnapshot,
  ResolvedCredentials,
  WebhookDelivery,
} from '../core/types';
import { basicAuth } from './http';
import { CHARGE_EVENTS, FULL_REFUND_EVENTS, REFUND_EVENTS } from './stone-events';
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
import {
  methodOf,
  orderSnapshot,
  positiveCents,
  settledCharge,
  type StoneCharge,
  type StoneOrder,
} from './stone-orders';
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
 * A delivery may carry either the ORDER or a bare CHARGE, and WHICH it is is
 * decided by the event family — not by the shape.
 *
 * A real Pagar.me `charge.*` delivery puts the charge in `data` and nests an
 * order STUB at `data.order`: `id`, `code`, `amount`, `status`, and no
 * `charges` array. Preferring that stub threw away the only account of the
 * charge the delivery carries — `settledCharge` found no charges, the event
 * degraded to `UNKNOWN`, and a paid PIX or card NEVER settled by webhook. Only
 * the buyer's own polling screen saved the order, and `charge.paid` is the
 * first event the setup guide tells the merchant to subscribe to (FUT-674).
 *
 * So a `charge.*` event is normalized the other way round: the charge IS the
 * payload, and the stub contributes only the order's own handles. `code` is
 * read from the STUB alone and never from `data` — a charge carries a `code` of
 * its own (an acquirer NSU, on one raised at a POS terminal), and putting that
 * where `reference` goes hands the host an id no order of its is keyed by.
 */
function orderOf(type: string, body: StoneWebhookBody): StoneOrder {
  const data = body.data;
  if (!data) return {};
  // Unconditional, and the shape is not consulted: on a `charge.*` event
  // `data` IS the charge, so resolving to the nested stub — which has no
  // charges — is the defect itself. A shape guard here was tried and is worse
  // than none: `data` on such a delivery carries the CHARGE's `code` (an
  // acquirer NSU), so reading it as an order names a reference no payable has.
  if (type.startsWith('charge.')) return chargeAsOrder(data);
  // Everything else is an `order.*`, where `data` IS the order, charges and
  // all. Two shape fallbacks used to sit here and are gone: once `charge.*`
  // stopped consulting the shape they could be reached by no event this
  // adapter acts on, and a branch that cannot run is a branch nothing can
  // keep honest.
  return data;
}

/** The charge as its own one-charge order, keyed by the stub's handles alone. */
function chargeAsOrder(data: NonNullable<StoneWebhookBody['data']>): StoneOrder {
  const stub = data.order;
  return {
    ...(stub?.id ? { id: stub.id } : {}),
    ...(stub?.code ? { code: stub.code } : {}),
    charges: [data as StoneCharge],
  };
}

/**
 * The refund a reversal event announces — the LEDGER fact, which is the only
 * account of it the host will ever get for money returned from the Pagar.me
 * dashboard or a POS terminal. It used to be emitted bare (`REFUND_UPDATED`
 * with no `refund`), and `classifyReversalEvent` reads the payload rather than
 * the type, so an estorno reached nothing at all (FUT-674).
 *
 * `status` comes from the EVENT, never from the charge: Pagar.me's own
 * `charge.refunded` example carries `"status": "canceled"` on the charge, so
 * mapping the charge status here would file a completed refund as a
 * cancellation.
 *
 * The amount is `canceled_amount`, the portion that went back. A FULL reversal
 * that omits it falls back to what was captured. A PARTIAL one that omits it
 * yields no refund payload rather than a guessed number — `capturedAmountCents`' rule, one object along: a
 * fabricated amount is precisely the input a reversal guard exists to catch.
 * Standing down leaves the bare event this replaces, which is no worse than
 * before; inventing a figure would be.
 */
function refundOf(type: string, order: StoneOrder, body: StoneWebhookBody): RefundSnapshot | undefined {
  const charge = settledCharge(order);
  const providerChargeId = charge?.id ?? order.id;
  const returned = returnedCents(type, charge);
  if (!providerChargeId || returned === null) return undefined;
  return {
    provider: NAME,
    providerChargeId,
    // Pagar.me mints no separate refund id: a reversal is a state change on the
    // charge itself (a DELETE on it), so the charge's id is the only stable
    // handle the delivery carries — the same call the PagBank adapter makes.
    providerRefundId: providerChargeId,
    ...(order.code ? { reference: order.code } : {}),
    status: 'REFUNDED',
    amount: { amountCents: returned, currency: (charge?.currency ?? 'BRL').toUpperCase() },
    raw: body,
  };
}

/**
 * The cents that went BACK, or null when the delivery does not say how many.
 *
 * Every read is POSITIVE-or-nothing. `canceled_amount: 0` is what a charge that
 * was never reversed carries, and taking it at face value emits a refund of
 * zero — which `classifyReversalEvent` accepts as a real one and hands to
 * `parkReversal`, taking the payable out of settled for no money at all. A
 * stated zero and an absent field are the same claim here: nothing came back.
 */
function returnedCents(type: string, charge: StoneCharge | undefined): number | null {
  const canceled = positiveCents(charge?.canceled_amount);
  if (canceled !== null) return canceled;
  if (!FULL_REFUND_EVENTS.has(type)) return null;
  // A full reversal returns what the buyer actually PAID, which on a charge
  // that settled short is not the amount raised — the same divergence
  // `capturedOf` exists for. `amount` is the last resort, for a delivery that
  // names neither.
  return positiveCents(charge?.paid_amount) ?? positiveCents(charge?.amount);
}

function parseStoneEvent(delivery: WebhookDelivery): NormalizedWebhookEvent[] {
  const body = JSON.parse(delivery.rawBody) as StoneWebhookBody;
  const type = body.type ?? '';
  // Pagar.me sends a delivery id; fall back to a body hash so redeliveries
  // stay idempotent even if it is ever absent.
  const eventId = body.id ?? sha256Hex(delivery.rawBody);
  const order = orderOf(type, body);
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
  if (REFUND_EVENTS.has(type)) {
    const refund = refundOf(type, order, body);
    return [
      { provider: NAME, eventId, type: 'REFUND_UPDATED', ...(refund ? { refund } : {}), raw: body },
    ];
  }
  return [{ provider: NAME, eventId, type: 'UNKNOWN', raw: body }];
}

export function stoneProvider(source: PaymentsCopySource<StoneCopy>): PaymentProviderAdapter {
  // Resolved at each BOUNDARY below, never here — see `src/copy-source.ts`.
  const copy = (locale?: string): StoneCopy => resolvePaymentsCopy(source, locale);

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
    credentialSchema: ({ locale }) => {
      const { fields } = copy(locale ?? undefined);
      return [
        { key: 'secretKey', label: fields.secretKey, secret: true, required: true },
        { key: 'publicKey', label: fields.publicKey, secret: false, required: true },
        { key: 'webhookUser', label: fields.webhookUser, secret: false, required: true },
        { key: 'webhookPassword', label: fields.webhookPassword, secret: true, required: true },
      ];
    },
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

    verifyCredentials: (credentials, locale) => verifyCredentialsWith(copy(locale))(credentials),
    createCharge: (input, credentials) => createChargeWith(copy(input.locale))(input, credentials),
    getCharge,
    findChargeByReference,
    cancelCharge,
    refund,

    webhook: {
      verify: verifyStoneWebhook,
      parse: async (delivery) => parseStoneEvent(delivery),
    },

    setupGuide: (ctx) => stoneSetupGuide(copy(ctx.locale).setupGuide, ctx),

    clientConfig(credentials) {
      return {
        provider: NAME,
        tokenization: 'PUBLIC_KEY',
        publicKey: credentials.fields['publicKey'],
      };
    },
  };
}
