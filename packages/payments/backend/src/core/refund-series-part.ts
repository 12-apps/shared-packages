import { claimHeld } from './refund-retry';
import type { RefundRetryStore, RefundSeriesKey, RefundSeriesRow } from './refund-series-store';

/**
 * A PART refund read back before it is asked again (FUT-4951). A part's money
 * cannot be proven back by the charge's status, which stays PAID or
 * PARTIALLY_REFUNDED either way, so an adapter that declares `refundReadBack`
 * reports the charge's cumulative refunded total and the series keeps the total
 * read just before its first send as a baseline. What grew since, less what a
 * sibling part of the same charge took back meanwhile, is this part's.
 */

/** The series' own fields this module reads. */
type PartRow = Pick<RefundSeriesRow, 'id' | 'providerChargeId' | 'amountCents' | 'refundedBeforeCents' | 'refundedBeforeAt'>;

/** A part series: one with an amount. */
export const isPart = (row: Pick<RefundSeriesRow, 'amountCents'>): boolean => row.amountCents !== null;

/** The baseline read before the part's first send; null while nothing was sent with one. */
export const baselineOf = (row: Pick<RefundSeriesRow, 'refundedBeforeCents'>): number | null => row.refundedBeforeCents ?? null;

/**
 * A series that may have moved money nobody has proven yet: a baseline is set
 * (something was sent) and it is neither settled nor out of attempts, or an
 * attempt of it holds its claim now.
 */
export function inDoubt(row: RefundSeriesRow, now: Date): boolean {
  if (row.settledAt !== null) return false;
  return (baselineOf(row) !== null && !row.exhausted) || claimHeld(row, now);
}

/** The other series kept for the same charge (one read, over the reference's index). */
export async function siblingsOf(store: RefundRetryStore, row: RefundSeriesRow): Promise<RefundSeriesRow[]> {
  const rows = await store.findByReference(row.merchant, row.reference);
  return rows.filter((other) => other.providerChargeId === row.providerChargeId && other.id !== row.id);
}

/** One doubt per charge: another series of it is in doubt, so this part waits for the next tick. */
export const fenced = (siblings: readonly RefundSeriesRow[], now: Date): boolean => siblings.some((other) => inDoubt(other, now));

/** What sibling parts settled as money back after the baseline was read: theirs, not this part's. */
function siblingsSince(row: PartRow, siblings: readonly RefundSeriesRow[]): number {
  const since = row.refundedBeforeAt ? Date.parse(row.refundedBeforeAt) : Number.NaN;
  if (Number.isNaN(since)) return 0;
  return siblings
    .filter((other) => (other.settledHow === 'REFUNDED' || other.settledHow === 'ADOPTED') && other.settledAt !== null)
    .filter((other) => Date.parse(other.settledAt!) > since)
    .reduce((sum, other) => sum + (other.amountCents ?? 0), 0);
}

/**
 * What is still owed through a part with a baseline, given the charge's
 * refunded total now: `asked − (now − before − siblings since)`, never more
 * than asked. Zero or less means the part is back (adopted, nothing sent).
 * A refund someone else made meanwhile (the owner, in the provider's panel)
 * counts as the part's: the buyer can only end up short, never paid twice.
 */
export function owedCents(row: PartRow, refundedNow: number, siblings: readonly RefundSeriesRow[]): number {
  const asked = row.amountCents ?? 0;
  const grown = refundedNow - (baselineOf(row) ?? refundedNow) - siblingsSince(row, siblings);
  return Math.min(asked, asked - grown);
}

/** A part's siblings for a person's press, or null while one of them is in doubt; a whole charge has none. */
export async function pressSiblings(store: RefundRetryStore, stored: RefundSeriesRow | null, now: Date): Promise<RefundSeriesRow[] | null> {
  if (!stored || !isPart(stored)) return [];
  const siblings = await siblingsOf(store, stored);
  return fenced(siblings, now) ? null : siblings;
}

/** A series re-opened for ANOTHER claim starts with no baseline; the same claim keeps its own, never moved. */
export const baselineFor = (stored: RefundSeriesRow, key: Pick<RefundSeriesKey, 'boundTo'>) =>
  stored.boundTo === key.boundTo || baselineOf(stored) === null ? {} : { refundedBeforeCents: null, refundedBeforeAt: null };
