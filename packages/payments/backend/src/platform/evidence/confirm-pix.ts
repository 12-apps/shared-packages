import { pixConfirmSteps, pixHoldsMoney } from './orders-pix-production';
import { EvidenceRunNotFoundError, sandboxSeller, usageStep, type EvidenceRunDeps, type PixConfirmAction } from './run';
import { clockOf, withStep } from './steps';
import type { EvidenceRecord } from './types';

const PROVIDER = 'pagbank';

/**
 * PRODUCTION phase 3 (FUT-4198): settle the Pix a person has to pay
 * (`pixConfirmSteps` says how). Each call saves the run and re-proves whose
 * token its calls carried, so the file is right after any of them. Answers the
 * run as it stands; a screen stops asking once `pixStateOf` is no longer open
 * (REFUNDED or SKIPPED). Only the latest run is settled here, which is why a
 * production phase 1 refuses to start over an open one.
 */
export async function confirmEvidencePix(
  deps: EvidenceRunDeps,
  runId: string,
  action: PixConfirmAction,
): Promise<EvidenceRecord> {
  const record = await deps.store.latest(PROVIDER, 'RUN');
  if (!record || record.id !== runId) throw new EvidenceRunNotFoundError(runId);
  // Nothing to do once the Pix is refunded, or skipped and expired, or when it
  // never ran. A refund that FAILED leaves it open: the next check settles it.
  if (!pixHoldsMoney(record, deps.copy.pixSkipped, clockOf(deps)())) return record;
  const seller = await sandboxSeller(deps);
  if (typeof seller !== 'object') return record;
  let steps = record.steps;
  for (const step of await pixConfirmSteps(deps, record.steps, action)) steps = withStep(steps, step);
  steps = withStep(steps, await usageStep(deps, steps, seller.token));
  return deps.store.save({ ...record, steps, updatedAt: clockOf(deps)().toISOString() });
}
