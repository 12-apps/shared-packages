import { describe, expect, it, vi } from 'vitest';

import { startChargeRun, type ChargeRun } from '../charge-run';
import { createConfirmedAct } from '../confirmed-act';
import type { ChargedSplit, FlowNotice } from '../flow-types';
import type { ChargeLink } from '../port';
import { fakeTerminal, settle, trace, type FakeTerminal } from './fake-port';

/**
 * One split's run against the paired terminal (FUT-4996, salvaged from the
 * FUT-3765 draft): each card or Pix leg pushed on its own, the station's
 * answers fed back, and the paths that could lose or double money.
 */

const TOTAL = 6490;
const LINKED: ChargeLink = { known: true, terminals: 1 };

function begin(split: ChargedSplit, link: ChargeLink = LINKED, port: FakeTerminal = fakeTerminal()) {
  const onReady = vi.fn<(split: ChargedSplit) => void>();
  const onNotice = vi.fn<(notice: FlowNotice) => void>();
  // Built in the return, so no helper-level binding is shared between tests.
  return { port, run: startChargeRun({ port, split, totalCents: TOTAL, link, saleRef: 'Sale 1', operator: 'Ana', onReady, onNotice }), onReady, onNotice };
}

const statusOf = (run: ChargeRun, index = 0) => run.current().legs[index]?.status;

describe('what goes to the terminal', () => {
  it('never pushes cash: an all-cash split is ready at once, with nothing pushed', async () => {
    const { port, onReady } = begin({ legs: [{ tender: 'CASH', amountCents: 7000 }], changeCents: 510 });
    await settle();
    expect(port.charges).toEqual([]);
    expect(onReady).toHaveBeenCalledWith({ legs: [{ tender: 'CASH', amountCents: 7000 }], changeCents: 510 });
  });

  it('pushes a single card leg with the whole bill, and settles once with its capture', async () => {
    const { port, run, onReady } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    expect(port.charges).toEqual([{ saleRef: 'Sale 1', operator: 'Ana', amountCents: TOTAL, method: 'CREDIT' }]);
    expect(statusOf(run)).toBe('waiting');

    port.status('approved', { capture: trace(TOTAL) });
    port.status('approved', { capture: trace(TOTAL) });

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0]?.[0].legs[0]).toMatchObject({ tender: 'CREDIT', amountCents: TOTAL, capture: { transactionCode: `TX-${TOTAL}-CREDIT`, deviceId: 'dev-1' } });
  });

  it('R01: pushes nothing while the link is unknown, and pushes once the link answers', async () => {
    const { port, run } = begin({ legs: [{ tender: 'PIX' }], changeCents: 0 }, { known: false });
    await settle();
    expect(port.charges).toEqual([]);

    run.linkChanged(LINKED);
    await settle();
    expect(port.charges).toHaveLength(1);
  });

  it('R03: with no terminal linked the card leg is plain and the split is ready at once', async () => {
    const { port, onReady } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 }, { known: true, terminals: 0 });
    await settle();
    expect(port.charges).toEqual([]);
    expect(onReady).toHaveBeenCalledWith({ legs: [{ tender: 'CREDIT', amountCents: TOTAL }], changeCents: 0 });
  });
});

