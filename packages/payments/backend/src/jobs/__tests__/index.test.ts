import { afterEach, describe, expect, it, vi } from 'vitest';

import { verificationReference } from '../../activation/reference';
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

/**
 * The three sweeps that used to be host code.
 *
 * What these pin is the half a host was restating: the outcomes each pass must
 * distinguish, and the reporting rule that keeps a quiet pass honest. The
 * cadence and the single-flight posture are asserted in the wiring suite's
 * compliance run, where the whole declaration is read at once.
 */


/**
 * An activation context with `outstanding` unproven configs.
 *
 * Built from the package's own `verificationReference`, because
 * `listStranded` re-derives the prefix from the config's identity and drops a
 * reference naming another merchant — a hand-typed string would be silently
 * filtered and the case would assert nothing. Neither proof source answers, so
 * every row stays unsettled: `checked` counts them, `stamped` stays 0, which
 * is the reporting case without needing a settled charge.
 */
function activationCtx(outstanding: number): PaymentsJobDeps['activation'] {
  const rows = Array.from({ length: outstanding }, (_unused, index) => {
    const merchantId = `client-${index + 1}`;
    return {
      merchant: { kind: 'TENANT' as const, id: merchantId },
      provider: 'pagbank',
      reference: verificationReference('pagbank', merchantId),
    };
  });
  return {
    providers: { has: () => false, get: () => undefined } as never,
    settings: {
      applyChargeVerification: () => Promise.resolve(undefined),
      getPendingVerification: () => Promise.resolve(null),
      setPendingVerification: () => Promise.resolve(undefined),
    } as never,
    config: { get: () => Promise.resolve(null) } as never,
    charges: { findByProviderChargeId: () => Promise.resolve(null) } as never,
    proofs: {
      listOutstanding: () => Promise.resolve(rows),
      findProcessedDeliveryPayload: () => Promise.resolve(null),
    },
  } as PaymentsJobDeps['activation'];
}

interface Logged {
  info: string[];
  warn: string[];
  error: string[];
}

/** A logger per case — the flakiness lane refuses a reassigned closed-over binding. */
function recorder(): { context: PaymentsJobContext; logged: Logged } {
  const logged: Logged = { info: [], warn: [], error: [] };
  return {
    logged,
    context: {
      logger: {
        info: (line: string) => logged.info.push(line),
        warn: (line: string) => logged.warn.push(line),
        error: (line: string) => logged.error.push(line),
      },
    },
  };
}

describe('the webhook drain', () => {
  const blueprint = () => paymentsJobBlueprints().webhookDrain;

  it('stays silent on a pass with nothing due', async () => {
    // Honest only because the store answers eligibility in the QUERY: every
    // row it lists, it replays. Nothing attempted therefore means nothing was
    // due, never "the batch was full of rows I could not touch".
    const { context: ctx, logged } = recorder();
    const { deps } = hostDeps({
      replayWebhooks: () =>
        Promise.resolve({ attempted: 0, processed: 0, failed: 0, skipped: 0, undecodable: 0 }),
    });
    await blueprint().handle(undefined, deps, ctx);
    expect(logged.info).toEqual([]);
  });

  it('breaks that silence for rows it could not decode', async () => {
    // A pass whose whole batch is unrehydratable attempts nothing, and staying
    // quiet would report a healthy sweep doing no work — while each of those
    // rows may be a paid order nobody can reconstruct.
    const { context: ctx, logged } = recorder();
    const { deps } = hostDeps({
      replayWebhooks: () =>
        Promise.resolve({ attempted: 0, processed: 0, failed: 0, skipped: 0, undecodable: 3 }),
    });
    await blueprint().handle(undefined, deps, ctx);
    expect(logged.info).toHaveLength(1);
    expect(logged.info[0]).toContain('3 could not be decoded');
  });

  it('reports counts and never content', async () => {
    // The payload is the provider's own data about a buyer and the headers
    // carry the delivery's signature, so neither may reach a log.
    const { context: ctx, logged } = recorder();
    const { deps } = hostDeps({
      replayWebhooks: () =>
        Promise.resolve({ attempted: 5, processed: 4, failed: 1, skipped: 0, undecodable: 0 }),
    });
    await blueprint().handle(undefined, deps, ctx);
    expect(logged.info[0]).toContain('replayed 5: 4 applied, 1 still failing');
  });
});

