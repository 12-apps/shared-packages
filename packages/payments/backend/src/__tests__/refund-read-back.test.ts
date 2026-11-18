import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderRequestError } from '../core/errors';
import type { MerchantRef } from '../core/types';

/**
 * CONTRACT — FUT-4951 (delivery D6), the package half: a PART refund that got
 * no answer, or an answer of FAILED, is read back before it is asked again
 * (owner, option A). Expected-AFTER behaviour; written against
 * `@12-apps/payments-backend` as it is on main (24816b3a), where every `[fix]`
 * case is red and every `[control]` case is green. The rows are contract.md
 * §a (P1–P22); each `it` names its row.
 *
 * New surface these tests name (contract.md §a.1), none of which exists on main:
 *  - `ChargeSnapshot.refundedAmount?: Money` — the provider's own CUMULATIVE
 *    refunded total of the charge (settled or on its way back, never a failed
 *    one); ABSENT means "cannot say", never 0;
 *  - `ProviderCapabilities.refundReadBack?: boolean` — the adapter sets
 *    `refundedAmount` on every snapshot of a captured charge (PagBank, Itaú);
 *  - `refundableCents(snapshot)` (core, exported) — `amount − refundedAmount`,
 *    null when unknown: the surface FUT-5295 will read;
 *  - `RefundSeriesRow.refundedBeforeCents` / `refundedBeforeAt` — the
 *    refunded total read right before a part's FIRST send, and when;
 *  - `RefundRetrierHost.refunded`'s outcome carries `refundedCents` = what
 *    went back THROUGH this series (the part's amount once proven).
 *
 * Same style as `store-refund-retry.test.ts`: an in-memory store, a fake
 * gateway, a host that still owes the money, a clock moved by hand. The fake
 * gateway models the provider's cumulative figure, so "the refund landed but
 * its answer was lost" is a refund that grows the figure and then throws.
 */

afterEach(() => {
  vi.useRealTimers();
});

const MIN = 60_000;
const T0 = Date.parse('2026-11-18T15:00:00.000Z');
const TENANT: MerchantRef = { kind: 'TENANT', id: 'tenant-1' };
const CAPTURE = 11_050;
const PART_CENTS = 509;

type Fn = (...args: never[]) => unknown;
type Mod = Record<string, unknown>;

async function load<T = Fn>(path: string, name: string): Promise<T> {
  const mod = (await import(/* @vite-ignore */ path).catch(() => ({}))) as Mod;
  expect(typeof mod[name], `${path} exports ${name}`).toBe('function');
  return mod[name] as T;
}

const down = () => new ProviderRequestError('pagbank', 'PagBank answered 503', { httpStatus: 503 });

/** The key a close discount's provider part opens its series under (contract.md §b.2). */
const PART = {
  merchant: TENANT,
  provider: 'pagbank',
  providerChargeId: 'CHAR_1',
  reference: 'order-1',
  subject: 'close-discount:disc-1',
  boundTo: 'disc-1',
  cause: 'order.close_discount',
  amountCents: PART_CENTS,
};
/** Another part of the same charge (a missing item refunded later). */
const SIBLING = { ...PART, subject: 'shortage:sug-1', boundTo: 'sug-1', cause: 'order.shortage', amountCents: 300 };
/** The whole charge (a cancel). */
const WHOLE = { ...PART, subject: 'order', boundTo: '2026-11-18T14:00:00.000Z', cause: 'order.cancel', amountCents: null };

/** What the fake provider does with the NEXT refund it is sent. */
type Next =
  | 'OK' // refunds, answers REFUNDED
  | 'DOWN' // refunds nothing, throws a 503
  | 'LOST' // refunds, then throws a 503 (the answer was lost)
  | 'FAILED' // refunds nothing, answers FAILED
  | { lostPart: number }; // refunds only this much, then throws

interface World {
  retrier: Record<string, Fn>;
  provider: { refundedCents: number; readBack: boolean; readThrows: number; script: Next[]; sent: number[]; reads: number };
  host: { stillOwed: ReturnType<typeof vi.fn>; attempted: ReturnType<typeof vi.fn>; refunded: ReturnType<typeof vi.fn> };
  store: Record<string, Fn>;
  at: (ms: number) => void;
}

