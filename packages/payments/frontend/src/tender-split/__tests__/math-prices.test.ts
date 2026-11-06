import { describe, expect, it } from 'vitest';

import { readTenderSplit, withPicked, withTyped, type TenderPick } from '../math';

/**
 * FUT-4416, R-WTR-2 — a tender may price the bill on its own (a discount per
 * way to pay), and a split is priced PRO RATA: a leg covering a fraction f of
 * the bill's full price pays f of that tender's price. A typed amount A in a
 * tender priced P covers A / P of the bill. The open leg covers the rest at
 * its own price. Without prices, nothing changes.
 *
 * The bill of the ticket's mesa: R$ 84,70 full; Dinheiro R$ 82,16, Crédito
 * R$ 84,70, Débito R$ 83,01, Pix R$ 75,20.
 */
type Tender = 'CASH' | 'CREDIT' | 'DEBIT' | 'PIX';

const TOTAL = 8470;
const PRICES: Record<Tender, number> = { CASH: 8216, CREDIT: 8470, DEBIT: 8301, PIX: 7520 };
const priceOf = (tender: Tender): number => PRICES[tender];
const givesChange = (tender: Tender): boolean => tender === 'CASH';

function tap(...tenders: Tender[]): TenderPick<Tender>[] {
  return tenders.reduce<TenderPick<Tender>[]>((picks, tender) => withPicked(picks, tender), []);
}

const read = (picks: readonly TenderPick<Tender>[], prices: ((t: Tender) => number) | undefined = priceOf) =>
  readTenderSplit(picks, TOTAL, givesChange, prices);

describe('one tender, priced', () => {
  it('carries the whole bill at its own price, and the leg is the open one', () => {
    const state = read(tap('PIX'));
    expect(state.outcome).toBe('READY');
    expect(state.amounts.get('PIX')).toBe(7520);
    expect(state.dueCents).toBe(7520);
    expect(state.answer).toEqual({ legs: [{ tender: 'PIX' }], changeCents: 0, dueCents: 7520 });
  });

  it('a tender priced at the full bill is the full bill', () => {
    expect(read(tap('CREDIT')).dueCents).toBe(8470);
  });
});

describe('a split, pro rata', () => {
  it('two tapped tenders cover half the bill each, each half at its own price', () => {
    const state = read(tap('PIX', 'CASH'));
    expect([...state.amounts.entries()]).toEqual([
      ['PIX', 3760],
      ['CASH', 4108],
    ]);
    expect(state.dueCents).toBe(7868);
    expect(state.answer?.legs).toEqual([{ tender: 'PIX', amountCents: 3760 }, { tender: 'CASH' }]);
  });

  it('a typed amount covers its share of the bill at its price, and the open leg covers the rest at its own', () => {
    // R$ 50,00 in Pix covers 50 / 75,20 of the bill; the cash pays the rest at the cash price.
    const picks = withTyped(tap('PIX', 'CASH'), 'PIX', '50');
    const state = read(picks);
    expect(state.outcome).toBe('READY');
    expect(state.amounts.get('PIX')).toBe(5000);
    expect(state.amounts.get('CASH')).toBe(2753);
    expect(state.dueCents).toBe(7753);
    expect(state.answer?.legs).toEqual([{ tender: 'PIX', amountCents: 5000 }, { tender: 'CASH' }]);
  });

  it('typed amounts that leave part of the bill say what is missing at the last tender\'s price', () => {
    const picks = withTyped(withTyped(tap('PIX', 'CREDIT'), 'PIX', '50'), 'CREDIT', '10');
    const state = read(picks);
    expect(state.outcome).toBe('SHORT');
    expect(state.restCents).toBe(1838);
    expect(state.answer).toBeNull();
  });

  it('cash typed above its price hands back change, measured at the cash price', () => {
    const state = read(withTyped(tap('CASH'), 'CASH', '100'));
    expect(state.outcome).toBe('READY');
    expect(state.changeCents).toBe(1784);
    expect(state.dueCents).toBe(8216);
    expect(state.answer).toEqual({ legs: [{ tender: 'CASH', amountCents: 8216 }], changeCents: 1784, dueCents: 8216 });
  });

  it('a non-cash tender typed above its price is refused, as today', () => {
    expect(read(withTyped(tap('PIX'), 'PIX', '80')).outcome).toBe('OVER');
  });
});

describe('prices the math cannot use', () => {
  it.each([0, -100, Number.NaN, 12.5, Number.POSITIVE_INFINITY])('ignores a price of %s: the tender pays the full bill', (bad) => {
    const state = read(tap('PIX'), () => bad);
    expect(state.amounts.get('PIX')).toBe(TOTAL);
    expect(state.dueCents).toBe(TOTAL);
  });
});

describe('without prices', () => {
  const cases: [string, TenderPick<Tender>[]][] = [
    ['one tap', tap('CASH')],
    ['three taps', tap('CASH', 'CREDIT', 'DEBIT')],
    ['a typed amount and a tap', withTyped(tap('CASH', 'CREDIT'), 'CASH', '20')],
    ['cash over with change', withTyped(tap('CASH'), 'CASH', '100')],
    ['short', withTyped(tap('CREDIT'), 'CREDIT', '10')],
  ];

  it.each(cases)('%s: no price, or every tender at the full bill, answers exactly as before', (_name, picks) => {
    const before = readTenderSplit(picks, TOTAL, givesChange);
    const flat = read(picks, () => TOTAL);
    expect([...flat.amounts.entries()]).toEqual([...before.amounts.entries()]);
    expect(flat.outcome).toBe(before.outcome);
    expect(flat.restCents).toBe(before.restCents);
    expect(flat.changeCents).toBe(before.changeCents);
    expect(flat.answer?.legs).toEqual(before.answer?.legs);
    // An answer with no prices keeps its old shape: no `dueCents` key.
    expect(before.answer === null || !('dueCents' in before.answer)).toBe(true);
    // With no price the bill is the bill, whatever the picks.
    expect(before.dueCents).toBe(TOTAL);
  });
});
