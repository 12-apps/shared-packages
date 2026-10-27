import type { ChargeQueryStore } from './charge-queries';
import { UnsupportedOperationError } from './errors';
import { reportProviderFailure, type ProviderFailureReporter } from './provider-failure';
import type { SupersededWhy, VoidOutcome } from './supersession';
import type { ChargeSnapshot, ChargeStatus, MerchantRef } from './types';

export type { SupersededWhy, VoidOutcome } from './supersession';

/**
 * RETIRING THE HOSTED LINKS A CHECKOUT MOVED PAST (FUT-4072).
 *
 * When a parked link is not handed back (`hosted-landing.ts`), the buyer ends
 * up holding another charge — a new one, or a different live one that was
 * reused — and the old link is still payable at its provider. Left alone that
 * is two payable charges for one payable, the exact double payment FUT-604
 * exists to prevent. So each moved-past link is retired, ONCE:
 *
 *  1. VOIDED at the provider when its adapter can (`cancelCharge`) AND the
 *     provider confirms it — the answer must read CANCELED (or another state a
 *     buyer cannot pay). The void goes through the gateway, so a refusal is
 *     reported to the host's `onProviderFailure` (FUT-4074).
 *  2. Otherwise MARKED SUPERSEDED on the stored row
 *     (`ChargeQueryStore.markSuperseded`) — so it is never offered back as the
 *     live charge and never retired twice — and then RECORDED through the
 *     host's recorder, so a payment of it reaches the host's superseded /
 *     duplicate-payment handling instead of settling unnoticed. With no
 *     recorder wired the line is logged as an error by name — never silent.
 *  3. A void the provider answers with a SETTLED charge (`PAID_BEFORE_VOID`:
 *     the buyer paid the old link in the window) is not superseded — it IS the
 *     payment. It is logged as an error, reported to `onProviderFailure`, and
 *     becomes the buyer's answer ({@link answerHeld}); the charge that was
 *     about to replace it is retired against it instead (`PAID_ELSEWHERE`) —
 *     unless that one was paid too, which is a `DOUBLE_PAID` to refund. Any
 *     further link found paid is a `DOUBLE_PAID` too, against the answer.
 *
 * ONLY ONCE THE CHARGE THE BUYER HOLDS IS LIVE. A declined or failed charge
 * leaves the buyer with nothing else to pay, and a recorded-superseded link they
 * then pay would be refused by the host. The link is retired by the next
 * attempt that does produce a live one. A PENDING charge counts as live: it is
 * what the buyer is now holding — a QR, a hosted page, a card awaiting 3-D
 * Secure. If that 3-D Secure then fails, the next attempt mints a fresh link;
 * the superseded one, paid anyway, reaches the host's superseded handling.
 *
 * NEVER THROWS. The buyer is waiting on the charge they hold; failing their
 * checkout because an OLD link could not be retired would turn a stale link
 * into an outage of the payment path.
 */

/** A moved-past charge that is still the buyer's to pay — or was paid anyway. */
export interface SupersededCharge {
  merchant: MerchantRef;
  /** The host's own reference for the thing being paid. */
  reference: string;
  /** The moved-past charge, as last known. */
  snapshot: ChargeSnapshot;
  /** The charge that replaced it — for `DOUBLE_PAID`, the other payment. */
  replacedBy: ChargeSnapshot;
  why: SupersededWhy;
  /** For `PAID_ELSEWHERE`: why this charge's own void did not take it back. */
  voidOutcome?: VoidOutcome;
}

/**
 * The host's record of a superseded charge. Called once per charge in the
 * ordinary case — the stored mark keeps it from being met again — but it MUST
 * be idempotent on `(snapshot.provider, snapshot.providerChargeId)`: a store
 * without `markSuperseded`, or a mark that failed, meets the same link on the
 * next attempt and records it again. Awaited and CONTAINED: a recorder that
 * throws is logged and cannot fail the buyer's charge.
 */
export type SupersededRecorder = (charge: SupersededCharge) => Promise<void> | void;