async function world(readBack = true): Promise<World> {
  const createRefundRetrier = await load<(deps: unknown) => Record<string, Fn>>('../core/refund-series', 'createRefundRetrier');
  const createMemoryRefundRetryStore = await load<() => Record<string, Fn>>('../memory', 'createMemoryRefundRetryStore');
  const instants = [new Date(T0)];
  const provider = { refundedCents: 0, readBack, readThrows: 0, script: [] as Next[], sent: [] as number[], reads: 0 };
  const gateway = {
    refund: vi.fn(async (_m: unknown, _p: unknown, input: { amount?: { amountCents: number } }) => {
      const cents = input.amount?.amountCents ?? CAPTURE - provider.refundedCents;
      provider.sent.push(cents);
      const next = provider.script.shift() ?? 'OK';
      if (next === 'DOWN') throw down();
      if (next === 'FAILED') return { providerChargeId: 'CHAR_1', providerRefundId: 'CHAR_1:f', status: 'FAILED', amount: { amountCents: cents, currency: 'BRL' } };
      if (next === 'LOST') {
        provider.refundedCents += cents;
        throw down();
      }
      if (typeof next === 'object') {
        provider.refundedCents += next.lostPart;
        throw down();
      }
      provider.refundedCents += cents;
      return { providerChargeId: 'CHAR_1', providerRefundId: `CHAR_1:${provider.refundedCents}`, status: 'REFUNDED', amount: { amountCents: cents, currency: 'BRL' } };
    }),
    refreshCharge: vi.fn(async () => {
      provider.reads += 1;
      if (provider.readThrows > 0) {
        provider.readThrows -= 1;
        throw down();
      }
      const whole = provider.refundedCents >= CAPTURE;
      return {
        provider: 'pagbank',
        providerChargeId: 'CHAR_1',
        status: whole ? 'REFUNDED' : provider.refundedCents > 0 ? 'PARTIALLY_REFUNDED' : 'PAID',
        amount: { amountCents: CAPTURE, currency: 'BRL' },
        method: 'CARD',
        ...(provider.readBack ? { refundedAmount: { amountCents: provider.refundedCents, currency: 'BRL' } } : {}),
      };
    }),
  };
  const host = {
    stillOwed: vi.fn(async () => true),
    attempted: vi.fn(async () => undefined),
    refunded: vi.fn(async () => undefined),
  };
  const store = createMemoryRefundRetryStore();
  const retrier = createRefundRetrier({ gateway, store, host, now: () => instants[instants.length - 1]! });
  return { retrier, provider, host, store, at: (ms) => void instants.push(new Date(ms)) };
}

/** The host's in-transaction act: the part's series opened due now, nothing sent (contract.md §b.1). */
async function opened(w: World, key: Record<string, unknown> = PART): Promise<void> {
  expect(await w.retrier.openDue!(key as never)).toBe(true);
}

/** One sweep tick at `ms`. */
async function tick(w: World, ms: number): Promise<void> {
  w.at(ms);
  await w.retrier.runDue!(10 as never);
}

const rowOf = async (w: World, key: Record<string, unknown> = PART) =>
  (await w.store.find!(key.provider as never, key.providerChargeId as never, key.subject as never)) as Record<string, unknown> | null;

