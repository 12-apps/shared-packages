import { ProviderRequestError } from '../core/errors';
import type { ResolvedCredentials, WebhookDelivery } from '../core/types';
import { NAME, pagbankRequest } from './pagbank-http';
import type { PagBankOrderResponse } from './pagbank-snapshots';
import { secureEquals, sha256Hex } from './shared';

/**
 * PagBank signs deliveries with `x-authenticity-token` =
 * SHA-256(`${secret}-${rawBody}`), where the documented secret is the ACCOUNT
 * token ("token da conta") — and PagBank never says WHICH account under
 * Connect (FUT-678). So a delivery authenticates under any secret it could
 * honestly have been signed with:
 *
 * - `webhookToken` — the platform's explicit override, copied in at connect;
 * - `token` — the merchant's own account token (a connected store's OAuth
 *   token, or the one a store pasted);
 * - `platformWebhookSecret` — the PLATFORM account's token, and
 *   `platformClientSecret` — the application's client secret, both stamped at
 *   resolve time by `withPlatformWebhookSecret` and honoured only for an OAuth
 *   connection, the one case where the platform's account created the
 *   application the order was raised through.
 *
 * It used to be `webhookToken ?? token`: one secret, so a configured override
 * hid the store's token entirely. The second sandbox evidence run (FUT-3722)
 * had all six of the test seller's notifications refused that way. `signer`
 * reports which field matched, so the first accepted delivery answers FUT-678.
 *
 * The URL itself carries no secret because `notification_urls` is capped at
 * 150 chars, so this header IS the authentication — hence fail-closed when it
 * is absent or no secret is configured at all (stub mode excepted).
 */
export function signerSecrets(credentials: ResolvedCredentials): Array<[string, string]> {
  const { fields } = credentials;
  const oauth = Boolean(fields['refreshToken']);
  const named: Array<[string, string | undefined]> = [
    ['webhookToken', fields['webhookToken']],
    ['token', fields['token']],
    ['platformWebhookSecret', oauth ? fields['platformWebhookSecret'] : undefined],
    ['platformClientSecret', oauth ? fields['platformClientSecret'] : undefined],
  ];
  return named.filter((entry): entry is [string, string] => Boolean(entry[1]));
}

export function signerOf(delivery: WebhookDelivery, credentials: ResolvedCredentials): string | null {
  const presented = delivery.headers['x-authenticity-token'];
  if (!presented) return null;
  for (const [field, secret] of signerSecrets(credentials)) {
    if (secureEquals(presented, sha256Hex(`${secret}-${delivery.rawBody}`))) return field;
  }
  return null;
}

/**
 * Confirming a Connect delivery by asking PagBank, for the one case its
 * signature cannot be checked (FUT-3722).
 *
 * Under Connect, PagBank signs order notifications with a secret it does not
 * name: the fourth evidence run refused every delivery under all four
 * candidates (`webhookToken`, the seller's `token`, the platform account's
 * token and the app's client secret), with the header present. So for an
 * OAuth connection whose signature matches none of them, the body is not
 * trusted at all: its order id is read, `GET /orders/{id}` is asked with the
 * SELLER's token, and only PagBank's answer is applied. A forged body can at
 * most make us re-read an order the seller really has.
 */

/** PagBank prefixes every order id `ORDE_…`. */
const ORDER_ID = /^ORDE_[A-Za-z0-9-]+$/;

/** A Connect connection: the seller authorised the app, so it holds a refresh token. */
export function isConnectConnection(credentials: ResolvedCredentials): boolean {
  return Boolean(credentials.fields['refreshToken'] && credentials.fields['token']);
}

/** The order id the delivery claims, or null when the body names none. */
function claimedOrderId(rawBody: string): string | null {
  try {
    const id = (JSON.parse(rawBody) as { id?: unknown }).id;
    return typeof id === 'string' && ORDER_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * The order as PagBank reports it to the seller, or null when this is not a
 * Connect connection, the body names no order, or PagBank does not know it
 * under these credentials (another environment's candidate set, an outage).
 */
export async function consultedOrder(
  delivery: WebhookDelivery,
  credentials: ResolvedCredentials,
): Promise<PagBankOrderResponse & { id?: string } | null> {
  if (!isConnectConnection(credentials)) return null;
  const orderId = claimedOrderId(delivery.rawBody);
  if (!orderId) return null;
  const order = await pagbankRequest<PagBankOrderResponse & { id?: string }>(
    `/orders/${encodeURIComponent(orderId)}`,
    credentials,
    { method: 'GET' },
  ).catch(() => null);
  return order?.id === orderId ? order : null;
}

/** A delivery that can only have verified by consult: Connect, secrets set, none matched. */
export function verifiedByConsult(delivery: WebhookDelivery, credentials: ResolvedCredentials): boolean {
  if (!isConnectConnection(credentials) || signerSecrets(credentials).length === 0) return false;
  return signerOf(delivery, credentials) === null;
}

/**
 * The consulted order for a delivery that verified BY consult — thrown when
 * PagBank no longer answers, so the delivery fails and is redelivered rather
 * than applied from its unverified body.
 */
export async function requireConsultedOrder(
  delivery: WebhookDelivery,
  credentials: ResolvedCredentials,
): Promise<PagBankOrderResponse & { id?: string }> {
  const order = await consultedOrder(delivery, credentials);
  if (!order) throw new ProviderRequestError(NAME, 'PagBank order consult failed for an unsigned Connect delivery', {
    retriable: true,
  });
  return order;
}
