import { refundDueNow } from '../../core/refund-retry';
import { pollPix } from './orders';
import { createdPixIds, paidChargeId, pixStateOf } from './orders-pix-production';
import { claimAttempt, firstClaim, nextClaim, refundStepOf, runClaimedAttempt, stampAfter, type RefundTarget } from './refund-attempt';
import { claimHeld, refundStateOf, type EvidenceRefundState } from './refund-state';
import { sandboxSeller, type EvidenceRunDeps } from './run';
import { clockOf, withStep } from './steps';
import type { EvidenceRecord, EvidenceStep, EvidenceStepKey } from './types';

/**
 * Who sends the Pix refund's attempts 2 and 3 (FUT-4360): a scheduled sweep
 * over the latest production run — the only run that can be pending, because a
 * new run is refused while the Pix holds money — and the operator's press once
 * the attempts ran out. Both only DECIDE here; `refund-attempt.ts` claims and
 * sends.
 */

const PROVIDER = 'pagbank';

/** What is due on a paid, unrefunded Pix right now. */
type Due =
  /** A record written before the retry state existed: attempt 1 of series 1, at once. */
  | { kind: 'LEGACY' }
  /** The next attempt of the series, whose time came or whose claimant died. */
  | { kind: 'NEXT'; state: EvidenceRefundState }
  /** A dead claimant held the LAST attempt: nothing is left to send. */
  | { kind: 'CLOSE'; state: EvidenceRefundState };

function dueNow(record: EvidenceRecord, now: Date): Due | null {
  const state = refundStateOf(record);
  if (!state) return refundStepOf(record) ? { kind: 'LEGACY' } : null;
  const due = refundDueNow(state, now);
  return due === null ? null : { kind: due, state };
}

/**
 * Close a series whose last attempt died with its process: no automatic attempt
 * is left. The charge is read back first — the dead claimant's cancel may have
 * landed — and adopted as refunded if so; nothing is cancelled here.
 */
async function closeSeries(deps: EvidenceRunDeps, record: EvidenceRecord, state: EvidenceRefundState): Promise<EvidenceRecord | null> {
  const step = refundStepOf(record);
  const ids = createdPixIds(record.steps);
  if (!step || !ids) return null;
  const polled = await pollPix({ ...deps, pixPolls: 1 }, paidChargeId(record.steps, ids));
  const calls = [...step.calls, ...polled.calls];
  const adopted = polled.status === 'REFUNDED';
  const refund = adopted
    ? { ...state, refusal: null, nextAt: null, exhausted: false, claimedAt: null }
    : { ...state, refusal: state.refusal ?? ('UNKNOWN' as const), nextAt: null, exhausted: true, claimedAt: null };
  const closed = adopted
    ? { ...step, status: 'EXECUTED' as const, at: clockOf(deps)().toISOString(), calls, observed: deps.copy.canceled('REFUNDED'), refund }
    : { ...step, calls, refund };
  const next = { ...record, steps: withStep(record.steps, closed), updatedAt: stampAfter(clockOf(deps)(), record.updatedAt) };
  return deps.store.saveIf(next, record.updatedAt);
}

/**
 * The sweep's body: run the one attempt that is due, if any. Idle, it costs
 * one read. Answers the record it left, or null when nothing was due or
 * another process won the claim.
 */
export async function retryDueEvidenceRefund(deps: EvidenceRunDeps): Promise<EvidenceRecord | null> {
  const record = await deps.store.latest(PROVIDER, 'RUN');
  if (!record) return null;
  // The Pix first, then a card cancel: a card is never starved by a Pix still retrying (review S5).
  const pix = pixStateOf(record, deps.copy.pixSkipped) === 'REFUND_PENDING' ? await retryDuePix(deps, record) : null;
  if (pix) return pix;
  return retryDueCardCancel(deps, (await deps.store.latest(PROVIDER, 'RUN')) ?? record);
}

/** The Pix refund's attempt that is due, if any. */
async function retryDuePix(deps: EvidenceRunDeps, record: EvidenceRecord): Promise<EvidenceRecord | null> {
  const now = clockOf(deps)();
  const due = dueNow(record, now);
  if (!due) return null;
  if (due.kind === 'CLOSE') return closeSeries(deps, record, due.state);
  const seller = await sandboxSeller(deps);
  if (typeof seller !== 'object') return null;
  const state = due.kind === 'LEGACY' ? firstClaim(now, null) : nextClaim(now, due.state);
  const claimed = await claimAttempt(deps, record, state);
  return claimed ? runClaimedAttempt(deps, claimed, state, seller) : null;
}