export interface RetireDeps {
  gateway: {
    cancelCharge(merchant: MerchantRef, provider: string, providerChargeId: string): Promise<ChargeSnapshot>;
  };
  charges: Pick<ChargeQueryStore, 'markSuperseded'>;
  log: { warn(message: string): void; error(message: string): void };
  onSuperseded?: SupersededRecorder;
  /** Told when a void comes back SETTLED (FUT-4074). */
  onProviderFailure?: ProviderFailureReporter;
}

interface RetireInput {
  merchant: MerchantRef;
  reference: string;
  movedPast: readonly ChargeSnapshot[];
  /** The charge the buyer holds now: raised by this attempt, or reused. */
  raised: ChargeSnapshot;
}

/** A charge a buyer holds or has paid — the only kind that may replace a link. */
const LIVE: ReadonlySet<ChargeStatus> = new Set<ChargeStatus>(['PENDING', 'AUTHORIZED', 'PAID']);
/** A void answer a buyer can no longer pay. */
const GONE: ReadonlySet<ChargeStatus> = new Set<ChargeStatus>(['CANCELED', 'EXPIRED', 'DECLINED']);

function sameCharge(a: ChargeSnapshot, b: ChargeSnapshot): boolean {
  return a.provider === b.provider && a.providerChargeId === b.providerChargeId;
}

/**
 * Void every moved-past link, or mark and record the ones still payable.
 * Answers the first link the provider reported PAID or AUTHORIZED instead of
 * voiding — the buyer already paid THAT one — or null. Every further link found
 * paid is a second payment of the same payable: marked, recorded and reported
 * `DOUBLE_PAID` against the first, for a refund.
 */
export async function retireMovedPast(deps: RetireDeps, input: RetireInput): Promise<ChargeSnapshot | null> {
  const [paid, ...more] = await retireStale(deps, input);
  if (!paid) return null;
  await recordDoublePaid(deps, input, more, paid);
  return paid;
}

/** Retire each moved-past link; answer EVERY one the void found paid, in order. */
async function retireStale(deps: RetireDeps, input: RetireInput): Promise<ChargeSnapshot[]> {
  const stale = input.movedPast.filter((snapshot) => !sameCharge(snapshot, input.raised));
  if (stale.length === 0) return [];
  if (!LIVE.has(input.raised.status)) {
    deps.log.warn(
      `payments.superseded kept ${stale.length} hosted link(s) on ${input.reference}: ` +
        `the ${input.raised.provider} charge the buyer holds is ${input.raised.status}`,
    );
    return [];
  }
  const paid: ChargeSnapshot[] = [];
  for (const snapshot of stale) {
    const settled = await retireOne(deps, input, snapshot, 'MOVED_PAST');
    if (settled) paid.push(settled);
  }
  return paid;
}

/** What the buyer is answered with once the moved-past links are retired. */
export interface HeldAnswer {
  /** The charge the buyer now holds — or the one they already paid. */
  answer: ChargeSnapshot;
  /**
   * The answer is an EARLIER charge the buyer already paid — its status is PAID
   * or AUTHORIZED (`PAID_BEFORE_VOID`), not one raised or reused now: SETTLE the payable with it and show paid —
   * never redirect to it, attach it as pending, or refuse it as a mismatch.
   * An AUTHORIZED answer still holds the buyer's money uncaptured: capture it,
   * or refund it.
   */
  paidEarlier: boolean;
}

/** Charge states in which the buyer's money has already moved. */
const SETTLED: ReadonlySet<ChargeStatus> = new Set<ChargeStatus>(['PAID', 'AUTHORIZED']);

/**
 * Retire the moved-past links against the charge the buyer holds (`held`) —
 * and when the void finds one of them PAID already:
 *
 *  - `held` still payable: answer with the PAID link (`paidEarlier`); the
 *    buyer paid, so the checkout must show paid rather than a fresh QR or page.
 *    `held` is retired against it: voided, or marked and recorded
 *    `PAID_ELSEWHERE` with the reason its own void failed;
 *  - `held` already paid too — a card paid in this very request, or one the
 *    void finds paid — is a DOUBLE PAYMENT, never something to void. The answer
 *    stays `held` (what the buyer paid in this attempt) and the older link is
 *    marked and recorded `DOUBLE_PAID`, with both charge ids, for a refund.
 *
 * Every OTHER moved-past link the void finds paid is a `DOUBLE_PAID` against
 * the charge kept as the answer, whichever of the two cases above applies.
 */
