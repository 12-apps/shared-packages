import { describe, expect, it, vi } from 'vitest';

import {
  createCycleCollector,
  type BillingInstrument,
  type CollectableCycle,
  type CycleCollectionDeps,
} from '../core/cycle-collection';
import type { InstallmentQuoteRequest, InstallmentQuoteResult } from '../core/installments';
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
  createdAt?: Date;
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
  /** The gateway's quote, or `false` for a gateway without the method. */
  quote?: ((request: InstallmentQuoteRequest) => InstallmentQuoteResult) | false;
  /** What the gateway's charge answers instead — an earlier attempt stored under the cycle's key. */
  returned?: Partial<ChargeSnapshot>;
  /** The charge was stored by an EARLIER call (its row predates this one), not raised now. */
  stale?: boolean;
}

/** A quoting provider's answer: 10% on top, whatever the count. */
function tenPercent(request: InstallmentQuoteRequest): InstallmentQuoteResult {
  const total = Math.round(request.amount.amountCents * 1.1);
  return {
    ok: true,
    provider: 'pagbank',
    quote: {
      installments: request.installments,
      perInstallment: { amountCents: Math.ceil(total / request.installments), currency: 'BRL' },
      total: { amountCents: total, currency: 'BRL' },
      interest: { amountCents: total - request.amount.amountCents, currency: 'BRL' },
    },
  };
}

