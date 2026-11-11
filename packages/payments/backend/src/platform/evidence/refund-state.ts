import { REFUND_RETRY_ATTEMPTS, type RefundRefusal } from '../../core/refund-retry';
import type { EvidenceRecord, EvidenceStep } from './types';

/**
 * Where the production Pix's refund stands between attempts (FUT-4360), kept on
 * the run record's `pix.refund` step so a restart, a second process or a second
 * tab all read the same thing. Never printed in the file: the file's builders
 * pick fields explicitly.
 */
export interface EvidenceRefundState {
  /** Each press of "Tentar estornar o Pix de novo" starts a new series, from 1. */
  series: number;
  /** Attempts CLAIMED in this series: a process that died holding one still counts. */
  attempt: number;
  /** When the next automatic attempt is due, ISO-8601; null when none will run by itself. */
  nextAt: string | null;
  /** No automatic attempt is left: out of attempts, or PagBank refused for good. */
  exhausted: boolean;
  refusal: RefundRefusal | null;
  /** When an attempt claimed the right to send its cancel, while it has not answered. */
  claimedAt: string | null;
  /** Sentry has heard of this charge's stuck refund (once per charge, FUT-4360). */
  reported: boolean;
}

/** What a screen shows of it — the stored fields a person needs. */
export interface EvidencePixRefundView {
  attempt: number;
  of: number;
  nextAt: string | null;
  exhausted: boolean;
  refusal: RefundRefusal | null;
}

/**
 * How long one attempt may hold its claim, and the deadline its provider calls
 * (the read-back and the cancel, together) run under. The deadline is an
 * AbortSignal the adapter honours, so an attempt is over 90 s after it started
 * whatever PagBank does, and 30 s of margin remain before another actor may
 * treat the claim as dead: a second cancel can never overlap a live one (I1).
 */
export const REFUND_CLAIM_TTL_MS = 120_000;
export const REFUND_ATTEMPT_DEADLINE_MS = 90_000;

const refundStep = (record: EvidenceRecord): EvidenceStep | undefined => record.steps.find((step) => step.key === 'pix.refund');

/** The retry state of the run's Pix refund, or null when no attempt was refused (or a record written before it). */
export function refundStateOf(record: EvidenceRecord): EvidenceRefundState | null {
  return refundStep(record)?.refund ?? null;
}

/** The claim is in force: its attempt may still be running. */
export function claimHeld(state: EvidenceRefundState, now: Date): boolean {
  return state.claimedAt !== null && now.getTime() < new Date(state.claimedAt).getTime() + REFUND_CLAIM_TTL_MS;
}

/**
 * The refund as a screen shows it; null while no attempt was refused (attempt 1
 * in flight, or nothing to show). An attempt in flight has `nextAt` null and is
 * not exhausted: the screen says "estornando".
 */
export function refundViewOf(record: EvidenceRecord): EvidencePixRefundView | null {
  const state = refundStateOf(record);
  if (!state || state.refusal === null) return null;
  return { attempt: state.attempt, of: REFUND_RETRY_ATTEMPTS, nextAt: state.nextAt, exhausted: state.exhausted, refusal: state.refusal };
}
