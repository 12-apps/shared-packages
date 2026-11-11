import { REFUND_RETRY_ATTEMPTS } from '../../core/refund-retry';
import { pixStateOf } from './orders-pix-production';
import { claimAttempt, firstClaim, nextClaim, refundStepOf, runClaimedAttempt, stampAfter } from './refund-attempt';
import { claimHeld, refundStateOf, type EvidenceRefundState } from './refund-state';
import { sandboxSeller, type EvidenceRunDeps } from './run';
import { clockOf } from './steps';
import type { EvidenceRecord } from './types';

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
  if (state.exhausted || claimHeld(state, now)) return null;
  const expiredClaim = state.claimedAt !== null;
  if (!expiredClaim && (state.nextAt === null || now.getTime() < new Date(state.nextAt).getTime())) return null;
  return state.attempt >= REFUND_RETRY_ATTEMPTS ? { kind: 'CLOSE', state } : { kind: 'NEXT', state };
}

/** Close a series whose last attempt died with its process: no automatic attempt is left. */
async function closeSeries(deps: EvidenceRunDeps, record: EvidenceRecord, state: EvidenceRefundState): Promise<EvidenceRecord | null> {
  const closed = { ...state, refusal: state.refusal ?? 'UNKNOWN', nextAt: null, exhausted: true, claimedAt: null } as const;
  const step = refundStepOf(record);
  if (!step) return null;
  const next = { ...record, steps: record.steps.map((s) => (s === step ? { ...s, refund: closed } : s)), updatedAt: stampAfter(clockOf(deps)(), record.updatedAt) };
  return deps.store.saveIf(next, record.updatedAt);
}

/**
 * The sweep's body: run the one attempt that is due, if any. Idle, it costs
 * one read. Answers the record it left, or null when nothing was due or
 * another process won the claim.
 */
export async function retryDueEvidenceRefund(deps: EvidenceRunDeps): Promise<EvidenceRecord | null> {
  const record = await deps.store.latest(PROVIDER, 'RUN');
  if (!record || pixStateOf(record, deps.copy.pixSkipped) !== 'REFUND_PENDING') return null;
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
  if (previous && !previous.exhausted) return record;
  const seller = await sandboxSeller(deps);
  if (typeof seller !== 'object') return record;
  const state = firstClaim(clockOf(deps)(), previous);
  const claimed = await claimAttempt(deps, record, state);
  if (!claimed) return (await deps.store.latest(PROVIDER, 'RUN')) ?? record;
  return runClaimedAttempt(deps, claimed, state, seller);
}