/**
 * "Tentar estornar o Pix de novo": a new series of attempts, starting now with
 * a consult. Only once the last one ran out (or for a record that predates the
 * retry state); while a series runs the press is a no-op that answers the record.
 */
export async function pressRetryRefund(deps: EvidenceRunDeps, record: EvidenceRecord): Promise<EvidenceRecord> {
  const previous = refundStateOf(record);
  if (previous && (!previous.exhausted || claimHeld(previous, clockOf(deps)()))) return record;
  const seller = await sandboxSeller(deps);
  if (typeof seller !== 'object') return record;
  const state = firstClaim(clockOf(deps)(), previous);
  const claimed = await claimAttempt(deps, record, state);
  if (!claimed) return (await deps.store.latest(PROVIDER, 'RUN')) ?? record;
  return runClaimedAttempt(deps, claimed, state, seller);
}

/** The card cancels a run makes ONE attempt of; the sweep sends the rest (FUT-4740). */
const CARD_CANCEL_KEYS: readonly EvidenceStepKey[] = ['card.cancel', 'debit.cancel', 'gpay.cancel', 'apay.cancel'];

/** A card cancel step still owed a refund, with its retry state and target; null otherwise. */
function cardRefundOf(record: EvidenceRecord, key: EvidenceStepKey): { step: EvidenceStep; state: EvidenceRefundState; target: RefundTarget } | null {
  const step = refundStepOf(record, key);
  if (step?.status !== 'FAILED' || !step.refund) return null;
  const chargeId = step.ids['charge_id'] ?? step.ids['order_id'];
  return chargeId ? { step, state: step.refund, target: { key, chargeId, orderId: step.ids['order_id'] ?? null } } : null;
}

/** The card cancel step whose refund has an attempt due, with its target. */
function dueCardCancel(record: EvidenceRecord, now: Date) {
  for (const key of CARD_CANCEL_KEYS) {
    const owed = cardRefundOf(record, key);
    const due = owed ? refundDueNow(owed.state, now) : null;
    if (owed && due) return { ...owed, due };
  }
  return null;
}

/**
 * A card cancel's attempts 2 and 3 (FUT-4740), on PG1's schedule and through
 * the same claim as the Pix's. A dead last attempt is closed with a consult:
 * a charge that went back is adopted, never cancelled again.
 */
async function retryDueCardCancel(deps: EvidenceRunDeps, record: EvidenceRecord): Promise<EvidenceRecord | null> {
  const now = clockOf(deps)();
  const found = dueCardCancel(record, now);
  if (!found) return null;
  const { state } = found;
  if (found.due === 'CLOSE') return closeCardSeries(deps, record, found.step, state, found.target);
  const seller = await sandboxSeller(deps);
  if (typeof seller !== 'object') return null;
  const next = nextClaim(now, state);
  const claimed = await claimAttempt(deps, record, next, record.steps, found.target.key);
  return claimed ? runClaimedAttempt(deps, claimed, next, seller, false, found.target) : null;
}

async function closeCardSeries(
  deps: EvidenceRunDeps,
  record: EvidenceRecord,
  step: EvidenceStep,
  state: EvidenceRefundState,
  target: RefundTarget,
): Promise<EvidenceRecord | null> {
  const status = await deps.gateway.refreshCharge(deps.merchant, PROVIDER, target.chargeId).then(
    (charge) => charge.status,
    () => null,
  );
  const adopted = status === 'REFUNDED' || status === 'CANCELED';
  const refund = adopted
    ? { ...state, refusal: null, nextAt: null, exhausted: false, claimedAt: null }
    : { ...state, refusal: state.refusal ?? ('UNKNOWN' as const), nextAt: null, exhausted: true, claimedAt: null };
  const closed = adopted
    ? { ...step, status: 'EXECUTED' as const, at: clockOf(deps)().toISOString(), observed: deps.copy.canceled('REFUNDED'), refund }
    : { ...step, refund };
  const next = { ...record, steps: withStep(record.steps, closed), updatedAt: stampAfter(clockOf(deps)(), record.updatedAt) };
  return deps.store.saveIf(next, record.updatedAt);
}
