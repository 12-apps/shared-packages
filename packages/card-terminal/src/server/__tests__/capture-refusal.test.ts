import { describe, expect, it } from 'vitest';

import { decideCaptureRefusal } from '../capture-refusal';

/**
 * FUT-3770: what a refused terminal-leg settle does with its captures, as the
 * owner decided it — the bill went DOWN with only card or Pix legs: refund at
 * once; a cash leg: the change rule absorbs it; the bill GREW: hold for the
 * context — and the counter's case, where the operator chooses.
 */

const card = (transactionCode: string, amountCents: number) => ({ transactionCode, amountCents });

describe('the bill grew (UNDERCHARGED): hold every capture for the context', () => {
  it('holds them, flags none, and names what is left to charge', () => {
    expect(decideCaptureRefusal({ reason: 'UNDERCHARGED', captures: [card('A', 6000)], dueCents: 9000 })).toEqual({
      kind: 'HOLD',
      refused: true,
      shortCents: 3000,
      flag: [],
      hold: [card('A', 6000)],
    });
  });

  it('counts a cash leg toward what was collected', () => {
    const decision = decideCaptureRefusal({ reason: 'UNDERCHARGED', captures: [card('A', 5000), card('B', 2000)], dueCents: 10_000, changeLegCents: 1000 });
    expect(decision).toMatchObject({ kind: 'HOLD', shortCents: 2000, flag: [], hold: [card('A', 5000), card('B', 2000)] });
  });

  it('never answers a negative shortfall', () => {
    expect(decideCaptureRefusal({ reason: 'UNDERCHARGED', captures: [card('A', 9000)], dueCents: 9000 })).toMatchObject({ kind: 'HOLD', shortCents: 0 });
  });
});

describe('the bill went down with only card or Pix legs: refund at once', () => {
  it.each(['OVERCHARGED', 'WRITTEN_OFF_LINE'] as const)('%s, one capture above the bill: flag it, hold nothing, charge the whole bill again', (reason) => {
    expect(decideCaptureRefusal({ reason, captures: [card('A', 10_000)], dueCents: 9000 })).toEqual({
      kind: 'FLAG',
      refused: true,
      excessCents: 1000,
      rechargeCents: 9000,
      flag: [card('A', 10_000)],
      hold: [],
    });
  });

  it('several captures: the latest come off until the rest fit; the rest are held, never refunded', () => {
    const decision = decideCaptureRefusal({ reason: 'OVERCHARGED', captures: [card('A', 6000), card('B', 4000)], dueCents: 9000 });
    expect(decision).toEqual({ kind: 'FLAG', refused: true, excessCents: 1000, rechargeCents: 3000, flag: [card('B', 4000)], hold: [card('A', 6000)] });
  });

  it('a capture is flagged or held, never both', () => {
    const decision = decideCaptureRefusal({ reason: 'OVERCHARGED', captures: [card('A', 3000), card('B', 3000), card('C', 3000)], dueCents: 4000 });
    const flagged = new Set(decision.flag.map((capture) => capture.transactionCode));
    expect(decision.hold.some((capture) => flagged.has(capture.transactionCode))).toBe(false);
    expect([...decision.flag, ...decision.hold].map((capture) => capture.transactionCode).sort()).toEqual(['A', 'B', 'C']);
  });

  it('a bill that went down to zero refunds every capture', () => {
    expect(decideCaptureRefusal({ reason: 'WRITTEN_OFF_LINE', captures: [card('A', 500)], dueCents: 0 })).toMatchObject({
      kind: 'FLAG',
      flag: [card('A', 500)],
      hold: [],
      rechargeCents: 0,
    });
  });
});

describe('a cash leg: the change rule absorbs it', () => {
  it('no refusal: the excess is change from the cash leg', () => {
    expect(decideCaptureRefusal({ reason: 'OVERCHARGED', captures: [card('A', 6000)], dueCents: 9000, changeLegCents: 5000 })).toEqual({
      kind: 'CHANGE',
      refused: false,
      changeCents: 2000,
      flag: [],
      hold: [],
    });
  });

  it('cash handed over and returned in full is change too', () => {
    expect(decideCaptureRefusal({ reason: 'WRITTEN_OFF_LINE', captures: [card('A', 9000)], dueCents: 9000, changeLegCents: 5000 })).toMatchObject({
      kind: 'CHANGE',
      changeCents: 5000,
    });
  });

  it('when the captures alone exceed the bill, the cash goes back whole and the card excess is refunded', () => {
    const decision = decideCaptureRefusal({ reason: 'OVERCHARGED', captures: [card('A', 9500)], dueCents: 9000, changeLegCents: 1000 });
    expect(decision).toMatchObject({ kind: 'FLAG', refused: true, excessCents: 500, flag: [card('A', 9500)], hold: [] });
  });
});

