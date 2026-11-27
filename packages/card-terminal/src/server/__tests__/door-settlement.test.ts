import { describe, expect, it } from 'vitest';

import { planDoorSettlement } from '../door-settlement';

/** One capture at the door, with no till (FUT-3764): exact, short, or above the due, all in one shape. */
describe('planDoorSettlement', () => {
  const capture = (amountCents: number) => ({ transactionCode: 'TC', amountCents });

  it('settles the due when the capture is the due', () => {
    expect(planDoorSettlement(capture(8990), 8990)).toEqual({ kind: 'EXACT', transactionCode: 'TC', settleCents: 8990, shortCents: 0, excessCents: 0 });
  });

  it('below the due: settles what was captured and names the shortfall for the caller to park', () => {
    expect(planDoorSettlement(capture(8000), 8990)).toEqual({ kind: 'SHORT', transactionCode: 'TC', settleCents: 8000, shortCents: 990, excessCents: 0 });
  });

  it('above the due: settles the due and names the excess owed back on that capture', () => {
    expect(planDoorSettlement(capture(9500), 8990)).toEqual({ kind: 'EXCESS', transactionCode: 'TC', settleCents: 8990, shortCents: 0, excessCents: 510 });
  });

  it('a sale that owes nothing: the whole capture is excess', () => {
    expect(planDoorSettlement(capture(500), 0)).toEqual({ kind: 'EXCESS', transactionCode: 'TC', settleCents: 0, shortCents: 0, excessCents: 500 });
  });

  it('refuses a capture of no money and any amount that is not whole cents', () => {
    expect(() => planDoorSettlement(capture(0), 10)).toThrow(RangeError);
    expect(() => planDoorSettlement(capture(-1), 10)).toThrow(RangeError);
    expect(() => planDoorSettlement(capture(1.5), 10)).toThrow(RangeError);
  });

  it('refuses a due that is negative or not whole cents', () => {
    expect(() => planDoorSettlement(capture(10), -1)).toThrow(RangeError);
    expect(() => planDoorSettlement(capture(10), 2.5)).toThrow(RangeError);
    expect(() => planDoorSettlement(capture(10), Number.NaN)).toThrow(RangeError);
  });
});
