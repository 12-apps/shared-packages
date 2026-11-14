import { describe, expect, it } from 'vitest';

import { NOW, OTHER_TENANT, TENANT, refusal, world } from './world';

/**
 * The terminal's own report (`recordFromDevice`). Ported from the origin
 * host's device-route suite: the tenant and the terminal come from the
 * device's credential, the source is DEVICE, a future capture time is now,
 * and a replay answers the stored capture.
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