export async function answerHeld(
  deps: RetireDeps,
  input: Omit<RetireInput, 'raised'> & { held: ChargeSnapshot },
): Promise<HeldAnswer> {
  const { held, ...rest } = input;
  const paidLinks = await retireStale(deps, { ...rest, raised: held });
  const [paid, ...more] = paidLinks;
  if (!paid) return { answer: held, paidEarlier: false };
  if (SETTLED.has(held.status)) return keep(deps, rest, paidLinks, held);
  reportPaidBeforeVoid(deps, rest, paid);
  const heldPaid = await retireOne(deps, { ...rest, raised: paid }, held, 'REPLACED_BY_PAYMENT');
  if (heldPaid) return keep(deps, rest, paidLinks, heldPaid);
  await recordDoublePaid(deps, rest, more, paid);
  return { answer: paid, paidEarlier: true };
}

type Scope = Omit<RetireInput, 'raised' | 'movedPast'>;

/** `kept` was paid in this attempt: it is the answer, every link paid before it a duplicate. */
async function keep(
  deps: RetireDeps,
  scope: Scope,
  duplicates: readonly ChargeSnapshot[],
  kept: ChargeSnapshot,
): Promise<HeldAnswer> {
  await recordDoublePaid(deps, scope, duplicates, kept);
  return { answer: kept, paidEarlier: false };
}

/** Each duplicate and `kept` were BOTH paid: report, mark and record each duplicate for a refund. */
async function recordDoublePaid(
  deps: RetireDeps,
  scope: Scope,
  duplicates: readonly ChargeSnapshot[],
  kept: ChargeSnapshot,
): Promise<void> {
  const { merchant, reference } = scope;
  for (const duplicate of duplicates) {
    const what = describe(duplicate, reference);
    const message =
      `DOUBLE_PAID: ${what} and ${kept.provider} charge ${kept.providerChargeId} were BOTH paid ` +
      `on ${reference}; the latter is the answer, refund the former`;
    deps.log.error(`payments.superseded ${message}`);
    reportProviderFailure(deps.onProviderFailure, {
      path: 'CANCEL',
      severity: 'error',
      merchant,
      provider: duplicate.provider,
      reference: duplicate.providerChargeId,
      message,
    });
    await markSuperseded(deps, { merchant, reference, movedPast: [], raised: kept }, duplicate, 'DOUBLE_PAID', what);
    await recordSuperseded(deps, { merchant, reference, snapshot: duplicate, replacedBy: kept, why: 'DOUBLE_PAID' }, what);
  }
}

/** A moved-past link the void found PAID: it is the payment, and that is news. */
function reportPaidBeforeVoid(deps: RetireDeps, input: Scope, paid: ChargeSnapshot): void {
  const message =
    `PAID_BEFORE_VOID: moved-past hosted ${describe(paid, input.reference)} was ${paid.status} ` +
    `before the void: the buyer paid it, so it is the answer and the charge raised in its place is retired`;
  deps.log.error(`payments.void ${message}`);
  reportProviderFailure(deps.onProviderFailure, {
    path: 'CANCEL',
    severity: 'error',
    merchant: input.merchant,
    provider: paid.provider,
    reference: paid.providerChargeId,
    message,
  });
}

function describe(snapshot: ChargeSnapshot, reference: string): string {
  return (
    `${snapshot.provider} charge ${snapshot.providerChargeId} ` +
    `(${snapshot.amount.amountCents} ${snapshot.amount.currency}) on ${reference}`
  );
}

/** What a void left: nothing payable, still payable (and why), or a payment. */
type VoidResult = { kind: 'GONE' } | { kind: 'KEPT'; why: VoidOutcome; latest: ChargeSnapshot } | { kind: 'PAID'; latest: ChargeSnapshot };

