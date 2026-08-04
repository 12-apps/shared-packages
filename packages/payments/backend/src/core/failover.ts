import {
  ChargeDeclinedError,
  CredentialsError,
  ProviderRequestError,
  UnknownProviderError,
  UnsupportedOperationError,
} from './errors';

/**
 * PROOF OF FAILURE — the rule that makes failover safe.
 *
 * Falling over to a second provider is only defensible when we can show the
 * first one created nothing. The ordering problem is easy; not double-charging
 * a buyer is the whole difficulty, because a provider that times out may still
 * have created the charge. So every failure is sorted into one of three
 * buckets, and only one of them permits an immediate retry elsewhere:
 *
 *   DEFINITELY_NOT_CHARGED  the request provably never became a charge —
 *                           it never left the process, or the provider
 *                           rejected it before doing any work. Fail over.
 *   AMBIGUOUS               the provider may or may not have created a
 *                           charge. Probe first; never fail over blind.
 *   BUSINESS_OUTCOME        the provider worked and said no. Not a technical
 *                           failure, and cascading it to another acquirer is
 *                           a business decision (see `failoverPolicy`).
 *
 * The bias throughout is deliberate: anything we cannot positively classify
 * as safe is AMBIGUOUS. Mislabelling an ambiguous failure as safe bills a
 * buyer twice; mislabelling a safe failure as ambiguous merely stops a walk
 * that could have continued.
 */
export type FailureBucket = 'DEFINITELY_NOT_CHARGED' | 'AMBIGUOUS' | 'BUSINESS_OUTCOME';

/** What a reconciliation probe concluded about a possibly-created charge. */
export type ProbeResult = 'NOT_CHARGED' | 'CHARGE_FOUND' | 'PROBE_FAILED' | 'UNSUPPORTED';

/** Per-attempt disposition recorded in the ledger. */
export type AttemptOutcome =
  | 'SUCCEEDED'
  | 'ADOPTED'
  | 'FAILED_OVER'
  | 'STOPPED'
  | 'DECLINED'
  | 'SKIPPED';

/**
 * Cause codes that prove the request never reached the provider's
 * application. DNS resolution, connection refusal, unreachable routes and TLS
 * handshake rejections all happen BEFORE any byte of the request body is
 * accepted, so no charge can exist on the other side.
 *
 * `UND_ERR_CONNECT_TIMEOUT` belongs here for the same reason and is worth
 * calling out, because its siblings below do NOT: it fires while the socket
 * is still being established.
 */
const PRE_SEND_CAUSE_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/**
 * There is deliberately no matching list of "ambiguous" cause codes, even
 * though the dangerous ones are well known (`UND_ERR_HEADERS_TIMEOUT`,
 * `UND_ERR_BODY_TIMEOUT`, `UND_ERR_SOCKET`, `ECONNRESET`, `EPIPE`,
 * `ETIMEDOUT` — all cases where the request WAS on the wire and only the
 * response was lost). Enumerating them would imply that anything absent from
 * the list is safe, which is the exact inversion that double-charges a buyer.
 * AMBIGUOUS is the DEFAULT here; the allowlist above is the only exit from it.
 *
 * This is also why classifying on the error class alone is not enough: undici
 * reports a headers timeout as the same `TypeError: fetch failed` as a
 * refused connection.
 */

