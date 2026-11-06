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

/**
 * Round 1 of review (FUT-4416): change is measured at the cash price, a typed
 * leg is never dropped, a non-cash tender never books above its own price,
 * and the screen's total is what the server derives from the legs it is sent.
 */
describe('a priced split over the bill', () => {
  it('refuses cash 10 then Pix 75,64: Pix alone passes its own price, so no change can explain it and no leg is dropped', () => {
    const picks = withTyped(withTyped(tap('CASH', 'PIX'), 'CASH', '10'), 'PIX', '75,64');
    const state = read(picks);
    expect(state.outcome).toBe('OVER');
    expect(state.answer).toBeNull();
    expect(state.changeCents).toBe(0);
  });

  it('cash typed first and over, a non-cash tender last: the change is the excess at the cash price, and both legs stay', () => {
    const picks = withTyped(withTyped(tap('CASH', 'PIX'), 'CASH', '20'), 'PIX', '70');
    const state = read(picks);
    expect(state.outcome).toBe('READY');
    expect(state.changeCents).toBe(1432);
    expect(state.answer?.legs).toEqual([{ tender: 'CASH', amountCents: 568 }, { tender: 'PIX', amountCents: 7000 }]);
    expect(state.dueCents).toBe(7568);
  });
});

/**
 * The server's rule (documented in `../math.ts`): every leg but the open one
 * covers `amountCents × total / price` of the bill, unrounded, and the open
 * leg pays the rest at its price, rounded once.
 */
function serverDue<T extends string>(legs: readonly { tender: T; amountCents?: number }[], total: number, price: (tender: T) => number): number {
  const fixed = legs.filter((leg) => leg.amountCents !== undefined);
  const open = legs.find((leg) => leg.amountCents === undefined);
  const covered = fixed.reduce((sum, leg) => sum + (leg.amountCents! * total) / price(leg.tender), 0);
  const openCents = open ? Math.round(((total - covered) * price(open.tender)) / total) : 0;
  return fixed.reduce((sum, leg) => sum + leg.amountCents!, 0) + openCents;
}

type Four = 'A' | 'B' | 'C' | 'D';

/** A seeded linear congruential sequence in [0, 1) — the drift probe's own. */
const lcgStep = (seed: number): number => (seed * 1103515245 + 12345) % 2147483648;

function* lcg(start: number): Generator<number> {
  for (let seed = lcgStep(start); ; seed = lcgStep(seed)) yield seed / 2147483648;
}

/**
 * `count` seeded random splits — up to four tenders priced 10% to 100% of a
 * bill, tapped in any order, the first sometimes typed — the reviewer's drift
 * probe, made deterministic. Its state lives in its own locals.
 */
function randomSplits(count: number): { index: number; total: number; prices: Record<Four, number>; picks: TenderPick<Four>[] }[] {
  const tenders: Four[] = ['A', 'B', 'C', 'D'];
  const random = lcg(7);
  const next = (): number => random.next().value as number;
  const splits = [];
  for (let index = 0; index < count; index += 1) {
    const total = 500 + Math.floor(next() * 50000);
    const prices = Object.fromEntries(tenders.map((t) => [t, Math.max(1, Math.round((total * (10000 - (next() < 0.3 ? 0 : Math.floor(next() * 9000)))) / 10000))])) as Record<Four, number>;
    const order = [...tenders].sort(() => next() - 0.5).slice(0, 1 + Math.floor(next() * 4));
    const tapped = order.reduce<TenderPick<Four>[]>((acc, t) => withPicked(acc, t), []);
    const typed = order.length > 1 && next() < 0.5 ? Math.floor(next() * prices[order[0]!] * 0.8) : null;
    const picks = typed === null ? tapped : withTyped(tapped, order[0]!, (typed / 100).toFixed(2).replace('.', ','));
    splits.push({ index, total, prices, picks });
  }
  return splits;
}

describe('the open leg takes the remainder, as the server derives it', () => {
  it('982 split between a tender at 245 and one at 982: the open leg pays 489, not an equal 491', () => {
    type Pair = 'A' | 'B';
    const prices: Record<Pair, number> = { A: 245, B: 982 };
    const picks = withPicked(withPicked<Pair>([], 'A'), 'B');
    const state = readTenderSplit(picks, 982, () => false, (tender) => prices[tender]);
    expect([...state.amounts.entries()]).toEqual([['A', 123], ['B', 489]]);
    expect(state.dueCents).toBe(612);
    expect(state.answer?.legs).toEqual([{ tender: 'A', amountCents: 123 }, { tender: 'B' }]);
    expect(serverDue(state.answer!.legs, 982, (tender) => prices[tender])).toBe(612);
  });

  it('for any priced split it accepts, its total equals the server\'s, and the cards add up to it', () => {
    const accepted = randomSplits(20000)
      .map((split) => ({ split, state: readTenderSplit(split.picks, split.total, (t) => t === 'A', (t) => split.prices[t]) }))
      .filter(({ state }) => state.outcome === 'READY' && state.answer !== null);
    expect(accepted.length).toBeGreaterThan(10000);
    for (const { split, state } of accepted) {
      const cards = [...state.amounts.values()].reduce((sum, cents) => sum + cents, 0) - state.changeCents;
      expect({ split: split.index, cards }).toEqual({ split: split.index, cards: state.dueCents });
      expect({ split: split.index, server: serverDue(state.answer!.legs, split.total, (t) => split.prices[t]) }).toEqual({ split: split.index, server: state.dueCents });
    }
  });
});

describe('a bill of zero', () => {
  it('is unpriced: no NaN anywhere, and the last tender answers for nothing', () => {
    const state = read(tap('PIX', 'CASH'), priceOf);
    const zero = readTenderSplit(tap('PIX', 'CASH'), 0, givesChange, priceOf);
    expect(state.dueCents).not.toBeNaN();
    expect([...zero.amounts.values()]).toEqual([0, 0]);
    expect(zero.dueCents).toBe(0);
    expect(zero.restCents).toBe(0);
    expect(zero.answer).toEqual({ legs: [{ tender: 'CASH' }], changeCents: 0 });
  });
});
