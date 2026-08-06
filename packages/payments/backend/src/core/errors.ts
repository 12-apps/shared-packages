import type { CustomerFieldIssue } from './customer-schema';
import type { DeclineReason, ProviderName } from './types';
import type { WalkFailure } from './walk-failure';

/**
 * Error taxonomy. Hosts catch on these classes (or on `PaymentsError` for a
 * blanket handler) and map them to their own HTTP semantics; provider-specific
 * error strings stay inside adapters, surfaced only via `providerCode`/`cause`.
 */

/**
 * Base class — everything this package throws is a `PaymentsError`.
 *
 * The name is passed EXPLICITLY by each subclass, never taken from
 * `new.target.name`. A minifier renames classes, so the constructor's name in a
 * production build is whatever single letter it was assigned — a real webhook
 * refusal in production answered
 *
 *     {"error":"h","message":"Webhook verification failed"}
 *
 * and `"h"` tells a support engineer nothing, cannot be grepped for, and
 * changes on the next build. `name` is part of this package's WIRE surface:
 * hosts put it in responses and logs, so it has to survive the build.
 */
export class PaymentsError extends Error {
  constructor(name: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = name;
  }
}

/** A provider name was requested that the registry doesn't know. */
export class UnknownProviderError extends PaymentsError {
  constructor(readonly provider: string) {
    super('UnknownProviderError', `Unknown payment provider: ${provider}`);
  }
}

/**
 * An adapter breaks an invariant of the adapter contract itself — thrown by
 * `defineProviders`, so a host that registers it fails at BOOT rather than
 * behaving subtly wrong under traffic (FUT-726).
 *
 * The type system already refuses these shapes; this catches the ones that get
 * past it — a JavaScript host, an `as` cast, an adapter assembled at runtime —
 * because the failures it guards are silent ones, and a payments bug nobody
 * can see is worse than a server that will not start.
 */
export class AdapterContractError extends PaymentsError {
  constructor(
    readonly provider: string,
    readonly problem: string,
  ) {
    super('AdapterContractError', `Adapter ${provider} is not a valid adapter: ${problem}`);
  }
}

/**
 * The operation is valid in general but THIS provider can't do it (method
 * not in capabilities, refunds unsupported, ...). Thrown by the gateway
 * before the adapter is ever called, so the message is uniform across
 * providers.
 */
export class UnsupportedOperationError extends PaymentsError {
  constructor(
    readonly provider: ProviderName,
    readonly operation: string,
  ) {
    super('UnsupportedOperationError', `Provider ${provider} does not support ${operation}`);
  }
}

/** No usable credentials for (merchant, provider) — not connected/enabled. */
export class CredentialsError extends PaymentsError {
  constructor(
    readonly provider: ProviderName,
    message: string,
  ) {
    super('CredentialsError', message);
  }
}

/**
 * A PINNED charge named a provider whose declared buyer requirements the
 * charge does not meet (FUT-595) — a required `customerSchema` field is
 * missing or malformed. Thrown BEFORE the adapter is called, so nothing was
 * sent anywhere: this is a refusal the host can fix by asking the buyer for
 * the named fields, not a provider failure. An unpinned walk never throws
 * this; it skips the provider (with a SKIPPED ledger row) and advances,
 * exactly like capability gating, so a chain member's requirement can never
 * strand a charge another member would accept.
 */
export class CustomerRequirementsError extends PaymentsError {
  constructor(
    readonly provider: ProviderName,
    readonly issues: readonly CustomerFieldIssue[],
  ) {
    super('CustomerRequirementsError',
      `Provider ${provider} requires buyer fields this charge does not carry: ` +
        issues.map((issue) => `${issue.field} (${issue.reason})`).join(', '),
    );
  }
}

/**
 * Someone tried to put a provider in the failover chain before a real charge
 * through it ever succeeded (FUT-463).
 *
 * Its own error because it is a REFUSAL, not a failure: nothing went wrong,
 * the caller asked for something the rules do not allow. A connection that
 * merely authenticates is not one that can take money — PagBank grants the
 * former and withholds the latter until the integration is homologated — so
 * "enabled" has to be earned by charging, not asserted by a switch.
 */
export class UnprovenProviderError extends PaymentsError {
  constructor(readonly provider: ProviderName) {
    super('UnprovenProviderError',
      `Provider ${provider} has not completed a verification charge, so it cannot be enabled`,
    );
  }
}

/**
 * What we SENT, kept alongside what came back (FUT-489).
 *
 * PagBank support asks for "o log completo" — request and response. Only the
 * response was ever preserved, so answering meant reconstructing the payload
 * from source and labelling it as a reconstruction: weaker evidence, produced
 * slowly, at the moment a live store cannot take money.
 *
 * Carried on the error rather than logged by the adapter, because the package
 * has no logger and should not grow one: the host already catches this error
 * where it decides what to record.
 *
 * NOTHING SECRET MAY BE PUT HERE. The adapter that builds it is responsible
 * for redaction — the `Authorization` header and the card instrument never
 * appear, only the shape that shows what was asked for.
 */
export interface ProviderRequestSnapshot {
  method: string;
  url: string;
  /** Redacted — carried so the pair reads like the real exchange. */
  headers: Readonly<Record<string, string>>;
  body?: unknown;
}

/**
 * The provider call itself failed (HTTP error, malformed response, network).
 * `retriable` tells the host whether a retry might succeed (timeouts yes,
 * validation errors no).
 */
