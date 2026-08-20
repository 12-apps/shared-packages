import { describe, expect, it, vi } from 'vitest';

import {
  createCycleCollector,
  type BillingInstrument,
  type CollectableCycle,
  type CycleCollectionDeps,
} from '../core/cycle-collection';
import type { ChargeSnapshot, MerchantRef } from '../core/types';

/**
 * COLLECTING A DUE CYCLE — the recurring money path.
 *
 * Every case here is a way to bill somebody twice, or to stop billing them at
 * all. They are asserted at this level rather than through a host's Prisma
 * because the rules are about the FLOW: which guard runs before which, what a
 * decline is allowed to leave behind, and which of two look-alike refusals the
 * customer is told about.
 *
 * The one that reads as an optimisation and is not: a DECLINED card must not
 * stamp `providerChargeId`. Stamping it makes the `already-charged` guard fire
 * on every later attempt, which silently turns a dunning retry ladder into a
 * single try — a customer who would have paid on attempt two is never asked
 * again, and nothing anywhere reports an error.
 */

const PLATFORM: MerchantRef = { kind: 'PLATFORM', id: 'platform' };

const CYCLE: CollectableCycle = {
  id: 'cycle-1',
  groupId: 'sub-1',
  amount: { amountCents: 9900, currency: 'BRL' },
  customer: { name: 'Acme Ltda', email: 'fin@acme.example', taxId: '11222333000181' },
};

const CARD_ON_FILE: BillingInstrument = {
  provider: 'pagbank',
  providerInstrumentId: 'CARD_A',
  providerCustomerId: 'CUS_A',
};

function snapshotWith(status: ChargeSnapshot['status']): ChargeSnapshot {
  return {
    provider: 'pagbank',
    providerChargeId: 'CHAR_A',
    reference: CYCLE.id,
    status,
    amount: CYCLE.amount,
    method: 'CARD',
  } as ChargeSnapshot;
}

/** What the gateway hands back — the two ids the flow records, plus the snapshot. */
interface RaisedCharge {
  provider: string;
  providerChargeId: string;
  snapshot: ChargeSnapshot;
}

/** What the collector hands the gateway, as these cases read it back. */
interface ChargeCall {
  reference: string;
  amount: { amountCents: number; currency: string };
  method: 'PIX' | 'CARD';
  idempotencyKey: string;
  card?: Record<string, unknown>;
}

interface WorldOptions {
  enabled?: boolean;
  row?: Awaited<ReturnType<CycleCollectionDeps['cycles']['read']>>;
  defaultProvider?: string | null;
  instrument?: BillingInstrument | null;
  hasAny?: boolean;
  status?: ChargeSnapshot['status'];
}

function world(options: WorldOptions = {}) {
  // Typed through the generic rather than by declaring unused parameters, so
  // `mock.calls` is readable — what the flow SENDS is half of what these cases
  // assert.
  const charge = vi.fn<(merchant: MerchantRef, input: ChargeCall) => Promise<RaisedCharge>>(
    async () => ({
      provider: 'pagbank',
      providerChargeId: 'CHAR_A',
      snapshot: snapshotWith(options.status ?? 'PENDING'),
    }),
  );
  const recordRaised = vi.fn(async () => undefined);
  const instruments = vi.fn(async () => ({
    instrument: options.instrument === undefined ? CARD_ON_FILE : options.instrument,
    hasAny: options.hasAny ?? true,
  }));

  const config = {
    gateway: { charge },
    credentials: {
      defaultProvider: async () =>
        options.defaultProvider === undefined ? 'pagbank' : options.defaultProvider,
    },
    cycles: {
      read: async () => options.row ?? { cycle: CYCLE, providerChargeId: null },
      recordRaised,
    },
    instruments,
    merchant: PLATFORM,
    enabled: async () => options.enabled ?? true,
  } as unknown as CycleCollectionDeps;

  return { collector: createCycleCollector(config), charge, recordRaised, instruments };
}

describe('the guards, before either method charges anything', () => {
  it('does nothing quietly when the deployment has no platform account', async () => {
    // Quietly on purpose: a sweep over hundreds of tenants must not throw once
    // per tenant deep inside the gateway for one missing config value.
    const { collector, charge } = world({ enabled: false });

    expect(await collector.collectByPush('cycle-1')).toEqual({
      skipped: 'no-platform-account',
      snapshot: null,
    });
    expect(await collector.collectByCard('cycle-1')).toEqual({
      skipped: 'no-platform-account',
      snapshot: null,
    });
    expect(charge).not.toHaveBeenCalled();
  });

  it('refuses a settled cycle — re-charging a refund takes the money back', async () => {
    const { collector, charge } = world({ row: 'settled' });

    expect((await collector.collectByPush('cycle-1')).skipped).toBe('already-paid');
    expect((await collector.collectByCard('cycle-1')).skipped).toBe('already-paid');
    expect(charge).not.toHaveBeenCalled();
  });

  it('refuses a cycle that already has a charge open at the provider', async () => {
    // Push: a payable code is outstanding and a second lets them pay twice.
    // Card: an attempt already reached the provider, and re-raising it under a
    // fresh key is the exact double charge the idempotency key exists to stop.
    const { collector, charge } = world({ row: { cycle: CYCLE, providerChargeId: 'CHAR_EXISTING' } });

    expect((await collector.collectByPush('cycle-1')).skipped).toBe('already-charged');
    expect((await collector.collectByCard('cycle-1')).skipped).toBe('already-charged');
    expect(charge).not.toHaveBeenCalled();
  });

  it('reports an unknown cycle as its own skip, not as a failure', async () => {
    const { collector } = world({ row: 'unknown' });
    expect((await collector.collectByPush('cycle-1')).skipped).toBe('unknown-payment');
  });
});

