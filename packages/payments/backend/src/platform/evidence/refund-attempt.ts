import {
  afterRefusal,
  isNothingToRefund,
  pg1Schedule,
  REFUND_ATTEMPT_DEADLINE_MS,
  refundRefusalOf,
  type RefundRefusal,
} from '../../core/refund-retry';
import { reportProviderFailure } from '../../core/provider-failure';
import type { RecordedHttpCall } from '../../core/traffic-recorder';
import { idsOf } from './orders';
import { paidChargeId, createdPixIds } from './orders-pix-production';
import { recordTraffic, type RecordedOutcome } from './record';
import type { EvidenceRefundState } from './refund-state';
import type { EvidenceRunDeps } from './run';
import { usageStep } from './run';
import { answered, clockOf, errorDetail, failureOf, pendingStep, stepOf, withStep } from './steps';
import type { EvidenceRecord, EvidenceStep, EvidenceStepKey } from './types';

/**
 * ONE attempt of the production Pix's refund (FUT-4360), whoever runs it: the
 * request that first finds the Pix PAID (attempt 1), the background sweep
 * (attempts 2 and 3), or the operator's "Tentar estornar o Pix de novo".
 *
 * Every attempt goes through the same fence. It CLAIMS itself first — a
 * compare-and-set on the record — and only the claim's winner sends the cancel,
 * so at most one cancel is in flight per charge, across processes and tabs. Its
 * answer is written the same way: an attempt whose claim expired and was taken
 * over writes nothing. Each refund reads the charge back before it cancels, so one that
 * already happened (a lost answer, the owner in PagBank's panel) is adopted
 * instead of cancelled twice.
 */

const PROVIDER = 'pagbank';

/** What an attempt needs of the seller: its token, to prove whose calls these were. */
export interface RefundSeller {
  token: string;
}

/**
 * Which refund an attempt is for: the production Pix's `pix.refund` step, or
 * a card cancel step (FUT-4740), with the charge it cancels.
 */
export interface RefundTarget {
  key: EvidenceStepKey;
  chargeId: string;
  orderId: string | null;
}

/** The production Pix's refund target, from the steps that created and paid it. */
export function pixRefundTarget(steps: readonly EvidenceStep[]): RefundTarget {
  const ids = createdPixIds(steps);
  return { key: 'pix.refund', chargeId: ids ? paidChargeId(steps, ids) : '', orderId: ids?.orderId ?? null };
}

/** The record's refund step for `key` (the Pix's by default), if any. */
export const refundStepOf = (record: EvidenceRecord, key: EvidenceStepKey = 'pix.refund'): EvidenceStep | undefined =>
  record.steps.find((step) => step.key === key);

/** A stamp strictly after the stored one, so the next compare-and-set can tell them apart. */
export function stampAfter(now: Date, stored: string): string {
  return new Date(Math.max(now.getTime(), new Date(stored).getTime() + 1)).toISOString();
}

/**
 * Claim an attempt: write its state (attempt number, `claimedAt`) behind the
 * record's current `updatedAt`. Answers the claimed record, or null when
 * another writer got there first — and then nothing was sent or written.
 */
export async function claimAttempt(
  deps: EvidenceRunDeps,
  record: EvidenceRecord,
  state: EvidenceRefundState,
  steps: readonly EvidenceStep[] = record.steps,
  key: EvidenceStepKey = 'pix.refund',
): Promise<EvidenceRecord | null> {
  const prior = steps.find((step) => step.key === key) ?? pendingStep(key, deps.copy);
  const next = { ...record, steps: withStep(steps, { ...prior, refund: state }), updatedAt: stampAfter(clockOf(deps)(), record.updatedAt) };
  return deps.store.saveIf(next, record.updatedAt);
}

/** What the attempt came to: the step to record, and the refusal that ended it (null when refunded). */
interface Settled {
  step: EvidenceStep;
  refusal: RefundRefusal | null;
  error: unknown;
}

/**
 * Send ONE refund. The adapter reads the charge back through its order before
 * it cancels (that read is the consult, recorded with the call), and answers
 * `NOTHING_TO_REFUND` for a charge that is already refunded — a cancel whose
 * answer was lost, the owner in PagBank's panel — which is adopted as done.
 */
