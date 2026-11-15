import { describe, expect, it, vi } from 'vitest';

import { startChargeRun } from '../charge-run';
import type { ChargedSplit, FlowNotice } from '../flow-types';
import { createHeldCaptures, withHeld } from '../held-captures';
import { holdTaken, legsByCode, takenCaptures } from '../offline-hand-off';
import { captureWireOf, type ChargeLink } from '../port';
import { fakeTerminal, settle, trace } from './fake-port';

/**
 * FUT-4997 contract rows D9-R31 to D9-R34 (package half): the charge run with
 * no server behind it — the station's journal settles the split — and the
 * hand-off of what an online try already took.
 */

const TOTAL = 6000;
const LINKED: ChargeLink = { known: true, terminals: 1 };
const KEY = 'sale-key-1';

function begin(split: ChargedSplit) {
  const terminal = fakeTerminal();
  const onReady = vi.fn<(split: ChargedSplit) => void>();
  const onNotice = vi.fn<(notice: FlowNotice) => void>();
  const run = startChargeRun({ port: terminal, split, totalCents: TOTAL, link: LINKED, saleRef: 'Sale 1', operator: 'Ana', onReady, onNotice });
  return { port: terminal, run, onReady };
}

describe('the run with no server (A6)', () => {
  it('D9-R31: pushes a card leg and hands a split whose leg carries the capture the terminal reported, reading nothing from a server', async () => {
    const { port, onReady } = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    port.status('approved', { capture: trace(TOTAL) });

    expect(port.state).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0]?.[0].legs[0]).toMatchObject({ tender: 'CREDIT', amountCents: TOTAL, capture: { transactionCode: `TX-${TOTAL}-CREDIT` } });
  });

  it.each(['CAPTURE_UNKNOWN', 'CAPTURE_TAKEN', 'CAPTURE_MISMATCH'])('D9-R34: the journal refusing %s stops the flow and is never settled again by itself', async (code) => {
    const { port, run, onReady } = begin({ legs: [{ tender: 'PIX' }], changeCents: 0 });
    await settle();
    port.status('approved', { capture: trace(TOTAL, 'PIX') });
    run.refused(code);

    expect(run.current().refusedAs).toBe(code);
    expect(run.current().retry).toBe(false);
    expect(run.retry()).toBe(false);
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});

describe('what the journal is told', () => {
  it('D9-R32: a terminal leg names its capture by code alone; the trace is not sent', () => {
    const split: ChargedSplit = {
      legs: [
        { tender: 'CASH', amountCents: 1000 },
        { tender: 'CREDIT', amountCents: 5000, capture: captureWireOf(trace(5000, 'CREDIT', 'TX-1'), 'dev-1') },
        { tender: 'PIX', amountCents: 0, elsewhere: { via: 'MANUAL_PIX' } },
      ],
      changeCents: 0,
    };

    expect(legsByCode(split)).toEqual([
      { tender: 'CASH', amountCents: 1000 },
      { tender: 'CREDIT', amountCents: 5000, transactionCode: 'TX-1' },
      { tender: 'PIX', amountCents: 0, elsewhere: { via: 'MANUAL_PIX' } },
    ]);
  });
});

describe('the online to offline hand-off (FUT-4996 A5)', () => {
  it('D9-R33: what the online try took is held under the key, and the offline run starts with it approved, never pushed again', async () => {
    const online = begin({ legs: [{ tender: 'CREDIT', amountCents: 2500 }, { tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    online.port.status('approved', { capture: trace(2500, 'CREDIT', 'TX-A') });
    await settle();
    expect(takenCaptures(online.run.current()).map((capture) => capture.transactionCode)).toEqual(['TX-A']);

    const held = createHeldCaptures();
    holdTaken(held, KEY, online.run.current());
    holdTaken(held, KEY, online.run.current());
    online.run.dispose();
    expect(held.heldFor(KEY).map((capture) => capture.transactionCode)).toEqual(['TX-A']);

    const offline = begin(withHeld({ legs: [{ tender: 'CREDIT' }], changeCents: 0 }, held.heldFor(KEY)));
    await settle();
    expect(offline.run.current().legs[0]).toMatchObject({ status: 'approved', capture: { transactionCode: 'TX-A' } });
    expect(offline.port.charges).toEqual([expect.objectContaining({ amountCents: 3500 })]);
  });

  it('D9-R33: a capture held for another sale is never moved by the hand-off', async () => {
    const online = begin({ legs: [{ tender: 'CREDIT' }], changeCents: 0 });
    await settle();
    online.port.status('approved', { capture: trace(TOTAL, 'CREDIT', 'TX-B') });
    const held = createHeldCaptures();
    takenCaptures(online.run.current()).forEach((capture) => held.hold('other-sale', capture));

    expect(() => holdTaken(held, KEY, online.run.current())).toThrow(/another sale/);
  });
});
