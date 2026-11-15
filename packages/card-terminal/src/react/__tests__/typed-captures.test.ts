import { describe, expect, it, vi } from 'vitest';

import type { TypedBookAnswer } from '../../server';

import type { CaptureWire } from '../port';
import { createTypedCaptureInbox, matchTypedCapture, type DueSale, type TypedCaptureInboxConfig } from '../typed-captures';
import { settle, trace } from './fake-port';

/**
 * FUT-4997 contract rows D9-R01 to D9-R17, R23 and R37 (package half): a typed
 * capture matched to the sales it may belong to, booked on its own otherwise,
 * and acknowledged to the terminal only once the server accounted for it.
 */

const DEVICE = 'dev-1';
const BOOKED: TypedBookAnswer = { outcome: 'BOOKED', orderId: 'order-1', paymentId: 'payment-1', created: true, ack: true };

interface Setup {
  dueSales?: DueSale[];
  answers?: Array<TypedBookAnswer | Error>;
  standaloneAllowed?: boolean;
  /** Leave the optional notice out, as a host may. */
  noOnAnswer?: boolean;
  /** The next acknowledgements' outcomes: an Error throws; past the list every one is taken. */
  acks?: Array<true | Error>;
}

function inbox(setup: Setup = {}) {
  const answers = [...(setup.answers ?? [])];
  const book = vi.fn<(deviceId: string, capture: CaptureWire) => Promise<TypedBookAnswer>>(async () => {
    const next = answers.shift() ?? BOOKED;
    if (next instanceof Error) throw next;
    return next;
  });
  const acks = [...(setup.acks ?? [])];
  const ack = vi.fn<(deviceId: string, codes: readonly string[]) => boolean>(() => {
    const next = acks.shift() ?? true;
    if (next instanceof Error) throw next;
    return next;
  });
  const onAnswer = vi.fn();
  const due = [...(setup.dueSales ?? [])];
  const policy = [setup.standaloneAllowed ?? true];
  const config: TypedCaptureInboxConfig = {
    book,
    ack,
    ...(setup.noOnAnswer === true ? {} : { onAnswer }),
    dueSales: () => due,
    ...(setup.standaloneAllowed === undefined ? {} : { standaloneAllowed: () => policy[0] === true }),
  };
  return {
    box: createTypedCaptureInbox(config),
    book,
    ack,
    onAnswer,
    /** The sales due change (one was paid, another rung up). */
    setDue: (sales: DueSale[]) => void due.splice(0, due.length, ...sales),
    /** The host's policy changes (the owner picked a product). */
    allow: (allowed: boolean) => void policy.splice(0, 1, allowed),
  };
}

const typed = (amountCents: number, code = `TC-${amountCents}`) => ({ deviceId: DEVICE, captures: [trace(amountCents, 'CREDIT', code)] });
const stateOf = (box: ReturnType<typeof inbox>['box'], code: string) => box.entries().find((entry) => entry.capture.transactionCode === code);

describe('matchTypedCapture', () => {
  const sales = [
    { key: 'sale-1', dueCents: 4600 },
    { key: 'order-1043', dueCents: 4600 },
    { key: 'sale-2', dueCents: 7800 },
    { key: 'paid', dueCents: 0 },
  ];

  it('D9-R01/R02: answers every sale whose amount still due equals the capture, in the order given', () => {
    expect(matchTypedCapture({ amountCents: 4600 }, sales).map((sale) => sale.key)).toEqual(['sale-1', 'order-1043']);
    expect(matchTypedCapture({ amountCents: 7800 }, sales).map((sale) => sale.key)).toEqual(['sale-2']);
  });

  it('D9-R03: a sale with nothing due, or a capture of no amount, never matches', () => {
    expect(matchTypedCapture({ amountCents: 0 }, sales)).toEqual([]);
    expect(matchTypedCapture({ amountCents: 2500 }, sales)).toEqual([]);
  });
});

