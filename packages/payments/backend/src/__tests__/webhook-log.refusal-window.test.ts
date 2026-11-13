import { describe, expect, it, vi } from 'vitest';

import { createWebhookLog } from '../core/webhook-log';

/**
 * A refusal reason reaches WARN once per window per provider and reason; the
 * rest of the window go to INFO, and the next WARN carries their count
 * (FUT-3968: unsigned PagBank deliveries were 2,151 warnings in 14 days).
 */

function rig(times: readonly number[]) {
  const log = { info: vi.fn<(message: string) => void>(), warn: vi.fn<(message: string) => void>() };
  const clock = times[Symbol.iterator]();
  const { observer } = createWebhookLog(log, { refusalWindowMs: 1000, now: () => clock.next().value ?? 0 });
  return { log, observer };
}

const REASON = 'Webhook verification failed (PRODUCTION: x-authenticity-token absent)';

describe('createWebhookLog observer refusals, once per window', () => {
  it('warns on the first refusal and logs the rest of the window at info', () => {
    const { log, observer } = rig([0, 10, 20]);
    observer.refused('pagbank', REASON);
    observer.refused('pagbank', REASON);
    observer.refused('pagbank', REASON);

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledTimes(2);
  });

  it('warns again after the window, saying how many were held back', () => {
    const { log, observer } = rig([0, 10, 20, 1500]);
    observer.refused('pagbank', REASON);
    observer.refused('pagbank', REASON);
    observer.refused('pagbank', REASON);
    observer.refused('pagbank', REASON);

    const warned = log.warn.mock.calls.map(([line]) => line);
    expect(warned).toHaveLength(2);
    expect(warned[0]).not.toMatch(/more since the last report/);
    expect(warned[1]).toMatch(/verify refused: pagbank .* \(2 more since the last report\)$/);
  });

  it('keeps a window per provider and reason', () => {
    const { log, observer } = rig([0, 10, 20]);
    observer.refused('pagbank', REASON);
    observer.refused('pagbank', 'another reason');
    observer.refused('stripe', REASON);

    expect(log.warn).toHaveBeenCalledTimes(3);
  });
});
