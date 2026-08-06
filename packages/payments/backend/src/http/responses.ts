import {
  AmbiguousChargeError,
  ChargeDeclinedError,
  ChargeNotPersistedError,
  CredentialsError,
  InvalidCredentialsInputError,
  NoProviderSucceededError,
  PaymentsError,
  ProviderRequestError,
  UnknownProviderError,
  UnsupportedOperationError,
  WebhookVerificationError,
} from '../core/errors';

/**
 * What a failure looks like on the wire, and the two DIFFERENT audiences that
 * question has (see `guardedWebhook`).
 *
 * Split out of `handlers.ts` so the handler file stays a list of endpoints:
 * the mapping is a policy of its own, and the reasoning it carries is longer
 * than most of the handlers it wraps.
 */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The caller sent something wrong, or asked for something not allowed. */
function callerErrorStatus(error: PaymentsError): number | null {
  // Refused before anything was stored — see the class for why this must not
  // share `CredentialsError`'s 409.
  if (error instanceof InvalidCredentialsInputError) return 400;
  if (error instanceof UnknownProviderError) return 404;
  if (error instanceof UnsupportedOperationError) return 422;
  if (error instanceof ChargeDeclinedError) return 402;
  if (error instanceof WebhookVerificationError) return 401;
  return null;
}

/** Nothing is wrong with the request; the state or the provider is. */
function stateErrorStatus(error: PaymentsError): number | null {
  // 409, deliberately NOT a 5xx: a charge whose outcome we could not
  // determine must not look retryable to a client or a proxy. Retrying is
  // exactly what would double-charge the buyer; this needs reconciliation.
  if (error instanceof AmbiguousChargeError) return 409;
  // The charge EXISTS at the provider; only our copy is missing. Same rule as
  // above — it must not look retryable, because a retry is what creates the
  // duplicate.
  if (error instanceof ChargeNotPersistedError) return 409;
  if (error instanceof CredentialsError) return 409;
  // Every provider in the chain failed — an upstream problem, not the
  // caller's, and safe to retry once something upstream recovers.
  if (error instanceof NoProviderSucceededError) return 502;
  if (error instanceof ProviderRequestError) return 502;
  return null;
}

/** Uniform error→HTTP mapping, so hosts get consistent statuses everywhere. */
function errorStatus(error: PaymentsError): number {
  return callerErrorStatus(error) ?? stateErrorStatus(error) ?? 500;
}

/**
 * The PROVIDER-facing guard: a refusal must be a status the provider will
 * REDELIVER on.
 *
 * The admin API's status mapping is about telling a human operator what went
 * wrong; this is about a machine deciding whether to try again, and the two
 * disagree. InfinitePay documents exactly two answers — 200 for accepted, 400
 * to be re-sent — so a refusal that came back 401 (verification failed) or 409
 * (`CredentialsError`) told it, in effect, do not come back. Every other
 * provider treats any non-2xx as retryable, so 400 is the safe common answer.
 *
 * That mattered: while the activation gate was refusing confirmations with a
 * 409, the payments were not merely rejected, they were rejected in a way that
 * stopped the redelivery which would have fixed them once the gate was.
 *
 * Retrying is the RIGHT outcome for almost everything that can fail here. A
 * failed verification is not proof of a forgery — for an unsigned provider,
 * `verify` is a live call back to it, so a network blip there refuses a real
 * payment. The inbox and the replay drain are built on the same doctrine: fail
 * closed, recover by asking again. The one refusal that must NOT invite a retry
 * is an unknown store, and the host answers that before reaching this.
 */
export async function guardedWebhook(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PaymentsError) {
      return json({ error: error.name, message: error.message }, 400);
    }
    throw error;
  }
}

export async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PaymentsError) {
      return json({ error: error.name, message: error.message }, errorStatus(error));
    }
    throw error;
  }
}
