import type { CustomerFieldIssue } from './customer-schema';
import type { ProviderName } from './types';

/**
 * WHY a provider did not produce the charge — the walk's failure channel.
 *
 * ## Why this is typed rather than prose
 *
 * `NoProviderSucceededError` is the only thing a host sees when a chain runs
 * out, and the host has to answer two completely different situations from it:
 *
 *   - nothing was ever SENT — the buyer's CPF is missing, the provider is not
 *     connected, the breaker is open. The honest answer names the field or
 *     stays quiet; it is not a payment outage and must not be logged as one.
 *   - a provider was actually ASKED and refused. Now something really did go
 *     wrong out there, and the buyer gets one honest "we could not take the
 *     payment" while an operator gets the detail.
 *
 * That distinction used to live in the MESSAGE STRING: the gate wrote a
 * sentence and the host parsed it back with a regex. It failed in the ordinary
 * case, not an exotic one — a two-provider chain where the head is gated on a
 * missing CPF and the tail is skipped for any other reason (no instrument for
 * it, breaker open, method unsupported) produced one parseable string and one
 * unparseable one, so the host gave up and answered a blanket 502 for a problem
 * the buyer could have fixed in one field. The parser also hardcoded the field
 * names, so the first new field would have silently reverted every such refusal
 * to a 5xx.
 *
 * A discriminant cannot rot that way: adding a field is a type change, and
 * "was anybody actually asked" is a fact the walk knows for certain at the
 * moment it decides.
 */
export type WalkFailureKind =
  /**
   * The BUYER-REQUIREMENTS gate refused this provider (FUT-595): its declared
   * `customerSchema` is not satisfied, so nothing was sent. Carries the typed
   * issues, which is what lets a host name the field.
   */
  | 'GATE'
  /**
   * The provider could not be attempted at all — not registered, cannot do the
   * method, not connected, breaker open, or no card instrument belongs to it.
   * Nothing was sent, and there is nothing the BUYER can do about it.
   */
  | 'SKIP'
  /**
   * The provider was asked and did not produce a charge: it refused, declined,
   * or could not be reached. This is the only kind that means a real exchange
   * happened, and the only one an operator's provider log should record.
   */
  | 'FAILURE';

/** One provider's contribution to an exhausted chain. */
export interface WalkFailure {
  provider: ProviderName;
  /** Operator-facing detail. NEVER shown to a buyer verbatim. */
  message: string;
  kind: WalkFailureKind;
  /** Present exactly when `kind` is `GATE` — the fields that blocked it. */
  issues?: readonly CustomerFieldIssue[];
}

/**
 * True when NO provider in the chain was ever asked — every entry was gated or
 * skipped before a single byte went out.
 *
 * This is the question a host actually needs: it decides whether the buyer sees
 * a fixable 4xx or an honest "the store cannot take payment right now", and it
 * decides whether anything is written to the provider-failure log. An empty
 * chain answers `true` (nothing was attempted, trivially), and the host's own
 * "no provider configured" path covers that case before it gets here.
 */
export function nothingWasAttempted(failures: readonly WalkFailure[]): boolean {
  return failures.every((failure) => failure.kind !== 'FAILURE');
}

/**
 * Every buyer field that blocked SOME provider, de-duplicated by field.
 *
 * The union across the chain, not the head's alone: the buyer has to satisfy
 * whichever provider ends up taking the charge, and they cannot be asked to
 * guess which. An INVALID issue wins over a MISSING one for the same field —
 * "the CPF you typed is wrong" is strictly more informative than "type a CPF"
 * when both were said about the same value.
 */
export function gateIssuesOf(failures: readonly WalkFailure[]): CustomerFieldIssue[] {
  const byField = new Map<CustomerFieldIssue['field'], CustomerFieldIssue>();
  for (const issue of failures.flatMap((failure) => [...(failure.issues ?? [])])) {
    const held = byField.get(issue.field);
    if (!held || (held.reason === 'MISSING' && issue.reason === 'INVALID')) {
      byField.set(issue.field, issue);
    }
  }
  return [...byField.values()];
}