// ── a.1 the adapter capability and the snapshot field ─────────────────────────
describe('a.1 the refunded total, read back from the provider', () => {
  it('P1 [fix] PagBank: an order body read back carries summary.refunded as refundedAmount (cumulative)', async () => {
    const orderSnapshot = await load<(res: unknown, id: string) => Record<string, unknown>>('../providers/pagbank-snapshots', 'orderSnapshot');
    const body = (refunded: number | undefined) => ({
      id: 'ORDE_1',
      reference_id: 'order-1',
      charges: [{ id: 'CHAR_1', status: 'PAID', amount: { value: CAPTURE, ...(refunded === undefined ? {} : { summary: { total: CAPTURE, paid: CAPTURE, refunded } }) }, payment_method: { type: 'CREDIT_CARD' } }],
    });
    expect(orderSnapshot(body(509), 'CHAR_1')).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedAmount: { amountCents: 509, currency: 'BRL' } });
    // A PAID charge that names no summary has refunded nothing: the same reading the partial path makes (FUT-4571).
    expect(orderSnapshot(body(undefined), 'CHAR_1')).toMatchObject({ status: 'PAID', refundedAmount: { amountCents: 0, currency: 'BRL' } });
  });

  it('P2 [fix] Itaú: a cob read back carries its devoluções, failed ones excluded, as refundedAmount', async () => {
    const snapshotFromCob = await load<(cob: unknown) => Record<string, unknown>>('../providers/itau-pix', 'snapshotFromCob');
    const cob = {
      txid: 'tx1',
      status: 'CONCLUIDA',
      valor: { original: '110.50' },
      pix: [{ endToEndId: 'E1', valor: '110.50', devolucoes: [{ id: 'd0', valor: '3.00', status: 'DEVOLVIDO' }, { id: 'd1', valor: '2.09', status: 'EM_PROCESSAMENTO' }, { id: 'd2', valor: '9.99', status: 'NAO_REALIZADO' }] }],
    };
    expect(snapshotFromCob(cob)).toMatchObject({ refundedAmount: { amountCents: 509, currency: 'BRL' } });
  });

  it('P3 [fix] the capability is declared by PagBank and Itaú, and by no provider that cannot prove the figure', async () => {
    const { pagbankProvider } = await import('../providers/pagbank');
    const { itauProvider } = await import('../providers/itau');
    const { stoneProvider } = await import('../providers/stone');
    const { stripeProvider } = await import('../providers/stripe');
    const { infinitePayProvider } = await import('../providers/infinitepay');
    const copy = await import('../providers/pt-BR');
    const caps = (adapter: { capabilities: Record<string, unknown> }) => adapter.capabilities.refundReadBack === true;
    expect(caps(pagbankProvider(copy.PT_BR_PAGBANK_COPY as never) as never)).toBe(true);
    expect(caps(itauProvider(copy.PT_BR_ITAU_COPY as never) as never)).toBe(true);
    // Not proven against a sandbox yet (contract.md §a.3): they fall back to the pending refund.
    expect(caps(stoneProvider(copy.PT_BR_STONE_COPY as never) as never)).toBe(false);
    expect(caps(stripeProvider(copy.PT_BR_STRIPE_COPY as never) as never)).toBe(false);
    expect(caps(infinitePayProvider(copy.PT_BR_INFINITEPAY_COPY as never) as never)).toBe(false);
  });

  it('P4 [fix] refundableCents: the capture less the read-back, null when the provider cannot say (FUT-5295)', async () => {
    const refundableCents = await load<(s: unknown) => number | null>('../index', 'refundableCents');
    const snap = { status: 'PARTIALLY_REFUNDED', amount: { amountCents: CAPTURE, currency: 'BRL' } };
    expect(refundableCents({ ...snap, refundedAmount: { amountCents: 509, currency: 'BRL' } })).toBe(CAPTURE - 509);
    expect(refundableCents(snap)).toBeNull();
  });

  it('P5 [control] a refresh that reports refundedAmount wins over the stored one; one that names none keeps it', async () => {
    const { mergeRefreshedSnapshot } = (await import('../core/snapshot-merge')) as Mod as { mergeRefreshedSnapshot: (a: unknown, b: unknown) => Record<string, unknown> };
    const base = { provider: 'pagbank', providerChargeId: 'CHAR_1', status: 'PARTIALLY_REFUNDED', method: 'CARD', amount: { amountCents: CAPTURE, currency: 'BRL' } };
    const stored = { ...base, refundedAmount: { amountCents: 300, currency: 'BRL' } };
    expect(mergeRefreshedSnapshot(stored, { ...base, refundedAmount: { amountCents: 809, currency: 'BRL' } })).toMatchObject({ refundedAmount: { amountCents: 809 } });
    expect(mergeRefreshedSnapshot(stored, base)).toMatchObject({ refundedAmount: { amountCents: 300 } });
  });
});