/** Ask the provider to void, and read its answer strictly. */
async function voidAt(deps: RetireDeps, input: RetireInput, snapshot: ChargeSnapshot, what: string): Promise<VoidResult> {
  let answer: ChargeSnapshot;
  try {
    answer = await deps.gateway.cancelCharge(input.merchant, snapshot.provider, snapshot.providerChargeId);
  } catch (error) {
    if (error instanceof UnsupportedOperationError) {
      deps.log.warn(`payments.void unsupported for ${what}`);
      return { kind: 'KEPT', why: 'VOID_UNSUPPORTED', latest: snapshot };
    }
    deps.log.error(`payments.void failed for ${what}: ${reason(error)}`);
    return { kind: 'KEPT', why: 'VOID_FAILED', latest: snapshot };
  }
  if (GONE.has(answer.status)) {
    deps.log.warn(`payments.void voided ${what} (${answer.status})`);
    return { kind: 'GONE' };
  }
  if (answer.status === 'PENDING') {
    deps.log.error(`payments.void not confirmed for ${what}: still PENDING`);
    return { kind: 'KEPT', why: 'VOID_NOT_CONFIRMED', latest: answer };
  }
  return { kind: 'PAID', latest: answer };
}

/**
 * Retire one charge: a moved-past link (`MOVED_PAST`, recorded with its void's
 * outcome), or the charge raised in this attempt after an older link turned out
 * PAID (`REPLACED_BY_PAYMENT`, recorded `PAID_ELSEWHERE`). Answers the charge
 * when the provider reported it PAID instead of voiding it.
 */
async function retireOne(
  deps: RetireDeps,
  input: RetireInput,
  snapshot: ChargeSnapshot,
  role: 'MOVED_PAST' | 'REPLACED_BY_PAYMENT',
): Promise<ChargeSnapshot | null> {
  const what = `${role === 'MOVED_PAST' ? 'moved-past hosted' : 'replaced'} ${describe(snapshot, input.reference)}`;
  const result = await voidAt(deps, input, snapshot, what);
  if (result.kind === 'GONE') return null;
  if (result.kind === 'PAID') return result.latest;
  const why: SupersededWhy = role === 'MOVED_PAST' ? result.why : 'PAID_ELSEWHERE';
  await markSuperseded(deps, input, snapshot, why, what);
  await recordSuperseded(
    deps,
    {
      merchant: input.merchant,
      reference: input.reference,
      snapshot: result.latest,
      replacedBy: input.raised,
      why,
      ...(role === 'MOVED_PAST' ? {} : { voidOutcome: result.why }),
    },
    what,
  );
  return null;
}

/** The stored mark — FIRST, so a recorder that throws still leaves it retired. */
async function markSuperseded(
  deps: RetireDeps,
  input: RetireInput,
  snapshot: ChargeSnapshot,
  why: SupersededWhy,
  what: string,
): Promise<void> {
  const mark = deps.charges.markSuperseded;
  if (!mark) {
    deps.log.error(`payments.superseded cannot mark ${what}: the charge store has no markSuperseded`);
    return;
  }
  try {
    await mark.call(deps.charges, input.merchant, snapshot.provider, snapshot.providerChargeId, {
      at: new Date().toISOString(),
      replacedBy: input.raised.providerChargeId,
      why,
    });
  } catch (error) {
    deps.log.error(`payments.superseded could not mark ${what}: ${reason(error)}`);
  }
}

async function recordSuperseded(deps: RetireDeps, charge: SupersededCharge, what: string): Promise<void> {
  if (!deps.onSuperseded) {
    deps.log.error(
      `payments.superseded ${what} (${charge.why}) and no superseded recorder is wired: reconcile by hand`,
    );
    return;
  }
  try {
    await deps.onSuperseded(charge);
  } catch (error) {
    deps.log.error(`payments.superseded could not record ${what}: ${reason(error)}`);
  }
}

/** A STRING, never the error object — a provider error retains the buyer's data. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
