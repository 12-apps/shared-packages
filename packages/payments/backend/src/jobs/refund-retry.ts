import { PAYMENTS_SWEEP_QUEUE, REFUND_RETRY_CRON } from './cadence';
// Type-only, so this stays a leaf at runtime (see `./sweeps`).
import type { PaymentsJobBlueprint } from './index';

/** What the host binds the store refund sweep to: its retrier's `runDue`, behind its own predicate. */
export interface RefundRetryJobDeps {
  retryDueRefunds(input: { now: Date }): Promise<unknown>;
  now?: () => Date;
}

/** The sweep with its deps closed over: the host installs it as it is and adds its namespace. */
export type RefundRetryJob = Omit<PaymentsJobBlueprint, 'handle'> & { handle: () => Promise<void> };

/**
 * The store refund retry's sweep (FUT-4740), a blueprint of its own rather
 * than a field of `PaymentsJobDeps`, so a host that never refunds a store's
 * charge binds nothing new.
 *
 * Single-flight on the sweep queue: every attempt is also claimed behind its
 * series row, so an overlap would send nothing twice, but it would consult
 * twice. Never retried by the queue: the next tick is the retry. The lease
 * covers a batch of attempts at the provider deadline.
 */
export function refundRetryJob(deps: RefundRetryJobDeps): RefundRetryJob {
  return {
    name: 'refund-retry',
    queue: PAYMENTS_SWEEP_QUEUE,
    concurrency: 1,
    schedule: { pattern: REFUND_RETRY_CRON },
    attempts: 1,
    lease: { ttlMs: 5 * 60_000 },
    handle: async () => {
      await deps.retryDueRefunds({ now: (deps.now ?? (() => new Date()))() });
    },
  };
}
