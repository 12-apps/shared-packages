import { z } from 'zod';

/**
 * Each provider's strict WIRE schema for the webhook payload it posts: the
 * documented envelope at the depths the adapters read. Every object is a plain
 * `z.object` (a host that walks the zod definition can name the keys a payload
 * carries that the schema does not declare, and one that parses strictly can
 * refuse them), and every sub-object a provider documents as free-form, or that
 * varies by event type, is a `z.unknown()` that is not entered. Declaring a key
 * as `z.unknown()` says "known, shape not pinned"; leaving it out says "the
 * provider did not document it".
 *
 * Only the payload shape lives here. Verifying a delivery, and what a payload
 * means, stay in each provider's adapter.
 */

const free = z.unknown();

/** PagBank (Orders API): a charge inside the order it posts (developer.pagbank.com.br, "Objeto Order"). */
export const pagbankChargeWireSchema = z.object({
  id: z.string(),
  reference_id: free,
  status: free,
  created_at: free,
  paid_at: free,
  description: free,
  amount: free,
  payment_response: free,
  payment_method: free,
  recurring: free,
  sub_merchant: free,
  splits: free,
  metadata: free,
  notification_urls: free,
  links: free,
});

/** PagBank (Orders API): the ORDER object it posts (developer.pagbank.com.br, "Objeto Order"). */
export const pagbankOrderWireSchema = z.object({
  id: z.string(),
  reference_id: free,
  created_at: free,
  customer: free,
  items: free,
  shipping: free,
  qr_codes: free,
  charges: z.array(pagbankChargeWireSchema).optional(),
  notification_urls: free,
  links: free,
  metadata: free,
});

/** PagBank's legacy transaction notification, form-encoded (`notificationCode`, `notificationType`). */
export const pagbankLegacyWireSchema = z.object({ notificationCode: free, notificationType: free });

/** Stone (Pagar.me v5): the webhook envelope; `data` is the charge or order, which varies by `type`. */
export const stoneWireSchema = z.object({
  id: free,
  account: free,
  type: free,
  created_at: free,
  data: free,
  attempts: free,
  last_attempt: free,
});

/** Stripe: the Event object; `data.object` varies by `type`. */
export const stripeWireSchema = z.object({
  id: free,
  object: free,
  api_version: free,
  account: free,
  context: free,
  created: free,
  data: z.object({ object: free, previous_attributes: free }),
  livemode: free,
  pending_webhooks: free,
  request: free,
  type: free,
});

/** InfinitePay: the checkout's payment notification. */
export const infinitepayWireSchema = z.object({
  invoice_slug: free,
  amount: free,
  paid_amount: free,
  installments: free,
  capture_method: free,
  transaction_nsu: free,
  order_nsu: free,
  receipt_url: free,
  items: free,
});

/** Itaú (BACEN API Pix callback): `{ pix: [...] }`, one entry per received Pix. */
export const itauWireSchema = z.object({
  pix: z.array(
    z.object({
      endToEndId: free,
      txid: free,
      chave: free,
      valor: free,
      horario: free,
      infoPagador: free,
      pagador: free,
      componentesValor: free,
      devolucoes: free,
    }),
  ),
});

/** The provider keys a wire schema exists for (the same strings hosts key a provider by). */
export const WEBHOOK_WIRE_PROVIDERS = ['pagbank', 'stone', 'stripe', 'infinitepay', 'itau'] as const;

export type WebhookWireProvider = (typeof WEBHOOK_WIRE_PROVIDERS)[number];

const isOrderShaped = (payload: unknown): boolean =>
  typeof payload === 'object' && payload !== null && !Array.isArray(payload) && !('notificationCode' in payload);

/** PagBank posts an Order object, or the legacy form carrying `notificationCode`: the shape picks the schema. */
export function pagbankWireSchema(payload: unknown): z.ZodType {
  return isOrderShaped(payload) ? pagbankOrderWireSchema : pagbankLegacyWireSchema;
}

/** The wire schema for a provider's webhook payload, or undefined for a provider with none declared. */
export function webhookWireSchema(provider: string, payload: unknown): z.ZodType | undefined {
  switch (provider) {
    case 'pagbank':
      return pagbankWireSchema(payload);
    case 'stone':
      return stoneWireSchema;
    case 'stripe':
      return stripeWireSchema;
    case 'infinitepay':
      return infinitepayWireSchema;
    case 'itau':
      return itauWireSchema;
    default:
      return undefined;
  }
}
