import { describe, expect, it } from 'vitest';

import { planDoorSettlement } from '../door-settlement';

/** One capture at the door, with no till (FUT-3764): exact, short, or above the due. */
describe('planDoorSettlement', () => {
  const capture = (amountCents: number) => ({ transactionCode: 'TC', amountCents });

  it('settles the due when the capture is the due', () => {
    expect(planDoorSettlement(capture(8990), 8990)).toEqual({ kind: 'EXACT', settleCents: 8990 });
  });

  it('below the due: settles what was captured and names the shortfall for the caller to park', () => {
    expect(planDoorSettlement(capture(8000), 8990)).toEqual({ kind: 'SHORT', settleCents: 8000, shortCents: 990 });
  });

  it('above the due: settles the due and names the excess owed back on that capture', () => {
    expect(planDoorSettlement(capture(9500), 8990)).toEqual({ kind: 'EXCESS', settleCents: 8990, excess: { transactionCode: 'TC', excessCents: 510 } });
  });

  it('refuses an amount that is not whole non-negative cents', () => {
    expect(() => planDoorSettlement(capture(-1), 10)).toThrow(RangeError);
    expect(() => planDoorSettlement(capture(1.5), 10)).toThrow(RangeError);
  });
});
