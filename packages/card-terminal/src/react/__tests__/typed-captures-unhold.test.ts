import { describe, expect, it, vi } from 'vitest';

import type { TypedBookAnswer } from '../../server';

import type { CaptureWire } from '../port';
import { createTypedCaptureInbox, type DueSale } from '../typed-captures';
import { settle, trace } from './fake-port';

/**
 * FUT-4997 contract row D9-R43 (P-TYPED R43), owner Decision 21: the sale a
 * typed capture was tapped onto left without it (paid another way, cancelled,
 * discarded). `unhold` puts it back on the band to be asked again, never tells
 * the terminal, never books it by itself, and loses to a bind.
 */

const DEVICE = 'dev-1';
const BOOKED: TypedBookAnswer = { outcome: 'BOOKED', orderId: 'order-1', paymentId: 'payment-1', created: true, ack: true };

interface Setup {
  dueSales: DueSale[];
  acks?: Array<true | Error>;
  standaloneAllowed?: boolean;
}

function inbox(setup: Setup) {
  const due = [...setup.dueSales];
  const pending = [...(setup.acks ?? [])];
  const policy = [setup.standaloneAllowed ?? true];
  const book = vi.fn<(deviceId: string, capture: CaptureWire) => Promise<TypedBookAnswer>>(async () => BOOKED);
  const ack = vi.fn<(deviceId: string, codes: readonly string[]) => boolean>(() => {
    const next = pending.shift() ?? true;
    if (next instanceof Error) throw next;
    return next;
  });
  const created = createTypedCaptureInbox({ book, ack, dueSales: () => due, standaloneAllowed: () => policy[0] === true });
  const listener = vi.fn();
  created.subscribe(listener);
  return {
    box: created,
    book,
    ack,
    listener,
    setDue: (sales: DueSale[]) => void due.splice(0, due.length, ...sales),
    allow: (allowed: boolean) => void policy.splice(0, 1, allowed),
    stateOf: (code: string) => created.entries().find((entry) => entry.capture.transactionCode === code),
  };
}

const typed = (amountCents: number, code = `TC-${amountCents}`) => ({ deviceId: DEVICE, captures: [trace(amountCents, 'CREDIT', code)] });

/** A capture of 46,00 tapped onto #1043, with sale-2 also due the same amount. */
function heldOn1043(setup: Partial<Setup> = {}) {
  const made = inbox({
    dueSales: [
      { key: '#1043', dueCents: 4600 },
      { key: 'sale-2', dueCents: 4600 },
    ],
    ...setup,
  });
  made.box.received(typed(4600));
  made.box.chooseSale('TC-4600', '#1043');
  made.listener.mockClear();
  return made;
}