describe('the bill went down but nothing is over: the refused money is held, never left floating', () => {
  it('holds the captures and names the shortfall', () => {
    expect(decideCaptureRefusal({ reason: 'WRITTEN_OFF_LINE', captures: [card('A', 4000)], dueCents: 9000 })).toMatchObject({
      kind: 'HOLD',
      shortCents: 5000,
      hold: [card('A', 4000)],
      flag: [],
    });
  });
});

describe('a counter where the operator chooses (the caixa)', () => {
  it('with no choice and ASK: refused CAPTURES_EXCEED_TOTAL naming the excess, nothing flagged or held', () => {
    expect(decideCaptureRefusal({ reason: 'OVERCHARGED', captures: [card('A', 10_000)], dueCents: 9000, withoutChoice: 'ASK' })).toEqual({
      kind: 'ASK',
      refused: true,
      code: 'CAPTURES_EXCEED_TOTAL',
      excessCents: 1000,
      flag: [],
      hold: [],
    });
  });

  it('with a choice: the planExcess plan, no refusal, the package settle writes its flags', () => {
    const decision = decideCaptureRefusal({
      reason: 'OVERCHARGED',
      captures: [card('A', 6000), card('B', 4000)],
      dueCents: 9000,
      choice: { as: 'REFUND_AND_RECHARGE', reason: 'line removed' },
    });
    expect(decision).toMatchObject({
      kind: 'EXCESS',
      refused: false,
      changeCents: 0,
      flag: [],
      hold: [],
      plan: { kind: 'REFUND_AND_RECHARGE', excessCents: 1000, kept: [card('A', 6000)], refunded: [card('B', 4000)], rechargeCents: 3000 },
    });
  });

  it.each(['CHANGE', 'STORE_CREDIT'] as const)('with %s: the plan books the whole excess', (as) => {
    const decision = decideCaptureRefusal({ reason: 'OVERCHARGED', captures: [card('A', 10_000)], dueCents: 9000, choice: { as, reason: 'r' } });
    expect(decision).toMatchObject({ kind: 'EXCESS', refused: false, plan: { kind: as, excessCents: 1000 } });
  });

  it('a choice never overrides the bill growing: the captures are held', () => {
    const decision = decideCaptureRefusal({ reason: 'UNDERCHARGED', captures: [card('A', 6000)], dueCents: 9000, choice: { as: 'CHANGE', reason: 'r' } });
    expect(decision.kind).toBe('HOLD');
  });
});

describe('edges', () => {
  it('no capture at all: nothing of the terminal’s to decide', () => {
    expect(decideCaptureRefusal({ reason: 'OVERCHARGED', captures: [], dueCents: 9000, changeLegCents: 20_000 })).toEqual({
      kind: 'NONE',
      refused: true,
      flag: [],
      hold: [],
    });
  });

  it('refuses amounts that are not whole non-negative cents, and an unknown reason', () => {
    expect(() => decideCaptureRefusal({ reason: 'OVERCHARGED', captures: [card('A', 1)], dueCents: -1 })).toThrow('dueCents');
    expect(() => decideCaptureRefusal({ reason: 'OVERCHARGED', captures: [card('A', 1)], dueCents: 1, changeLegCents: 1.5 })).toThrow('changeLegCents');
    expect(() => decideCaptureRefusal({ reason: 'OVERCHARGED', captures: [card('A', -5)], dueCents: 1 })).toThrow('capture A');
    expect(() => decideCaptureRefusal({ reason: 'NOPE' as never, captures: [], dueCents: 1 })).toThrow('refusal reason');
  });

  it('does not hand back the caller’s capture objects', () => {
    const captures = [card('A', 6000)];
    const decision = decideCaptureRefusal({ reason: 'UNDERCHARGED', captures, dueCents: 9000 });
    expect(decision.hold[0]).not.toBe(captures[0]);
  });
});
