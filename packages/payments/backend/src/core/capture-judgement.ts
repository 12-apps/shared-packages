/**
 * WHAT A CAPTURE OWES BACK once the sale it paid for shrank after the price was
 * fixed (FUT-1262): a line written off between the moment a Pix was raised at a
 * frozen total and the moment that Pix landed. Pure arithmetic, no I/O; the
 * orchestration around it is `./capture-recompose`.
 *
 * The verdicts, Pix only:
 *
 *  - `NONE`: nothing to do. Not a Pix, nothing net captured, or the live total
 *    did not fall below the frozen one.
 *  - `OVER { excessCents }`: the live total is above zero and below what was
 *    captured. The excess is RECORDED and the operator alerted; it is never
 *    refunded automatically (a part of a capture is not what any refund here
 *    sends).
 *  - `REFUND_ALL`: nothing is left to pay for. The whole capture goes back.
 *
 * The excess is measured against the FROZEN total, never against everything
 * captured: money captured above the frozen total (a second capture, a short
 * capture parked and then completed) is another lane's to record or refund, and
 * counting it here would record it twice.
 */

/** The one method a recompose judges: a card is captured before a line can be written off. */
export const RECOMPOSED_METHOD = 'PIX';

export interface CaptureJudgementInput {
  /** The method the sale was paid with; only {@link RECOMPOSED_METHOD} is judged. */
  method: string;
  /** Everything captured for the sale, in cents. */
  capturedCents: number;
  /** What of it already went back, or is going back under a held refund claim, in cents. */
  refundedCents: number;
  /** What the sale's live lines are worth now, composed by the host, in cents. */
  liveTotalCents: number;
  /** The total the charge was raised at, in cents. */
  frozenTotalCents: number;
}

export type CaptureVerdict =
  | { kind: 'NONE' }
  /** A part of the capture is above the live total: recorded and alerted, refunded by a person. */
  | { kind: 'OVER'; excessCents: number }
  /** Nothing is left to pay for: the whole capture goes back. */
  | { kind: 'REFUND_ALL' };

const NONE: CaptureVerdict = { kind: 'NONE' };

function assertCents(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer of cents, got ${String(value)}`);
  }
}

/** Judge one sale's capture against its live total. Throws a RangeError on an amount that is not whole, non-negative cents. */
export function judgeCapture(input: CaptureJudgementInput): CaptureVerdict {
  const { method, capturedCents, refundedCents, liveTotalCents, frozenTotalCents } = input;
  assertCents('capturedCents', capturedCents);
  assertCents('refundedCents', refundedCents);
  assertCents('liveTotalCents', liveTotalCents);
  assertCents('frozenTotalCents', frozenTotalCents);
  if (method !== RECOMPOSED_METHOD) return NONE;
  const netCents = capturedCents - refundedCents;
  if (netCents <= 0 || liveTotalCents >= frozenTotalCents) return NONE;
  if (liveTotalCents === 0) return { kind: 'REFUND_ALL' };
  const excessCents = Math.min(netCents, frozenTotalCents) - liveTotalCents;
  return excessCents > 0 ? { kind: 'OVER', excessCents } : NONE;
}

/** One capture of the sale, as the host reads it. */
export interface CaptureShare {
  providerChargeId: string;
  /** What this capture took, in cents. */
  capturedCents: number;
  /** What of it already went back, or is going back under a held refund claim, in cents. */
  refundedCents: number;
}

/**
 * Which capture holds how much of an excess: taken from the LAST capture
 * backwards (the one that paid last is the one that paid too much), each giving
 * at most what it still holds. Captures holding nothing of it are left out.
 */
export function allocateExcess<T extends CaptureShare>(captures: readonly T[], excessCents: number): { capture: T; excessCents: number }[] {
  const shares: { capture: T; excessCents: number }[] = [];
  let left = excessCents;
  for (let index = captures.length - 1; index >= 0 && left > 0; index -= 1) {
    const capture = captures[index] as T;
    const held = Math.max(0, capture.capturedCents - capture.refundedCents);
    const taken = Math.min(held, left);
    if (taken > 0) shares.unshift({ capture, excessCents: taken });
    left -= taken;
  }
  return shares;
}