describe('the band (State 1)', () => {
  it('D9-R01/R04: a matching capture asks, with its matches, and the server is never called by itself', async () => {
    const { box, book, ack } = inbox({ dueSales: [{ key: 'sale-1', dueCents: 4600 }] });
    box.received(typed(4600));
    await settle();

    expect(stateOf(box, 'TC-4600')).toMatchObject({ state: 'asking', standalone: true, matches: [{ key: 'sale-1' }] });
    expect(book).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
  });

  it('D9-R05/R06: one tap holds it for that sale, and the acknowledgement waits for the sale to settle', async () => {
    const { box, ack } = inbox({ dueSales: [{ key: 'sale-1', dueCents: 4600 }] });
    box.received(typed(4600));

    expect(box.chooseSale('TC-4600', 'sale-1')).toMatchObject({ transactionCode: 'TC-4600', amountCents: 4600, deviceId: DEVICE });
    expect(stateOf(box, 'TC-4600')).toMatchObject({ state: 'held', saleKey: 'sale-1' });
    expect(ack).not.toHaveBeenCalled();

    box.bound(['TC-4600']);
    box.bound(['TC-4600']);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith(DEVICE, ['TC-4600']);
    expect(stateOf(box, 'TC-4600')?.state).toBe('done');
  });

  it('D9-R05: a capture not on the band cannot be tapped onto a sale', () => {
    const { box } = inbox();
    expect(box.chooseSale('TC-NONE', 'sale-1')).toBeNull();
  });

  it('D9-R08: what still waits for a person is listed for the end of the shift', async () => {
    const { box } = inbox({ dueSales: [{ key: 'sale-1', dueCents: 4600 }] });
    box.received(typed(4600, 'TC-A'));
    box.received(typed(4600, 'TC-B'));
    box.chooseSale('TC-A', 'sale-1');

    expect(box.unanswered().map((entry) => [entry.capture.transactionCode, entry.state])).toEqual([
      ['TC-A', 'held'],
      ['TC-B', 'asking'],
    ]);
  });

  it('D9-R10: "none of these" books it on its own', async () => {
    const { box, book, ack } = inbox({ dueSales: [{ key: 'sale-1', dueCents: 4600 }] });
    box.received(typed(4600));
    expect(box.chooseStandalone('TC-4600')).toBe(true);
    await settle();

    expect(book).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith(DEVICE, ['TC-4600']);
    expect(stateOf(box, 'TC-4600')?.state).toBe('done');
  });
});