// ── a.2 the retry rule for a part ─────────────────────────────────────────────
describe('a.2 a part sent by the sweep: no answer or FAILED → read back → owed → retry or settle', () => {
  it('P6 [control] attempt 1 of a part opened due is sent by the sweep, after a consult, for its amount', async () => {
    const w = await world();
    await opened(w);
    await tick(w, T0);
    expect(w.provider.sent).toEqual([PART_CENTS]);
    expect(w.provider.reads).toBe(1);
    expect(await rowOf(w)).toMatchObject({ settledHow: 'REFUNDED' });
  });

  it('P7 [fix] the refunded total read before the FIRST send is kept on the row as the baseline', async () => {
    const w = await world();
    w.provider.refundedCents = 1_200; // an earlier part of the same charge, already back
    w.provider.script.push('DOWN');
    await opened(w);
    await tick(w, T0);
    expect(await rowOf(w)).toMatchObject({ refundedBeforeCents: 1_200, attempt: 1, exhausted: false, refusal: 'UNKNOWN' });
  });

  it('P8 [fix] case A — no answer, nothing landed: read back, nothing grew, the whole part is asked again', async () => {
    const w = await world();
    w.provider.script.push('DOWN');
    await opened(w);
    await tick(w, T0);
    await tick(w, T0 + 30_000);
    expect(w.provider.sent).toEqual([PART_CENTS, PART_CENTS]);
    expect(w.provider.refundedCents).toBe(PART_CENTS);
    expect(await rowOf(w)).toMatchObject({ settledHow: 'REFUNDED' });
    expect(w.host.refunded.mock.calls.at(-1)?.[1]).toMatchObject({ adopted: false, refundedCents: PART_CENTS });
  });

  it('P9 [fix] the lost answer — it DID land: the read-back proves it, nothing is sent again, adopted', async () => {
    const w = await world();
    w.provider.script.push('LOST');
    await opened(w);
    await tick(w, T0);
    await tick(w, T0 + 30_000);
    expect(w.provider.sent).toEqual([PART_CENTS]);
    expect(w.provider.refundedCents).toBe(PART_CENTS); // never 2 × 509
    expect(await rowOf(w)).toMatchObject({ settledHow: 'ADOPTED' });
    expect(w.host.refunded.mock.calls.at(-1)?.[1]).toMatchObject({ adopted: true, refundedCents: PART_CENTS });
  });

  it('P10 [fix] case B — answered FAILED: read as no answer, read back, asked again on the no-answer schedule', async () => {
    const w = await world();
    w.provider.script.push('FAILED');
    await opened(w);
    await tick(w, T0);
    expect(await rowOf(w)).toMatchObject({ attempt: 1, of: 4, exhausted: false, refusal: 'UNKNOWN' });
    await tick(w, T0 + 30_000);
    expect(w.provider.sent).toEqual([PART_CENTS, PART_CENTS]);
    expect(await rowOf(w)).toMatchObject({ settledHow: 'REFUNDED' });
  });

  it('P11 [fix] proven partly refunded: only what is still owed is asked (509 − 200 = 309)', async () => {
    const w = await world();
    w.provider.script.push({ lostPart: 200 });
    await opened(w);
    await tick(w, T0);
    await tick(w, T0 + 30_000);
    expect(w.provider.sent).toEqual([PART_CENTS, 309]);
    expect(w.provider.refundedCents).toBe(PART_CENTS);
    expect(w.host.refunded.mock.calls.at(-1)?.[1]).toMatchObject({ refundedCents: PART_CENTS });
  });

  it('P12 [fix] bounded: a provider that never answers is asked 4 times (T0, +30 s, +5 min, +15 min), then the part is pending', async () => {
    const w = await world();
    w.provider.script.push('DOWN', 'DOWN', 'DOWN', 'DOWN');
    await opened(w);
    for (const ms of [T0, T0 + 30_000, T0 + 5 * MIN, T0 + 15 * MIN, T0 + 60 * MIN]) await tick(w, ms);
    expect(w.provider.sent).toEqual([PART_CENTS, PART_CENTS, PART_CENTS, PART_CENTS]);
    expect(await rowOf(w)).toMatchObject({ attempt: 4, exhausted: true, settledAt: null });
    expect(w.retrier.viewOf!((await rowOf(w)) as never)).toMatchObject({ exhausted: true, nextAt: null });
  });

  it('P13 [fix] a read-back that fails sends nothing: the attempt counts as no answer, the next one reads again', async () => {
    const w = await world();
    w.provider.script.push('DOWN');
    await opened(w);
    await tick(w, T0);
    const before = w.provider.sent.length;
    w.provider.readThrows = 1;
    await tick(w, T0 + 30_000);
    expect(w.provider.sent.length).toBe(before);
    expect(await rowOf(w)).toMatchObject({ attempt: 2, exhausted: false, refusal: 'UNKNOWN' });
    await tick(w, T0 + 5 * MIN + 30_000);
    expect(w.provider.sent).toEqual([PART_CENTS, PART_CENTS]);
  });

  it('P14 [fix] a sibling part of the same charge that landed after the baseline is not counted as this part\'s money', async () => {
    const w = await world();
    w.provider.script.push('DOWN', 'DOWN', 'DOWN', 'DOWN');
    await opened(w, PART);
    for (const ms of [T0, T0 + 30_000, T0 + 5 * MIN, T0 + 15 * MIN]) await tick(w, ms);
    expect(await rowOf(w, PART)).toMatchObject({ exhausted: true, settledAt: null, refundedBeforeCents: 0 }); // pending
    await opened(w, SIBLING); // a missing item, refunded while the part waits for a person
    await tick(w, T0 + 20 * MIN);
    expect(await rowOf(w, SIBLING)).toMatchObject({ settledHow: 'REFUNDED' });
    w.at(T0 + 30 * MIN);
    await w.retrier.press!(PART as never); // "Tentar estornar de novo": the charge grew 300 since the baseline, all of it the sibling's
    expect(w.provider.sent).toEqual([PART_CENTS, PART_CENTS, PART_CENTS, PART_CENTS, 300, PART_CENTS]);
    expect(w.provider.refundedCents).toBe(PART_CENTS + 300);
    expect(await rowOf(w, PART)).toMatchObject({ settledHow: 'REFUNDED' });
  });

  it('P15 [fix] no two sends on one charge while one of them is in doubt: the sibling waits for the next tick, no attempt spent', async () => {
    const w = await world();
    w.provider.script.push('DOWN');
    await opened(w, PART);
    await tick(w, T0); // PART in doubt until its attempt 2
    await opened(w, SIBLING);
    await tick(w, T0 + 10_000);
    expect(w.provider.sent).toEqual([PART_CENTS]);
    expect(await rowOf(w, SIBLING)).toMatchObject({ attempt: 0, settledAt: null });
    await tick(w, T0 + 30_000); // PART resolves (OK)
    await tick(w, T0 + 5 * MIN); // then the sibling goes
    expect(w.provider.sent).toEqual([PART_CENTS, PART_CENTS, 300]);
  });

  it('P16 [fix] the host says nothing is owed any more (the pedido was cancelled): the series ENDS, nothing sent', async () => {
    const w = await world();
    w.provider.script.push('DOWN');
    await opened(w);
    await tick(w, T0);
    w.host.stillOwed.mockResolvedValue(false);
    await tick(w, T0 + 30_000);
    expect(w.provider.sent).toEqual([PART_CENTS]);
    expect(await rowOf(w)).toMatchObject({ settledHow: 'ENDED' });
  });

  it('P17 [control] a duplicate sweep tick sends once: the second finds the claim held', async () => {
    const w = await world();
    await opened(w);
    w.at(T0);
    await Promise.all([w.retrier.runDue!(10 as never), w.retrier.runDue!(10 as never)]);
    expect(w.provider.sent).toEqual([PART_CENTS]);
  });

  it('P18 [fix] a process that died holding the claim of a part in doubt: the next tick reads back and adopts, never sends blind', async () => {
    const w = await world();
    w.provider.script.push('LOST');
    await opened(w);
    await tick(w, T0);
    // The claimant of attempt 2 dies after its claim write: claimed, never answered.
    const row = (await rowOf(w))!;
    await w.store.saveIf!({ ...row, attempt: 2, claimedAt: new Date(T0 + 30_000).toISOString(), nextAt: new Date(T0 + 150_000).toISOString() } as never, row.version as never);
    await tick(w, T0 + 30_000 + 121_000);
    expect(w.provider.sent).toEqual([PART_CENTS]);
    expect(await rowOf(w)).toMatchObject({ settledHow: 'ADOPTED' });
  });
});

