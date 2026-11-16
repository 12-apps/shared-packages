import { describe, expect, it, vi } from 'vitest';

import { SWEEP_QUEUE } from '../cadence';
import { HELD_SWEEP_OFF_WARNING, UNBOUND_CAPTURE_SWEEP_BATCH, terminalCaptureJobBlueprints } from '../job';
import { DAY, NOW, capture, world } from './world';

/** The sweep blueprint: the package's cadence and batch, the ledger's window. */

describe('the unbound-capture sweep blueprint', () => {
  it("declares the origin host's cadence on the single-flight sweep queue", () => {
    const { flagUnboundCaptures } = terminalCaptureJobBlueprints({ ledger: { flagStaleUnbound: vi.fn() } });
    expect(flagUnboundCaptures).toMatchObject({
      name: 'flag-unbound-captures',
      queue: SWEEP_QUEUE,
      concurrency: 1,
      schedule: { pattern: '*/10 * * * *', timezone: 'UTC' },
      lease: { ttlMs: 120_000 },
    });
    expect(UNBOUND_CAPTURE_SWEEP_BATCH).toBe(200);
  });

  it("flags through the ledger's window, a batch per tick, and logs only when it flagged", async () => {
    const w = world();
    await w.ledger.record(capture({ capturedAt: new Date(NOW.getTime() - DAY) }));
    w.captures.setRecordedAt('tenant-a', 'TC-0001', new Date(NOW.getTime() - DAY));
    const info = vi.fn();
    const spy = vi.spyOn(w.ledger, 'flagStaleUnbound');
    const { flagUnboundCaptures } = terminalCaptureJobBlueprints({ ledger: w.ledger, now: () => NOW });

    await flagUnboundCaptures.handle(undefined, { logger: { info } });
    await flagUnboundCaptures.handle(undefined, { logger: { info } });

    expect(spy).toHaveBeenCalledWith(NOW, UNBOUND_CAPTURE_SWEEP_BATCH);
    expect(w.rows()[0]).toMatchObject({ refundReason: 'UNBOUND_TIMEOUT' });
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('also flags, in the same tick, a held capture whose sale stayed unpaid through the window (FUT-5095)', async () => {
    const w = world();
    const sale = w.sale('tenant-a', new Date(NOW.getTime() - DAY));
    await w.ledger.record(capture({ capturedAt: new Date(NOW.getTime() - DAY) }));
    w.captures.setRecordedAt('tenant-a', 'TC-0001', new Date(NOW.getTime() - DAY));
    await w.ledger.markSaleCreated(null, { clientId: 'tenant-a', transactionCode: 'TC-0001' }, sale.orderId);
    const info = vi.fn();
    const spy = vi.spyOn(w.ledger, 'flagStaleHeld');
    const { flagUnboundCaptures } = terminalCaptureJobBlueprints({ ledger: w.ledger, now: () => NOW });

    await flagUnboundCaptures.handle(undefined, { logger: { info } });
    await flagUnboundCaptures.handle(undefined, { logger: { info } });

    expect(spy).toHaveBeenCalledWith(NOW, UNBOUND_CAPTURE_SWEEP_BATCH);
    expect(w.rows()[0]).toMatchObject({ state: 'ORDER_CREATED', refundReason: 'SALE_NOT_PAID' });
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('warns once a tick while the held half cannot run, so a host without the port does not look fixed', async () => {
    const warn = vi.fn();
    const info = vi.fn();
    const off = terminalCaptureJobBlueprints({ ledger: { flagStaleUnbound: vi.fn(async () => 0) } }).flagUnboundCaptures;
    const unready = terminalCaptureJobBlueprints({
      ledger: { flagStaleUnbound: vi.fn(async () => 0), flagStaleHeld: vi.fn(async () => 0), heldSweepReady: false },
    }).flagUnboundCaptures;
    const ready = terminalCaptureJobBlueprints({ ledger: world().ledger, now: () => NOW }).flagUnboundCaptures;

    await off.handle(undefined, { logger: { info, warn } });
    await unready.handle(undefined, { logger: { info, warn } });
    await ready.handle(undefined, { logger: { info, warn } });
    await off.handle(undefined, { logger: { info } });

    expect(warn.mock.calls).toEqual([[HELD_SWEEP_OFF_WARNING], [HELD_SWEEP_OFF_WARNING]]);
    expect(info.mock.calls).toEqual([[HELD_SWEEP_OFF_WARNING]]);
  });
});
