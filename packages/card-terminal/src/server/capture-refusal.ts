import { capturedAbove, planExcess, type ExcessCapture, type ExcessPlan, type ExcessResolution } from './capture-excess';

/**
 * A settle with terminal legs that the host refused because the bill moved
 * between the charge and the settle: which captures are owed back now, which
 * are held for the sale context's next settle, and when there is no refusal
 * after all (the change leg absorbs it, or the operator chose how to book the
 * excess). Pure: the host writes what it decides — `ledger.flag` with its own
 * reduced-bill reason code for `flag`, `ledger.hold` under its context key for
 * `hold` — and keeps the copy and the status.
 *
 * Nothing here moves money twice: a capture is either flagged (owed back) or
 * held (good money for the context), never both, and a capture that fits is
 * never refunded.
 *
 * | reason | change leg | choice | decision |
 * |---|---|---|---|
 * | `UNDERCHARGED` (the bill GREW) | any | any | `HOLD` every capture; `shortCents` left to charge (cash resent) |
 * | `OVERCHARGED` / `WRITTEN_OFF_LINE`, nothing over | any | any | `HOLD` every capture (refused money never floats) |
 * | went down, the change leg covers the excess | cash ≥ excess | any | `CHANGE`: no refusal, the excess is change |
 * | went down, the captures alone exceed the bill | none or too small | none, `FLAG` | `FLAG` the latest captures until the rest fit; `HOLD` the rest; `rechargeCents` |
 * | as above | none or too small | none, `ASK` | `ASK`: refused `CAPTURES_EXCEED_TOTAL` until the operator chooses |
 * | as above | none or too small | given | `EXCESS`: the `planExcess` plan, booked with `createCaptureExcess` |
 * | no capture at all | any | any | `NONE`: nothing of the terminal's to decide |
 */

export const CAPTURE_REFUSAL_REASONS = ['OVERCHARGED', 'UNDERCHARGED', 'WRITTEN_OFF_LINE'] as const;
/**
 * Why the settle was refused: `UNDERCHARGED` the bill grew after the charge;
 * `OVERCHARGED` what was collected exceeds the bill; `WRITTEN_OFF_LINE` a line
 * was taken off the bill since the charge (it went down).
 */
export type CaptureRefusalReason = (typeof CAPTURE_REFUSAL_REASONS)[number];

export interface CaptureRefusalInput {
  reason: CaptureRefusalReason;
  /** The settle's terminal captures, in the order they were taken. */
  captures: readonly ExcessCapture[];
  /**
   * What the captures and the change leg share: the bill's total NOW, less
   * every other leg of the settle (vouchers, a second cash leg…).
   */
  dueCents: number;
  /** The leg that can hand change back (cash), as handed over. Absent or 0: the settle has none. */
  changeLegCents?: number | undefined;
  /** The operator's choice for an excess (a counter's explicit step). With one, the excess is planned, not flagged. */
  choice?: ExcessResolution | undefined;
  /**
   * With no choice, captures above the bill: `FLAG` (the default: a terminal
   * settle with card or Pix only) decides the refund at once; `ASK` refuses
   * until the operator chooses (a counter that offers the choice).
   */
  withoutChoice?: 'FLAG' | 'ASK' | undefined;
}