describe('the activation reconcile', () => {
  const blueprint = () => paymentsJobBlueprints().reconcileActivations;

  it('is silent when nothing is outstanding — the steady state', async () => {
    const { context: ctx, logged } = recorder();
    const { deps } = hostDeps();
    // The context is handed to the package's own reconcile; a host with no
    // stranded rows sees nothing at all.
    await blueprint().handle(undefined, { ...deps, activation: activationCtx(0) }, ctx);
    expect(logged.info).toEqual([]);
  });

  it('reports what it stamped when there was something to repair', async () => {
    const { context: ctx, logged } = recorder();
    const { deps } = hostDeps();
    await blueprint().handle(undefined, { ...deps, activation: activationCtx(2) }, ctx);
    expect(logged.info[0]).toContain('checked 2');
  });
});

describe('the oauth renewal', () => {
  const blueprint = () => paymentsJobBlueprints().oauthRenewal;

  const connection = (id: string) => ({
    merchant: { kind: 'TENANT' as const, id },
    provider: 'pagbank',
    expiresAt: new Date('2026-09-01T00:00:00Z'),
  });

  it('does nothing, loudly or otherwise, when no grant is due', async () => {
    const { context: ctx, logged } = recorder();
    const { deps } = hostDeps({
      oauth: { listExpiring: () => Promise.resolve([]), refresh: () => Promise.reject(new Error('unreachable')) },
    });
    await blueprint().handle(undefined, deps, ctx);
    expect(logged).toEqual({ info: [], warn: [], error: [] });
  });

  it('asks only for grants inside the fortnight of runway', async () => {
    const asked: Date[] = [];
    const { context: ctx } = recorder();
    const { deps } = hostDeps({
      now: () => new Date('2026-08-17T12:00:00Z'),
      oauth: {
        listExpiring: (before: Date) => {
          asked.push(before);
          return Promise.resolve([]);
        },
        refresh: () => Promise.reject(new Error('unreachable')),
      },
    });
    await blueprint().handle(undefined, deps, ctx);
    // 14 days ahead of the injected clock — early renewal costs one request,
    // late renewal costs a merchant that cannot take money.
    expect(asked[0]?.toISOString()).toBe('2026-08-31T12:00:00.000Z');
  });

  it('treats a RECONNECT_REQUIRED result as a failure, not a success', async () => {
    // `refresh` RECORDS the refusal rather than throwing, so a resolved promise
    // is not automatically a renewal — the status has to be read back.
    const { context: ctx, logged } = recorder();
    const told: string[] = [];
    const { deps } = hostDeps({
      oauth: {
        listExpiring: () => Promise.resolve([connection('c1')]),
        refresh: () => Promise.resolve({ status: 'RECONNECT_REQUIRED' } as never),
        onReconnectRequired: (_conn, reason) => told.push(reason),
      },
    });
    await blueprint().handle(undefined, deps, ctx);
    expect(logged.warn[0]).toContain('must reauthorize');
    expect(logged.info[0]).toContain('0/1 renewed, 1 need reauthorization');
    // The warn reaches an operator; this reaches the person who can fix it.
    expect(told).toEqual(['refused']);
  });

  it('is loudest about the outcome that loses the tokens outright', async () => {
    // The provider rotated and we could not keep what it returned, so the
    // tokens that still work exist nowhere. The merchant is down until the
    // owner reauthorizes and nothing else will say so.
    const { context: ctx, logged } = recorder();
    const told: string[] = [];
    const { deps } = hostDeps({
      oauth: {
        listExpiring: () => Promise.resolve([connection('c1')]),
        refresh: () => Promise.reject(new Error('store write failed')),
        onReconnectRequired: (_conn, reason) => told.push(reason),
      },
    });
    await blueprint().handle(undefined, deps, ctx);
    expect(logged.error[0]).toContain('left the connection unusable');
    expect(told).toEqual(['lost']);
  });

  it('lets one failed connection not cost the rest of the batch', async () => {
    const { context: ctx, logged } = recorder();
    const { deps } = hostDeps({
      oauth: {
        listExpiring: () => Promise.resolve([connection('c1'), connection('c2')]),
        refresh: (merchant) =>
          merchant.id === 'c1'
            ? Promise.reject(new Error('boom'))
            : Promise.resolve({ status: 'CONNECTED' } as never),
      },
    });
    await blueprint().handle(undefined, deps, ctx);
    expect(logged.info[0]).toContain('1/2 renewed');
    expect(logged.error).toHaveLength(1);
  });
});