describe('the operator and the station', () => {
  it('a declined leg sent again cancels the declined charge before the fresh push', async () => {
    const { port, run } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    port.status('declined');
    run.resend();
    await settle();
    expect(port.cancels).toEqual(['ch-1']);
    expect(port.charges).toHaveLength(2);
    expect(run.current().legs[0]).toMatchObject({ status: 'waiting', chargeId: 'ch-2', history: ['ch-1'] });
  });

  it('R44: a push the station refuses offers the exits, and is sent again on resend', async () => {
    const port = fakeTerminal();
    port.pushAnswers = [{ ok: false, code: 'NOT_CONNECTED' }];
    const { run } = begin({ legs: [{ tender: 'DEBIT' }], changeCents: 0 }, LINKED, port);
    await settle();
    expect(run.current().legs[0]).toMatchObject({ status: 'refused', exits: ['resend', 'other-tender', 'other-machine', 'manual-pix'] });
    run.resend();
    await settle();
    expect(statusOf(run)).toBe('waiting');
  });

  it('R04: charged on another machine, offered after the station refused the push as not connected, settles a manual leg', async () => {
    const port = fakeTerminal();
    port.pushAnswers = [{ ok: false, code: 'NOT_CONNECTED' }];
    const { run, onReady } = begin({ legs: [{ tender: 'DEBIT' }], changeCents: 0 }, LINKED, port);
    await settle();
    run.elsewhere(0, { via: 'OTHER_MACHINE', reference: '004512' });
    expect(onReady).toHaveBeenCalledWith({ legs: [{ tender: 'DEBIT', amountCents: TOTAL, elsewhere: { via: 'OTHER_MACHINE', reference: '004512' } }], changeCents: 0 });
  });

  it('R04 (owner rule): with the terminal usable, a manual leg is refused and nothing settles', async () => {
    const { run, onReady } = begin({ legs: [{ tender: 'DEBIT' }], changeCents: 0 });
    await settle();
    expect(() => run.elsewhere(0, { via: 'OTHER_MACHINE' })).toThrow();
    expect(onReady).not.toHaveBeenCalled();
  });

  it('R04: no push goes out while the link says no terminal is connected; the manual exits are offered', async () => {
    const { port, run } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 }, { known: true, terminals: 1, down: true });
    await settle();
    expect(port.charges).toEqual([]);
    expect(run.current().legs[0]?.exits).toEqual(expect.arrayContaining(['other-machine', 'manual-pix']));
  });

  it('R07: moved to cash on the terminal and received, a late approval is received-twice, never applied', async () => {
    const { port, run, onReady, onNotice } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    port.status('method_changed', { method: 'CASH' });
    run.cashReceived();
    expect(onReady).toHaveBeenCalledWith({ legs: [{ tender: 'CASH', amountCents: TOTAL }], changeCents: 0 });

    port.status('approved', { capture: trace(TOTAL), chargeId: 'ch-1' });

    expect(onNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: 'received-twice' }));
    expect(statusOf(run)).toBe('local');
  });

  it('R43: a transient refusal keeps the capture; the same body is settled again only when the operator retries', async () => {
    const { port, run, onReady } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    port.status('approved', { capture: trace(TOTAL) });
    run.refused('CAPTURE_CONTENDED');
    expect(onReady).toHaveBeenCalledTimes(1);

    expect(run.retry()).toBe(true);

    expect(onReady).toHaveBeenCalledTimes(2);
    expect(onReady.mock.calls[1]?.[0]).toEqual(onReady.mock.calls[0]?.[0]);
  });

  it('R43 (B2): a host that refuses NETWORK every time is settled once, never in a loop', async () => {
    const port = fakeTerminal();
    const onReady = vi.fn(() => charging.refused('NETWORK'));
    const charging = startChargeRun({ port, split: { legs: [{ tender: 'CREDIT' }], changeCents: 0 }, totalCents: TOTAL, link: LINKED, saleRef: 's', operator: 'o', onReady, onNotice: vi.fn() });
    await settle();
    port.status('approved', { capture: trace(TOTAL) });
    await settle();

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('B3: retry before any refusal settles nothing', async () => {
    const { port, run, onReady } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    port.status('approved', { capture: trace(TOTAL) });
    expect(onReady).toHaveBeenCalledTimes(1);

    expect(run.retry()).toBe(false);

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('B3: two retries after one NETWORK refusal settle exactly once more', async () => {
    const { port, run, onReady } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    port.status('approved', { capture: trace(TOTAL) });
    run.refused('NETWORK');

    expect(run.retry()).toBe(true);
    expect(run.retry()).toBe(false);

    expect(onReady).toHaveBeenCalledTimes(2);
  });

  it('B3: after a cash-only split, retry settles nothing', async () => {
    const { run, onReady } = begin({ legs: [{ tender: 'CASH', amountCents: TOTAL }], changeCents: 0 });
    await settle();
    expect(run.retry()).toBe(false);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('N7: a cashReceived that changes nothing never settles again, before or after a refusal', async () => {
    const { port, run, onReady } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    port.status('method_changed', { method: 'CASH' });
    run.cashReceived();
    run.cashReceived();
    run.cashReceived();
    expect(onReady).toHaveBeenCalledTimes(1);

    run.refused('NETWORK');
    run.cashReceived();

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('R16 (B2): retry never resends a body the server refused as not fitting', async () => {
    const { port, run, onReady } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    port.status('approved', { capture: trace(TOTAL) });
    run.refused('TENDERS_DONT_FIT');
    expect(run.retry()).toBe(false);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('R16: a body refused as not fitting is not settled again: the operator decides', async () => {
    const { port, run, onReady } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    port.status('approved', { capture: trace(TOTAL) });
    run.refused('TENDERS_DONT_FIT');
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(run.current()).toMatchObject({ refusedAs: 'TENDERS_DONT_FIT', retry: false });
  });
});

describe('Outra forma is a way out wherever it is offered (B1, invariant 7)', () => {
  it('R06: from a leg waiting on the terminal, another tender cancels the charge and takes the leg in cash', async () => {
    const { port, run, onReady } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    expect(run.current().legs[0]?.exits).toContain('other-tender');

    run.other('CASH');
    await settle();

    expect(port.cancels).toEqual(['ch-1']);
    expect(run.current().legs[0]).toMatchObject({ status: 'local', tender: 'CASH', history: ['ch-1'] });
    expect(onReady).toHaveBeenCalledWith({ legs: [{ tender: 'CASH', amountCents: TOTAL }], changeCents: 0 });
  });

  it('R06: from a waiting leg, another card method cancels the old charge before the new push', async () => {
    const { port, run } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    run.other('PIX');
    await settle();
    expect(port.cancels).toEqual(['ch-1']);
    expect(port.charges.map((charge) => charge.method)).toEqual(['CREDIT', 'PIX']);
    expect(run.current().legs[0]).toMatchObject({ status: 'waiting', chargeId: 'ch-2', history: ['ch-1'] });
  });

  it('R44 (B1): a start with the terminal down offers Outra forma above the manual exits, and it works', async () => {
    const { port, run, onReady } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 }, { known: true, terminals: 1, down: true });
    await settle();
    expect(run.current().legs[0]?.exits).toEqual(['other-tender', 'other-machine', 'manual-pix']);

    run.other('CASH');

    expect(port.charges).toEqual([]);
    expect(onReady).toHaveBeenCalledWith({ legs: [{ tender: 'CASH', amountCents: TOTAL }], changeCents: 0 });
  });

  it('N8: no Outra forma while the push is still out; it comes back once the push answers', async () => {
    const { port, run } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await Promise.resolve();
    expect(run.current().legs[0]).toMatchObject({ status: 'pushing' });
    expect(run.current().legs[0]?.exits).not.toContain('other-tender');
    run.other('DEBIT');
    expect(run.current().legs[0]).toMatchObject({ status: 'pushing', tender: 'CREDIT' });

    await settle();

    expect(run.current().legs[0]).toMatchObject({ status: 'waiting', chargeId: 'ch-1', tender: 'CREDIT' });
    expect(run.current().legs[0]?.exits).toContain('other-tender');
    expect(port.charges.map((charge) => charge.method)).toEqual(['CREDIT']);
  });
});

describe('N1: an approval while the leg was moved to cash', () => {
  it('is never applied silently: the leg stays cash and the operator is told it was received twice', async () => {
    const { port, run, onNotice } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    port.status('method_changed', { method: 'CASH' });

    port.status('approved', { capture: trace(TOTAL), chargeId: 'ch-1' });

    expect(run.current().legs[0]?.status).toBe('cash');
    expect(onNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: 'received-twice', index: 0 }));
  });
});

describe('N3: a confirmed act is sent once', () => {
  it('refuses a second confirm after the act was sent', async () => {
    const send = vi.fn(async () => ({ ok: true as const }));
    const act = createConfirmedAct({ send });

    await act.confirm({ act: 'refund', reason: 'paid twice', pin: '1234' });
    await expect(act.confirm({ act: 'refund', reason: 'paid twice', pin: '1234' })).resolves.toEqual({ ok: false, code: 'ALREADY_SENT' });

    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('a split goes one part at a time', () => {
  it('pushes part 2 only after part 1 is approved, and re-balances it to the captured amount', async () => {
    const { port, run, onReady } = begin({ legs: [{ tender: 'CREDIT', amountCents: 3000 }, { tender: 'PIX' }], changeCents: 0 });
    await settle();
    expect(port.charges).toEqual([expect.objectContaining({ amountCents: 3000, part: 1, parts: 2, remainingCents: 3490 })]);

    port.status('approved', { capture: trace(3150) });
    await settle();

    expect(port.charges[1]).toMatchObject({ amountCents: 3340, method: 'PIX', part: 2, parts: 2 });
    port.status('approved', { capture: trace(3340, 'PIX') });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(run.current().legs.map((leg) => leg.amountCents)).toEqual([3150, 3340]);
  });

  it('R15: an approval above the total raises the excess and settles nothing', async () => {
    const { port, run, onReady, onNotice } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    port.status('approved', { capture: trace(TOTAL + 200) });
    expect(onNotice).toHaveBeenCalledWith({ kind: 'excess', excessCents: 200 });
    expect(onReady).not.toHaveBeenCalled();
    expect(run.current().excessCents).toBe(200);
  });
});

describe('leaving and reloading', () => {
  it('leaving mid-charge cancels the charge on the terminal and hears nothing more', async () => {
    const { port, run, onNotice } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    run.dispose();
    expect(port.cancels).toEqual(['ch-1']);
    port.status('approved', { capture: trace(TOTAL) });
    expect(onNotice).not.toHaveBeenCalled();
  });

  it('R45: the charge a reload left is cancelled on request, and its approval is an orphan, never this sale’s', async () => {
    const link: ChargeLink = { known: true, terminals: 1, pending: { chargeId: 'ch-old', amountCents: 999, method: 'CREDIT' } };
    const { port, run, onNotice } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 }, link);
    await settle();
    run.cancelPending();
    expect(port.cancels).toContain('ch-old');
    expect(run.current().pending).toBeNull();

    port.emit({ kind: 'orphan-capture', deviceId: 'dev-1', chargeId: 'ch-old', state: 'approved', capture: trace(999, 'CREDIT', 'OLD') });

    expect(onNotice).toHaveBeenCalledWith({ kind: 'orphan', capture: expect.objectContaining({ transactionCode: 'OLD' }) });
    expect(statusOf(run)).toBe('waiting');
  });
});
