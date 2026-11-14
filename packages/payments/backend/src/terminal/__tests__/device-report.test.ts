import { describe, expect, it } from 'vitest';

import { NOW, OTHER_TENANT, TENANT, capture, refusal, world } from './world';

/**
 * The terminal's own report (`recordFromDevice`) and the journal row it
 * completes. Ported from the origin host's device-route and offline-capture
 * suites: the tenant and the terminal come from the device's credential, the
 * source is DEVICE, a future capture time is now, a replay answers the stored
 * capture, and a report never loses itself against a journal row.
 */

const report = { transactionCode: 'TC-0001', kind: 'CREDIT' as const, amountCents: 2500, transactionId: 'TID-0001', terminalSerial: 'PAX-1' };

describe('a capture the terminal reports itself', () => {
  it("records it under the device's tenant and terminal, source DEVICE, and answers it UNBOUND", async () => {
    const w = world();
    const device = { clientId: TENANT, deviceId: w.device() };

    const answer = await w.ledger.recordFromDevice(device, { ...report, capturedAt: '2026-11-03T14:00:00.000Z' });

    expect(answer).toEqual({
      transactionCode: 'TC-0001',
      kind: 'CREDIT',
      amountCents: 2500,
      state: 'UNBOUND',
      created: true,
      orderId: null,
      capturedAt: '2026-11-03T14:00:00.000Z',
      refundFlagged: false,
    });
    expect(w.row('TC-0001')).toMatchObject({ source: 'DEVICE', deviceId: device.deviceId, transactionId: 'TID-0001' });
  });

  it('answers a replay with the stored capture and its current state, writing nothing', async () => {
    const w = world();
    const device = { clientId: TENANT, deviceId: w.device() };
    await w.ledger.recordFromDevice(device, report);
    const target = w.sale();
    await w.ledger.bind(null, TENANT, ['TC-0001'], target);
    await w.ledger.flag({ clientId: TENANT, transactionCode: 'TC-0001' }, 'SALE_CANCELLED', NOW);

    const replay = await w.ledger.recordFromDevice(device, report);

    expect(replay).toMatchObject({ created: false, state: 'BOUND', orderId: target.orderId, refundFlagged: true });
    expect(w.rows()).toHaveLength(1);
  });

  it('throws CONFLICT for the same code with another amount, keeping the first', async () => {
    const w = world();
    const device = { clientId: TENANT, deviceId: w.device() };
    await w.ledger.recordFromDevice(device, report);

    const refused = await refusal(w.ledger.recordFromDevice(device, { ...report, amountCents: 2600 }));

    expect(refused).toMatchObject({ code: 'CONFLICT', transactionCode: 'TC-0001' });
    expect(w.row('TC-0001')).toMatchObject({ amountCents: 2500 });
  });

  it("never reaches another tenant's capture: the same code from another tenant's terminal is that tenant's own row", async () => {
    const w = world();
    await w.ledger.recordFromDevice({ clientId: TENANT, deviceId: w.device() }, report);

    const theirs = await w.ledger.recordFromDevice({ clientId: OTHER_TENANT, deviceId: w.device(OTHER_TENANT) }, { ...report, amountCents: 999 });

    expect(theirs).toMatchObject({ created: true, amountCents: 999 });
    expect(w.row('TC-0001')).toMatchObject({ amountCents: 2500 });
  });

  it('reads a capture time in the future as now, and an absent one as now', async () => {
    const w = world();
    const device = { clientId: TENANT, deviceId: w.device() };

    await expect(w.ledger.recordFromDevice(device, { ...report, capturedAt: '2026-11-04T15:00:00.000Z' }, NOW)).resolves.toMatchObject({
      capturedAt: NOW.toISOString(),
    });
    await expect(w.ledger.recordFromDevice(device, { ...report, transactionCode: 'TC-0002' }, NOW)).resolves.toMatchObject({
      capturedAt: NOW.toISOString(),
    });
  });
});

describe('a journal row the report completes', () => {
  const journal = capture({
    source: 'JOURNAL',
    kind: 'DEBIT',
    transactionId: null,
    hostNsu: null,
    authorizationCode: null,
    cardBrand: null,
    installments: null,
    terminalSerial: null,
    entryMode: null,
  });

  it('takes the trace and the terminal when the report agrees, and keeps its state, sale and flag', async () => {
    const w = world();
    await w.ledger.record(journal);
    const target = w.sale();
    await w.ledger.bind(null, TENANT, ['TC-0001'], target);
    const deviceId = w.device();

    const { capture: completed, created } = await w.ledger.record(capture({ kind: 'DEBIT', deviceId }));

    expect(created).toBe(false);
    expect(completed).toMatchObject({ source: 'JOURNAL', state: 'BOUND', orderId: target.orderId, transactionId: 'TID-0001', deviceId, refundFlaggedAt: null });
  });

  it("never loses the terminal's report: the row takes its kind, amount and trace, flagged JOURNAL_CONFLICT once", async () => {
    const w = world();
    await w.ledger.record(journal);
    const target = w.sale();
    await w.ledger.bind(null, TENANT, ['TC-0001'], target);

    const { capture: completed } = await w.ledger.record(capture({ kind: 'CREDIT', amountCents: 2600 }));

    expect(completed).toMatchObject({
      state: 'BOUND',
      orderId: target.orderId,
      source: 'JOURNAL',
      kind: 'CREDIT',
      amountCents: 2600,
      transactionId: 'TID-0001',
      refundReason: 'JOURNAL_CONFLICT',
      refundFlaggedAt: NOW,
      refundClearedAt: null,
    });
    const flagged = w.row('TC-0001');
    // The outbox resending the same report writes nothing more.
    await w.ledger.record(capture({ kind: 'CREDIT', amountCents: 2600 }));
    expect(w.row('TC-0001')).toEqual(flagged);
  });

  it('is a CONFLICT again once its trace is in: only a row still awaiting its report is completed', async () => {
    const w = world();
    await w.ledger.record(journal);
    await w.ledger.record(capture({ kind: 'DEBIT' }));

    expect((await refusal(w.ledger.record(capture({ kind: 'DEBIT', amountCents: 9 })))).code).toBe('CONFLICT');
    // A second journal report of the same leg is a plain replay, never a completion.
    await expect(w.ledger.record({ ...journal, amountCents: 2500 })).resolves.toMatchObject({ created: false });
  });
});