describe('collectByPush', () => {
  it("charges the PLATFORM's account, keyed by the cycle's own id", async () => {
    const { collector, charge, recordRaised } = world();

    const result = await collector.collectByPush('cycle-1');

    expect(result.skipped).toBeNull();
    const [merchant, input] = charge.mock.calls[0]!;
    // Never the tenant's own connected account — billing a store's acquirer for
    // its own subscription takes the money and hands it straight back.
    expect(merchant).toEqual(PLATFORM);
    // Reference AND key are the cycle row, so every retry of this cycle
    // collapses onto one charge however many times a queue redelivers it.
    expect(input.reference).toBe('cycle-1');
    expect(input.idempotencyKey).toBe('cycle-1');
    expect(input.method).toBe('PIX');
    expect(recordRaised).toHaveBeenCalledWith('cycle-1', {
      provider: 'pagbank',
      providerChargeId: 'CHAR_A',
      method: 'PIX',
    });
  });

  it('needs no instrument at all', async () => {
    const { collector, instruments } = world({ instrument: null, hasAny: false });

    expect((await collector.collectByPush('cycle-1')).skipped).toBeNull();
    expect(instruments).not.toHaveBeenCalled();
  });
});

describe('collectByCard', () => {
  it('charges the card on file off-session, pinned to the provider that vaulted it', async () => {
    const { collector, charge } = world();

    expect((await collector.collectByCard('cycle-1')).skipped).toBeNull();

    const [, input] = charge.mock.calls[0]!;
    expect(input.card).toEqual({
      savedCardToken: 'CARD_A',
      customerRef: 'CUS_A',
      // Naming the owner is what stops the gateway offering this token to a
      // provider that cannot read it.
      tokenProvider: 'pagbank',
      // Nobody is at the keyboard: without this the issuer may decline for the
      // absence of a stored-credential agreement, or hold the intent waiting
      // for an authentication a scheduled job can never give.
      merchantInitiated: true,
    });
  });

  it('asks for the card at TODAY\'s collecting provider', async () => {
    const { collector, instruments } = world({ defaultProvider: 'stripe' });

    await collector.collectByCard('cycle-1');

    expect(instruments).toHaveBeenCalledWith('sub-1', 'stripe');
  });

  /**
   * Two refusals that look alike and are not. A customer holding a card the
   * platform can no longer charge did not fail to add one — the platform
   * switched acquirer — and telling them the same thing makes a solvable
   * problem read as a dead end.
   */
  it('separates "never added a card" from "card at a provider we left"', async () => {
    const never = world({ instrument: null, hasAny: false });
    expect((await never.collector.collectByCard('cycle-1')).skipped).toBe('no-instrument');

    const elsewhere = world({ instrument: null, hasAny: true });
    expect((await elsewhere.collector.collectByCard('cycle-1')).skipped).toBe('instrument-elsewhere');
  });

  it('skips when nothing is enabled to collect through', async () => {
    const { collector, charge } = world({ defaultProvider: null });

    expect((await collector.collectByCard('cycle-1')).skipped).toBe('no-platform-account');
    expect(charge).not.toHaveBeenCalled();
  });

  /** The expensive one — see the file header. */
  it('records NOTHING for a declined card, so the retry ladder survives', async () => {
    const { collector, recordRaised } = world({ status: 'DECLINED' });

    const result = await collector.collectByCard('cycle-1');

    // The decline is a RESULT, not a throw: the caller's retry policy reads it.
    expect(result.skipped).toBeNull();
    expect(result.snapshot?.status).toBe('DECLINED');
    // A decline left no authorization and nothing payable. Stamping the row
    // would make `already-charged` fire forever after.
    expect(recordRaised).not.toHaveBeenCalled();
  });

  it('records a PENDING charge, which is exactly what the guard must catch next time', async () => {
    const { collector, recordRaised } = world({ status: 'PENDING' });

    await collector.collectByCard('cycle-1');

    expect(recordRaised).toHaveBeenCalledWith('cycle-1', {
      provider: 'pagbank',
      providerChargeId: 'CHAR_A',
      method: 'CARD',
    });
  });
});
