import { ChargeDeclinedError, ProviderRequestError } from './errors';
import { providerRejectionReasons } from './error-readers';
import { type AttemptOutcome, type FailureBucket, type ProbeResult, isTransportError } from './failover';
import type { MerchantRef, PaymentEnvironment, ProviderName } from './types';

/**
 * EVERY PROVIDER REFUSAL REACHES THE HOST (FUT-4074).
 *
 * The failover walk is built to keep money moving: PagBank refuses, InfinitePay
 * takes the charge, the buyer pays. That is the point of it — and it is also
 * how a store's primary provider refused EVERY checkout in production while
 * nothing anywhere said so. The ledger row was written; nobody reads a ledger.
 *
 * So the package now hands the host one typed report per provider failure, on
 * every path that talks to a provider: the charge walk (each non-success
 * attempt), the gateway's follow-up calls (refresh, cancel, refund, vault), the
 * checkout's browser key, and the activation flow. What the host does with it —
 * an error tracker, a staff notification, both — is the host's; that it is told
 * is not optional any more.
 *
 * ## What is deliberately NOT reported
 *
 * Each exception is a known cause where a report would say nothing new. They
 * are enumerated as {@link ProviderFailureSilence} so that a new one is a type
 * change a reviewer sees, never a quietly missing call.
 *
 * ## What a report never carries
 *
 * Credentials, the request we sent, the provider's raw body, card data or the
 * buyer's contact details. The message and the provider's reasons pass through
 * {@link redactProviderText}; the request snapshot is not read at all.
 */

/** Which provider-calling path produced the failure. */
export type ProviderFailurePath =
  | 'CHARGE'
  | 'REFRESH'
  | 'CANCEL'
  | 'REFUND'
  | 'VAULT'
  | 'BROWSER_KEY'
  | 'ACTIVATION'
  | 'ACTIVATION_POLL'
  | 'ACTIVATION_REFUND'
  | 'ACTIVATION_RECONCILE';

/**
 * How loud the host should be. `error`: a provider refused or failed a real
 * request. `warning`: something is wrong that did not cost this payment (a
 * misconfigured chain member, a charge adopted after a lost answer, a failed
 * follow-up read). `info`: an ordinary card decline — the provider worked.
 */
export type ProviderFailureSeverity = 'error' | 'warning' | 'info';

/**
 * The documented reasons a walk attempt is NOT reported. Each one is a skip
 * whose cause is known and whose report would be noise, not news.
 */
export type ProviderFailureSilence =
  /**
   * The buyer-requirements gate (FUT-595): nothing was sent, and the buyer is
   * asked for the missing field on screen. A report per typo'd CPF would bury
   * real refusals.
   */
  | 'BUYER_FIELDS'
  /**
   * The provider cannot do this payment method (a chain whose head is
   * card-only taking a boleto). That is the chain working as designed.
   */
  | 'METHOD_NOT_OFFERED'
  /**
   * No card instrument was minted for this provider. The checkout tokenizes
   * per provider; a missing token is a checkout choice, not a provider fault.
   */
  | 'NO_INSTRUMENT'
  /**
   * The outage breaker is open. The failures that OPENED it were each
   * reported; a report per skipped charge while it stays open is a flood.
   */
  | 'BREAKER_OPEN'
  /**
   * A retry's re-probe RESOLVED an earlier stop (no charge, or the charge was
   * found and adopted). The stop itself was reported when it happened.
   */
  | 'RESOLVED_ON_RETRY';

/** The report a host receives. Plain data — safe to log or serialize. */
export interface ProviderFailureReport {
  path: ProviderFailurePath;
  severity: ProviderFailureSeverity;
  merchant: MerchantRef;
  provider: ProviderName;
  /** The charge/attempt reference, when the path has one. */
  reference: string | null;
  /** The walk's ledger outcome; `null` outside the walk. */
  outcome: AttemptOutcome | null;
  failureBucket: FailureBucket | null;
  probeResult: ProbeResult | null;
  /** 1-based attempt number within the walk; `null` outside it. */
  attemptNo: number | null;
  /** The provider's HTTP status, when it answered one. */
  httpStatus: number | null;
  /** Every provider error code we could read, de-duplicated, e.g. `['40001']`. */
  providerCodes: string[];
  /** The provider's own validation reasons, redacted. */
  reasons: { code?: string; description?: string; parameterName?: string }[];
  /** The error's class name, e.g. `ProviderRequestError`. */
  errorName: string | null;
  /** Operator-facing detail, redacted and capped. */
  message: string;
  /** The provider account's environment, when known. */
  environment: PaymentEnvironment | null;
  /**
   * A stable key for grouping and de-duplication: path, provider, HTTP status
   * and codes — never the reference, which differs on every charge.
   */
  fingerprint: string;
}

/**
 * The host's hook. It may be async; it is never awaited by a money path, and a
 * throw or rejection is contained (see {@link reportProviderFailure}).
 */
export type ProviderFailureReporter = (report: ProviderFailureReport) => void | Promise<void>;