describe('D9-R43: typed capture inbox unhold', () => {
  it('puts a held capture back to asking, naming the sale it left and how', () => {
    const world = heldOn1043();
    world.setDue([{ key: 'sale-2', dueCents: 4600 }]);

    world.box.unhold(['TC-4600'], 'paid-elsewhere');

    expect(world.stateOf('TC-4600')).toMatchObject({
      state: 'asking',
      saleKey: null,
      waitingFor: null,
      unheldFrom: { saleKey: '#1043', reason: 'paid-elsewhere' },
    });
    expect(world.box.unanswered().map((entry) => entry.state)).toEqual(['asking']);
  });

  it('recomputes the matches against the sales due now', () => {
    const world = heldOn1043();
    world.setDue([
      { key: 'sale-2', dueCents: 4600 },
      { key: 'sale-3', dueCents: 9900 },
    ]);

    world.box.unhold(['TC-4600'], 'cancelled');

    const stored = world.box.unanswered()[0];
    expect(stored?.matches.map((sale) => sale.key)).toEqual(['sale-2']);
    expect(world.stateOf('TC-4600')?.matches.map((sale) => sale.key)).toEqual(['sale-2']);
    expect(world.box.chooseSale('TC-4600', '#1043')).toBeNull();
    expect(world.box.chooseSale('TC-4600', 'sale-2')).not.toBeNull();
  });

  it('never books an unheld capture by itself, even when nothing matches (R09 does not apply)', async () => {
    const world = heldOn1043();
    world.setDue([]);

    world.box.unhold(['TC-4600'], 'cancelled');
    world.box.retry();
    world.box.received(typed(4600));
    await settle();

    expect(world.book).not.toHaveBeenCalled();
    expect(world.stateOf('TC-4600')).toMatchObject({ state: 'asking', matches: [], standalone: true });
  });

  it('never books it by itself once the policy that kept it off "on its own" allows it', async () => {
    const world = heldOn1043({ standaloneAllowed: false });
    world.setDue([]);
    world.box.unhold(['TC-4600']);
    expect(world.stateOf('TC-4600')).toMatchObject({ state: 'asking', standalone: false, unheldFrom: { saleKey: '#1043', reason: null } });

    world.allow(true);
    world.box.retry();
    await settle();

    expect(world.book).not.toHaveBeenCalled();
    expect(world.stateOf('TC-4600')).toMatchObject({ state: 'asking', standalone: true });

    expect(world.box.chooseStandalone('TC-4600')).toBe(true);
    await settle();
    expect(world.book).toHaveBeenCalledTimes(1);
  });

  it('never acknowledges the terminal', async () => {
    const world = heldOn1043();
    world.box.unhold(['TC-4600'], 'paid-elsewhere');
    await settle();

    expect(world.ack).not.toHaveBeenCalled();
  });

  it('leaves alone a capture already settled and waiting only for the acknowledgement', async () => {
    const world = heldOn1043({ acks: [new Error('link closed')] });
    world.box.bound(['TC-4600']);
    await settle();
    expect(world.stateOf('TC-4600')).toMatchObject({ state: 'held', waitingFor: 'link' });
    world.listener.mockClear();

    world.box.unhold(['TC-4600'], 'paid-elsewhere');

    expect(world.stateOf('TC-4600')).toMatchObject({ state: 'held', waitingFor: 'link', saleKey: '#1043', unheldFrom: null });
    expect(world.listener).not.toHaveBeenCalled();
  });

  it('a second call, or an unknown code, changes nothing and tells no one', () => {
    const world = heldOn1043();
    world.box.unhold(['TC-4600'], 'cancelled');
    const after = world.stateOf('TC-4600');
    world.listener.mockClear();

    world.box.unhold(['TC-4600'], 'paid-elsewhere');
    world.box.unhold(['TC-UNKNOWN']);

    expect(world.stateOf('TC-4600')).toEqual(after);
    expect(world.box.entries()).toHaveLength(1);
    expect(world.listener).not.toHaveBeenCalled();
  });

  it('a bind in flight wins: a bound after the unhold settles it under its sale and tells the terminal once', async () => {
    const world = heldOn1043();
    world.box.unhold(['TC-4600'], 'paid-elsewhere');

    world.box.bound(['TC-4600']);
    await settle();

    expect(world.stateOf('TC-4600')).toMatchObject({ state: 'done', saleKey: '#1043', unheldFrom: null });
    expect(world.ack).toHaveBeenCalledTimes(1);
    expect(world.box.unanswered()).toEqual([]);
  });

  it('a bind already done wins: an unhold after it changes nothing', async () => {
    const world = heldOn1043();
    world.box.bound(['TC-4600']);
    await settle();

    world.box.unhold(['TC-4600'], 'paid-elsewhere');

    expect(world.stateOf('TC-4600')).toMatchObject({ state: 'done', saleKey: '#1043' });
    expect(world.ack).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers once per capture it puts back, each code once', () => {
    const world = heldOn1043();
    world.box.received(typed(4600, 'TC-OTHER'));
    world.box.chooseSale('TC-OTHER', 'sale-2');
    world.listener.mockClear();

    world.box.unhold(['TC-4600', 'TC-OTHER', 'TC-4600'], 'cancelled');

    expect(world.listener).toHaveBeenCalledTimes(2);
  });
});
