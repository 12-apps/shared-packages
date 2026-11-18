import { describe, expect, it, vi } from 'vitest';

import { ProviderRequestError } from '../core/errors';
import { createRefundRetrier } from '../core/refund-series';
import type { RefundSeriesRow } from '../core/refund-series-store';
import type { MerchantRef } from '../core/types';
import { createMemoryRefundRetryStore } from '../memory';

/**
 * FUT-4951 review round 1: "one doubt per charge" at the sweep's DEFAULT batch
 * (B1), and a sibling's money that already sat inside a part's baseline (B2).
 * Same world as `refund-read-back.test.ts`: a fake provider over a cumulative
 * refunded figure, a clock moved by hand.
 */

const MIN = 60_000;
const T0 = Date.parse('2026-11-18T15:00:00.000Z');
const CAPTURE = 11_050;
const MERCHANT: MerchantRef = { kind: 'TENANT', id: 'tenant-1' };
const part = (subject: string, amountCents: number) => ({
  merchant: MERCHANT,
  provider: 'pagbank',
  providerChargeId: 'CHAR_1',
  reference: 'ref-1',
  subject,
  boundTo: subject,
  cause: 'test',
  amountCents,
});
const X = part('part:x', 509);
const Y = part('part:y', 300);
const Z = part('part:z', 200);

type Next = 'OK' | 'DOWN' | 'LOST';
const down = () => new ProviderRequestError('pagbank', 'answered 503', { httpStatus: 503 });

function world() {
  const instants = [new Date(T0)];
  const provider = { refundedCents: 0, readThrows: 0, script: [] as Next[], sent: [] as number[] };
  const gateway = {
    refund: vi.fn(async (_m: unknown, _p: unknown, input: { amount?: { amountCents: number } }) => {
      const cents = input.amount?.amountCents ?? CAPTURE - provider.refundedCents;
      provider.sent.push(cents);
      const next = provider.script.shift() ?? 'OK';
      if (next === 'DOWN') throw down();
      provider.refundedCents += cents;
      if (next === 'LOST') throw down();
      return { provider: 'pagbank', providerChargeId: 'CHAR_1', providerRefundId: `r${provider.refundedCents}`, status: 'REFUNDED' as const, amount: { amountCents: cents, currency: 'BRL' } };
    }),
    refreshCharge: vi.fn(async () => {
      if (provider.readThrows > 0) {
        provider.readThrows -= 1;
        throw down();
      }
      return {
        status: provider.refundedCents > 0 ? ('PARTIALLY_REFUNDED' as const) : ('PAID' as const),
        amount: { amountCents: CAPTURE, currency: 'BRL' },
        refundedAmount: { amountCents: provider.refundedCents, currency: 'BRL' },
      };
    }),
  };
  const host = { stillOwed: vi.fn(async () => true), attempted: vi.fn(async () => undefined), refunded: vi.fn(async () => undefined) };
  const store = createMemoryRefundRetryStore();
  const retrier = createRefundRetrier({ gateway, store, host, now: () => instants[instants.length - 1]! });
  const at = (ms: number) => void instants.push(new Date(ms));
  /** One sweep tick at `ms`, at the production batch size. */
  const tick = async (ms: number) => {
    at(ms);
    await retrier.runDue();
  };
  const row = async (key: { subject: string }) => (await store.find('pagbank', 'CHAR_1', key.subject))!;
  return { retrier, provider, store, at, tick, row };
}