/** What a call site knows; everything else is read off the error. */
interface ProviderFailureInput {
  path: ProviderFailurePath;
  merchant: MerchantRef;
  provider: ProviderName;
  reference?: string | null;
  severity?: ProviderFailureSeverity;
  outcome?: AttemptOutcome | null;
  failureBucket?: FailureBucket | null;
  probeResult?: ProbeResult | null;
  attemptNo?: number | null;
  environment?: PaymentEnvironment | null;
  /** The thrown error, when there was one. */
  error?: unknown;
  /** A message to use when there is no error (a ledger-only outcome). */
  message?: string | null;
}

const MESSAGE_CAP = 500;

/**
 * Strip what must never leave the payment boundary from provider prose.
 *
 * Providers echo request fields in their error text often enough that the
 * message cannot be trusted raw: long digit runs (a card number, a CPF/CNPJ, a
 * phone), e-mail addresses, bearer tokens, and the values of secret-looking
 * JSON keys. The provider's own codes and field NAMES survive — they are what
 * makes the report actionable.
 */
export function redactProviderText(text: string): string {
  return text
    .replace(/Bearer\s+[\w.~+/=-]+/gi, 'Bearer [redacted]')
    .replace(
      /("(?:[\w-]*(?:token|secret|password|authorization|api[_-]?key|card|cvv|security_code|encrypted)[\w-]*)"\s*:\s*)("[^"]*"|\d+)/gi,
      '$1"[redacted]"',
    )
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[redacted-email]')
    .replace(/\d(?:[ .\-/]?\d){10,}/g, '[redacted-number]');
}

/** HTTP status and codes, read structurally off a provider error. */
function exchangeOf(error: unknown): Pick<ProviderFailureReport, 'httpStatus' | 'providerCodes' | 'reasons'> {
  const reasons = providerRejectionReasons(error).map((reason) => ({
    ...(reason.code ? { code: reason.code } : {}),
    ...(reason.description ? { description: redactProviderText(reason.description) } : {}),
    ...(reason.parameterName ? { parameterName: reason.parameterName } : {}),
  }));
  const own = error instanceof ProviderRequestError ? error.options.providerCode : undefined;
  const codes = [own, ...reasons.map((reason) => reason.code)].filter(
    (code): code is string => typeof code === 'string' && code.length > 0,
  );
  const httpStatus = error instanceof ProviderRequestError ? error.options.httpStatus ?? null : null;
  return { httpStatus, providerCodes: [...new Set(codes)], reasons };
}

function messageOf(input: ProviderFailureInput): string {
  const raw = input.error instanceof Error
    ? input.error.message
    : input.error !== undefined
      ? String(input.error)
      : input.message ?? '';
  return redactProviderText(raw).slice(0, MESSAGE_CAP);
}

/** A walk outcome's default loudness; non-walk paths default to `error`. */
function severityOf(input: ProviderFailureInput): ProviderFailureSeverity {
  if (input.severity) return input.severity;
  if (input.error instanceof ChargeDeclinedError || input.outcome === 'DECLINED') return 'info';
  if (input.outcome === 'SKIPPED' || input.outcome === 'ADOPTED') return 'warning';
  return 'error';
}

/** The optional facts, each defaulted to an explicit `null`. */
function contextOf(input: ProviderFailureInput) {
  return {
    reference: input.reference ?? null,
    outcome: input.outcome ?? null,
    failureBucket: input.failureBucket ?? null,
    probeResult: input.probeResult ?? null,
    attemptNo: input.attemptNo ?? null,
    environment: input.environment ?? null,
  };
}

/** Build the report. Pure; exported so hosts and tests can see exactly what is sent. */
export function describeProviderFailure(input: ProviderFailureInput): ProviderFailureReport {
  const exchange = exchangeOf(input.error);
  const errorName = input.error instanceof Error ? input.error.name : null;
  return {
    path: input.path,
    severity: severityOf(input),
    merchant: { kind: input.merchant.kind, id: input.merchant.id },
    provider: input.provider,
    ...contextOf(input),
    errorName,
    message: messageOf(input),
    ...exchange,
    fingerprint: [
      input.path,
      input.provider,
      input.outcome ?? '-',
      exchange.httpStatus ?? '-',
      [...exchange.providerCodes].sort().join(',') || errorName || '-',
    ].join(':'),
  };
}

/**
 * Hand a report to the host — and NEVER let that break a payment.
 *
 * Not awaited: a slow error tracker must not hold a buyer's checkout open. A
 * synchronous throw and an async rejection are both contained; a report that
 * cannot be delivered is lost, which is strictly better than a charge that
 * fails because its post-mortem could not be written.
 */
export function reportProviderFailure(
  reporter: ProviderFailureReporter | undefined,
  input: ProviderFailureInput,
): void {
  if (!reporter) return;
  try {
    const pending = reporter(describeProviderFailure(input));
    if (pending && typeof (pending as Promise<void>).catch === 'function') {
      (pending as Promise<void>).catch(() => undefined);
    }
  } catch {
    // Contained — see above.
  }
}

/**
 * Is this error the PROVIDER's answer (or its silence), as opposed to our own
 * store or a caller mistake? Only those are reported from the gateway's
 * follow-up calls: a `CredentialsError` there is "not connected", a state the
 * settings screen already shows, and a database error is not a provider's.
 */
export function isProviderEndpointFailure(error: unknown): boolean {
  return error instanceof ProviderRequestError || error instanceof ChargeDeclinedError || isTransportError(error);
}
