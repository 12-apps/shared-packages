import { describe, expect, it, vi } from 'vitest';

import type { TypedBookAnswer } from '../../server';

import type { CaptureWire } from '../port';
import { createTypedCaptureInbox, type DueSale } from '../typed-captures';
import { settle, trace } from './fake-port';

/**
 * FUT-4997 contract row D9-R22 as corrected by Gate 2 round 4 (P-TYPED R22): a
 * capture the refund sweep flagged `UNBOUND_TIMEOUT` ("A estornar") may already
 * have been refunded on the terminal. The server answers `FLAGGED_TIMEOUT`
 * until a person confirms that very flag, and the inbox never confirms it on
 * an arrival or a retry: only `chooseStandalone` does.
 */

const DEVICE = 'dev-1';
const FLAGGED_AT = '2026-11-14T12:00:00.000Z';
const FLAGGED: TypedBookAnswer = { outcome: 'FLAGGED_TIMEOUT', flaggedAt: FLAGGED_AT, ack: false };
const BOOKED: TypedBookAnswer = { outcome: 'BOOKED', orderId: 'order-1', paymentId: 'payment-1', created: true, ack: true };

/** A server that books the flagged capture only when the flag is confirmed, as `timeoutHold` decides. */
function inbox(dueSales: DueSale[] = []) {
  const due = [...dueSales];
  const answers: TypedBookAnswer[] = [];
  const book = vi.fn<(deviceId: string, capture: CaptureWire, confirmedFlaggedAt: string | null) => Promise<TypedBookAnswer>>(async (_device, _capture, confirmed) =>
    answers.shift() ?? (confirmed === FLAGGED_AT ? BOOKED : FLAGGED),
  );
  const ack = vi.fn<(deviceId: string, codes: readonly string[]) => boolean>(() => true);
  const created = createTypedCaptureInbox({ book, ack, dueSales: () => due });
  return {
    box: created,
    book,
    ack,
    /** The server's next answers, before the flag rule. */
    answerNext: (...next: TypedBookAnswer[]) => void answers.push(...next),
    stateOf: (code: string) => created.entries().find((entry) => entry.capture.transactionCode === code),
  };
}

const typed = (amountCents: number, code = `TC-${amountCents}`) => ({ deviceId: DEVICE, captures: [trace(amountCents, 'CREDIT', code)] });

describe('P-TYPED R22: a capture flagged for the timeout is booked only on a person answer', () => {
  it('received does not book it: it waits on the band with the flag date, unacknowledged', async () => {
    const made = inbox();
    made.box.received(typed(4600));
    await settle();

    expect(made.book).toHaveBeenCalledTimes(1);
    expect(made.book).toHaveBeenLastCalledWith(DEVICE, expect.objectContaining({ transactionCode: 'TC-4600' }), null);
    expect(made.stateOf('TC-4600')).toMatchObject({ state: 'asking', standalone: true, flaggedAt: FLAGGED_AT, waitingFor: null });
    expect(made.ack).not.toHaveBeenCalled();
    expect(made.box.unanswered()).toHaveLength(1);
  });

  it('a resend of it does not book it either', async () => {
    const made = inbox();
    made.box.received(typed(4600));
    await settle();
    made.box.received(typed(4600));
    await settle();

    expect(made.book).toHaveBeenCalledTimes(1);
    expect(made.stateOf('TC-4600')?.state).toBe('asking');
  });

  it('retry does not book it', async () => {
    const made = inbox();
    made.box.received(typed(4600));
    await settle();

    made.box.retry();
    made.box.retry();
    await settle();

    expect(made.book).toHaveBeenCalledTimes(1);
    expect(made.stateOf('TC-4600')).toMatchObject({ state: 'asking', flaggedAt: FLAGGED_AT });
  });

  it('a capture that waited for a session and was flagged meanwhile is not booked by the retry', async () => {
    const made = inbox();
    made.answerNext({ outcome: 'WAITING', ack: false });
    made.box.received(typed(4600));
    await settle();
    expect(made.stateOf('TC-4600')).toMatchObject({ state: 'waiting', waitingFor: 'session' });

    made.box.retry();
    await settle();

    expect(made.book).toHaveBeenLastCalledWith(DEVICE, expect.anything(), null);
    expect(made.stateOf('TC-4600')).toMatchObject({ state: 'asking', flaggedAt: FLAGGED_AT });
    expect(made.ack).not.toHaveBeenCalled();
  });

  it('chooseStandalone books it, confirming that very flag, and the entry carries the flag no more', async () => {
    const made = inbox();
    made.box.received(typed(4600));
    await settle();

    expect(made.box.chooseStandalone('TC-4600')).toBe(true);
    await settle();

    expect(made.book).toHaveBeenLastCalledWith(DEVICE, expect.anything(), FLAGGED_AT);
    expect(made.stateOf('TC-4600')).toMatchObject({ state: 'done', flaggedAt: null, answer: BOOKED });
    expect(made.ack).toHaveBeenCalledTimes(1);
  });

  it('a person who chose "on its own" before the flag was known is asked again, never booked unconfirmed', async () => {
    const made = inbox([{ key: 'sale-1', dueCents: 4600 }]);
    made.box.received(typed(4600));
    expect(made.box.chooseStandalone('TC-4600')).toBe(true);
    await settle();

    expect(made.book).toHaveBeenLastCalledWith(DEVICE, expect.anything(), null);
    expect(made.stateOf('TC-4600')).toMatchObject({ state: 'asking', flaggedAt: FLAGGED_AT });
    expect(made.ack).not.toHaveBeenCalled();
  });
});