export class ProviderRequestError extends PaymentsError {
  constructor(
    readonly provider: ProviderName,
    message: string,
    readonly options: {
      /** Provider's own error code, verbatim, for logs/debugging. */
      providerCode?: string;
      httpStatus?: number;
      retriable?: boolean;
      /**
       * The provider's parsed error payload, when it sent JSON. Adapters read
       * it to tell a DECLINE apart from a genuine failure (Stripe answers a
       * declined card with HTTP 402 and a `decline_code`) — branching on a
       * structured body beats regexing an error message.
       */
      body?: unknown;
      /**
       * The request that produced this failure, redacted — see
       * {@link ProviderRequestSnapshot}. Absent when the adapter does not
       * build one.
       */
      request?: ProviderRequestSnapshot;
      cause?: unknown;
    } = {},
  ) {
    super('ProviderRequestError', message, { cause: options.cause });
  }

  get retriable(): boolean {
    return this.options.retriable ?? false;
  }
}

/**
 * The provider processed the request and said NO (card declined, fraud
 * block). Distinct from `ProviderRequestError`: the call worked, the payment
 * didn't. Carries the normalized reason so hosts show one message catalog.
 */
export class ChargeDeclinedError extends PaymentsError {
  constructor(
    readonly provider: ProviderName,
    readonly reason: DeclineReason,
    message?: string,
  ) {
    super('ChargeDeclinedError', message ?? `Charge declined (${reason})`);
  }
}

/**
 * A charge attempt failed in a way we could NOT prove left no charge behind,
 * and the walk stopped rather than risk billing the buyer twice.
 *
 * This is the deliberate dead end of the failover design. It is raised when a
 * provider gave an ambiguous answer (timeout, 5xx, reset mid-flight) AND the
 * reconciliation probe could not settle the question — because the adapter
 * implements no reference lookup, or because the probe call itself failed.
 *
 * Hosts should treat it as "unknown, needs a human", NOT as a failure to
 * retry: the whole point is that retrying or falling over here is what
 * produces a double charge. An unresolved charge is a support ticket; a
 * double charge is a chargeback.
 */
export class AmbiguousChargeError extends PaymentsError {
  constructor(
    readonly provider: ProviderName,
    /** Host reference of the charge whose fate is unknown. */
    readonly reference: string,
    /** Why the probe could not settle it. */
    readonly probeResult: 'PROBE_FAILED' | 'UNSUPPORTED',
    /**
     * Whether the STOPPED attempt reached the ledger.
     *
     * When false the situation is strictly worse than an ordinary ambiguous
     * outcome: the charge is unresolved AND nothing durable records that,
     * so a later retry cannot re-probe this provider and would issue a fresh
     * request against one that may already hold the buyer's money. Hosts
     * should treat it as an alert, not just a failed payment.
     */
    readonly recorded: boolean = true,
    options?: ErrorOptions,
  ) {
    super('AmbiguousChargeError',
      `Charge ${reference} on ${provider} has an UNKNOWN outcome (${probeResult}); ` +
        'failover was stopped to avoid double-charging. Reconcile manually.' +
        (recorded
          ? ''
          : ' WARNING: the attempt ledger write FAILED, so a retry will not know to' +
            ' re-probe this provider — do not retry until this charge is reconciled.'),
      options,
    );
  }
}

/**
 * The provider created the charge and the LOCAL write then failed.
 *
 * Distinct from `AmbiguousChargeError`, and the distinction is the whole
 * point: there is no uncertainty here. The charge exists, its provider id is
 * known, and the only thing missing is the row in our own store. Throwing the
 * bare database error would lose the one fact an operator needs — that money
 * is already committed at `provider` under `providerChargeId`.
 *
 * `recorded` says whether the attempt ledger got the row. When true a retry
 * recovers automatically; when false BOTH stores were unreachable and only a
 * human can reconnect the charge to the order.
 */
export class ChargeNotPersistedError extends PaymentsError {
  constructor(
    readonly provider: ProviderName,
    readonly providerChargeId: string,
    readonly reference: string,
    readonly recorded: boolean,
    options?: ErrorOptions,
  ) {
    super('ChargeNotPersistedError',
      `Charge ${providerChargeId} WAS created on ${provider} for ${reference}, but the local ` +
        `charge store write failed.` +
        (recorded
          ? ' The attempt ledger recorded it, so a retry will recover it.'
          : ' The attempt ledger write ALSO failed — nothing records this charge.' +
            ' Reconcile it manually before retrying; a retry will create a second charge.'),
      options,
    );
  }
}

/**
 * Every provider in the merchant's chain was tried and none produced a
 * charge. Carries the per-provider failures so the host can surface why,
 * rather than a bare "payment failed".
 */
export class NoProviderSucceededError extends PaymentsError {
  constructor(readonly failures: readonly WalkFailure[]) {
    super('NoProviderSucceededError',
      failures.length === 0
        ? 'No payment provider is available for this merchant'
        : `All ${failures.length} configured provider(s) failed: ` +
          failures.map((f) => `${f.provider}: ${f.message}`).join('; '),
    );
  }
}

/** A webhook delivery failed signature/authenticity verification. */
export class WebhookVerificationError extends PaymentsError {
  constructor(
    readonly provider: ProviderName,
    message = 'Webhook verification failed',
  ) {
    super('WebhookVerificationError', message);
  }
}
