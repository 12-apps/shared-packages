import { ProviderRequestError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import type {
  ChargeInput,
  ChargeSnapshot,
  PaymentMethodKind,
  RefundSnapshot,
} from '../core/types';
import type { StripeCopy } from './copy';
import { stubCharge, stubPendingSnapshot, stubRefund } from './shared';
import {
  declineReasonOf,
  declineRetriableOf,
  intentPayload,
  intentSnapshot,
  type StripeErrorBody,
  type StripePaymentIntent,
} from './stripe-charges';
import {
  stripeChecksSummary,
  stripeCredentialChecks,
  type StripeAccountFacts,
} from './stripe-credential-checks';
import { unreachableOutcome } from './probe-shared';
import { NAME, stripeRequest } from './stripe-http';

/**
 * The Stripe adapter's operations, split out so `stripe.ts` stays the
 * ADAPTER (identity, capabilities, OAuth, webhooks) and this file holds the
 * calls it makes.
 */

/** Which payment method an intent used, for snapshots rebuilt from a fetch. */
export function methodOf(intent: StripePaymentIntent): PaymentMethodKind {
  const types = (intent as { payment_method_types?: string[] }).payment_method_types ?? [];
  if (types.includes('pix')) return 'PIX';
  if (types.includes('boleto')) return 'BOLETO';
  return 'CARD';
}

/**
 * A declined card is a RESULT, not an exception. Stripe answers a failed
 * confirm with HTTP 402 and embeds the failed PaymentIntent in the error
 * envelope — mapping that back to a DECLINED snapshot is what lets checkout
 * show a message instead of a stack trace.
 */
function declinedSnapshot(error: unknown, input: ChargeInput): ChargeSnapshot | null {
  if (!(error instanceof ProviderRequestError) || error.options.httpStatus !== 402) return null;
  const body = error.options.body as StripeErrorBody | undefined;
  const intent = body?.error?.payment_intent;
  const declineReason = declineReasonOf(body?.error);
  // Stripe's own "next steps" verdict, read from the SAME envelope error the
  // reason comes from — the intent's embedded copy can be absent on a confirm
  // that never produced one.
  const declineRetriable = declineRetriableOf(body?.error);
  if (intent) {
    const snapshot = intentSnapshot(intent, {
      amountCents: input.amount.amountCents,
      currency: input.amount.currency,
      method: input.method,
      id: '',
    });
    // The envelope's error is more specific than the intent's own copy.
    return { ...snapshot, status: 'DECLINED', declineReason, declineRetriable };
  }
  return {
    provider: NAME,
    providerChargeId: '',
    status: 'DECLINED',
    amount: input.amount,
    method: input.method,
    declineReason,
    declineRetriable,
    raw: body,
  };
}

export const createCharge: PaymentProviderAdapter['createCharge'] = async (input, credentials) => {
  if (credentials.stub) return stubCharge(NAME, input, credentials);
  try {
    const intent = await stripeRequest<StripePaymentIntent>('/v1/payment_intents', credentials, {
      method: 'POST',
      body: intentPayload(input, credentials),
      idempotencyKey: input.idempotencyKey ?? input.reference,
    });
    return intentSnapshot(intent, {
      amountCents: input.amount.amountCents,
      currency: input.amount.currency,
      method: input.method,
    });
  } catch (error) {
    const declined = declinedSnapshot(error, input);
    if (declined) return declined;
    throw error;
  }
};

/**
 * Prove the connection, credential by credential (FUT-796).
 *
 * `GET /v1/account` rather than `/v1/balance`: the same authenticated round
 * trip, but its answer NAMES the account the key resolves to and states
 * whether Stripe has released charging on it. Both are facts an owner cannot
 * otherwise get from this screen, and the second is the whole difference
 * between "your key works" and "your store can take money" — an account still
 * in document review authenticates perfectly and refuses every charge.
 *
 * The rest of the credentials are checked for agreement in
 * `stripe-credential-checks`, and where Stripe offers no way to check at all,
 * reported as unchecked rather than passed.
 */
export function verifyCredentialsWith(
  copy: StripeCopy,
): NonNullable<PaymentProviderAdapter['verifyCredentials']> {
  return async (credentials) => {
    if (credentials.stub) return { ok: true, message: 'stub mode' };
    try {
      const account = await stripeRequest<StripeAccountFacts>('/v1/account', credentials, {
        method: 'GET',
      });
      const checks = stripeCredentialChecks(copy.checks, credentials, account);
      const message = stripeChecksSummary(copy.checks, checks);
      // A credential that fails its own check fails the PROBE. Whether the key
      // authenticates is not the question the owner is asking — they are asking
      // whether this store can take money, and a live secret key beside a test
      // publishable key cannot.
      return message ? { ok: false, message, checks } : { ok: true, checks };
    } catch (error) {
      // Transport first: an unanswered probe learned NOTHING about the key, and
      // reporting it without the fault is what let a DNS blip persist FAILED
      // over good credentials (FUT-695) — `runVerify` skips the store only for
      // an explicit UNREACHABLE.
      const unreachable = unreachableOutcome(error, copy.unreachable);
      if (unreachable) return unreachable;
      const status = error instanceof ProviderRequestError ? error.options.httpStatus : undefined;
      if (status === 401 || status === 403) {
        // Stripe's OWN sentence, when it sent one. "Credenciais recusadas" alone
        // names neither the credential nor the reason, and on this path there are
        // four of them — the owner is left re-checking all four against a screen
        // that knows which one failed and will not say. Stripe answers with
        // things like "Invalid API Key provided: sk_test_***…***4242" or "The
        // provided key does not have access to account acct_…", each of which
        // points straight at the box to fix. Only the `message` string is taken:
        // the rest of the body is the provider's, and this error type retains it
        // whole (see the PII note on ProviderRequestError).
        const detail = refusalDetail(error);
        return { ok: false, fault: 'REFUSED', message: copy.refused(detail) };
      }
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  };
}

/**
 * What Stripe said when it refused, or null when it said nothing usable.
 *
 * Narrowed by hand rather than cast: the body is whatever the provider sent,
 * and a probe that throws while explaining a refusal reports the wrong fault.
 */
function refusalDetail(error: unknown): string | null {
  if (!(error instanceof ProviderRequestError)) return null;
  const body: unknown = error.options.body;
  if (typeof body !== 'object' || body === null) return null;
  const inner: unknown = (body as { error?: unknown }).error;
  if (typeof inner !== 'object' || inner === null) return null;
  const message: unknown = (inner as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() !== '' ? message.trim() : null;
}

/** Fetch an intent and normalize it; shared by `getCharge` and `cancelCharge`. */
async function intentOperation(
  path: string,
  method: 'GET' | 'POST',
  providerChargeId: string,
  credentials: Parameters<PaymentProviderAdapter['getCharge']>[1],
): Promise<ChargeSnapshot> {
  const intent = await stripeRequest<StripePaymentIntent>(path, credentials, {
    method,
    ...(method === 'GET' ? { body: { expand: ['latest_charge'] } } : {}),
  });
  // No amount fallback: this operation only READS Stripe's state, so a
  // succeeded intent that carries no amount is refused rather than reported as
  // a zero capture.
  return intentSnapshot(intent, {
    currency: 'BRL',
    method: methodOf(intent),
    id: providerChargeId,
  });
}

export const getCharge: PaymentProviderAdapter['getCharge'] = async (
  providerChargeId,
  credentials,
) => {
  if (credentials.stub) return stubPendingSnapshot(NAME, providerChargeId, 'CARD');
  return intentOperation(
    `/v1/payment_intents/${encodeURIComponent(providerChargeId)}`,
    'GET',
    providerChargeId,
    credentials,
  );
};

/**
 * How far back the reconciliation probe looks, and how many pages it will
 * read. The window only has to cover the gap between sending a charge and
 * noticing it failed, which is seconds; 15 minutes is generous slack for a
 * hung socket.
 */
const PROBE_WINDOW_SECONDS = 900;
const PROBE_PAGE_SIZE = 100;
const PROBE_MAX_PAGES = 5;

/**
 * Reconciliation probe.
 *
 * Deliberately built on `GET /v1/payment_intents` (the LIST endpoint) rather
 * than `/v1/payment_intents/search`, even though search can filter on
 * metadata directly and would be one call instead of several. Stripe's search
 * index is documented as lagging behind by up to a minute for newly created
 * objects — and this probe runs seconds after a charge was attempted, which
 * is precisely the interval search cannot see. A stale "no results" would be
 * read as proof that nothing was charged, and the walk would go create a
 * second charge on the next provider. The list endpoint reads the primary
 * datastore, so it has no such window.
 *
 * If the page budget runs out before a verdict, this THROWS rather than
 * returning null: not finding a charge in the first 500 intents of the last
 * quarter hour is inconclusive, not proof of absence, and the walk must treat
 * it as such.
 */
async function probePage(
  credentials: Parameters<PaymentProviderAdapter['getCharge']>[1],
  createdGte: number,
  startingAfter: string | undefined,
): Promise<{ intents: StripePaymentIntent[]; hasMore: boolean }> {
  const res = await stripeRequest<{ data?: StripePaymentIntent[]; has_more?: boolean }>(
    '/v1/payment_intents',
    credentials,
    {
      method: 'GET',
      body: {
        limit: PROBE_PAGE_SIZE,
        created: { gte: createdGte },
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
    },
  );
  return { intents: res.data ?? [], hasMore: res.has_more === true };
}

export const findChargeByReference: NonNullable<
  PaymentProviderAdapter['findChargeByReference']
> = async (reference, credentials) => {
  if (credentials.stub) return null;
  const createdGte = Math.floor(Date.now() / 1000) - PROBE_WINDOW_SECONDS;
  let startingAfter: string | undefined;

  for (let page = 0; page < PROBE_MAX_PAGES; page += 1) {
    const { intents, hasMore } = await probePage(credentials, createdGte, startingAfter);
    const hit = intents.find((intent) => intent.metadata?.['reference'] === reference);
    if (hit) {
      return intentSnapshot(hit, {
        currency: (hit.currency ?? 'brl').toUpperCase(),
        method: methodOf(hit),
        id: hit.id ?? reference,
      });
    }
    startingAfter = intents[intents.length - 1]?.id;
    // A complete read of the window with no match IS proof of absence.
    if (!hasMore || !startingAfter) return null;
  }

  throw new ProviderRequestError(
    NAME,
    `Reconciliation probe for reference ${reference} exceeded ${PROBE_MAX_PAGES} pages; ` +
      'the outcome is undetermined, not absent',
    { retriable: true },
  );
};

export const cancelCharge: NonNullable<PaymentProviderAdapter['cancelCharge']> = async (
  providerChargeId,
  credentials,
) => {
  if (credentials.stub) return stubPendingSnapshot(NAME, providerChargeId, 'CARD');
  return intentOperation(
    `/v1/payment_intents/${encodeURIComponent(providerChargeId)}/cancel`,
    'POST',
    providerChargeId,
    credentials,
  );
};

/**
 * Stripe refund status → normalized status.
 *
 * `failed` and `canceled` are TERMINAL UNSUCCESSFUL states: the money did not
 * go back. Collapsing them into REFUNDED (as "anything not pending succeeded"
 * would) tells the host a buyer was repaid when they were not — the kind of
 * wrong that surfaces as a chargeback rather than an error. `pending` and
 * `requires_action` are genuinely in-flight and bank-dependent.
 *
 * An unrecognized status is treated as PENDING, never as success: a refund
 * this code does not understand is one it must not declare complete.
 */
function refundStatusOf(status: string | undefined): RefundSnapshot['status'] {
  switch (status) {
    case 'succeeded':
      return 'REFUNDED';
    case 'failed':
    case 'canceled':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

export const refund: NonNullable<PaymentProviderAdapter['refund']> = async (input, credentials) => {
  if (credentials.stub) return stubRefund(NAME, input);
  const res = await stripeRequest<{ id?: string; status?: string; amount?: number }>(
    '/v1/refunds',
    credentials,
    {
      method: 'POST',
      body: {
        payment_intent: input.providerChargeId,
        // Omitting the amount means a FULL refund — Stripe's default too.
        ...(input.amount ? { amount: input.amount.amountCents } : {}),
        ...(input.reason ? { metadata: { reason: input.reason } } : {}),
      },
    },
  );
  return {
    provider: NAME,
    providerChargeId: input.providerChargeId,
    providerRefundId: res.id ?? input.providerChargeId,
    status: refundStatusOf(res.status),
    // A full refund carries no requested amount; Stripe reports what it
    // actually returned, which is the number worth persisting.
    amount: input.amount ?? { amountCents: res.amount ?? 0, currency: 'BRL' },
    raw: res,
  };
};
