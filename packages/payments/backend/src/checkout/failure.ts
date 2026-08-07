import { ChargeIdentityError } from '../core/charge-identity';
import {
  AmbiguousChargeError,
  CustomerRequirementsError,
  NoProviderSucceededError,
} from '../core/errors';
import type { CustomerFieldIssue, PaymentMethodKind } from '../core/types';
import { gateIssuesOf, nothingWasAttempted } from '../core/walk-failure';

import type { CheckoutCopy } from './copy';
import type { CheckoutErrorBody, CheckoutLogger } from './types';

/**
 * WHAT A FAILED CHARGE IS TOLD TO THE BUYER, AND IN WHAT ORDER (FUT-563/595).
 *
 * The ORDER is itself a money-safety rule, which is why it is one unbranchable
 * pipeline here rather than a catch block per route:
 *
 *   1. a charge that is not this attempt's        → 409, nothing recorded
 *   2. a buyer field the gate refused             → 400, naming the field
 *   3. the walk's own outcomes (exhausted / ambiguous)
 *   4. the host's per-provider mapping
 *   5. one honest generic
 *
 * Each step above the next exists because the next got it WRONG in production.
 * (1) ahead of everything: an identity refusal is OUR bug, and the provider
 * mapping reported it to the buyer as "the provider refused your charge". (2)
 * ahead of (3): a missing CPF wearing a `NoProviderSucceededError` answered a
 * blanket 502 that named nothing, stripping a fixable problem of the one detail
 * that fixes it. (3) ahead of (4): left to the per-provider mapping, whichever
 * provider happened to fail LAST decided the message, so one event read as a
 * bad card at one merchant and as a server error at the next.
 */

/** A refusal, ready to send: the structured body plus the status it carries. */
export interface CheckoutRefusal {
  body: CheckoutErrorBody;
  status: number;
}

/** Everything the pipeline needs that is not the error itself. */
export interface FailureContext {
  copy: CheckoutCopy;
  log: CheckoutLogger;
  /** The payable handle, for the operator-facing log lines only. */
  ref: string;
  /** What was being charged — the exhausted-chain sentence names it. */
  method: PaymentMethodKind;
  /**
   * The host's own per-provider mapping (one vendor's error vocabulary, e.g.
   * PagBank's reason codes). Deliberately NOT in the library: a table of one
   * provider's error strings is the definition of a vendor coupling, and the
   * pipeline above is what keeps it from ever deciding a walk's outcome.
   */
  mapProviderError?: (error: unknown) => CheckoutErrorBody | null;
}

/**
 * Turn the gate's typed issues into the buyer's answer (FUT-595).
 *
 * MISSING wins over INVALID when both are present: a field that is not there at
 * all is the more basic thing to fix, and enumerating every missing one at once
 * spares the buyer a round trip per field.
 *
 * No provider is named. Nothing was SENT anywhere — this refusal happens before
 * the first request — so "the provider refused" would be a lie, and which
 * gateway a merchant uses is not the buyer's business either way.
 */
function buyerFieldRefusal(
  copy: CheckoutCopy,
  issues: readonly CustomerFieldIssue[],
): CheckoutErrorBody | null {
  const byKey = new Map<CustomerFieldIssue['field'], CustomerFieldIssue>();
  for (const issue of issues) if (!byKey.has(issue.field)) byKey.set(issue.field, issue);
  const unique = [...byKey.values()];
  const missing = unique.filter((issue) => issue.reason === 'MISSING');
  const first = missing[0];
  if (first) {
    return {
      code: 'MISSING_BUYER_FIELD',
      message: copy.buyerFieldMissing(missing.map((issue) => issue.field)),
      field: copy.fieldNameOf(first.field),
    };
  }
  const invalid = unique[0];
  if (!invalid) return null;
  return {
    code: 'INVALID_BUYER_FIELD',
    message: copy.buyerFieldInvalid(invalid.field),
    field: copy.fieldNameOf(invalid.field),
  };
}

/**
 * Map a BUYER-REQUIREMENTS refusal onto its body, or null.
 *
 * The gate refuses a provider whose declared `customerSchema` a charge cannot
 * satisfy BEFORE anything is sent, in two shapes: a PINNED charge throws
 * `CustomerRequirementsError`, an UNPINNED walk skips the provider and — if
 * nobody else takes the charge — throws `NoProviderSucceededError` carrying the
 * same issues typed alongside a `kind` discriminant.
 *
 * THE CONDITION IS "WAS ANYBODY ACTUALLY ASKED", not "did every failure look
 * like a gate refusal". Those are not the same test, and the difference was a
 * live defect: a two-provider chain whose head is gated on a missing CPF and
 * whose tail is skipped for its own unrelated reason has one gate refusal and
 * one skip. Nothing went out and the buyer needs the field named; the old test
 * saw an unfamiliar second failure and fell through to a blanket 502 that filed
 * buyer input as an outage.
 */
