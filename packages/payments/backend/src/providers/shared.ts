import { createHash, timingSafeEqual } from 'node:crypto';

import { ProviderRequestError } from '../core/errors';
import { stubDeliveryTrusted } from '../core/stub-mode';
import type { PaymentProviderAdapter } from '../core/provider';
import type {
  ChargeInput,
  ChargeSnapshot,
  NormalizedWebhookEvent,
  PaymentMethodKind,
  ProviderName,
  RefundInput,
  RefundSnapshot,
  ResolvedCredentials,
  WebhookDelivery,
} from '../core/types';

import { applyStubChargeFault } from './stub-fault';

/**
 * The charge description a provider is sent, capped at that provider's own
 * limit (Stripe 350, Stone 255, InfinitePay 120, PagBank 64 — each measured
 * from its API docs, and each the reason this cannot simply be one constant).
 *
 * Four adapters composed this line themselves before FUT-760's doctrine
 * reached them, so there were four chances for one to drift; now there is one,
 * and the words in it are the host's.
 */
export function chargeDescription(input: ChargeInput, maxLength: number): string {
  const written = input.description?.trim();
  return (written && written.length > 0 ? written : input.reference).slice(0, maxLength);
}

/**
 * Internal helpers shared by the provider adapters.
 *
 * Every adapter's STUB mode is fully functional (deterministic fakes, zero
 * network) so hosts can build and test the whole flow before any real account
 * exists — the contract the PagBank integration's stub mode established, and
 * what keeps local dev and CI running with no credentials. The LIVE paths now
 * live in each vendor's own `*-operations.ts`.
 */

/** Deterministic stub charge id: stable per (provider, reference). */
export function stubChargeId(provider: ProviderName, reference: string): string {
  return `stub_${provider}_${reference}`;
}

/**
 * The captured amount a snapshot may report — the ONE place every adapter
 * decides what to do when a provider settles a charge without saying for how
 * much.
 *
 * A SETTLED charge with no reported amount is REFUSED rather than normalized
 * to 0. Zero does not mean "we captured nothing", it means "we do not know",
 * and a fabricated zero is exactly the input a host's shortfall guard exists
 * to catch — it turns a fully-paid order into a parked, refund-me-please one.
 * Failing loudly instead makes the delivery retryable and the poll harmless.
 *
 * The refusal is scoped to SETTLED on purpose: an unpaid charge legitimately
 * carries no amount on every single status poll (an unpaid PIX order, a
 * checkout link nobody opened), and throwing there would break both the
 * buyer's polling screen and the reconciliation walk, which reads a probe
 * error as "the provider did not answer".
 *
 * `fallback` is for the callers that genuinely KNOW the amount from their own
 * request (a freshly created charge); callers that are only reading provider
 * state pass nothing, because inventing a number there is the whole bug.
 */
export function capturedAmountCents(
  provider: ProviderName,
  settled: boolean,
  reported: number | undefined,
  fallback?: number,
): number {
  const known = typeof reported === 'number' ? reported : fallback;
  if (typeof known === 'number') return known;
  if (settled) {
    throw new ProviderRequestError(
      provider,
      `${provider} reported a settled charge with no amount; refusing to fabricate one.`,
    );
  }
  return 0;
}

/**
 * Deterministic stub charge. Card charges settle immediately as PAID unless
 * the token carries the magic suffix `-declined` (lets tests and demo flows
 * exercise the failure path); PIX/boleto start PENDING, awaiting a (stub)
 * webhook.
 *
 * `credentials` is optional and only ever read to run a SCRIPTED failure — see
 * `stub-fault.ts`. Passing it is what lets a fixture make the head of a chain
 * fail in a specific, classifiable way; omitting it keeps the plain stub.
 */
export function stubCharge(
  provider: ProviderName,
  input: ChargeInput,
  credentials?: ResolvedCredentials,
): ChargeSnapshot {
  applyStubChargeFault(provider, credentials);
  const providerChargeId = stubChargeId(provider, input.reference);
  const base: ChargeSnapshot = {
    provider,
    providerChargeId,
    status: 'PENDING',
    amount: input.amount,
    method: input.method,
  };
  if (input.method === 'CARD') {
    const declined = input.card?.token?.endsWith('-declined') ?? false;
    return {
      ...base,
      status: declined ? 'DECLINED' : 'PAID',
      declineReason: declined ? 'CARD_DECLINED' : undefined,
      card: { brand: 'visa', last4: '4242' },
    };
  }
  if (input.method === 'PIX') {
    return { ...base, pix: { qrText: `00020126:stub-pix:${providerChargeId}` } };
  }
  return { ...base, boleto: { barcode: `23790:stub-boleto:${providerChargeId}` } };
}

/** Stub `getCharge` result: a PENDING snapshot for an id-only lookup. */
export function stubPendingSnapshot(
  provider: ProviderName,
  providerChargeId: string,
  method: PaymentMethodKind = 'PIX',
): ChargeSnapshot {
  return {
    provider,
    providerChargeId,
    status: 'PENDING',
    amount: { amountCents: 0, currency: 'BRL' },
    method,
  };
}

/** Stub refund result: settles immediately as REFUNDED. */
export function stubRefund(provider: ProviderName, input: RefundInput): RefundSnapshot {
  return {
    provider,
    providerChargeId: input.providerChargeId,
    providerRefundId: `stub_refund_${input.providerChargeId}`,
    status: 'REFUNDED',
    amount: input.amount ?? { amountCents: 0, currency: 'BRL' },
  };
}

/**
 * Webhook handling for providers authenticated by a shared secret header.
 * FAIL CLOSED: live-mode deliveries without a configured secret are always
 * rejected — a forged PAID must never authenticate by omission; only stub
 * mode (no network, fake events) may skip the check.
 */
export function sharedSecretWebhook(provider: ProviderName): PaymentProviderAdapter['webhook'] {
  return {
    async verify(delivery, credentials) {
      const secret = credentials.fields['webhookSecret'];
      if (!secret) return stubDeliveryTrusted(credentials);
      const presented = delivery.headers['x-webhook-secret'] ?? '';
      return secureEquals(presented, secret);
    },
    async parse(delivery) {
      // Stub body shape; live adapters replace this with real payload mapping.
      return parseStubWebhook(provider, delivery);
    },
  };
}

/** Stub webhook body: `{ eventId, charge: ChargeSnapshot }` as JSON. */
function parseStubWebhook(
  provider: ProviderName,
  delivery: WebhookDelivery,
): NormalizedWebhookEvent[] {
  const body = JSON.parse(delivery.rawBody) as {
    eventId?: string;
    charge?: ChargeSnapshot;
  };
  return [
    {
      provider,
      eventId: body.eventId ?? sha256Hex(delivery.rawBody),
      type: body.charge ? 'CHARGE_UPDATED' : 'UNKNOWN',
      charge: body.charge,
      raw: body,
    },
  ];
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time string comparison for webhook shared-secret checks. */
export function secureEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
