import { claimHeld, REFUND_CLAIM_TTL_MS } from './refund-retry';
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

/** A baseline's instant in ms; NaN when there is none. */
const baselineMs = (row: Pick<RefundSeriesRow, 'refundedBeforeAt'>): number => (row.refundedBeforeAt ? Date.parse(row.refundedBeforeAt) : Number.NaN);

/** A part series: one with an amount. */
export const isPart = (row: Pick<RefundSeriesRow, 'amountCents'>): boolean => row.amountCents !== null;

/** The baseline read before the part's first send; null while nothing was sent with one. */
export const baselineOf = (row: Pick<RefundSeriesRow, 'refundedBeforeCents'>): number | null => row.refundedBeforeCents ?? null;

/** A series that may have moved money nobody has proven yet: a baseline is set, and it is neither settled nor out of attempts. */
const inDoubt = (row: RefundSeriesRow): boolean => row.settledAt === null && baselineOf(row) !== null && !row.exhausted;

/** Doubts are taken oldest baseline first, the id breaking a tie. */
const olderDoubt = (a: RefundSeriesRow, b: RefundSeriesRow): boolean => {
  const at = Date.parse(a.refundedBeforeAt ?? '');
  const bt = Date.parse(b.refundedBeforeAt ?? '');
  return at !== bt ? at < bt : a.id < b.id;
};

/**
 * Does `other` hold `row` back (one doubt per charge)? While its attempt holds its claim, always.
 * While it is in doubt, only a row with no baseline yet or a younger doubt waits, so of two doubts on
 * one charge the older always goes first and the two can never wait for each other.
 */
function holdsBack(row: RefundSeriesRow, other: RefundSeriesRow, now: Date): boolean {
  if (other.settledAt !== null) return false;
  if (claimHeld(other, now)) return true;
  return inDoubt(other) && (baselineOf(row) === null || olderDoubt(other, row));
}

/** The other series kept for the same charge (one read, over the reference's index). */
export async function siblingsOf(store: RefundRetryStore, row: RefundSeriesRow): Promise<RefundSeriesRow[]> {
  const rows = await store.findByReference(row.merchant, row.reference);
  return rows.filter((other) => other.providerChargeId === row.providerChargeId && other.id !== row.id);
}

/** The siblings that hold `row` back now; none: it may go. */
export const blockersOf = (row: RefundSeriesRow, siblings: readonly RefundSeriesRow[], now: Date): RefundSeriesRow[] =>
  siblings.filter((other) => holdsBack(row, other, now));

/** The least a held-back part waits, so it never keeps the sweep's oldest slots tick after tick. */
export const DEFER_MIN_MS = 30_000;

/**
 * When a held-back part is due again: just after the earliest moment one of its blockers can resolve
 * (its next attempt, or the end of the claim it holds), and never sooner than {@link DEFER_MIN_MS}.
 */
export function deferredUntil(blockers: readonly RefundSeriesRow[], now: Date): string {
  const resolves = blockers.map((other) =>
    claimHeld(other, now) ? Date.parse(other.claimedAt!) + REFUND_CLAIM_TTL_MS : Date.parse(other.nextAt ?? ''),
  );
  const earliest = Math.min(...resolves.filter((ms) => !Number.isNaN(ms)));
  return new Date(Math.max(now.getTime() + DEFER_MIN_MS, Number.isFinite(earliest) ? earliest + 1_000 : 0)).toISOString();
}

/** A sibling settled as money back after this part's baseline was read. */
const settledSince = (other: RefundSeriesRow, since: number, how: 'REFUNDED' | 'ADOPTED'): boolean =>
  other.settledHow === how && other.settledAt !== null && Date.parse(other.settledAt) > since;

/**
 * What sibling parts took back after this part's baseline was read: theirs, not this part's.
 * - A sibling settled REFUNDED since: its settling send landed after the baseline (it held this part
 *   back while it ran), so what that send asked counts, whatever the sibling's own baseline.
 * - A sibling ADOPTED since counts only when its own first send came after this baseline, since then
 *   none of its money can be inside it. One adopted with an older baseline is {@link ambiguousSince}.
 */
function siblingsSince(row: PartRow, siblings: readonly RefundSeriesRow[]): number {
  const since = baselineMs(row);
  if (Number.isNaN(since)) return 0;
  const refunded = siblings.filter((other) => settledSince(other, since, 'REFUNDED'));
  const adopted = siblings.filter((other) => settledSince(other, since, 'ADOPTED') && baselineMs(other) >= since);
  return (
    refunded.reduce((sum, other) => sum + (other.lastSentCents ?? other.amountCents ?? 0), 0) +
    adopted.reduce((sum, other) => sum + (other.amountCents ?? 0), 0)
  );
}

/**
 * A sibling ADOPTED since this baseline whose own baseline is older (or absent): its money may have
 * landed before this baseline (inside it) or after (not this part's), and nothing tells which. The
 * part is then neither adopted nor sent: it goes pending, so a person decides.
 */
export function ambiguousSince(row: PartRow, siblings: readonly RefundSeriesRow[]): boolean {
  const since = baselineMs(row);
  if (Number.isNaN(since)) return false;
  return siblings.some((other) => settledSince(other, since, 'ADOPTED') && !(baselineMs(other) >= since));
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
  return blockersOf(stored, siblings, now).length > 0 ? null : siblings;
}

/** A series re-opened for ANOTHER claim starts with no baseline; the same claim keeps its own, never moved. */
export const baselineFor = (stored: RefundSeriesRow, key: Pick<RefundSeriesKey, 'boundTo'>) =>
  stored.boundTo === key.boundTo || baselineOf(stored) === null ? {} : { refundedBeforeCents: null, refundedBeforeAt: null };

/** A part read back whose figure proves nothing is owed any more: adopted by a CLOSE (a dead claimant's last attempt). */
export const provenBack = (row: RefundSeriesRow, readBack: number | null, siblings: readonly RefundSeriesRow[]): boolean =>
  readBack !== null && isPart(row) && baselineOf(row) !== null && !ambiguousSince(row, siblings) && owedCents(row, readBack, siblings) <= 0;
