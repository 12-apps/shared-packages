import { cancelCharge, pixConsultStep, pollPix } from './orders';
import { clockOf, pendingStep, stepOf } from './steps';
import type { EvidenceRecord, EvidenceStep } from './types';
import type { EvidenceRunDeps, PixConfirmAction } from './run';

/**
 * The PRODUCTION Pix (FUT-4198): a person pays it, so phase 2 only raises the
 * QR (`awaitingPixSteps`, in `orders.ts`) and phase 3 settles it — consulted
 * once per check, refunded once PAID (and refunded again on the next check if
 * the refund failed), or recorded as skipped. The sandbox Pix in `orders.ts`
 * polls the simulator, which pays itself.
 */

/**
 * Where a run's production Pix stands. OPEN states still hold real money or
 * a payable QR: `AWAITING_PAYMENT` (the QR is up) and `REFUND_PENDING` (paid,
 * the refund not done yet). The run may not be replaced while it is open.
 */
export type EvidencePixState = 'NONE' | 'AWAITING_PAYMENT' | 'REFUND_PENDING' | 'REFUNDED' | 'SKIPPED';

/** What a screen needs to show the Pix a person pays. */
export interface EvidencePixView {
  runId: string;
  state: EvidencePixState;
  /** The copia-e-cola text the QR encodes; null once nothing is payable. */
  qrText: string | null;
  /** When PagBank stops accepting the QR, ISO-8601; null when it did not say. */
  expiresAt: string | null;
}

const stepIn = (steps: readonly EvidenceStep[], key: EvidenceStep['key']) => steps.find((step) => step.key === key);

export function pixStateOf(record: EvidenceRecord, skippedNote: string): EvidencePixState {
  if (stepIn(record.steps, 'pix.create')?.status !== 'EXECUTED' || !stepIn(record.steps, 'pix.refund')) return 'NONE';
  if (stepIn(record.steps, 'pix.refund')?.status === 'EXECUTED') return 'REFUNDED';
  if (stepIn(record.steps, 'pix.paid')?.status === 'EXECUTED') return 'REFUND_PENDING';
  return stepIn(record.steps, 'pix.paid')?.observed === skippedNote ? 'SKIPPED' : 'AWAITING_PAYMENT';
}

export const isPixOpen = (state: EvidencePixState): boolean => state === 'AWAITING_PAYMENT' || state === 'REFUND_PENDING';

/** The first string under any of these keys, depth-first (an array's items included). */
function findString(value: unknown, keys: readonly string[]): string | null {
  if (value === null || typeof value !== 'object') return null;
  const entries = Object.entries(value);
  const direct = entries.find(([key, child]) => keys.includes(key) && typeof child === 'string');
  if (direct) return direct[1] as string;
  for (const [, child] of entries) {
    const found = findString(child, keys);
    if (found) return found;
  }
  return null;
}

/** The run's Pix as a screen shows it, read back from the recorded `pix.create` answer. */
export function pixViewOf(record: EvidenceRecord, skippedNote: string): EvidencePixView {
  const state = pixStateOf(record, skippedNote);
  const answer = stepIn(record.steps, 'pix.create')?.calls.at(-1)?.responseBody;
  const qrCodes = (answer as { qr_codes?: unknown; charges?: unknown } | undefined) ?? {};
  return {
    runId: record.id,
    state,
    qrText: state === 'AWAITING_PAYMENT' ? findString(qrCodes, ['text']) : null,
    expiresAt: state === 'AWAITING_PAYMENT' ? findString(qrCodes, ['expiration_date']) : null,
  };
}

/** The stored row's id and the order PagBank named, read back from the recorded `pix.create`. */
function createdPixIds(steps: readonly EvidenceStep[]): { chargeId: string; orderId: string } | null {
  const created = steps.find((step) => step.key === 'pix.create' && step.status === 'EXECUTED');
  const orderId = created?.ids['order_id'];
  if (!orderId) return null;
  return { chargeId: created.ids['charge_id'] ?? orderId, orderId };
}

/** The charge to refund: the one the PAID consult named, or the created one. */
function paidChargeId(steps: readonly EvidenceStep[], ids: { chargeId: string }): string {
  return stepIn(steps, 'pix.consult')?.ids['charge_id'] ?? stepIn(steps, 'pix.paid')?.ids['charge_id'] ?? ids.chargeId;
}

/**
 * PRODUCTION (FUT-4198): settle the Pix a person was asked to pay. Returns
 * only the steps it settled.
 *
 * - Paid already, refund not done (it failed before): refund again.
 * - Otherwise consult it once. PAID → refund it, whatever the operator
 *   pressed: a skipped QR that was paid anyway still gets its money back.
 * - Not paid: `CHECK` records the consult; `SKIP` records it was skipped.
 */
export async function pixConfirmSteps(
  deps: EvidenceRunDeps,
  steps: readonly EvidenceStep[],
  action: PixConfirmAction,
): Promise<EvidenceStep[]> {
  const ids = createdPixIds(steps);
  if (!ids) return [];
  if (stepIn(steps, 'pix.paid')?.status === 'EXECUTED') {
    return [await cancelCharge(deps, 'pix.refund', paidChargeId(steps, ids), ids.orderId)];
  }
  const polled = await pollPix({ ...deps, pixPolls: 1 }, ids.chargeId);
  const { step: consult, ids: idsOfPix } = pixConsultStep(deps, polled, ids.orderId);
  if (polled.status === 'PAID') {
    const paid = stepOf('pix.paid', 'EXECUTED', clockOf(deps)(), { ids: idsOfPix, observed: deps.copy.paid });
    return [consult, paid, await cancelCharge(deps, 'pix.refund', polled.chargeId, ids.orderId)];
  }
  if (action === 'CHECK') return [consult];
  const why = deps.copy.pixSkipped;
  return [consult, pendingStep('pix.paid', deps.copy, why), pendingStep('pix.refund', deps.copy, why)];
}