function world(options: WorldOptions = {}) {
  // Typed through the generic rather than by declaring unused parameters, so
  // `mock.calls` is readable — what the flow SENDS is half of what these cases
  // assert.
  const charge = vi.fn<(merchant: MerchantRef, input: ChargeCall, opts?: unknown) => Promise<RaisedCharge>>(
    async (_merchant, input) => ({
      provider: 'pagbank',
      providerChargeId: 'CHAR_A',
      snapshot: { ...snapshotWith(options.status ?? 'PENDING'), amount: input.amount, ...options.returned },
      createdAt: options.stale ? new Date(0) : new Date('2999-01-01T00:00:00Z'),
    }),
  );
  const quoteInstallments = vi.fn<
    (merchant: MerchantRef, request: InstallmentQuoteRequest, provider?: string) => Promise<InstallmentQuoteResult>
  >(async (_merchant, request) => (options.quote || tenPercent)(request));
  const recordRaised = vi.fn(async () => undefined);
  const instruments = vi.fn(async () => ({
    instrument: options.instrument === undefined ? CARD_ON_FILE : options.instrument,
    hasAny: options.hasAny ?? true,
  }));

  const config = {
    gateway: options.quote === false ? { charge } : { charge, quoteInstallments },
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

  return { collector: createCycleCollector(config), charge, recordRaised, instruments, quoteInstallments };
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

describe('collectByCard in instalments (FUT-4382)', () => {
  it('leaves one payment exactly as before: no quote, no count, no pin', async () => {
    const { collector, charge, quoteInstallments, recordRaised } = world();

    const result = await collector.collectByCard('cycle-1', { installments: 1 });

    expect(quoteInstallments).not.toHaveBeenCalled();
    // Two arguments, as before — no third `options` pinning a provider.
    expect(charge.mock.calls[0]).toHaveLength(2);
    expect(charge.mock.calls[0]![1].amount).toEqual(CYCLE.amount);
    expect(charge.mock.calls[0]![1].card).not.toHaveProperty('installments');
    expect(recordRaised).toHaveBeenCalledWith('cycle-1', {
      provider: 'pagbank',
      providerChargeId: 'CHAR_A',
      method: 'CARD',
    });
    expect(result.snapshot).not.toHaveProperty('principal');
  });

  it('charges the QUOTED total in N, pinned to the quoting provider', async () => {
    const { collector, charge, quoteInstallments } = world();

    await collector.collectByCard('cycle-1', { installments: 3 });

    expect(quoteInstallments).toHaveBeenCalledWith(
      PLATFORM,
      {
        amount: CYCLE.amount,
        installments: 3,
        card: { savedCardToken: 'CARD_A' },
        merchantInitiated: true,
      },
      'pagbank',
    );
    const [, input, opts] = charge.mock.calls[0]!;
    expect(input.amount).toEqual({ amountCents: 10_890, currency: 'BRL' });
    expect(input.card).toMatchObject({ installments: 3, merchantInitiated: true, savedCardToken: 'CARD_A' });
    // Failover must never land the total on an acquirer that priced nothing.
    expect(opts).toEqual({ provider: 'pagbank' });
  });

  it('records principal, total and count apart, and returns them on the snapshot', async () => {
    const { collector, recordRaised } = world();

    const result = await collector.collectByCard('cycle-1', { installments: 3 });

    expect(recordRaised).toHaveBeenCalledWith('cycle-1', {
      provider: 'pagbank',
      providerChargeId: 'CHAR_A',
      method: 'CARD',
      installments: {
        count: 3,
        principal: CYCLE.amount,
        total: { amountCents: 10_890, currency: 'BRL' },
      },
    });
    expect(result.snapshot).toMatchObject({
      amount: { amountCents: 10_890, currency: 'BRL' },
      principal: CYCLE.amount,
      installments: 3,
    });
  });

  it('charges the re-quote, never a total quoted earlier', async () => {
    // The buyer was shown 10% on top; by the time the cycle falls due the
    // provider prices 20%. The charge takes what the provider says NOW.
    let rate = 1.1;
    const quote = (request: InstallmentQuoteRequest) => {
      const answer = tenPercent(request);
      if (!answer.ok) return answer;
      const total = Math.round(request.amount.amountCents * rate);
      return {
        ...answer,
        quote: {
          ...answer.quote,
          total: { amountCents: total, currency: 'BRL' },
          interest: { amountCents: total - request.amount.amountCents, currency: 'BRL' },
        },
      };
    };
    const { collector, charge, quoteInstallments } = world({ quote });
    const shown = await quoteInstallments(PLATFORM, { amount: CYCLE.amount, installments: 2, card: {} });
    expect(shown.ok && shown.quote.total.amountCents).toBe(10_890);
    rate = 1.2;

    await collector.collectByCard('cycle-1', { installments: 2 });

    expect(charge.mock.calls[0]![1].amount).toEqual({ amountCents: 11_880, currency: 'BRL' });
  });

  it('records nothing for a declined split, so the retry ladder survives', async () => {
    const { collector, recordRaised } = world({ status: 'DECLINED' });

    const result = await collector.collectByCard('cycle-1', { installments: 2 });

    expect(result.snapshot?.status).toBe('DECLINED');
    expect(recordRaised).not.toHaveBeenCalled();
  });

  it.each([
    ['a provider that quotes nothing', 'installments-unsupported' as const],
    ['a merchant-initiated split the provider refuses', 'installments-merchant-initiated' as const],
  ])('passes the refusal of %s through as the skip, charging nothing', async (_case, refusal) => {
    const { collector, charge, recordRaised } = world({
      quote: () => ({ ok: false, provider: 'pagbank', refusal }),
    });

    expect(await collector.collectByCard('cycle-1', { installments: 4 })).toEqual({
      skipped: refusal,
      snapshot: null,
    });
    expect(charge).not.toHaveBeenCalled();
    expect(recordRaised).not.toHaveBeenCalled();
  });

  it('skips a split when the gateway it was given cannot quote', async () => {
    const { collector, charge } = world({ quote: false });

    expect((await collector.collectByCard('cycle-1', { installments: 2 })).skipped).toBe('installments-unsupported');
    expect(charge).not.toHaveBeenCalled();
  });

  it.each([0, 13, 1.5, Number.NaN])('refuses a count of %s before asking anyone', async (installments) => {
    const { collector, charge, quoteInstallments, instruments } = world();

    expect((await collector.collectByCard('cycle-1', { installments })).skipped).toBe('installments-out-of-range');
    expect(quoteInstallments).not.toHaveBeenCalled();
    expect(instruments).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

  it('still answers the cycle guards first — a settled cycle is already-paid, not a split refusal', async () => {
    const { collector } = world({ row: 'settled' });
    expect((await collector.collectByCard('cycle-1', { installments: 99 })).skipped).toBe('already-paid');
  });
});

describe('collectByCard with the cardholder at the screen (FUT-4382)', () => {
  it('quotes and charges customer-initiated when cardholderPresent', async () => {
    const { collector, charge, quoteInstallments } = world();

    await collector.collectByCard('cycle-1', { installments: 3, cardholderPresent: true });

    expect(quoteInstallments.mock.calls[0]![1].merchantInitiated).toBe(false);
    expect(charge.mock.calls[0]![1].card).toMatchObject({ merchantInitiated: false, installments: 3 });
  });

  it('defaults to merchant-initiated for both the quote and the charge', async () => {
    const { collector, charge, quoteInstallments } = world();

    await collector.collectByCard('cycle-1', { installments: 3, cardholderPresent: false });

    expect(quoteInstallments.mock.calls[0]![1].merchantInitiated).toBe(true);
    expect(charge.mock.calls[0]![1].card).toMatchObject({ merchantInitiated: true });
  });

  it('charges one payment customer-initiated too', async () => {
    const { collector, charge } = world();

    await collector.collectByCard('cycle-1', { cardholderPresent: true });

    expect(charge.mock.calls[0]![1].card).toMatchObject({ merchantInitiated: false });
  });
});

describe('the charge that came back is not the one asked for (FUT-4382)', () => {
  // The gateway answers the cycle's key with the charge already stored under
  // it: an earlier sweep raised 3x and its `recordRaised` failed.
  const EARLIER_3X = { amount: { amountCents: 10_605, currency: 'BRL' }, installments: 3 };

  it("records the stored charge's own split, never this call's quote", async () => {
    const { collector, recordRaised } = world({ returned: EARLIER_3X });

    const result = await collector.collectByCard('cycle-1', { installments: 6 });

    expect(recordRaised).toHaveBeenCalledWith('cycle-1', {
      provider: 'pagbank',
      providerChargeId: 'CHAR_A',
      method: 'CARD',
      installments: { count: 3, principal: CYCLE.amount, total: EARLIER_3X.amount },
    });
    expect(result.chargeMismatch).toMatch(/expected 10890 cents, got 10605/);
    expect(result.snapshot).toMatchObject({ installments: 3, amount: EARLIER_3X.amount });
  });

  it('stamps no split when the stored charge does not say its count, and flags it', async () => {
    const { collector, recordRaised } = world({ returned: { amount: EARLIER_3X.amount } });

    const result = await collector.collectByCard('cycle-1', { installments: 3 });

    // The charge id is still recorded: the charge exists, and the guard needs it.
    expect(recordRaised).toHaveBeenCalledWith('cycle-1', {
      provider: 'pagbank',
      providerChargeId: 'CHAR_A',
      method: 'CARD',
    });
    expect(result.chargeMismatch).toBeDefined();
    expect(result.snapshot).not.toHaveProperty('principal');
  });

  it('flags a count that differs at the same amount', async () => {
    const { collector } = world({ returned: { amount: { amountCents: 10_890, currency: 'BRL' }, installments: 2 } });

    const result = await collector.collectByCard('cycle-1', { installments: 3 });

    expect(result.chargeMismatch).toBe('expected 3 installments, got 2');
    expect(result.snapshot?.installments).toBe(2);
  });

  it('flags a one-payment retry handed an earlier charge at another amount, stamping no split', async () => {
    // No adapter reports a count, so only the amount gives the earlier 3x away.
    const { collector, recordRaised } = world({ returned: { amount: { amountCents: 10_452, currency: 'BRL' } } });

    const result = await collector.collectByCard('cycle-1');

    expect(recordRaised).toHaveBeenCalledWith('cycle-1', {
      provider: 'pagbank',
      providerChargeId: 'CHAR_A',
      method: 'CARD',
    });
    expect(result.chargeMismatch).toBe('expected 9900 cents, got 10452');
    expect(result.snapshot).not.toHaveProperty('principal');
  });

  it('leaves the count out of a matching split it cannot confirm, and says so', async () => {
    // Same total, no reported count, and a row older than this call: it may be
    // an earlier attempt at another count that priced the same.
    const { collector, recordRaised } = world({ stale: true });

    const result = await collector.collectByCard('cycle-1', { installments: 3 });

    expect(recordRaised).toHaveBeenCalledWith('cycle-1', {
      provider: 'pagbank',
      providerChargeId: 'CHAR_A',
      method: 'CARD',
      installments: { principal: CYCLE.amount, total: { amountCents: 10_890, currency: 'BRL' } },
    });
    expect(result.chargeMismatch).toBe('count-unconfirmed');
    expect(result.snapshot).not.toHaveProperty('installments');
  });

  it('records the method of a PIX charge stored under the cycle id', async () => {
    const { collector, recordRaised } = world({ returned: { method: 'PIX' } });

    const result = await collector.collectByCard('cycle-1', { installments: 3 });

    expect(recordRaised).toHaveBeenCalledWith('cycle-1', expect.objectContaining({ method: 'PIX' }));
    expect(result.chargeMismatch).toBe('expected a CARD charge, got PIX');
  });

  it('adds no flag when the charge is the one asked for', async () => {
    const { collector } = world();
    expect(await collector.collectByCard('cycle-1', { installments: 3 })).not.toHaveProperty('chargeMismatch');
    expect(await world().collector.collectByCard('cycle-1')).not.toHaveProperty('chargeMismatch');
  });
});
