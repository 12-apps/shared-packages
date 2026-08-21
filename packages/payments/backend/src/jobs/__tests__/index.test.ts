import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoredCharge } from '../../core/ports';
import type { ChargeSnapshot, MerchantRef } from '../../core/types';
import {
  PAYMENTS_JOBS,
  PAYMENTS_SWEEP_QUEUE,
  paymentsJobBlueprints,
  RECONCILE_CRON,
  type PaymentsJobContext,
  type PaymentsJobDeps,
} from '../index';

/**
 * The package's own schedule, as blueprints a host binds.
 *
 * What these pin is that a host gets the reconciliation by BINDING what the
 * package declares, not by remembering to schedule it — the failure that left
 * one adopting host with a sweep and every other host with none. The sweep's
 * own behaviour is covered by `core/__tests__/payable-sweep.test.ts`; these are
 * about the declaration and the policy travelling with it.
 */

const MERCHANT: MerchantRef = { kind: 'TENANT', id: 'client-1' };

function snapshot(status: ChargeSnapshot['status']): ChargeSnapshot {
  return {
    provider: 'infinitepay',
    providerChargeId: 'ch_1',
    status,
    amount: { amountCents: 1350, currency: 'BRL' },
    method: 'PIX',
  };
}

function charge(): StoredCharge {
  return {
    id: 'row-1',
    merchant: MERCHANT,
    provider: 'infinitepay',
    providerChargeId: 'ch_1',
    reference: 'order-1',
    idempotencyKey: 'order-1:0',
    snapshot: snapshot('PENDING'),
    createdAt: new Date('2026-08-17T12:00:00Z'),
    updatedAt: new Date('2026-08-17T12:00:00Z'),
  };
}

const context: PaymentsJobContext = {
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
};

/** A host's deps, with what the sweep actually settled recorded. */
function hostDeps(overrides: Partial<PaymentsJobDeps> = {}): {
  deps: PaymentsJobDeps;
  settled: ChargeSnapshot[];
} {
  const settled: ChargeSnapshot[] = [];
  const deps = {
    charges: {
      countByReference: async () => 0,
      listPayable: async () => [],
      latestByReference: async () => null,
      listPendingCharges: async () => [charge()],
    },
    gateway: { refreshCharge: async () => snapshot('PAID') },
    settle: async (snap: ChargeSnapshot) => {
      settled.push(snap);
    },
    now: () => new Date('2026-08-17T12:10:00Z'),
    ...overrides,
  } as PaymentsJobDeps;
  return { deps, settled };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('paymentsJobBlueprints', () => {
  it('carries the cadence and the queue, so a host is never asked for them', () => {
    // Two overlapping passes double the provider calls and race each other's
    // settles. That is a money decision, not tuning — and a host asked to
    // restate it is a host that can get it wrong.
    expect(paymentsJobBlueprints().reconcilePending).toMatchObject({
      name: 'reconcile-pending',
      queue: PAYMENTS_SWEEP_QUEUE,
      concurrency: 1,
      schedule: { pattern: RECONCILE_CRON },
      // The rest of the policy the origin host used to state by hand: never
      // queue-retried (the next tick IS the retry), and one pass may hold the
      // single-flight name for the cadence itself.
      attempts: 1,
      lease: { ttlMs: 5 * 60_000 },
    });
  });

  it('exposes the SAME declaration as a wiring jobs contribution', () => {
    // Namespace plus blueprints — the shape `@12-apps/wiring` binds. The
    // contract itself cannot be imported here (payments/no-host-imports), so
    // this pins identity and the wiring suite's payments-manifest.test.ts
    // runs the producer assertions one package over.
    expect(PAYMENTS_JOBS.namespace).toBe('payments');
    expect(PAYMENTS_JOBS.blueprints.reconcilePending).toBe(
      PAYMENTS_JOBS.blueprints.reconcilePending,
    );
    expect(PAYMENTS_JOBS.blueprints.reconcilePending.name).toBe('reconcile-pending');
  });

  it('names the same sweep queue `@12-apps/jobs` exports as SWEEP_QUEUE', () => {
    // The string is stated rather than imported (ADOPTING.md §6 — this package
    // must vendor into a repo that has no job library). This is the pin that
    // keeps the copy honest: if the two ever diverge, the package's scheduled
    // sweep lands on a queue nothing consumes and simply stops running.
    expect(PAYMENTS_SWEEP_QUEUE).toBe('sweeps');
  });

  it('hands a fresh object out, so a host cannot mutate the shared declaration', () => {
    expect(paymentsJobBlueprints()).not.toBe(paymentsJobBlueprints());
  });

  it('settles a charge the provider reports PAID', async () => {
    const { deps, settled } = hostDeps();

    await paymentsJobBlueprints().reconcilePending.handle(undefined, deps, context);

    expect(settled).toHaveLength(1);
    expect(settled[0]?.status).toBe('PAID');
  });

  it('leaves a charge the provider still calls PENDING alone', async () => {
    const { deps, settled } = hostDeps({
      gateway: { refreshCharge: async () => snapshot('PENDING') },
    });

    await paymentsJobBlueprints().reconcilePending.handle(undefined, deps, context);

    expect(settled).toHaveLength(0);
  });

  it('does not throw when the provider is down', async () => {
    // A provider outage must not fail the job: a thrown handler retries, which
    // is a retry storm against an acquirer that is already struggling. The next
    // tick asks again, and that IS the recovery model.
    const { deps, settled } = hostDeps({
      gateway: {
        refreshCharge: async () => {
          throw new Error('502 from the acquirer');
        },
      },
    });

    await expect(
      paymentsJobBlueprints().reconcilePending.handle(undefined, deps, context),
    ).resolves.toBeUndefined();
    expect(settled).toHaveLength(0);
  });
});
