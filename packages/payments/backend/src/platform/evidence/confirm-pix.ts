import { pixConfirmSteps, pixHoldsMoney, pixStateOf } from './orders-pix-production';
import { claimAttempt, firstClaim, runClaimedAttempt, stampAfter, type RefundSeller } from './refund-attempt';
import { pressRetryCardRefund, pressRetryRefund } from './refund-sweep';
import { EvidenceRunNotFoundError, sandboxSeller, usageStep, type EvidenceRunDeps, type PixConfirmAction } from './run';
import { clockOf, withStep } from './steps';
import type { EvidenceRecord, EvidenceStep } from './types';

const PROVIDER = 'pagbank';

/**
 * PRODUCTION phase 3 (FUT-4198): settle the Pix a person has to pay
 * (`pixConfirmSteps` says how). Answers the run as it stands; a screen stops
 * asking once `pixStateOf` is no longer open (REFUNDED or SKIPPED). Only the
 * latest run is settled here, which is why a production phase 1 refuses to
 * start over an open one.
 *
 * Once the Pix is PAID its refund is retried in the background (FUT-4360): the
 * request that first finds it paid sends attempt 1 (claimed first, behind the
 * record's compare-and-set), and from then on a CHECK or a SKIP makes no
 * PagBank call and no write. Only `RETRY_REFUND`, once the attempts ran out,
 * sends again.
 */
export async function confirmEvidencePix(
  deps: EvidenceRunDeps,
  runId: string,
  action: PixConfirmAction,
): Promise<EvidenceRecord> {
  const record = await deps.store.latest(PROVIDER, 'RUN');
  if (!record || record.id !== runId) throw new EvidenceRunNotFoundError(runId);
  // Nothing to do once the Pix is refunded, or skipped and expired, or when it never ran — but a
  // card whose refund ran out is pressed by the same action (FUT-4740, C33).
  if (!pixHoldsMoney(record, deps.copy.pixSkipped, clockOf(deps)())) return pressCardOr(deps, record, action);
  if (pixStateOf(record, deps.copy.pixSkipped) === 'REFUND_PENDING') {
    return action === 'RETRY_REFUND' ? pressRetryRefund(deps, record) : record;
  }
  if (action === 'RETRY_REFUND') return record;
  const seller = await sandboxSeller(deps);
  if (typeof seller !== 'object') return record;
  let steps = record.steps;
  for (const step of await pixConfirmSteps(deps, record.steps, action)) steps = withStep(steps, step);
  const paidNow = steps.some((step) => step.key === 'pix.paid' && step.status === 'EXECUTED');
  return paidNow ? refundFirst(deps, record, steps, seller) : saveConsulted(deps, record, steps, seller);
}

/** RETRY_REFUND once the Pix holds nothing: a card whose refund ran out (C33); any other action is a no-op. */
function pressCardOr(deps: EvidenceRunDeps, record: EvidenceRecord, action: PixConfirmAction): Promise<EvidenceRecord> {
  return action === 'RETRY_REFUND' ? pressRetryCardRefund(deps, record) : Promise.resolve(record);
}

/** The Pix was just read PAID: claim attempt 1 (with the paid steps) and send it. */
async function refundFirst(
  deps: EvidenceRunDeps,
  record: EvidenceRecord,
  steps: readonly EvidenceStep[],
  seller: RefundSeller,
): Promise<EvidenceRecord> {
  const state = firstClaim(clockOf(deps)(), null);
  const claimed = await claimAttempt(deps, record, state, steps);
  if (!claimed) return (await deps.store.latest(PROVIDER, 'RUN')) ?? record;
  return runClaimedAttempt(deps, claimed, state, seller, true);
}

/** A consult that settled nothing, or a skip: saved behind the record's compare-and-set. */
async function saveConsulted(
  deps: EvidenceRunDeps,
  record: EvidenceRecord,
  steps: readonly EvidenceStep[],
  seller: RefundSeller,
): Promise<EvidenceRecord> {
  const proven = withStep(steps, await usageStep(deps, steps, seller.token));
  const next = { ...record, steps: proven, updatedAt: stampAfter(clockOf(deps)(), record.updatedAt) };
  return (await deps.store.saveIf(next, record.updatedAt)) ?? (await deps.store.latest(PROVIDER, 'RUN')) ?? record;
}
