import { describe, expect, it } from 'vitest';

import {
  parseAmount,
  readTenderSplit,
  shareEqually,
  withPicked,
  withTyped,
  withoutPicked,
  type TenderPick,
} from '../math';

/**
 * The rule `TenderSplit` renders: tapped tenders share the bill equally, a
 * typed amount stays put until its tender is removed, and the last automatic
 * leg is sent as "the rest".
 */
type Tender = 'CASH' | 'CREDIT' | 'DEBIT' | 'PIX';
const TOTAL = 44440;
const cashGivesChange = (tender: Tender): boolean => tender === 'CASH';

function tap(...tenders: Tender[]): TenderPick<Tender>[] {
  return tenders.reduce<TenderPick<Tender>[]>((picks, tender) => withPicked(picks, tender), []);
}

function read(picks: TenderPick<Tender>[], total = TOTAL) {
  return readTenderSplit(picks, total, cashGivesChange);
}

describe('parseAmount', () => {
  it.each([
    ['50', 5000],
    ['50,5', 5050],
    ['50,50', 5050],
    ['50.50', 5050],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['1.234', 123400],
    ['R$ 12,00', 1200],
    ['0', 0],
    ['', 0],
    ['   ', 0],
  ])('reads %j as %i cents', (typed, cents) => {
    expect(parseAmount(typed)).toBe(cents);
  });

  it.each(['abc', '-5', '12a', 'R$'])('refuses %j', (typed) => {
    expect(parseAmount(typed)).toBeNull();
  });
});

describe('shareEqually', () => {
  it('gives the leftover cents to the last share', () => {
    expect(shareEqually(44440, 3)).toEqual([14813, 14813, 14814]);
  });

  it('never shares a negative pool', () => {
    expect(shareEqually(-100, 2)).toEqual([0, 0]);
  });
});

describe('readTenderSplit — tapping', () => {
  it('waits for a first tender', () => {
    expect(read([])).toMatchObject({ outcome: 'EMPTY', answer: null, launchedCents: 0 });
  });

  it('gives the one tapped tender the whole bill, sent as the rest', () => {
    const state = read(tap('CASH'));
    expect(state.amounts.get('CASH')).toBe(TOTAL);
    expect(state.answer).toEqual({ legs: [{ tender: 'CASH' }], changeCents: 0 });
  });

  it('splits 50/50 on a second tap', () => {
    const state = read(tap('CASH', 'CREDIT'));
    expect([...state.amounts.values()]).toEqual([22220, 22220]);
    expect(state.answer?.legs).toEqual([
      { tender: 'CASH', amountCents: 22220 },
      { tender: 'CREDIT' },
    ]);
  });

  it('splits in three, the leftover cent on the last tapped', () => {
    const state = read(tap('CASH', 'CREDIT', 'DEBIT'));
    expect([...state.amounts.values()]).toEqual([14813, 14813, 14814]);
    expect(state.outcome).toBe('READY');
  });

  it('re-divides among the others when one is removed', () => {
    const state = read(withoutPicked(tap('CASH', 'CREDIT', 'DEBIT'), 'CREDIT'));
    expect([...state.amounts.entries()]).toEqual([
      ['CASH', 22220],
      ['DEBIT', 22220],
    ]);
  });

  it('keeps a tender tapped twice as one pick', () => {
    expect(tap('CASH', 'CASH')).toHaveLength(1);
  });
});

describe('readTenderSplit — typing', () => {
  it('fixes a typed amount and shares what it leaves', () => {
    const picks = withTyped(tap('CASH', 'CREDIT', 'DEBIT'), 'CASH', '200');
    const state = read(picks);
    expect([...state.amounts.values()]).toEqual([20000, 12220, 12220]);
    expect(state.answer?.legs).toEqual([
      { tender: 'CASH', amountCents: 20000 },
      { tender: 'CREDIT', amountCents: 12220 },
      { tender: 'DEBIT' },
    ]);
  });

  it('keeps the typed amount when another tender is tapped after it', () => {
    const picks = withPicked(withTyped(tap('CASH', 'CREDIT'), 'CASH', '200'), 'DEBIT');
    expect(read(picks).amounts.get('CASH')).toBe(20000);
  });

  it('keeps an emptied field fixed at zero instead of sharing again', () => {
    const picks = withTyped(tap('CASH', 'CREDIT'), 'CASH', '');
    const state = read(picks);
    expect(state.amounts.get('CASH')).toBe(0);
    expect(state.amounts.get('CREDIT')).toBe(TOTAL);
    expect(state.answer?.legs).toEqual([{ tender: 'CREDIT' }]);
  });

  it('lets a typed amount go only when its tender is removed', () => {
    const typed = withTyped(tap('CASH', 'CREDIT'), 'CASH', '200');
    const again = withPicked(withoutPicked(typed, 'CASH'), 'CASH');
    expect(read(again).amounts.get('CASH')).toBe(22220);
  });

  it('names every amount when all were typed, adding up exactly', () => {
    const picks = withTyped(withTyped(tap('CASH', 'CREDIT'), 'CASH', '400'), 'CREDIT', '44,40');
    expect(read(picks).answer?.legs).toEqual([
      { tender: 'CASH', amountCents: 40000 },
      { tender: 'CREDIT', amountCents: 4440 },
    ]);
  });

  it('says how much is missing while the typed amounts fall short', () => {
    const picks = withTyped(tap('PIX'), 'PIX', '100');
    expect(read(picks)).toMatchObject({ outcome: 'SHORT', restCents: 34440, answer: null });
  });

  it('refuses text that is not an amount', () => {
    const picks = withTyped(tap('PIX', 'CASH'), 'PIX', 'abc');
    expect(read(picks)).toMatchObject({ outcome: 'INVALID', answer: null });
  });
});

describe('readTenderSplit — change', () => {
  it('hands back what cash received above the bill', () => {
    const picks = withTyped(tap('CASH'), 'CASH', '500');
    const state = read(picks);
    expect(state.changeCents).toBe(5560);
    expect(state.answer).toEqual({
      legs: [{ tender: 'CASH', amountCents: TOTAL }],
      changeCents: 5560,
    });
  });

  it('takes the change off cash when another tender carries a part', () => {
    const picks = withTyped(withTyped(tap('CREDIT', 'CASH'), 'CREDIT', '200'), 'CASH', '300');
    expect(read(picks).answer).toEqual({
      legs: [
        { tender: 'CREDIT', amountCents: 20000 },
        { tender: 'CASH', amountCents: 24440 },
      ],
      changeCents: 5560,
    });
  });

  it('refuses a card typed above the bill — a card gives no change', () => {
    const picks = withTyped(tap('CREDIT'), 'CREDIT', '500');
    expect(read(picks)).toMatchObject({ outcome: 'OVER', restCents: -5560, answer: null });
  });

  it('drops an automatic tender left with nothing to carry', () => {
    const picks = withTyped(tap('CASH', 'PIX'), 'CASH', '500');
    expect(read(picks).answer?.legs).toEqual([{ tender: 'CASH', amountCents: TOTAL }]);
  });
});
