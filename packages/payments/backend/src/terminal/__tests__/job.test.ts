import { describe, expect, it, vi } from 'vitest';

import { PAYMENTS_SWEEP_QUEUE } from '../../jobs/cadence';
import { UNBOUND_CAPTURE_SWEEP_BATCH, terminalCaptureJobBlueprints } from '../job';
import { DAY, NOW, capture, world } from './world';

/** The sweep blueprint: the package's cadence and batch, the ledger's window. */

describe('the unbound-capture sweep blueprint', () => {
  it("declares the origin host's cadence on the single-flight sweep queue", () => {
    const { flagUnboundCaptures } = terminalCaptureJobBlueprints({ ledger: { flagStaleUnbound: vi.fn() } });
    expect(flagUnboundCaptures).toMatchObject({
      name: 'flag-unbound-captures',
      queue: PAYMENTS_SWEEP_QUEUE,
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
});
