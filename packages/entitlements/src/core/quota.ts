import type { EntitlementValue } from './types';

/**
 * Quota algebra. Pure — no I/O, no ports. `'unlimited'` is normalized to
 * `Infinity` for comparison only; it stays a sentinel everywhere it might be
 * serialized (see {@link EntitlementValue}).
 */

/** Numeric ceiling implied by a granted value. Booleans have no ceiling. */
export function toLimit(value: EntitlementValue | undefined): number {
  if (value === undefined) return 0;
  if (value === 'unlimited') return Number.POSITIVE_INFINITY;
  if (typeof value === 'boolean') return value ? Number.POSITIVE_INFINITY : 0;
  // A negative quota is meaningless; treat it as none rather than throwing so
  // one bad row can never take down every gate in the app.
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Does this granted value switch the feature ON at all?
 *
 * `0` is a real, meaningful value — "entitled to none" — and reads as OFF, so
 * a plan can explicitly zero out an inherited quota.
 */
export function isGranted(value: EntitlementValue | undefined): boolean {
  return toLimit(value) > 0;
}

/** Wire-safe ceiling: a finite number, the `'unlimited'` sentinel, or `null`. */
export function toWireLimit(
  value: EntitlementValue | undefined,
  isQuota: boolean,
): number | 'unlimited' | null {
  if (!isQuota) return null;
  if (value === 'unlimited') return 'unlimited';
  const limit = toLimit(value);
  return Number.isFinite(limit) ? limit : 'unlimited';
}

/** What remains of a quota. `Infinity` when unlimited; never negative. */
export function remainingOf(limit: number, used: number): number {
  if (!Number.isFinite(limit)) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - used);
}

/**
 * Is the quota spent? Existing rows always survive an overage — this only ever
 * tells the host to refuse a *new* one.
 */
export function isExceeded(limit: number, used: number): boolean {
  if (!Number.isFinite(limit)) return false;
  return used >= limit;
}
