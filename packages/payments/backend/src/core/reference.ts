/**
 * THE `--` ATTEMPT-REFERENCE CONVENTION — one implementation, two callers.
 *
 * A reference is the host's own handle (an order id, an invoice id) sent to the
 * provider so its dashboard correlates back. ONE reference per payable is what
 * makes an abandoned checkout permanent: a provider that dedupes on the
 * reference — InfinitePay on `order_nsu`, PagBank on its order code — answers
 * every later attempt with the charge it minted for the FIRST one, carrying
 * that attempt's `providerChargeId`. The charge store is insert-or-return-
 * existing on `(provider, providerChargeId)`, so it hands back the row attempt
 * 0 wrote, and {@link chargeIdentityMismatch} refuses a charge stored under
 * another attempt's key. The buyer gets a mismatch, and so does every retry
 * after it, because nothing about the situation ever changes.
 *
 * A distinct reference per attempt stops the provider deduping at all, so the
 * charge stores cleanly and passes the guard.
 *
 * This lived FOUR times before FUT-740 — twice in the host's checkout, once in
 * its identity guard, and once here as the activation charge's own
 * `verificationReference`, which documented itself as "the same `--`
 * convention, for the same reason". Four copies of a comparison that runs
 * against rows already on disk is three chances for one of them to drift by a
 * byte and start missing every live charge, so there is now one.
 */

/**
 * What separates a payable's handle from the attempt ordinal. Two hyphens, not
 * one: host ids routinely contain single hyphens (a uuid, a slug), and a
 * single-hyphen separator could not tell `ord-7` the order from `ord` attempt
 * 7. Never change it — every charge row already on disk is written with it.
 */
const ATTEMPT_SEPARATOR = '--';

/**
 * The reference for ONE attempt on `base`.
 *
 * ATTEMPT 0 KEEPS THE BARE HANDLE, and that is a compatibility guarantee, not
 * a nicety: every charge stored before the convention existed carries the bare
 * reference, and so does the first charge of every payable since. A version
 * that suffixed attempt 0 would make all of them unfindable by the lookups
 * below, which is a live payable no query can reach.
 */
export function attemptReference(base: string, attempt: number): string {
  return attempt > 0 ? suffixedReference(base, String(attempt)) : base;
}

/**
 * The same reference for an OPAQUE attempt id rather than an ordinal — what
 * the activation charge uses, where the attempt is a timestamp and there is no
 * count to read. One function so the separator has exactly one definition.
 */
export function suffixedReference(base: string, attempt: string): string {
  return `${base}${ATTEMPT_SEPARATOR}${attempt}`;
}

/**
 * Does `reference` name an attempt on `base`?
 *
 * Exact-or-suffix, never a bare `startsWith`: `abc--1` belongs to `abc`, and
 * `abcd` belongs to a DIFFERENT payable that must still be refused. A prefix
 * match here reaches another payable's charges, which is the entire class of
 * bug this module exists to prevent.
 */
export function ownsReference(base: string, reference: string): boolean {
  return reference === base || reference.startsWith(`${base}${ATTEMPT_SEPARATOR}`);
}

/** The handle inside an attempt reference — the `--<n>` suffix removed. */
export function baseReference(reference: string): string {
  return reference.split(ATTEMPT_SEPARATOR)[0] ?? reference;
}

/**
 * The prefix a storage layer matches attempt references against, for stores
 * whose query language has a `startsWith` but no notion of "exact or suffix".
 * Paired with an exact-equality clause on `base` itself — see the `OR`
 * disjunction in `prisma/stores.ts`.
 */
export function attemptReferencePrefix(base: string): string {
  return `${base}${ATTEMPT_SEPARATOR}`;
}

/**
 * The idempotency key ONE attempt on `base` is deduplicated under at the
 * provider. Minted here so the formula has exactly one definition:
 * `attemptReference` moved package-side and the key that must move in
 * lockstep with it was left for hosts to spell by hand — and a host whose
 * spelling drifts breaks provider dedup silently (a retried attempt
 * re-charges instead of answering the charge already stored under the key).
 */
export function attemptIdempotencyKey(base: string, attempt: number): string {
  return `${base}:${attempt}`;
}