describe('B1: a held-back part is deferred, so it never stalls the sweep at the default batch', () => {
  it('two parts held back behind one in doubt: the one in doubt is still asked, and both follow', async () => {
    const w = world();
    w.provider.script.push('DOWN');
    await w.retrier.openDue(X);
    await w.tick(T0); // X in doubt, next at T0 + 30 s
    await w.retrier.openDue(Y);
    await w.retrier.openDue(Z);
    await w.tick(T0 + 30_000); // Y and Z are older due rows: both held back, deferred
    expect(w.provider.sent).toEqual([509]);
    for (const held of [Y, Z]) {
      expect(await w.row(held)).toMatchObject({ attempt: 0, settledAt: null, nextAt: new Date(T0 + 60_000).toISOString() });
    }
    await w.tick(T0 + 5 * MIN); // X goes first (its next_at is now the oldest), then Y
    await w.tick(T0 + 6 * MIN); // then Z
    expect(w.provider.sent).toEqual([509, 509, 300, 200]);
    for (const key of [X, Y, Z]) expect(await w.row(key)).toMatchObject({ settledHow: 'REFUNDED' });
    expect(w.provider.refundedCents).toBe(1_009);
  });

  it('two parts both in doubt never wait for each other: the older baseline goes first, the younger after it', async () => {
    const w = world();
    w.provider.script.push('DOWN');
    await w.retrier.openDue(X);
    await w.tick(T0); // X in doubt, baseline at T0
    // A press on Y raced the sweep: Y sent with its own baseline at T0 + 5 s, no answer, nothing landed.
    await w.retrier.openDue(Y);
    const y = await w.row(Y);
    const yInDoubt: RefundSeriesRow = {
      ...y, attempt: 1, of: 4, refusal: 'UNKNOWN', refundedBeforeCents: 0, refundedBeforeAt: new Date(T0 + 5_000).toISOString(), nextAt: new Date(T0 + 35_000).toISOString(),
    };
    expect(await w.store.saveIf(yInDoubt, y.version)).not.toBeNull();
    w.provider.script.push('DOWN'); // X's attempt 2 gets no answer either: X stays in doubt
    await w.tick(T0 + 40_000);
    expect(w.provider.sent).toEqual([509, 509]); // X went; Y, the younger doubt, was held back
    expect(await w.row(Y)).toMatchObject({ attempt: 1, settledAt: null, exhausted: false });
    await w.tick(T0 + 5 * MIN + 30_000); // X answers this time, then Y is no longer held back
    expect(w.provider.sent.slice(0, 3)).toEqual([509, 509, 509]);
    expect(await w.row(X)).toMatchObject({ settledHow: 'REFUNDED' });
    expect((await w.row(Y)).attempt).toBe(2);
  });
});

describe('B2: a sibling sent before the baseline is not subtracted again', () => {
  it('Y landed unproven, X landed unproven on top of it: pressing Y then X adopts both, 809 back, never 1109', async () => {
    const w = world();
    w.provider.script.push('LOST');
    await w.retrier.openDue(Y);
    await w.tick(T0); // Y's 300 lands, its answer is lost
    w.provider.readThrows = 3;
    for (const ms of [T0 + 30_000, T0 + 5 * MIN, T0 + 15 * MIN]) await w.tick(ms);
    expect(await w.row(Y)).toMatchObject({ exhausted: true, settledAt: null, refundedBeforeCents: 0 });

    w.provider.script.push('LOST');
    await w.retrier.openDue(X);
    await w.tick(T0 + 20 * MIN); // X's baseline is 300, Y's money already inside it; its 509 lands, answer lost
    w.provider.readThrows = 3;
    for (const ms of [T0 + 20 * MIN + 30_000, T0 + 25 * MIN, T0 + 35 * MIN]) await w.tick(ms);
    expect(await w.row(X)).toMatchObject({ exhausted: true, settledAt: null, refundedBeforeCents: 300 });

    w.at(T0 + 40 * MIN);
    await w.retrier.press(Y);
    expect(await w.row(Y)).toMatchObject({ settledHow: 'ADOPTED' });
    w.at(T0 + 41 * MIN);
    await w.retrier.press(X);
    expect(await w.row(X)).toMatchObject({ settledHow: 'ADOPTED' });
    expect(w.provider.sent).toEqual([300, 509]);
    expect(w.provider.refundedCents).toBe(809);
  });
});

describe('N1: a blind part past its first attempt whose consult fails stays pending', () => {
  it('no baseline, a dead claimant after a send, then a failed consult: pending, never resent', async () => {
    const w = world();
    await w.retrier.openDue(X);
    const x = await w.row(X);
    // Attempt 2 claimed by a process that died after sending, with no baseline (no read-back).
    expect(
      await w.store.saveIf({ ...x, attempt: 2, of: 4, refusal: 'UNKNOWN', claimedAt: new Date(T0).toISOString(), nextAt: new Date(T0 + 120_000).toISOString() }, x.version),
    ).not.toBeNull();
    w.provider.readThrows = 1;
    await w.tick(T0 + 121_000);
    expect(w.provider.sent).toEqual([]);
    expect(await w.row(X)).toMatchObject({ attempt: 3, exhausted: true, settledAt: null });
  });
});