/** Read the `cause.code` undici/Node attach to a wrapped network failure. */
function causeCode(error: unknown): string | null {
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  // Some runtimes put the code on the error itself rather than a cause.
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

/**
 * True only for failures proven to have happened BEFORE the request was
 * transmitted — the sole class that is safe to retry blindly, whether by the
 * transport's own retry loop or by falling over to another provider.
 *
 * An unrecognized network failure returns false. That is the safe default:
 * an unknown failure gets probed rather than retried.
 */
export function isPreSendNetworkError(error: unknown): boolean {
  const code = causeCode(error);
  if (code) return PRE_SEND_CAUSE_CODES.has(code);
  return false;
}

/**
 * Cause codes where the request WAS on the wire and only the answer was lost.
 *
 * The note above explains why there is deliberately no such list for the RETRY
 * decision: absence from it must never be read as "safe to send again". This
 * list exists for the opposite question — "did we get an answer at all?" — and
 * the two have opposite safe defaults, which is the whole reason they are
 * separate sets rather than one.
 *
 * Unrecognized here means NOT a transport failure, so the caller treats the
 * error as our own and RECORDS it. Being wrong that way produces a loud,
 * diagnosable verdict; being wrong the other way produces silence.
 */
const RESPONSE_LOST_CAUSE_CODES: ReadonlySet<string> = new Set([
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_ABORTED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
]);

/**
 * True when the failure is the NETWORK's, rather than ours.
 *
 * The question this answers is narrower than it looks, and it is not "was
 * anything charged" — it is "did the provider answer". A read-only probe has no
 * double-charge risk to weigh, so both the pre-send and the response-lost codes
 * count: either way nothing was learned, and the caller must not present the
 * silence as the provider's verdict.
 *
 * Keyed on the cause code rather than on the error CLASS, because the class
 * cannot tell these apart: undici reports a refused connection, a headers
 * timeout, AND a plain bug in our own code as `TypeError`. Only the first two
 * carry a code, which is exactly the line that needs drawing — a `TypeError`
 * thrown by this package has no `cause.code`, so it is correctly not a
 * transport failure and gets recorded as the fault it is.
 */
export function isTransportError(error: unknown): boolean {
  const code = causeCode(error);
  if (!code) return false;
  return PRE_SEND_CAUSE_CODES.has(code) || RESPONSE_LOST_CAUSE_CODES.has(code);
}

/**
 * HTTP statuses whose meaning is settled. Everything absent — notably every
 * 5xx — falls through to AMBIGUOUS, because a provider that broke while
 * answering may well have created the charge first.
 */
const STATUS_BUCKETS: Readonly<Record<number, FailureBucket>> = {
  // The provider answered without creating anything: validation, credential
  // rejection, unknown route, rate limiting.
  400: 'DEFINITELY_NOT_CHARGED',
  401: 'DEFINITELY_NOT_CHARGED',
  403: 'DEFINITELY_NOT_CHARGED',
  404: 'DEFINITELY_NOT_CHARGED',
  422: 'DEFINITELY_NOT_CHARGED',
  429: 'DEFINITELY_NOT_CHARGED',
  // How several providers report a decline that escaped adapter
  // normalization — the call worked, the payment did not.
  402: 'BUSINESS_OUTCOME',
  // Typically an idempotency/duplicate conflict, which is EVIDENCE a charge
  // may already exist. Never safe.
  409: 'AMBIGUOUS',
};

/** Gateway-side refusals raised before any adapter call is made. */
function isGatewayRefusal(error: unknown): boolean {
  return (
    error instanceof CredentialsError ||
    error instanceof UnsupportedOperationError ||
    error instanceof UnknownProviderError
  );
}

/**
 * Sort an adapter failure into its bucket. Anything not positively recognized
 * as safe lands in AMBIGUOUS, so an unfamiliar failure mode stops the walk
 * for a probe instead of silently authorizing a second charge.
 */
export function classifyFailure(error: unknown): FailureBucket {
  // The provider processed the request and declined it.
  if (error instanceof ChargeDeclinedError) return 'BUSINESS_OUTCOME';
  if (isGatewayRefusal(error)) return 'DEFINITELY_NOT_CHARGED';

  if (error instanceof ProviderRequestError) {
    const status = error.options.httpStatus;
    // No status means we never got a usable response — a body that failed to
    // parse, or a transport wrapped by the adapter. The provider may still
    // have acted on the request.
    if (typeof status !== 'number') return 'AMBIGUOUS';
    return STATUS_BUCKETS[status] ?? 'AMBIGUOUS';
  }

  // Raw transport failure (`fetch` rejects with a TypeError). Only the
  // provably pre-send subset is safe; a headers timeout wearing the same
  // class is not — and neither is an abort, which means the request was very
  // likely already in flight.
  if (isPreSendNetworkError(error)) return 'DEFINITELY_NOT_CHARGED';

  return 'AMBIGUOUS';
}

/** Short operator-facing text for the ledger's `error` column. */
export function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = causeCode(error);
    return code ? `${error.name}: ${error.message} (${code})` : `${error.name}: ${error.message}`;
  }
  return String(error);
}