async function settle(deps: EvidenceRunDeps, claimed: EvidenceRecord, found: boolean, target: RefundTarget): Promise<Settled> {
  const { chargeId } = target;
  // This caller owns the retry and reports a give-up once per charge (below), so the gateway stays
  // quiet for it; and its two provider calls run under one deadline shorter than the claim.
  const signal = AbortSignal.timeout(deps.refundAttemptMs ?? REFUND_ATTEMPT_DEADLINE_MS);
  const refunded = await recordTraffic(() =>
    deps.gateway.refund(deps.merchant, PROVIDER, { providerChargeId: chargeId, retriedByCaller: true, signal }),
  );
  // The attempt that FOUND the Pix paid has that very read as its `pix.consult`: only the cancel is its own.
  const calls = [...(refundStepOf(claimed, target.key)?.calls ?? []), ...refunded.calls.filter((call) => !found || call.method !== 'GET')];
  const record = (status: 'EXECUTED' | 'FAILED', observed: string): EvidenceStep =>
    stepOf(target.key, status, clockOf(deps)(), {
      calls,
      ids: idsOf({ providerChargeId: chargeId }, undefined, target.orderId),
      observed,
    });
  const answer = answerOf(deps, refunded);
  return { step: record(answer.refusal === null ? 'EXECUTED' : 'FAILED', answer.observed), refusal: answer.refusal, error: answer.error };
}

/** What PagBank's answer to the refund comes to: done (adopted or cancelled), or the refusal. */
function answerOf(deps: EvidenceRunDeps, refunded: RecordedOutcome<{ status: string }>): { refusal: RefundRefusal | null; observed: string; error: unknown } {
  if (!refunded.ok && isNothingToRefund(refunded.error)) return { refusal: null, observed: deps.copy.canceled('REFUNDED'), error: null };
  if (refunded.ok && refunded.value.status === 'REFUNDED' && answered(refunded.calls)) {
    return { refusal: null, observed: deps.copy.canceled(pagbankWord(refunded)), error: null };
  }
  const refusal = refunded.ok ? 'UNKNOWN' : refundRefusalOf(refunded.error);
  return { refusal, observed: failureOf(deps.copy, refunded), error: refunded.ok ? null : refunded.error };
}

/** PagBank's own word for the charge (CANCELED), which is what the scenario expects. */
function pagbankWord(refunded: { calls: readonly RecordedHttpCall[]; value: { status: string } }): string {
  const said = (refunded.calls.at(-1)?.responseBody as { status?: unknown } | undefined)?.status;
  return typeof said === 'string' ? said : refunded.value.status;
}

/**
 * Run the claimed attempt: send ONE refund, and write what came of it behind
 * the claim. A lost claim (the record moved on)
 * writes nothing and answers the record as it now stands.
 */
export async function runClaimedAttempt(
  deps: EvidenceRunDeps,
  claimed: EvidenceRecord,
  state: EvidenceRefundState,
  seller: RefundSeller,
  found = false,
  target: RefundTarget = pixRefundTarget(claimed.steps),
): Promise<EvidenceRecord> {
  const settled = await settle(deps, claimed, found, target);
  const now = clockOf(deps)();
  const next: EvidenceRefundState =
    settled.refusal === null
      ? { ...state, refusal: null, nextAt: null, exhausted: false, claimedAt: null }
      : afterRefusal(state, settled.refusal, now, pg1Schedule);
  const reportNow = next.exhausted && !next.reported;
  const final = reportNow ? { ...next, reported: true } : next;
  let steps = withStep(claimed.steps, { ...settled.step, refund: final });
  steps = withStep(steps, await usageStep(deps, steps, seller.token));
  const saved = await deps.store.saveIf({ ...claimed, steps, updatedAt: stampAfter(now, claimed.updatedAt) }, claimed.updatedAt);
  if (!saved) return (await deps.store.latest(PROVIDER, 'RUN')) ?? claimed;
  if (reportNow) reportStuckRefund(deps, target, settled);
  return saved;
}

/** Sentry hears of a stuck refund ONCE per charge, when its first series gives up (FUT-4360). */
function reportStuckRefund(deps: EvidenceRunDeps, target: RefundTarget, settled: Settled): void {
  reportProviderFailure(deps.onProviderFailure, {
    path: 'REFUND',
    // A refusal for good is a fault; a "not yet" or no verdict that ran out of attempts is news.
    severity: settled.refusal === 'REFUSED' ? 'error' : 'warning',
    merchant: deps.merchant,
    provider: PROVIDER,
    reference: target.chargeId || null,
    error: settled.error ?? undefined,
    message: errorDetail(settled.step.observed),
  });
}

// Moved to core (FUT-4740), re-exported for the evidence modules that claim through this one.
export { firstClaim, nextClaim } from '../../core/refund-retry';