describe('a.3 a provider with no read-back falls back to the pending refund', () => {
  it('P19 [control] no read-back, no answer on the first send: the part is pending at once (B2 kept), sent once', async () => {
    const w = await world(false);
    w.provider.script.push('DOWN');
    await opened(w);
    await tick(w, T0);
    await tick(w, T0 + 30_000);
    expect(w.provider.sent).toEqual([PART_CENTS]);
    expect(await rowOf(w)).toMatchObject({ exhausted: true, settledAt: null });
  });

  it('P20 [control] no read-back, answered FAILED: the part is pending at once (never asked again blind)', async () => {
    const w = await world(false);
    w.provider.script.push('FAILED');
    await opened(w);
    await tick(w, T0);
    await tick(w, T0 + 30_000);
    expect(w.provider.sent).toEqual([PART_CENTS]);
    expect(await rowOf(w)).toMatchObject({ exhausted: true, settledAt: null });
    expect(w.host.attempted).toHaveBeenCalled();
  });
});

describe('a.4 what does not change', () => {
  it('P21 [control] a whole-charge series is untouched by the part rule: whole REFUNDED on the consult is adopted', async () => {
    const w = await world();
    w.provider.script.push('LOST');
    await opened(w, WHOLE);
    await tick(w, T0);
    await tick(w, T0 + 30_000);
    expect(w.provider.sent).toEqual([CAPTURE]);
    expect(await rowOf(w, WHOLE)).toMatchObject({ settledHow: 'ADOPTED' });
  });

  it('P22 [control] firstAttempt of a part with no answer still opens no series (the in-request path keeps B2)', async () => {
    const w = await world();
    w.provider.script.push('DOWN');
    const result = (await w.retrier.firstAttempt!(PART as never, {} as never)) as { kind: string; row: unknown };
    expect(result).toMatchObject({ kind: 'UNKNOWN', row: null });
  });
});
