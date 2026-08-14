import { createHmac } from 'node:crypto';

import { stubDeliveryTrusted } from '../core/stub-mode';
import type {
  IntakeFreshness,
  ResolvedCredentials,
  WebhookDelivery,
} from '../core/types';
import { secureEquals } from './shared';

/**
 * Stripe webhook authentication (FUT-690), split from `stripe.ts` the way
 * `pagbank-webhook.ts` is: the adapter keeps normalization, this module owns
 * whether a delivery is genuine and fresh. `verify` decides authenticity
 * against every acceptable secret and the identity facts the signed body
 * carries; `stripeIntakeFreshness` is the live-intake-only skew window
 * (`core/webhook-replay.ts` explains why it must never live inside verify).
 */

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
 * Fail OPEN on missing metadata (not every event carries `account`, and a
 * store charging on its own key need not name its account at all), CLOSED on
 * contradiction. A body that does not parse carries no metadata to contradict
 * — `parse` owns answering the malformed case.
 *
 * The account is read under BOTH spellings, because one concept is stored
 * under two names: the OAuth exchange writes `stripeUserId`
 * (`tokensToFields`), while the credential form writes `connectedAccountId`,
 * the schema's own key. Reading only the OAuth one skipped this check on every
 * pasted-key store — including those that HAD filled the `acct_` field in, so
 * the owner supplied the fact and the guard ignored it (FUT-796).
 */
function boundToCredentials(delivery: WebhookDelivery, credentials: ResolvedCredentials): boolean {
  let body: StripeDeliveryIdentity;
  try {
    body = JSON.parse(delivery.rawBody) as StripeDeliveryIdentity;
  } catch {
    return true;
  }
  const accountId = credentials.fields['stripeUserId'] || credentials.fields['connectedAccountId'];
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
export async function verifyStripeSignature(
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
export function stripeIntakeFreshness(delivery: WebhookDelivery, nowMs: number): IntakeFreshness {
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