describe('booking on its own (State 2)', () => {
  it('D9-R09: no match books at once, acknowledges after the answer and tells the host', async () => {
    const { box, book, ack, onAnswer } = inbox();
    box.received(typed(2500));
    expect(ack).not.toHaveBeenCalled();
    await settle();

    expect(book).toHaveBeenCalledWith(DEVICE, expect.objectContaining({ transactionCode: 'TC-2500', amountCents: 2500 }));
    expect(ack).toHaveBeenCalledWith(DEVICE, ['TC-2500']);
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ state: 'done', answer: BOOKED }));
  });

  it('D9-R14: a capture another sale holds is acknowledged, and nothing is booked', async () => {
    const { box, ack } = inbox({ answers: [{ outcome: 'BOUND', orderId: 'order-9', ack: true }] });
    box.received(typed(2500));
    await settle();

    expect(ack).toHaveBeenCalledWith(DEVICE, ['TC-2500']);
    expect(stateOf(box, 'TC-2500')?.answer).toMatchObject({ outcome: 'BOUND' });
  });

  it('D9-R11: no open session waits, unacknowledged, and books once on retry', async () => {
    const { box, book, ack } = inbox({ answers: [{ outcome: 'WAITING', ack: false }] });
    box.received(typed(2500));
    await settle();
    expect(stateOf(box, 'TC-2500')).toMatchObject({ state: 'waiting', waitingFor: 'session' });
    expect(ack).not.toHaveBeenCalled();

    box.retry();
    await settle();
    box.retry();
    await settle();
    expect(book).toHaveBeenCalledTimes(2);
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('D9-R37: the server out of reach: nothing acknowledged; booked once when the link is back', async () => {
    const { box, book, ack } = inbox({ answers: [new Error('offline')] });
    box.received(typed(2500));
    await settle();
    expect(stateOf(box, 'TC-2500')).toMatchObject({ state: 'waiting', waitingFor: 'link' });
    expect(ack).not.toHaveBeenCalled();

    box.retry();
    await settle();
    expect(book).toHaveBeenCalledTimes(2);
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('D9-R16: a refusal for a person is never acknowledged, and is asked again only on retry (once it is resolved)', async () => {
    const { box, book, ack } = inbox({ answers: [{ outcome: 'REFUSED', code: 'CONFLICT', ack: false }, { outcome: 'REFUSED', code: 'CONFLICT', ack: false }] });
    box.received(typed(2500));
    await settle();
    expect(stateOf(box, 'TC-2500')).toMatchObject({ state: 'waiting', waitingFor: 'refused' });
    expect(book).toHaveBeenCalledTimes(1);

    box.retry();
    await settle();
    expect(book).toHaveBeenCalledTimes(2);
    expect(ack).not.toHaveBeenCalled();

    box.retry();
    await settle();
    expect(book).toHaveBeenCalledTimes(3);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(stateOf(box, 'TC-2500')?.state).toBe('done');
  });

  it('D9-R16: a contended booking waits for a retry', async () => {
    const { box, book } = inbox({ answers: [{ outcome: 'REFUSED', code: 'CONTENDED', ack: false }] });
    box.received(typed(2500));
    await settle();
    expect(stateOf(box, 'TC-2500')?.waitingFor).toBe('retry');
    box.retry();
    await settle();
    expect(book).toHaveBeenCalledTimes(2);
  });

  it('D9-R23: the policy refuses: the capture goes to the band, with no "on its own"', async () => {
    const { box, ack } = inbox({ answers: [{ outcome: 'NOT_ALLOWED', reason: 'PRODUCT_INVALID', ack: false }] });
    box.received(typed(2500));
    await settle();

    expect(stateOf(box, 'TC-2500')).toMatchObject({ state: 'asking', standalone: false });
    expect(box.chooseStandalone('TC-2500')).toBe(false);
    expect(ack).not.toHaveBeenCalled();
  });

  it('D9-R23: a screen that knows booking is off asks on the band, and never calls the server', async () => {
    const { box, book } = inbox({ standaloneAllowed: false });
    box.received(typed(2500));
    await settle();

    expect(stateOf(box, 'TC-2500')).toMatchObject({ state: 'asking', standalone: false, matches: [] });
    expect(book).not.toHaveBeenCalled();
  });
});

describe('resends (A3)', () => {
  it('D9-R17: a resend while booking is not booked twice', async () => {
    const { box, book } = inbox();
    box.received(typed(2500));
    box.received(typed(2500));
    await settle();
    expect(book).toHaveBeenCalledTimes(1);
  });

  it('D9-R17: a resend of a capture already accounted for is acknowledged again, without booking', async () => {
    const { box, book, ack } = inbox();
    box.received(typed(2500));
    await settle();
    box.received(typed(2500));
    await settle();

    expect(book).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledTimes(2);
  });

  it('D9-R17: a resend of a capture on the band changes nothing', async () => {
    const { box, book, ack } = inbox({ dueSales: [{ key: 'sale-1', dueCents: 4600 }] });
    box.received(typed(4600));
    box.received(typed(4600));
    await settle();

    expect(box.entries()).toHaveLength(1);
    expect(book).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
  });
});

describe('review round 1', () => {
  it('B1: with no onAnswer, WAITING still waits, retry books it, and a resend is acknowledged again', async () => {
    const { box, book, ack } = inbox({ noOnAnswer: true, answers: [{ outcome: 'WAITING', ack: false }] });
    box.received(typed(2500));
    await settle();
    expect(stateOf(box, 'TC-2500')).toMatchObject({ state: 'waiting', waitingFor: 'session' });

    box.retry();
    await settle();
    expect(stateOf(box, 'TC-2500')).toMatchObject({ state: 'done', answer: BOOKED });
    expect(ack).toHaveBeenCalledTimes(1);

    box.received(typed(2500));
    await settle();
    expect(book).toHaveBeenCalledTimes(2);
    expect(ack).toHaveBeenCalledTimes(2);
  });

  it('B1: with no onAnswer, NOT_ALLOWED puts the capture on the band', async () => {
    const { box } = inbox({ noOnAnswer: true, answers: [{ outcome: 'NOT_ALLOWED', reason: 'OFF', ack: false }] });
    box.received(typed(2500));
    await settle();
    expect(stateOf(box, 'TC-2500')).toMatchObject({ state: 'asking', standalone: false });
  });

  it('N3: the matches are the sales due now, and a sale no longer due (or never matched) cannot be chosen', async () => {
    const { box, setDue } = inbox({ dueSales: [{ key: 'sale-1', dueCents: 4600 }] });
    box.received(typed(4600));
    expect(box.chooseSale('TC-4600', 'anything-at-all')).toBeNull();

    setDue([{ key: 'sale-2', dueCents: 4600 }]);
    expect(stateOf(box, 'TC-4600')?.matches.map((sale) => sale.key)).toEqual(['sale-2']);
    expect(box.chooseSale('TC-4600', 'sale-1')).toBeNull();
    expect(box.chooseSale('TC-4600', 'sale-2')).not.toBeNull();
  });

  it('N5: a capture the policy kept off is booked on retry once the policy allows and nothing matches', async () => {
    const { box, book, ack, allow } = inbox({ standaloneAllowed: false });
    box.received(typed(2500));
    box.retry();
    await settle();
    expect(book).not.toHaveBeenCalled();

    allow(true);
    box.retry();
    await settle();
    expect(book).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith(DEVICE, ['TC-2500']);
  });

  it('N5: a NOT_ALLOWED capture that matches a sale is offered "on its own" again on retry, never booked by itself', async () => {
    const { box, book } = inbox({ dueSales: [{ key: 'sale-1', dueCents: 4600 }], answers: [{ outcome: 'NOT_ALLOWED', reason: 'OFF', ack: false }] });
    box.received(typed(4600));
    box.chooseStandalone('TC-4600');
    await settle();
    expect(stateOf(box, 'TC-4600')).toMatchObject({ state: 'asking', standalone: false });

    box.retry();
    await settle();
    expect(stateOf(box, 'TC-4600')).toMatchObject({ state: 'asking', standalone: true });
    expect(book).toHaveBeenCalledTimes(1);
  });

  it('N6: an acknowledgement that throws leaves the capture to tell again; retry tells it', async () => {
    const { box, ack } = inbox({ acks: [new Error('link closed')] });
    box.received(typed(2500));
    await settle();
    expect(stateOf(box, 'TC-2500')).toMatchObject({ state: 'waiting', waitingFor: 'link' });

    box.retry();
    await settle();
    expect(stateOf(box, 'TC-2500')?.state).toBe('done');
    expect(ack).toHaveBeenCalledTimes(2);
  });

  it('N6: a settled sale whose acknowledgement throws stays held until a retry tells it', async () => {
    const { box, ack } = inbox({ dueSales: [{ key: 'sale-1', dueCents: 4600 }], acks: [new Error('link closed')] });
    box.received(typed(4600));
    box.chooseSale('TC-4600', 'sale-1');
    box.bound(['TC-4600']);
    await settle();
    expect(stateOf(box, 'TC-4600')).toMatchObject({ state: 'held', waitingFor: 'link' });

    box.retry();
    await settle();
    expect(stateOf(box, 'TC-4600')?.state).toBe('done');
    expect(ack).toHaveBeenCalledTimes(2);
  });
});
