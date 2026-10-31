import { cancelCharge, pixConsultStep, pollPix } from './orders';
import { clockOf, pendingStep, stepOf } from './steps';
import type { EvidenceStep } from './types';
import type { EvidenceRunDeps, PixConfirmAction } from './run';

/**
 * The PRODUCTION Pix (FUT-4198): a person pays it, so phase 2 only raises the
 * QR (`awaitingPixSteps`, in `orders.ts`) and phase 3 settles it — consulted
 * once per check, refunded once PAID, or recorded as skipped. The sandbox Pix
 * in `orders.ts` polls the simulator, which pays itself.
 */

/** The stored row's id and the order PagBank named, read back from the recorded `pix.create`. */
function createdPixIds(steps: readonly EvidenceStep[]): { chargeId: string; orderId: string } | null {
  const created = steps.find((step) => step.key === 'pix.create' && step.status === 'EXECUTED');
  const orderId = created?.ids['order_id'];
  if (!orderId) return null;
  return { chargeId: created.ids['charge_id'] ?? orderId, orderId };
}

/**
 * PRODUCTION (FUT-4198): one consult of the Pix a person was asked to pay and,
 * once it is PAID, its refund — or, when the operator skipped it, the record
 * that it was never paid. Returns only the steps it settled.
 */
export async function pixConfirmSteps(
  deps: EvidenceRunDeps,
  steps: readonly EvidenceStep[],
  action: PixConfirmAction,
): Promise<EvidenceStep[]> {
  const ids = createdPixIds(steps);
  if (!ids) return [];
  if (action === 'SKIP') {
    const why = deps.copy.pixSkipped;
    return [pendingStep('pix.paid', deps.copy, why), pendingStep('pix.refund', deps.copy, why)];
  }
  const polled = await pollPix({ ...deps, pixPolls: 1 }, ids.chargeId);
  const { step: consult, ids: idsOfPix } = pixConsultStep(deps, polled, ids.orderId);
  if (polled.status !== 'PAID') return [consult];
  const paid = stepOf('pix.paid', 'EXECUTED', clockOf(deps)(), { ids: idsOfPix, observed: deps.copy.paid });
  return [consult, paid, await cancelCharge(deps, 'pix.refund', polled.chargeId, ids.orderId)];
}

