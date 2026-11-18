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

type Next = 'OK' | 'DOWN' | 'LOST' | { lostPart: number };
const down = () => new ProviderRequestError('pagbank', 'answered 503', { httpStatus: 503 });

function world() {
  const instants = [new Date(T0)];
  /** CHAR_1's figure, its script and its sends; `other` is every other charge (another store's), which always answers. */
  const provider = { refundedCents: 0, readThrows: 0, script: [] as Next[], sent: [] as number[], other: {} as Record<string, number> };
  const refundedOf = (charge: string) => (charge === 'CHAR_1' ? provider.refundedCents : (provider.other[charge] ?? 0));
  const gateway = {
    refund: vi.fn(async (_m: unknown, _p: unknown, input: { providerChargeId: string; amount?: { amountCents: number } }) => {
      const charge = input.providerChargeId;
      const cents = input.amount?.amountCents ?? CAPTURE - refundedOf(charge);
      const answer = { provider: 'pagbank', providerChargeId: charge, providerRefundId: `r${charge}${cents}`, status: 'REFUNDED' as const, amount: { amountCents: cents, currency: 'BRL' } };
      if (charge !== 'CHAR_1') {
        provider.other[charge] = refundedOf(charge) + cents;
        return answer;
      }
      provider.sent.push(cents);
      const next = provider.script.shift() ?? 'OK';
      if (next === 'DOWN') throw down();
      provider.refundedCents += typeof next === 'object' ? next.lostPart : cents;
      if (next !== 'OK') throw down();
      return answer;
    }),
    refreshCharge: vi.fn(async (_m: unknown, _p: unknown, charge: string) => {
      if (charge === 'CHAR_1' && provider.readThrows > 0) {
        provider.readThrows -= 1;
        throw down();
      }
      const refunded = refundedOf(charge);
      return {
        status: refunded >= CAPTURE ? ('REFUNDED' as const) : refunded > 0 ? ('PARTIALLY_REFUNDED' as const) : ('PAID' as const),
        amount: { amountCents: CAPTURE, currency: 'BRL' },
        refundedAmount: { amountCents: refunded, currency: 'BRL' },
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
  const row = async (key: { subject: string; providerChargeId?: string }) => (await store.find('pagbank', key.providerChargeId ?? 'CHAR_1', key.subject))!;
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
  it('Y landed unproven, X landed unproven on top of it: pressing Y then X adopts Y, X goes pending, 809 back, never 1109', async () => {
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
    // Round 2: Y was adopted since X's baseline with an older baseline of its own, so nothing tells whether
    // its money is inside X's baseline. X is neither adopted nor sent: pending, for a person (FUT-4951 R2-B1).
    expect(await w.row(X)).toMatchObject({ settledAt: null, exhausted: true });
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

/** Y (300) then X (509) each run out of attempts in an outage, nothing landed: both pending, baselines 0. */
async function bothPendingAfterOutage(w: ReturnType<typeof world>): Promise<void> {
  w.provider.script.push('DOWN', 'DOWN', 'DOWN', 'DOWN');
  await w.retrier.openDue(Y);
  for (const ms of [T0, T0 + 30_000, T0 + 5 * MIN, T0 + 15 * MIN]) await w.tick(ms);
  w.provider.script.push('DOWN', 'DOWN', 'DOWN', 'DOWN');
  await w.retrier.openDue(X);
  for (const ms of [T0 + 20 * MIN, T0 + 20 * MIN + 30_000, T0 + 25 * MIN, T0 + 35 * MIN]) await w.tick(ms);
  for (const key of [Y, X]) expect(await w.row(key)).toMatchObject({ exhausted: true, settledAt: null, refundedBeforeCents: 0 });
}

describe('R2-B1: a sibling REFUNDED after the baseline is subtracted by what its settling send asked', () => {
  /** Press one pending part, then the other, after the outage; answers what each press sent. */
  async function pressInOrder(first: typeof X, second: typeof X) {
    const w = world();
    await bothPendingAfterOutage(w);
    w.at(T0 + 40 * MIN);
    await w.retrier.press(first);
    w.at(T0 + 41 * MIN);
    await w.retrier.press(second);
    for (const key of [X, Y]) expect(await w.row(key)).toMatchObject({ settledHow: 'REFUNDED', lastSentCents: key.amountCents });
    return { sent: w.provider.sent.slice(8), total: w.provider.refundedCents };
  }

  it('Q2: after an outage, pressing Y then X refunds 809, each part once', async () => {
    expect(await pressInOrder(Y, X)).toEqual({ sent: [300, 509], total: 809 });
  });

  it('Q2: after an outage, pressing X then Y refunds 809, each part once', async () => {
    expect(await pressInOrder(X, Y)).toEqual({ sent: [509, 300], total: 809 });
  });

  it('partial: Y\'s 200 landed before X\'s baseline and its last 100 after it; X is sent whole, never 200 again', async () => {
    await partialScenario();
  });

  /** Y lands 200 of its 300 before X's baseline (answer lost), its last 100 after it. */
  async function partialScenario() {
    const w = world();
    w.provider.script.push({ lostPart: 200 }, 'DOWN', 'DOWN', 'DOWN');
    await w.retrier.openDue(Y);
    for (const ms of [T0, T0 + 30_000, T0 + 5 * MIN, T0 + 15 * MIN]) await w.tick(ms);
    // Y's attempts 2–4 read 200 back and send the 100 still owed, with no answer.
    expect(w.provider.sent).toEqual([300, 100, 100, 100]);
    w.provider.script.push('DOWN', 'DOWN', 'DOWN', 'DOWN');
    await w.retrier.openDue(X);
    for (const ms of [T0 + 20 * MIN, T0 + 20 * MIN + 30_000, T0 + 25 * MIN, T0 + 35 * MIN]) await w.tick(ms);
    expect(await w.row(X)).toMatchObject({ exhausted: true, refundedBeforeCents: 200 });
    w.at(T0 + 40 * MIN);
    await w.retrier.press(Y); // reads 200 back, sends the last 100
    w.at(T0 + 41 * MIN);
    await w.retrier.press(X); // +100 since its baseline, all of it Y's settling send: X owes all 509
    expect(w.provider.sent.slice(8)).toEqual([100, 509]);
    expect(w.provider.refundedCents).toBe(809);
    expect(await w.row(Y)).toMatchObject({ settledHow: 'REFUNDED', lastSentCents: 100 });
    expect(await w.row(X)).toMatchObject({ settledHow: 'REFUNDED', lastSentCents: 509 });
  }
});

describe('R2-N2: a held-back part never takes another store\'s slot for more than one tick', () => {
  it('another store\'s due row is refunded the tick after the held-back rows are deferred', async () => {
    await otherStoreScenario();
  });

  /** X in doubt, Y and Z held back behind it, and another store's whole-charge row due meanwhile. */
  async function otherStoreScenario() {
    const w = world();
    const other = { ...X, merchant: { kind: 'TENANT' as const, id: 'tenant-2' }, reference: 'ref-2', providerChargeId: 'CHAR_2', subject: 'order', boundTo: 'order', amountCents: null };
    w.provider.script.push('DOWN');
    await w.retrier.openDue(X);
    await w.tick(T0); // X in doubt, next at T0 + 30 s
    w.at(T0 + 10_000);
    await w.retrier.openDue(Y);
    await w.retrier.openDue(Z);
    w.at(T0 + 20_000);
    await w.retrier.openDue(other);
    await w.tick(T0 + 30_000); // Y and Z take the two slots and are deferred
    expect(await w.row(other)).toMatchObject({ attempt: 0, settledAt: null });
    await w.tick(T0 + 90_000); // the other store's row, then X
    expect(await w.row(other)).toMatchObject({ settledHow: 'REFUNDED' });
    expect(w.provider.other.CHAR_2).toBe(CAPTURE);
    expect(await w.row(X)).toMatchObject({ settledHow: 'REFUNDED' });
  }
});
