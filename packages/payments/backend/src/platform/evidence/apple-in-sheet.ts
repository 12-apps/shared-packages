import { applePaySteps } from './orders-wallet';
import { appleRaised, blockedBecause, EvidenceRunNotFoundError, openRun, sandboxSeller, type EvidenceRunDeps } from './run';
import { clockOf, withStep } from './steps';
import type { BrowserWalletResult } from './types';

const PROVIDER = 'pagbank';

/**
 * Apple Pay, charged while its sheet is still open (FUT-5519): Apple's token
 * expires within minutes (PagBank answered EXPIRED_PAYMENT_TOKEN to one held
 * for the length of a run), so the order, its consult and its cancel are
 * raised on the prepared run at once and recorded there; phase 2 then raises
 * the rest and leaves Apple Pay's section as it stands. Answers whether
 * PagBank charged it, for the sheet to close with.
 */
export async function chargeApplePayInSheet(
  deps: EvidenceRunDeps,
  runId: string,
  result: BrowserWalletResult,
): Promise<{ paid: boolean }> {
  const record = openRun(await deps.store.latest(PROVIDER, 'RUN'), runId);
  if (appleRaised(record)) throw new EvidenceRunNotFoundError(runId);
  const seller = await sandboxSeller(deps);
  const blocked = blockedBecause(deps, record, seller);
  if (blocked !== null || typeof seller !== 'object') throw new Error(blocked ?? deps.copy.notRun);
  const raised = await applePaySteps(deps, runId, result);
  let steps = record.steps;
  for (const step of raised) steps = withStep(steps, step);
  await deps.store.save({ ...record, steps, updatedAt: clockOf(deps)().toISOString() });
  return { paid: raised.some((step) => step.key === 'apay.approved' && step.status === 'EXECUTED') };
}
