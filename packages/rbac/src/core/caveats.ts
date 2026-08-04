/**
 * Reusable ABAC caveat factories (FUT-146). Caveats are pure predicates over
 * the host-populated {@link AuthzContext}; the PEP/call site populates the
 * context (refund amount, shift state, elevation expiry), and every factory
 * here DENIES when its context key is missing or mistyped — "forgot to pass
 * the amount" can never become a silent allow.
 *
 * These are the three condition shapes the design doc names (amount
 * thresholds, shift/clock-in gating, time-boxed acting elevation) shipped as
 * concrete, tested building blocks. Hosts may still write ad-hoc caveats; a
 * caveat is just `(context) => boolean`.
 */
import type { AuthzContext, Caveat } from './types';

/** Anything the time-based caveats accept as an instant. */
export type InstantLike = number | string | Date;

/** Parse an instant from context (epoch millis, ISO string, or Date); null when unusable. */
function toEpochMillis(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** The decision instant: `context[nowKey]` when supplied, else the wall clock. */
function decisionNow(context: AuthzContext, nowKey: string): number | null {
  if (context[nowKey] === undefined) return Date.now();
  return toEpochMillis(context[nowKey]);
}

/**
 * Amount-threshold caveat: passes when `context[key]` is a finite number and
 * `<= limit` (a comp/refund cap: "may refund at most X cents"). A missing,
 * non-numeric, or over-limit amount denies.
 */
export function amountAtMost(limit: number, key = 'amount'): Caveat {
  return (context) => {
    const amount = context[key];
    return typeof amount === 'number' && Number.isFinite(amount) && amount <= limit;
  };
}

/**
 * Boolean-flag caveat: passes only when `context[key]` is literally `true`.
 * The building block for any "only while ..." condition.
 */
export function contextFlag(key: string): Caveat {
  return (context) => context[key] === true;
}

/**
 * Shift/clock-in gating: passes only while the PEP marked the actor as
 * clocked-in (`context[key] === true`). A call site that forgot to populate
 * the shift state denies.
 */
export function withinShift(key = 'onShift'): Caveat {
  return contextFlag(key);
}

/**
 * Time-boxed (acting) elevation: passes while `context[key]` — the grant's
 * expiry instant (epoch millis, ISO string, or Date) — is strictly in the
 * future. The decision instant comes from `context[nowKey]` when the host
 * pins it (deterministic tests, request-scoped clocks) and the wall clock
 * otherwise. A missing or unparsable expiry denies: an elevation that never
 * expires must be granted as a real role, not a caveat.
 */
export function notExpired(key = 'elevationExpiresAt', nowKey = 'now'): Caveat {
  return (context) => {
    const expiresAt = toEpochMillis(context[key]);
    const now = decisionNow(context, nowKey);
    if (expiresAt === null || now === null) return false;
    return expiresAt > now;
  };
}

/**
 * AND-compose caveats: the entry grants only when EVERY caveat passes (e.g. an
 * acting manager may refund small amounts while their elevation lasts:
 * `allOf(amountAtMost(5000), notExpired())`). An empty list passes — it adds
 * no condition.
 */
export function allOf(...caveats: readonly Caveat[]): Caveat {
  return (context) => caveats.every((caveat) => caveat(context));
}

/**
 * The temporal shape of an assignment-relation row (`valid_from`/`valid_to`,
 * filter-not-delete). Absent/null bounds are open: no `validTo` means "still
 * active", no `validFrom` means "active since forever".
 */
export interface TemporalAssignment {
  validFrom?: InstantLike | null;
  validTo?: InstantLike | null;
}

/**
 * The in-process mirror of the SQL temporal predicate
 * (`valid_from <= now AND (valid_to IS NULL OR valid_to > now)`) — the one
 * filter every `AssignmentResolver` must apply so revoked assignments stop
 * granting WITHOUT deleting their audit trail. Hosts backed by SQL express it
 * as a WHERE clause; in-memory hosts (and tests) call this. An unparsable
 * bound fails closed (inactive).
 */
export function isActiveAssignment(
  assignment: TemporalAssignment,
  now: InstantLike = Date.now(),
): boolean {
  const at = toEpochMillis(now);
  if (at === null) return false;
  return (
    boundHolds(assignment.validFrom, (from) => from <= at) &&
    boundHolds(assignment.validTo, (to) => to > at)
  );
}

/** An open (absent) bound holds; a set bound must parse AND satisfy `test`. */
function boundHolds(
  bound: InstantLike | null | undefined,
  test: (ms: number) => boolean,
): boolean {
  if (bound === null || bound === undefined) return true;
  const ms = toEpochMillis(bound);
  return ms !== null && test(ms);
}