/** What to do with a refused settle's captures. `refused: false`: the settle may go ahead as the decision says. */
export type CaptureRefusalDecision =
  | { kind: 'NONE'; refused: true; flag: ExcessCapture[]; hold: ExcessCapture[] }
  | {
      kind: 'HOLD';
      refused: true;
      /**
       * What is left to charge, assuming the next settle sends the change
       * (cash) leg AGAIN with the held captures: the bill less both. A settle
       * that does not resend the cash must also charge `changeLegCents`.
       */
      shortCents: number;
      flag: ExcessCapture[];
      hold: ExcessCapture[];
    }
  | { kind: 'CHANGE'; refused: false; changeCents: number; flag: ExcessCapture[]; hold: ExcessCapture[] }
  | {
      kind: 'FLAG';
      refused: true;
      /** What the captures took above the bill. */
      excessCents: number;
      /**
       * What is left to charge once the held captures are used: the bill less
       * them. The change (cash) leg is NOT counted: it was handed back whole.
       */
      rechargeCents: number;
      flag: ExcessCapture[];
      hold: ExcessCapture[];
    }
  | { kind: 'ASK'; refused: true; code: 'CAPTURES_EXCEED_TOTAL'; excessCents: number; flag: ExcessCapture[]; hold: ExcessCapture[] }
  | {
      kind: 'EXCESS';
      refused: false;
      /** The admitted-or-not plan: `admitExcess` it, then book it with `createCaptureExcess().settle`, which writes its flags. */
      plan: Exclude<ExcessPlan, { kind: 'FITS' } | { kind: 'REFUSED' }>;
      /** The change leg, handed back whole: the captures alone exceed the bill. */
      changeCents: number;
      flag: ExcessCapture[];
      hold: ExcessCapture[];
    };

const sumOf = (captures: readonly ExcessCapture[]): number => captures.reduce((sum, capture) => sum + capture.amountCents, 0);

function cents(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole, non-negative number of cents, got ${String(value)}`);
  return value;
}

function holdAll(captures: readonly ExcessCapture[], dueCents: number, changeCents: number): CaptureRefusalDecision {
  const shortCents = Math.max(0, dueCents - sumOf(captures) - changeCents);
  return { kind: 'HOLD', refused: true, shortCents, flag: [], hold: captures.map((capture) => ({ ...capture })) };
}

/** The captures alone exceed the bill: the operator's plan, a refusal that asks for one, or the refund decided now. */
function capturesAbove(input: CaptureRefusalInput, changeCents: number): CaptureRefusalDecision {
  const { captures, dueCents, choice } = input;
  const excessCents = capturedAbove(captures, dueCents);
  if (choice !== undefined) {
    const plan = planExcess({ captures, dueCents, choice });
    // The captures exceed the due here, so the plan is never FITS; with a choice it is never REFUSED.
    if (plan.kind === 'FITS' || plan.kind === 'REFUSED') throw new Error('An excess with a choice is always planned.');
    return { kind: 'EXCESS', refused: false, plan, changeCents, flag: [], hold: [] };
  }
  if (input.withoutChoice === 'ASK') return { kind: 'ASK', refused: true, code: 'CAPTURES_EXCEED_TOTAL', excessCents, flag: [], hold: [] };
  // The same split the operator's "refund and charge again" makes: the latest captures off until the rest fit.
  const split = planExcess({ captures, dueCents, choice: { as: 'REFUND_AND_RECHARGE', reason: '' } });
  if (split.kind !== 'REFUND_AND_RECHARGE') throw new Error('An excess split is always a refund and recharge.');
  return { kind: 'FLAG', refused: true, excessCents, rechargeCents: split.rechargeCents, flag: split.refunded, hold: split.kept };
}

/** What a refused terminal-leg settle does with its captures. Pure; see the table above. */
export function decideCaptureRefusal(input: CaptureRefusalInput): CaptureRefusalDecision {
  const { reason, captures } = input;
  if (!(CAPTURE_REFUSAL_REASONS as readonly string[]).includes(reason)) throw new Error(`Not a capture refusal reason: ${String(reason)}`);
  const dueCents = cents('dueCents', input.dueCents);
  const changeLegCents = cents('changeLegCents', input.changeLegCents ?? 0);
  for (const capture of captures) cents(`the amount of capture ${capture.transactionCode}`, capture.amountCents);
  if (captures.length === 0) return { kind: 'NONE', refused: true, flag: [], hold: [] };
  if (reason === 'UNDERCHARGED') return holdAll(captures, dueCents, changeLegCents);
  const excessCents = sumOf(captures) + changeLegCents - dueCents;
  if (excessCents <= 0) return holdAll(captures, dueCents, changeLegCents);
  // Troco: one change leg may hand back up to all of itself, as the settle's own change rule does.
  if (changeLegCents >= excessCents) return { kind: 'CHANGE', refused: false, changeCents: excessCents, flag: [], hold: [] };
  return capturesAbove({ ...input, dueCents }, changeLegCents);
}
