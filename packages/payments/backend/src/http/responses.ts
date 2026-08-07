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
  UnprovenProviderError,
  UnsupportedOperationError,
  WebhookVerificationError,
} from '../core/errors';

/**
 * What every handler ANSWERS with: the JSON envelope, and the one place a
 * `PaymentsError` becomes a status code.
 *
 * Lifted out of `handlers.ts` because the two audiences it serves — a human
 * operator reading an admin screen, and a provider's delivery robot deciding
 * whether to re-send — disagree about what a refusal should look like, and
 * that disagreement is the whole content of this file. Reading it next to the
 * handlers it wraps is what makes `guarded` vs `guardedWebhook` a choice
 * rather than a coin flip.
 */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The 409s, as one group, because they are one rule: each is a REFUSAL rather
 * than a failure, and none may look retryable.
 *
 * For the two charge errors that is about money — retrying a charge whose
 * outcome we could not determine, or one that exists at the provider with only
 * our copy missing, is exactly what bills the buyer twice. For the two
 * configuration errors it is about the answer being actionable: a provider that
 * is not connected, or that has not completed its verification charge, stays
 * refused until the owner does something about it, and a 500 said the opposite —
 * "the server broke, try again" — burying the one instruction that resolves it.
 */
const REFUSALS = [
  AmbiguousChargeError,
  ChargeNotPersistedError,
  CredentialsError,
  UnprovenProviderError,
];

/** Uniform error→HTTP mapping, so hosts get consistent statuses everywhere. */
function errorStatus(error: PaymentsError): number {
  // Refused BEFORE anything was stored, so it is the caller's body that is
  // wrong — not the connection's state. It must not share `CredentialsError`'s
  // 409 below: 409 tells the owner to go fix the provider connection, when the
  // thing to fix is the field they just typed (FUT-694).
  if (error instanceof InvalidCredentialsInputError) return 400;
  if (error instanceof UnknownProviderError) return 404;
  if (error instanceof UnsupportedOperationError) return 422;
  if (error instanceof ChargeDeclinedError) return 402;
  if (error instanceof WebhookVerificationError) return 401;
  if (REFUSALS.some((refusal) => error instanceof refusal)) return 409;
  // Every provider in the chain failed — an upstream problem, not the
  // caller's, and safe to retry once something upstream recovers.
  if (error instanceof NoProviderSucceededError) return 502;
  if (error instanceof ProviderRequestError) return 502;
  return 500;
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
