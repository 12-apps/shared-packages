import { refundLive, type BindTarget, type CaptureErrorCode, type TerminalCaptureRecord } from './model';
import type { CaptureVersion } from './ports';

/**
 * The ledger's decisions, made on a read before anything is written. Pure: the
 * engine (`./ledger`) writes what they decide, predicated on the row they read.
 */

/**
 * How many times a move re-reads and decides again when its predicated write
 * finds the row changed. Each retry needs another committed write to the same
 * capture, and a capture has only a handful of moves, so this is never reached
 * by honest traffic; it bounds a pathological loop.
 */
export const MOVE_ATTEMPTS = 4;

export const REFUSALS: Record<CaptureErrorCode, string> = {
  CONFLICT: 'The capture conflicts with the one recorded.',
  NOT_FOUND: 'No capture with this code at this tenant.',
  BOUND_ELSEWHERE: 'The capture already belongs to another sale.',
  SALE_MISMATCH: "The sale is not this tenant's.",
  DEVICE_MISMATCH: "The terminal is not this tenant's.",
  FLAGGED: 'The capture is flagged for a refund.',
  NOT_UNBOUND: 'This refund reason only fits a capture no sale holds.',
  CONTENDED: 'The capture kept changing under the move; nothing was written.',
};

/** The row as a write predicate: see {@link CaptureVersion}. */
export function versionOf(current: TerminalCaptureRecord): CaptureVersion {
  return {
    id: current.id,
    state: current.state,
    orderId: current.orderId,
    refundFlaggedAt: current.refundFlaggedAt,
    refundClearedAt: current.refundClearedAt,
  };
}

/** Flagged and not cleared for a reason a bind refuses: the money is owed back. */
export function owedBackForGood(record: TerminalCaptureRecord): boolean {
  return refundLive(record) && record.refundReason !== 'UNBOUND_TIMEOUT';
}

/**
 * What marking `current` created for `orderId` means: `"replay"` when it
 * already carries that sale, `"mark"` when it may move, or the refusal. A
 * capture flagged for a reason a bind would refuse may not move either, so it
 * never reaches an ORDER_CREATED that a bind then refuses.
 */
export function markDecision(current: TerminalCaptureRecord, orderId: string): 'replay' | 'mark' | CaptureErrorCode {
  if (current.orderId !== null) return current.orderId === orderId ? 'replay' : 'BOUND_ELSEWHERE';
  if (owedBackForGood(current)) return 'FLAGGED';
  return 'mark';
}

/**
 * What binding `current` to `target` means, before anything is written:
 * `"replay"` when the other transport already bound it there, `{ clearFlag }`
 * when it may be bound (and whether a timeout flag must be cleared), or the
 * refusal.
 */
export function bindDecision(
  current: TerminalCaptureRecord,
  target: BindTarget,
): 'replay' | { clearFlag: boolean } | CaptureErrorCode {
  if (current.state === 'BOUND') {
    return current.orderId === target.orderId && current.paymentId === target.paymentId ? 'replay' : 'BOUND_ELSEWHERE';
  }
  if (current.orderId !== null && current.orderId !== target.orderId) return 'BOUND_ELSEWHERE';
  const flagged = refundLive(current);
  if (flagged && current.refundReason !== 'UNBOUND_TIMEOUT') return 'FLAGGED';
  return { clearFlag: flagged };
}
