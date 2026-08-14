import { PaymentsError, ProviderRequestError } from './errors';

/**
 * Readers of the error taxonomy, ported from the first adopting host (FUT-761)
 * so no adopter re-derives them. Their own module rather than `errors.ts`
 * because that file holds the taxonomy itself and sits at its size budget —
 * and because these are consumers of the classes, not part of the contract
 * an adapter throws against.
 */

/**
 * The request/response PAIR as one printable block, or `null` when the error
 * carries no captured request — i.e. it is not a provider rejection at all,
 * or came from an adapter that builds no snapshot.
 *
 * Ported from the first adopting host (FUT-489 → FUT-761): provider support asks
 * for "the full log", and a host that keeps only the response answers by
 * reconstructing the payload from source — weaker evidence, produced slowly,
 * at the moment a live store cannot take money. The response is rendered from
 * `options.body` rather than from the message, whose length cap is what made
 * the original HTTP 502 undiagnosable.
 *
 * Returned rather than logged — this package binds no logger. It is the
 * canonical way to feed `CheckoutLogger.providerFailure`, so hosts stop
 * re-writing the same block.
 */
export function providerExchangeReport(context: string, error: unknown): string | null {
  if (!(error instanceof ProviderRequestError) || !error.options.request) return null;
  const { request, httpStatus, body } = error.options;
  return [
    `[payments] ${context} — provider exchange follows (secrets redacted)`,
    `REQUEST ${request.method} ${request.url}`,
    ...Object.entries(request.headers).map(([name, value]) => `  ${name}: ${value}`),
    ...(request.body === undefined ? [] : [JSON.stringify(request.body)]),
    `RESPONSE HTTP ${httpStatus ?? '?'}`,
    body === undefined ? error.message : JSON.stringify(body),
  ].join('\n');
}

/** One validation reason, as a provider's `error_messages` array carries it. */
export interface ProviderRejectionReason {
  /** The provider's own code, e.g. PagBank's `40002`. */
  code?: string;
  /** The provider's own description, in the provider's own language. */
  description?: string;
  /** Which request field the reason is about, e.g. `customer.email`. */
  parameterName?: string;
}

/**
 * The provider's validation reasons, read STRUCTURALLY off `options.body`.
 *
 * Exported because every host branches on these to turn a rejection into a
 * sentence the buyer can act on ("that e-mail is the store's own merchant
 * account", "the CPF was not accepted"), and hosts were re-deriving them the
 * same WRONG way: by regexing the JSON back out of `error.message`.
 *
 * That is not a style difference, it is a defect. An adapter CAPS the message
 * — PagBank's is `PagBank <status> <statusText>: <text.slice(0, 300)>` —
 * precisely because the message is matched on and shown, while the full
 * payload travels separately in `options.body`. So a rejection whose body runs
 * past the cap parses to NOTHING when read from the message, and every
 * specific, actionable sentence collapses into the generic refusal — failing
 * worst exactly when the provider was most talkative about what was wrong.
 *
 * `parameter_name` is renamed to `parameterName` on the way out: the wire
 * spelling is the provider's, and a host branching on it should be reading
 * this package's vocabulary rather than one vendor's snake_case.
 *
 * Answers `[]` for anything that is not a provider rejection carrying a
 * structured body — never throws, and never guesses.
 */
export function providerRejectionReasons(error: unknown): ProviderRejectionReason[] {
  if (!(error instanceof ProviderRequestError)) return [];
  const body = error.options.body;
  if (typeof body !== 'object' || body === null) return [];
  const reasons = (body as { error_messages?: unknown }).error_messages;
  if (!Array.isArray(reasons)) return [];
  return reasons.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { code, description, parameter_name: parameterName } = entry as Record<string, unknown>;
    return [
      {
        ...(typeof code === 'string' ? { code } : {}),
        ...(typeof description === 'string' ? { description } : {}),
        ...(typeof parameterName === 'string' ? { parameterName } : {}),
      },
    ];
  });
}

/**
 * True when the provider rejected the merchant's ACCOUNT or credentials
 * rather than this particular request: 401 (token rejected) or 403 (access
 * denied — e.g. a production account not yet whitelisted for the charge API).
 * The connection row is where that answer belongs — see
 * `downgradeOnAccountError` in `config/account-downgrade.ts`, which is why
 * this predicate is exported rather than inlined there: hosts also branch on
 * it to decide whether a charge failure says anything about the store at all.
 */
export function isAccountAccessError(error: unknown): error is ProviderRequestError {
  if (!(error instanceof ProviderRequestError)) return false;
  const status = error.options.httpStatus;
  return status === 401 || status === 403;
}

/**
 * Whether a refusal is a PERMANENT verdict of this taxonomy — one that waiting
 * cannot improve. A retriable `ProviderRequestError` is the one refusal that
 * can; every other `PaymentsError` is this package saying something definite
 * about the provider (cannot detach, not connected, id rejected). Anything
 * that is not a `PaymentsError` at all is a fault on the caller's side of the
 * seam and must never be read as a provider verdict.
 *
 * Ported from the first adopting host's card-vault detach policy (FUT-761). What to DO
 * with the answer — drop a stored pointer, keep a row, alert someone — stays
 * the host's policy; whether the refusal is final is this taxonomy's property.
 */
export function isPermanentProviderRefusal(error: unknown): boolean {
  if (error instanceof ProviderRequestError) return !error.retriable;
  return error instanceof PaymentsError;
}
