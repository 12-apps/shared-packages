import { attemptsOf, type RefundRefusal, type RefundRetryState } from '../../core/refund-retry';
import type { EvidenceRecord, EvidenceStep } from './types';

/**
 * Where the production Pix's refund stands between attempts (FUT-4360), kept on
 * the run record's refund step so a restart, a second process or a second tab
 * all read the same thing. Never printed in the file: the file's builders pick
 * fields explicitly. It is core's {@link RefundRetryState}, the same one a store
 * refund's series keeps (FUT-4740).
 */
export type EvidenceRefundState = RefundRetryState;

/**
 * How the evidence words a refund that is still open, or that went back after
 * refusals (FUT-5371) — part of the outcome copy (`EvidenceOutcomeCopy`).
 */
export interface EvidenceRefundOutcomeCopy {
  /**
   * PagBank has not taken the refund yet: what the last attempt answered, and
   * whether the system still retries by itself or a person must press "Tentar o
   * estorno de novo". The money is still out: "estorno pendente".
   */
  refundPending: (attempt: number, of: number, detail: string, exhausted: boolean) => string;
  /** The note on a refund that went back after earlier refused attempts, kept in the step as context. */
  refundAfterRetries: (refused: number) => string;
}

/** What a screen shows of it — the stored fields a person needs. */
export interface EvidencePixRefundView {
  attempt: number;
  of: number;
  nextAt: string | null;
  exhausted: boolean;
  refusal: RefundRefusal | null;
}

// Moved to core (FUT-4740): the evidence retry and the store retry read the same ones.
export { claimHeld, REFUND_ATTEMPT_DEADLINE_MS } from '../../core/refund-retry';

const refundStep = (record: EvidenceRecord): EvidenceStep | undefined => record.steps.find((step) => step.key === 'pix.refund');

/** The retry state of the run's Pix refund, or null when no attempt was refused (or a record written before it). */
export function refundStateOf(record: EvidenceRecord): EvidenceRefundState | null {
  return refundStep(record)?.refund ?? null;
}

/**
 * The refund as a screen shows it; null while no attempt was refused (attempt 1
 * in flight, or nothing to show). An attempt in flight has `nextAt` null and is
 * not exhausted: the screen says "estornando".
 */
export function refundViewOf(record: EvidenceRecord): EvidencePixRefundView | null {
  const state = refundStateOf(record);
  if (!state || state.refusal === null) return null;
  return { attempt: state.attempt, of: attemptsOf(state), nextAt: state.nextAt, exhausted: state.exhausted, refusal: state.refusal };
}