function customerRequirementsBody(
  copy: CheckoutCopy,
  error: unknown,
): CheckoutErrorBody | null {
  if (error instanceof CustomerRequirementsError) return buyerFieldRefusal(copy, error.issues);
  if (!(error instanceof NoProviderSucceededError) || error.failures.length === 0) return null;
  if (!nothingWasAttempted(error.failures)) return null;
  return buyerFieldRefusal(copy, gateIssuesOf(error.failures));
}

/**
 * The answer to a charge whose snapshot is NOT this attempt's charge (FUT-378).
 * Nothing is recorded and the buyer is asked to retry, because the alternative
 * is bookkeeping written from somebody else's charge.
 *
 * `mismatch` and the charge id are LOGGED, never returned: the buyer can do
 * nothing with them, and an operator needs both to reconcile the charge that
 * came back. This one line is also the only thing that tells the two causes of
 * a mismatch apart — "expected attempt X:1, got X:0" (identity) versus
 * "expected 1290 cents, got 0" (a degraded snapshot).
 */
export function chargeMismatchRefusal(
  context: Pick<FailureContext, 'copy' | 'log' | 'ref'>,
  /** A `ChargeSnapshot`, or the stored row's provider + id. Both identify it. */
  charge: { provider: string; providerChargeId: string },
  mismatch: string,
): CheckoutRefusal {
  context.log.error(
    `[payments] charge snapshot mismatch for ${context.ref}: ${mismatch} ` +
      `(${charge.provider} charge ${charge.providerChargeId}) — nothing recorded`,
  );
  return {
    body: { code: 'CHARGE_MISMATCH', message: context.copy.chargeMismatch, field: null },
    status: 409,
  };
}

/**
 * Where an exhausted chain is written down — and the line that decides it is
 * the SAME discriminant the buyer's answer turns on (FUT-563).
 *
 * A walk in which no provider was ever asked is not a provider failure, and
 * `providerFailure` is the operator's provider-outage channel: filing a missing
 * CPF or an open breaker there is the inverse of what it exists for, and it is
 * what made buyer input look like an outage in the reporter.
 */
function logExhaustedChain(context: FailureContext, error: NoProviderSucceededError): void {
  if (nothingWasAttempted(error.failures)) {
    context.log.warn(
      `[payments] no provider could be attempted for ${context.ref}: ${error.message}`,
    );
    return;
  }
  context.log.providerFailure(`every provider failed for ${context.ref}`, error);
}

/**
 * The two outcomes that belong to the WALK rather than to any one provider.
 *
 * An AMBIGUOUS charge is deliberately NOT worded as a retry-me failure: some
 * provider may be holding the buyer's money, so inviting them to pay again is
 * the one instruction that can turn an unresolved charge into a double one.
 *
 * 502 for an exhausted chain, not 400: nothing about the buyer's data was
 * wrong. The full per-provider detail stays server-side, where it names
 * providers and quotes their raw messages — operator information, not buyer
 * information.
 */
function walkRefusal(context: FailureContext, error: unknown): CheckoutRefusal | null {
  if (error instanceof NoProviderSucceededError) {
    logExhaustedChain(context, error);
    return {
      body: {
        code: 'PAYMENT_UNAVAILABLE',
        message: context.copy.chainExhausted(context.method),
        field: null,
      },
      status: 502,
    };
  }
  if (error instanceof AmbiguousChargeError) {
    context.log.error(`[payments] unresolved charge for ${context.ref}: ${error.message}`);
    return {
      body: {
        code: 'PAYMENT_UNRESOLVED',
        message: context.copy.unresolvedCharge,
        field: null,
      },
      status: 409,
    };
  }
  return null;
}

/**
 * THE PIPELINE. See the module doc for why the order is what it is; there is no
 * parameter, flag or branch that lets a caller reorder it.
 */
export function checkoutRefusalFor(context: FailureContext, error: unknown): CheckoutRefusal {
  if (error instanceof ChargeIdentityError) {
    return chargeMismatchRefusal(context, error, error.mismatch);
  }
  const buyerFields = customerRequirementsBody(context.copy, error);
  if (buyerFields) return { body: buyerFields, status: 400 };

  const walk = walkRefusal(context, error);
  if (walk) return walk;

  // Only now may a single provider's vocabulary speak, and only through the
  // host's own mapping — the library holds no vendor error table.
  context.log.providerFailure(`charge failed for ${context.ref}`, error);
  const mapped = context.mapProviderError?.(error);
  if (mapped) return { body: mapped, status: 400 };
  return {
    body: {
      code: 'PAYMENT_DECLINED',
      message: context.copy.genericProviderRefusal,
      field: null,
    },
    status: 502,
  };
}
