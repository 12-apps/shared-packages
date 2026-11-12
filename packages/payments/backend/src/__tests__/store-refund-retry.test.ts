import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderRequestError, UnsupportedOperationError } from '../core/errors';
import { createPaymentsGateway } from '../core/gateway';
import { defineProviders } from '../core/registry';
import { NOTHING_TO_REFUND } from '../core/refund-retry';
import type { MerchantRef, ResolvedCredentials } from '../core/types';
import { createMemoryAttemptLedger, createMemoryChargeStore, createMemoryCredentialStore } from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY, type EvidenceRunDeps } from '../platform/evidence/index';
import { pagbankProvider } from '../providers/pagbank';
import { PT_BR_PAGBANK_COPY } from '../providers/pt-BR';

/**
 * PG3 (FUT-4740): a STORE refund PagBank answers "not yet" (40008) is retried in
 * the background — 3 attempts per series at T0, T0+5 min, T0+15 min (PG1's
 * schedule); an attempt 1 with NO answer (a timeout, a 5xx) opens a series of
 * 4, at T0, T0+30 s, T0+5 min, T0+15 min (owner, 2026-11-11, Q1) — and the evidence run's card cancels get the same retry instead of
 * the in-request loop. The cases are the contract's table
 * (agent-pg3-contract/contract.md, C1–C34, invariants I1–I14); each `it` names
 * its row.
 *
 * New surface these tests name (contract §7), none of which exists on main:
 *  - core `refund-retry.ts`: `RefundRetryState`, `REFUND_CLAIM_TTL_MS`,
 *    `REFUND_ATTEMPT_DEADLINE_MS`, `claimHeld`, `firstClaim`, `nextClaim`,
 *    `afterRefusal`, `refundDueNow`, `isNothingToRefund` — MOVED out of
 *    `platform/evidence/`, which re-exports them (reuse, never copy) — and the
 *    provider-free `refundRefusalOf(error)`;
 *  - `ProviderRequestError.options.refundRefusal`, the adapter's own verdict;
 *  - core `refund-series.ts`: `createRefundRetrier({ gateway, store, host, now,
 *    onProviderFailure })` → `firstAttempt`, `runDue`, `press`, `settleByHand`,
 *    `end`, `find`, `viewOf`;
 *  - `memory.ts`: `createMemoryRefundRetryStore()`.
 *
 * Each new symbol is loaded through `load()`, so a missing one fails ITS cases
 * with "expected undefined to be a function" instead of failing the file.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const MIN = 60_000;
const T0 = Date.parse('2026-11-11T15:00:00.000Z');
const TENANT: MerchantRef = { kind: 'TENANT', id: 'tenant-1' };
const CREDS: ResolvedCredentials = { environment: 'SANDBOX', fields: { token: 'tok' } };
const PROD = PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY;

type Fn = (...args: never[]) => unknown;
type Mod = Record<string, unknown>;

/** A module's export, asserted to be a function — the failure names it. */
async function load<T = Fn>(path: string, name: string): Promise<T> {
  const mod = (await import(/* @vite-ignore */ path).catch(() => ({}))) as Mod;
  expect(typeof mod[name], `${path} exports ${name}`).toBe('function');
  return mod[name] as T;
}

/** What PagBank answers to a cancel sent seconds after a Pix capture, once the adapter tagged it. */
const notYet = () =>
  new ProviderRequestError('pagbank', 'PagBank refused the refund: refund_temporarily_unavailable', {
    httpStatus: 400,
    providerCode: '40008',
    body: { error_messages: [{ code: '40008', message: 'refund_temporarily_unavailable', description: 'Transaction is not found.' }] },
    refundRefusal: 'NOT_YET',
  } as ConstructorParameters<typeof ProviderRequestError>[2]);
const refused = () =>
  new ProviderRequestError('pagbank', 'PagBank refused the refund', {
    httpStatus: 400,
    providerCode: '40002',
    refundRefusal: 'REFUSED',
  } as ConstructorParameters<typeof ProviderRequestError>[2]);
const down = () => new ProviderRequestError('pagbank', 'PagBank answered 503', { httpStatus: 503 });
const nothingLeft = () =>
  new ProviderRequestError('pagbank', 'nothing left to refund', { providerCode: NOTHING_TO_REFUND, retriable: false });

const accepted = (amountCents = 4290) => ({
  providerChargeId: 'CHAR_1',
  providerRefundId: 'CHAR_1',
  status: 'REFUNDED',
  amount: { amountCents, currency: 'BRL' },
});

/** The key a host opens a store refund's series under: the order, bound to its cancel. */
const KEY = {
  merchant: TENANT,
  provider: 'pagbank',
  providerChargeId: 'CHAR_1',
  reference: 'order-1',
  subject: 'order',
  boundTo: '2026-11-11T14:59:30.000Z',
  cause: 'order.cancel',
};

interface World {
  retrier: Record<string, Fn>;
  gateway: { refund: ReturnType<typeof vi.fn>; refreshCharge: ReturnType<typeof vi.fn> };
  host: { stillOwed: ReturnType<typeof vi.fn>; attempted: ReturnType<typeof vi.fn>; refunded: ReturnType<typeof vi.fn> };
  reports: { severity: string; path: string }[];
  at: (ms: number) => void;
}

/** A retrier over an in-memory store, a fake gateway and a host that still owes the money. */
async function world(): Promise<World> {
  const createRefundRetrier = await load<(deps: unknown) => Record<string, Fn>>('../core/refund-series', 'createRefundRetrier');
  const createMemoryRefundRetryStore = await load<() => unknown>('../memory', 'createMemoryRefundRetryStore');
  // The clock is the last instant pushed: `at` moves it without reassigning a closed-over binding.
  const instants = [new Date(T0)];
  const gateway = {
    refund: vi.fn(async () => accepted()),
    refreshCharge: vi.fn(async () => ({ status: 'PAID', providerChargeId: 'CHAR_1' })),
  };
  const host = {
    stillOwed: vi.fn(async () => true),
    attempted: vi.fn(async () => undefined),
    refunded: vi.fn(async () => undefined),
  };
  const reports: { severity: string; path: string }[] = [];
  const retrier = createRefundRetrier({
    gateway,
    store: createMemoryRefundRetryStore(),
    host,
    now: () => instants[instants.length - 1]!,
    onProviderFailure: (report: { severity: string; path: string }) => reports.push(report),
  });
  return { retrier, gateway, host, reports, at: (ms) => void instants.push(new Date(ms)) };
}

const viewOf = async (w: World) => w.retrier.viewOf!((await w.retrier.find!(KEY as never)) as never) as Record<string, unknown> | null;

describe('core: the retry pieces are the evidence retry\'s own, moved, never copied (I9)', () => {
  it('S0 the evidence modules re-export the core state functions, by identity', async () => {
    const core = (await import('../core/refund-retry')) as Mod;
    const state = (await import('../platform/evidence/refund-state')) as Mod;
    for (const name of ['claimHeld', 'REFUND_ATTEMPT_DEADLINE_MS']) {
      expect(core[name], `core/refund-retry exports ${name}`).toBeDefined();
      expect(state[name]).toBe(core[name]);
    }
    for (const name of ['REFUND_CLAIM_TTL_MS', 'firstClaim', 'nextClaim', 'afterRefusal', 'refundDueNow', 'isNothingToRefund', 'refundRefusalOf']) {
      expect(core[name], `core/refund-retry exports ${name}`).toBeDefined();
    }
    expect(core['REFUND_CLAIM_TTL_MS']).toBe(120_000);
    expect(core['REFUND_ATTEMPT_DEADLINE_MS']).toBe(90_000);
  });

  it('S0b refundDueNow: nothing before +5 min, NEXT at +5, CLOSE when a dead claimant held the last attempt', async () => {
    const refundDueNow = await load<(state: unknown, now: Date) => string | null>('../core/refund-retry', 'refundDueNow');
    const waiting = { series: 1, attempt: 1, nextAt: new Date(T0 + 5 * MIN).toISOString(), exhausted: false, refusal: 'NOT_YET', claimedAt: null, reported: false };
    expect(refundDueNow(waiting, new Date(T0 + 4 * MIN))).toBeNull();
    expect(refundDueNow(waiting, new Date(T0 + 5 * MIN))).toBe('NEXT');
    const deadLast = { ...waiting, attempt: 3, nextAt: null, claimedAt: new Date(T0).toISOString() };
    expect(refundDueNow(deadLast, new Date(T0 + 119_000))).toBeNull();
    expect(refundDueNow(deadLast, new Date(T0 + 121_000))).toBe('CLOSE');
    expect(refundDueNow({ ...waiting, exhausted: true }, new Date(T0 + 60 * MIN))).toBeNull();
    // A no-answer series has four attempts (Q1): a dead attempt 3 is followed by a 4th, never closed.
    expect(refundDueNow({ ...deadLast, of: 4 }, new Date(T0 + 121_000))).toBe('NEXT');
  });

  it('S0c refundRefusalOf reads the adapter\'s tag and never PagBank\'s vocabulary (I4)', async () => {
    const refundRefusalOf = await load<(error: unknown) => string>('../core/refund-retry', 'refundRefusalOf');
    expect(refundRefusalOf(notYet())).toBe('NOT_YET');
    expect(refundRefusalOf(refused())).toBe('REFUSED');
    expect(refundRefusalOf(down())).toBe('UNKNOWN');
    // A 40008-shaped body with no tag is another provider's 4xx: an answer, never "not yet".
    const untagged = new ProviderRequestError('stone', 'no', { httpStatus: 400, body: { error_messages: [{ code: '40008' }] } });
    expect(refundRefusalOf(untagged)).toBe('REFUSED');
    expect(refundRefusalOf(new ProviderRequestError('pagbank', 'later', { httpStatus: 429 }))).toBe('UNKNOWN');
    expect(refundRefusalOf(new Error('socket hang up'))).toBe('UNKNOWN');
  });
});

describe('the PagBank adapter tags its own refusal (I4, I8)', () => {
  /** GET (the read-back) answers a PAID charge, POST (the cancel) answers `cancel`. */
  function stubPagBank(cancel: { status: number; body: unknown }) {
    const recorded: Array<[string, RequestInit]> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        recorded.push([String(url), init]);
        const reply = init.method === 'POST' ? cancel : { status: 200, body: { id: 'CHAR_1', status: 'PAID', amount: { value: 4290 }, payment_method: { type: 'PIX' } } };
        return {
          ok: reply.status >= 200 && reply.status < 300,
          status: reply.status,
          statusText: reply.status === 200 ? 'OK' : 'ERR',
          json: async () => reply.body,
          text: async () => JSON.stringify(reply.body),
        } as unknown as Response;
      }),
    );
    return recorded;
  }

  it('SA a 40008 answer to a store refund comes out tagged NOT_YET', async () => {
    const refundRefusalOf = await load<(error: unknown) => string>('../core/refund-retry', 'refundRefusalOf');
    stubPagBank({ status: 400, body: { error_messages: [{ code: '40008', message: 'refund_temporarily_unavailable', description: 'Transaction is not found.' }] } });
    const error = await pagbankProvider(PT_BR_PAGBANK_COPY)
      .refund!({ providerChargeId: 'CHAR_1' }, CREDS)
      .then(() => null, (thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ProviderRequestError);
    expect((error as ProviderRequestError).options).toMatchObject({ refundRefusal: 'NOT_YET' });
    expect(refundRefusalOf(error)).toBe('NOT_YET');
  });

  it('SA2 any other 4xx comes out tagged REFUSED', async () => {
    stubPagBank({ status: 400, body: { error_messages: [{ code: '40002', message: 'invalid_parameter' }] } });
    const error = await pagbankProvider(PT_BR_PAGBANK_COPY)
      .refund!({ providerChargeId: 'CHAR_1' }, CREDS)
      .then(() => null, (thrown: unknown) => thrown);
    expect((error as ProviderRequestError).options).toMatchObject({ refundRefusal: 'REFUSED' });
  });
});

describe('attempt 1, inside the request that cancelled (C1–C6)', () => {
  it('S1 an accepted refund: one call, opted out of the gateway report, under a deadline, no series (C1)', async () => {
    const w = await world();
    const result = (await w.retrier.firstAttempt!(KEY as never, {} as never)) as { kind: string };
    expect(result.kind).toBe('REFUNDED');
    expect(w.gateway.refund).toHaveBeenCalledTimes(1);
    const input = w.gateway.refund.mock.calls[0]![2] as { providerChargeId: string; retriedByCaller?: boolean; signal?: unknown };
    expect(input.providerChargeId).toBe('CHAR_1');
    expect(input.retriedByCaller).toBe(true);
    expect(input.signal).toBeInstanceOf(AbortSignal);
    expect(await w.retrier.find!(KEY as never)).toBeNull();
  });

  it('S2 a "not yet" opens series 1: attempt 1 of 3 recorded, attempt 2 due at T0+5, nothing reported, no wait (C2, I7)', async () => {
    const w = await world();
    w.gateway.refund.mockRejectedValueOnce(notYet());
    const result = (await w.retrier.firstAttempt!(KEY as never, {} as never)) as { kind: string };
    expect(result.kind).toBe('NOT_YET');
    expect(w.gateway.refund).toHaveBeenCalledTimes(1);
    expect(await viewOf(w)).toMatchObject({
      series: 1,
      attempt: 1,
      of: 3,
      nextAt: new Date(T0 + 5 * MIN).toISOString(),
      exhausted: false,
      refusal: 'NOT_YET',
    });
    expect(w.host.attempted).toHaveBeenCalledTimes(1);
    expect(w.reports).toEqual([]);
  });

  it('S3 a definitive refusal opens no series and is reported once at error (C3, I4)', async () => {
    const w = await world();
    w.gateway.refund.mockRejectedValueOnce(refused());
    const result = (await w.retrier.firstAttempt!(KEY as never, {} as never)) as { kind: string };
    expect(result.kind).toBe('REFUSED');
    expect(await w.retrier.find!(KEY as never)).toBeNull();
    expect(w.reports.map((r) => [r.path, r.severity])).toEqual([['REFUND', 'error']]);
  });

  it('S4 no verdict (5xx) opens a series of FOUR: attempt 2 due at T0+30 s, nothing reported yet (C4, Q1)', async () => {
    const w = await world();
    w.gateway.refund.mockRejectedValueOnce(down());
    const result = (await w.retrier.firstAttempt!(KEY as never, {} as never)) as { kind: string };
    expect(result.kind).toBe('UNKNOWN');
    expect(await viewOf(w)).toMatchObject({
      series: 1,
      attempt: 1,
      of: 4,
      nextAt: new Date(T0 + 30_000).toISOString(),
      exhausted: false,
      refusal: 'UNKNOWN',
    });
    expect(w.host.attempted).toHaveBeenCalledTimes(1);
    expect(w.reports).toEqual([]);
  });

  it('S4c the no-answer series consults first at T0+30 s, +5 min, +15 min, then gives up, reported ONCE at warning (C4, Q1, I3)', async () => {
    const w = await world();
    w.gateway.refund.mockRejectedValue(down());
    await w.retrier.firstAttempt!(KEY as never, {} as never);
    w.gateway.refund.mockClear();
    w.at(T0 + 29_000);
    await w.retrier.runDue!();
    expect(w.gateway.refund).not.toHaveBeenCalled();
    for (const [n, due, next] of [
      [2, T0 + 30_000, T0 + 5 * MIN],
      [3, T0 + 5 * MIN, T0 + 15 * MIN],
    ] as const) {
      w.at(due);
      await w.retrier.runDue!();
      expect(w.gateway.refreshCharge).toHaveBeenCalledTimes(n - 1);
      expect(await viewOf(w)).toMatchObject({ attempt: n, of: 4, nextAt: new Date(next).toISOString(), exhausted: false });
    }
    w.at(T0 + 15 * MIN);
    await w.retrier.runDue!();
    expect(w.gateway.refund).toHaveBeenCalledTimes(3);
    expect(await viewOf(w)).toMatchObject({ attempt: 4, of: 4, exhausted: true, nextAt: null });
    expect(w.reports.map((r) => [r.path, r.severity])).toEqual([['REFUND', 'warning']]);
  });

  it('S4d a no-answer attempt 1 whose consult finds the money gone is adopted, never sent again (C4, Q1, I3)', async () => {
    const w = await world();
    w.gateway.refund.mockRejectedValueOnce(down());
    await w.retrier.firstAttempt!(KEY as never, {} as never);
    w.gateway.refund.mockClear();
    w.gateway.refreshCharge.mockResolvedValueOnce({ status: 'CANCELED', providerChargeId: 'CHAR_1' });
    w.at(T0 + 30_000);
    await w.retrier.runDue!();
    expect(w.gateway.refund).not.toHaveBeenCalled();
    expect(w.host.refunded.mock.calls[0]![1]).toMatchObject({ adopted: true });
    expect(await viewOf(w)).toBeNull();
  });

  it('S4b a refusal decided before dispatch is rethrown for the host\'s taxonomy (C6)', async () => {
    const w = await world();
    w.gateway.refund.mockRejectedValueOnce(new UnsupportedOperationError('infinitepay', 'refund'));
    await expect(w.retrier.firstAttempt!(KEY as never, {} as never)).rejects.toBeInstanceOf(UnsupportedOperationError);
    expect(await w.retrier.find!(KEY as never)).toBeNull();
  });

  it('S8 a charge with nothing left to refund is ADOPTED as refunded, never a failure (C5, C12)', async () => {
    const w = await world();
    w.gateway.refund.mockRejectedValueOnce(nothingLeft());
    const result = (await w.retrier.firstAttempt!(KEY as never, {} as never)) as { kind: string };
    expect(result.kind).toBe('ADOPTED');
    expect(w.reports).toEqual([]);
  });
});

describe('attempts 2 and 3, in the background (C11–C19)', () => {
  /** Series 1 opened by a "not yet" at T0. */
  async function opened(): Promise<World> {
    const fresh = await world();
    fresh.gateway.refund.mockRejectedValueOnce(notYet());
    await fresh.retrier.firstAttempt!(KEY as never, {} as never);
    fresh.gateway.refund.mockClear();
    fresh.host.attempted.mockClear();
    return fresh;
  }

  it('S5 nothing runs before T0+5; at T0+5 the charge is consulted, then ONE refund; "not yet" again → attempt 2, next at T0+15 (C11)', async () => {
    const w = await opened();
    w.at(T0 + 4 * MIN);
    await w.retrier.runDue!();
    expect(w.gateway.refreshCharge).not.toHaveBeenCalled();
    expect(w.gateway.refund).not.toHaveBeenCalled();

    w.at(T0 + 5 * MIN);
    w.gateway.refund.mockRejectedValueOnce(notYet());
    await w.retrier.runDue!();
    expect(w.gateway.refreshCharge).toHaveBeenCalledTimes(1);
    expect(w.gateway.refund).toHaveBeenCalledTimes(1);
    expect(w.gateway.refreshCharge.mock.invocationCallOrder[0]!).toBeLessThan(w.gateway.refund.mock.invocationCallOrder[0]!);
    expect(await viewOf(w)).toMatchObject({ attempt: 2, nextAt: new Date(T0 + 15 * MIN).toISOString(), exhausted: false });
    expect(w.host.attempted).toHaveBeenCalledTimes(1);
  });

  it('S5b a 5xx inside a series counts as an attempt and the series goes on (C15)', async () => {
    const w = await opened();
    w.at(T0 + 5 * MIN);
    w.gateway.refund.mockRejectedValueOnce(down());
    await w.retrier.runDue!();
    expect(await viewOf(w)).toMatchObject({ attempt: 2, exhausted: false, refusal: 'UNKNOWN' });
  });

  it('S6 attempt 3 "not yet" exhausts the series, reported ONCE at warning, and nothing runs by itself after (C13, I10)', async () => {
    const w = await opened();
    w.gateway.refund.mockRejectedValue(notYet());
    w.at(T0 + 5 * MIN);
    await w.retrier.runDue!();
    w.at(T0 + 15 * MIN);
    await w.retrier.runDue!();
    expect(await viewOf(w)).toMatchObject({ attempt: 3, exhausted: true, nextAt: null });
    expect(w.reports.map((r) => [r.path, r.severity])).toEqual([['REFUND', 'warning']]);
    w.gateway.refund.mockClear();
    w.at(T0 + 120 * MIN);
    await w.retrier.runDue!();
    expect(w.gateway.refund).not.toHaveBeenCalled();
    expect(w.reports).toHaveLength(1);
  });

  it('S7 a consult that finds the charge already refunded adopts it: no cancel, the host told once (C12, I3)', async () => {
    const w = await opened();
    w.gateway.refreshCharge.mockResolvedValueOnce({ status: 'REFUNDED', providerChargeId: 'CHAR_1' });
    w.at(T0 + 5 * MIN);
    await w.retrier.runDue!();
    expect(w.gateway.refund).not.toHaveBeenCalled();
    expect(w.host.refunded).toHaveBeenCalledTimes(1);
    expect(w.host.refunded.mock.calls[0]![1]).toMatchObject({ adopted: true });
    expect(await viewOf(w)).toBeNull();
  });

  it('S9 a pedido that moved on (undone, re-cancelled, refunded elsewhere) gets NOTHING sent and the series ends (C16, I2)', async () => {
    const w = await opened();
    w.host.stillOwed.mockResolvedValue(false);
    w.at(T0 + 5 * MIN);
    await w.retrier.runDue!();
    expect(w.gateway.refreshCharge).not.toHaveBeenCalled();
    expect(w.gateway.refund).not.toHaveBeenCalled();
    expect(await viewOf(w)).toBeNull();
    w.host.stillOwed.mockResolvedValue(true);
    w.at(T0 + 15 * MIN);
    await w.retrier.runDue!();
    expect(w.gateway.refund).not.toHaveBeenCalled();
  });

  it('S11 the sweep and the press on the same due attempt send ONE cancel (C19, I1, I5)', async () => {
    const w = await opened();
    const releases: Array<(value: unknown) => void> = [];
    w.gateway.refund.mockImplementationOnce(() => new Promise((resolve) => void releases.push(resolve)));
    w.gateway.refund.mockResolvedValue(accepted());
    w.at(T0 + 5 * MIN);
    const sweep = w.retrier.runDue!();
    const sweep2 = w.retrier.runDue!();
    const press = w.retrier.press!(KEY as never);
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases[0]!(accepted());
    await Promise.all([sweep, sweep2, press]);
    expect(w.gateway.refund).toHaveBeenCalledTimes(1);
    expect(w.host.refunded).toHaveBeenCalledTimes(1);
  });

  it('S12 a claimant that died is taken over after 120 s; its attempt still counts (C18)', async () => {
    const w = await opened();
    w.gateway.refund.mockImplementationOnce(() => new Promise(() => undefined)); // never answers: the process "died"
    w.at(T0 + 5 * MIN);
    void w.retrier.runDue!();
    await vi.waitFor(() => expect(w.gateway.refund).toHaveBeenCalledTimes(1));
    w.gateway.refund.mockRejectedValueOnce(notYet());
    w.at(T0 + 5 * MIN + 60_000);
    await w.retrier.runDue!();
    expect(w.gateway.refund).toHaveBeenCalledTimes(1); // the claim is still held
    w.at(T0 + 5 * MIN + 121_000);
    await w.retrier.runDue!();
    expect(w.gateway.refund).toHaveBeenCalledTimes(2);
    expect(await viewOf(w)).toMatchObject({ attempt: 3 });
  });

  it('S15 a later attempt that refunds tells the host once, with the snapshot, and the series is settled (C17)', async () => {
    const w = await opened();
    w.at(T0 + 5 * MIN);
    await w.retrier.runDue!();
    expect(w.host.refunded).toHaveBeenCalledTimes(1);
    expect(w.host.refunded.mock.calls[0]![1]).toMatchObject({ adopted: false, snapshot: { status: 'REFUNDED' } });
    w.at(T0 + 15 * MIN);
    await w.retrier.runDue!();
    expect(w.gateway.refund).toHaveBeenCalledTimes(1);
    expect(w.host.refunded).toHaveBeenCalledTimes(1);
  });

  it('S16 a definitive refusal inside a series exhausts it at once, reported at error (C14)', async () => {
    const w = await opened();
    w.gateway.refund.mockRejectedValueOnce(refused());
    w.at(T0 + 5 * MIN);
    await w.retrier.runDue!();
    expect(await viewOf(w)).toMatchObject({ attempt: 2, exhausted: true, refusal: 'REFUSED' });
    expect(w.reports.map((r) => r.severity)).toEqual(['error']);
  });

  it('S17 every attempt opts out of the gateway report and runs under the 90 s deadline (I10)', async () => {
    const w = await opened();
    w.gateway.refund.mockRejectedValueOnce(notYet());
    w.at(T0 + 5 * MIN);
    await w.retrier.runDue!();
    const input = w.gateway.refund.mock.calls[0]![2] as { retriedByCaller?: boolean; signal?: unknown };
    expect(input.retriedByCaller).toBe(true);
    expect(input.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('the person: the press and the hand acts share the fence (C21–C27)', () => {
  async function exhausted(): Promise<World> {
    const fresh = await world();
    fresh.gateway.refund.mockRejectedValue(notYet());
    await fresh.retrier.firstAttempt!(KEY as never, {} as never);
    fresh.at(T0 + 5 * MIN);
    await fresh.retrier.runDue!();
    fresh.at(T0 + 15 * MIN);
    await fresh.retrier.runDue!();
    fresh.gateway.refund.mockReset();
    fresh.gateway.refund.mockRejectedValue(notYet());
    fresh.gateway.refreshCharge.mockClear();
    return fresh;
  }

  it('S10 "Tentar estornar de novo" starts series 2 now, consult first; pressed mid-series it is a no-op (C21, C22)', async () => {
    const w = await exhausted();
    w.at(T0 + 40 * MIN);
    await w.retrier.press!(KEY as never);
    expect(w.gateway.refreshCharge).toHaveBeenCalledTimes(1);
    expect(w.gateway.refund).toHaveBeenCalledTimes(1);
    expect(await viewOf(w)).toMatchObject({ series: 2, attempt: 1, nextAt: new Date(T0 + 45 * MIN).toISOString(), exhausted: false });
    await w.retrier.press!(KEY as never);
    expect(w.gateway.refund).toHaveBeenCalledTimes(1);
    expect(await viewOf(w)).toMatchObject({ series: 2, attempt: 1 });
  });

  it('S10b a new series may be reported once more when it gives up (once per series, I10)', async () => {
    const w = await exhausted();
    expect(w.reports).toHaveLength(1);
    w.at(T0 + 40 * MIN);
    await w.retrier.press!(KEY as never);
    w.at(T0 + 45 * MIN);
    await w.retrier.runDue!();
    w.at(T0 + 55 * MIN);
    await w.retrier.runDue!();
    expect(await viewOf(w)).toMatchObject({ series: 2, exhausted: true });
    expect(w.reports).toHaveLength(2);
  });

  it('S13 "Já estornei no painel" settles the series by hand; nothing is ever sent again (C24)', async () => {
    const w = await exhausted();
    expect(await w.retrier.settleByHand!(KEY as never)).toBe(true);
    expect(await viewOf(w)).toBeNull();
    w.at(T0 + 40 * MIN);
    await w.retrier.press!(KEY as never);
    await w.retrier.runDue!();
    expect(w.gateway.refund).not.toHaveBeenCalled();
  });

  it('S13b a hand act while an attempt\'s claim is live is fenced, never sent past a cancel in flight (C27, I1)', async () => {
    const w = await exhausted();
    w.gateway.refund.mockImplementationOnce(() => new Promise(() => undefined));
    w.at(T0 + 40 * MIN);
    void w.retrier.press!(KEY as never);
    await vi.waitFor(() => expect(w.gateway.refund).toHaveBeenCalledTimes(1));
    expect(await w.retrier.settleByHand!(KEY as never)).toBe(false);
    expect(await viewOf(w)).toMatchObject({ series: 2, inFlight: true });
  });

  it('S14 the undo ends any series (C29)', async () => {
    const w = await world();
    w.gateway.refund.mockRejectedValueOnce(notYet());
    await w.retrier.firstAttempt!(KEY as never, {} as never);
    await w.retrier.end!(KEY as never);
    expect(await viewOf(w)).toBeNull();
    w.at(T0 + 5 * MIN);
    await w.retrier.runDue!();
    expect(w.gateway.refund).toHaveBeenCalledTimes(1);
  });
});

describe('a refund held before the retry existed gets a series, consulted first (owner Q2)', () => {
  it('S19 openDue schedules attempt 1 now; the sweep consults, adopts a refunded charge, and a second open is a no-op', async () => {
    const w = await world();
    expect(await w.retrier.openDue!(KEY as never)).toBe(true);
    expect(await w.retrier.openDue!(KEY as never)).toBe(false);
    expect(w.gateway.refund).not.toHaveBeenCalled();
    w.gateway.refreshCharge.mockResolvedValueOnce({ status: 'REFUNDED', providerChargeId: 'CHAR_1' });
    await w.retrier.runDue!();
    expect(w.gateway.refund).not.toHaveBeenCalled();
    expect(w.host.refunded.mock.calls[0]![1]).toMatchObject({ adopted: true });
  });

  it('S19b a held refund still PAID is sent once by the sweep, and its answer picks the schedule', async () => {
    const w = await world();
    await w.retrier.openDue!(KEY as never);
    w.gateway.refund.mockRejectedValueOnce(down());
    await w.retrier.runDue!();
    expect(w.gateway.refreshCharge).toHaveBeenCalledTimes(1);
    expect(w.gateway.refund).toHaveBeenCalledTimes(1);
    expect(await viewOf(w)).toMatchObject({ attempt: 1, of: 4, nextAt: new Date(T0 + 30_000).toISOString() });
  });
});

/** A clock a case moves forward: the last instant pushed. */
function stepClock(start: number): { now: () => Date; at: (ms: number) => void } {
  const instants = [new Date(start)];
  return { now: () => instants[instants.length - 1]!, at: (ms) => void instants.push(new Date(ms)) };
}

describe('round-1 review: the deadline, a part, a failed consult, the amount, the undo (B1, B2, N2, S6, S1)', () => {
  const PART = { ...KEY, subject: 'problem-report:r-1', boundTo: 'r-1', amountCents: 1000 };

  /** Series 1 opened by a "not yet" at T0, on `key`. */
  async function openedOn(key: Record<string, unknown>): Promise<World> {
    const fresh = await world();
    fresh.gateway.refund.mockRejectedValueOnce(notYet());
    await fresh.retrier.firstAttempt!(key as never, {} as never);
    fresh.gateway.refund.mockClear();
    return fresh;
  }

  it('B1 the consult and the cancel of one attempt share ONE deadline', async () => {
    const w = await openedOn(KEY);
    w.at(T0 + 5 * MIN);
    await w.retrier.runDue!();
    const consulted = (w.gateway.refreshCharge.mock.calls[0]![4] as { signal: AbortSignal }).signal;
    const sent = (w.gateway.refund.mock.calls[0]![2] as { signal: AbortSignal }).signal;
    expect(sent).toBe(consulted);
  });

  it('B1 a consult that outlives the deadline sends no cancel; the attempt counts as no answer', async () => {
    const createRefundRetrier = await load<(deps: unknown) => Record<string, Fn>>('../core/refund-series', 'createRefundRetrier');
    const createMemoryRefundRetryStore = await load<() => unknown>('../memory', 'createMemoryRefundRetryStore');
    const clock = stepClock(T0);
    const refund = vi.fn(async () => accepted());
    refund.mockRejectedValueOnce(notYet());
    const refreshCharge = vi.fn(
      (_m: unknown, _p: unknown, _c: unknown, _h: unknown, options: { signal: AbortSignal }) =>
        new Promise((resolve) => options.signal.addEventListener('abort', () => resolve({ status: 'PAID', providerChargeId: 'CHAR_1' }))),
    );
    const host = { stillOwed: vi.fn(async () => true), attempted: vi.fn(async () => undefined), refunded: vi.fn(async () => undefined) };
    const retrier = createRefundRetrier({
      gateway: { refund, refreshCharge },
      store: createMemoryRefundRetryStore(),
      host,
      now: clock.now,
      attemptMs: 20,
    });
    await retrier.firstAttempt!(KEY as never, {} as never);
    clock.at(T0 + 5 * MIN);
    await retrier.runDue!();
    expect(refund).toHaveBeenCalledTimes(1);
    expect((host.attempted.mock.calls.at(-1) as unknown[] | undefined)?.[1]).toBe('UNKNOWN');
  });

  it('B2 a PART with no answer on attempt 1 opens no series: it is pending at once', async () => {
    const w = await world();
    w.gateway.refund.mockRejectedValueOnce(down());
    const result = (await w.retrier.firstAttempt!(PART as never, {} as never)) as { kind: string; row: unknown };
    expect(result).toMatchObject({ kind: 'UNKNOWN', row: null });
    expect(await w.retrier.find!(PART as never)).toBeNull();
  });

  it('B2 a PART series whose attempt 2 gets no answer is exhausted, never sent blind a third time', async () => {
    const w = await openedOn(PART);
    w.gateway.refund.mockRejectedValue(down());
    w.at(T0 + 5 * MIN);
    await w.retrier.runDue!();
    w.at(T0 + 15 * MIN);
    await w.retrier.runDue!();
    expect(w.gateway.refund).toHaveBeenCalledTimes(1);
    expect(w.retrier.viewOf!((await w.retrier.find!(PART as never)) as never)).toMatchObject({ attempt: 2, exhausted: true });
  });

  it('B2 a consult that fails sends nothing: the attempt counts, and the next one consults again', async () => {
    const w = await openedOn(KEY);
    w.gateway.refreshCharge.mockRejectedValueOnce(down());
    w.at(T0 + 5 * MIN);
    await w.retrier.runDue!();
    expect(w.gateway.refund).not.toHaveBeenCalled();
    expect(await viewOf(w)).toMatchObject({ attempt: 2, refusal: 'UNKNOWN', exhausted: false });
    w.at(T0 + 15 * MIN);
    await w.retrier.runDue!();
    expect(w.gateway.refreshCharge).toHaveBeenCalledTimes(2);
    expect(w.gateway.refund).toHaveBeenCalledTimes(1);
  });

  it('N2 our own deadline aborting attempt 1 is no answer, never a pre-dispatch refusal', async () => {
    const w = await world();
    w.gateway.refund.mockRejectedValueOnce(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    const result = (await w.retrier.firstAttempt!(KEY as never, {} as never)) as { kind: string };
    expect(result.kind).toBe('UNKNOWN');
    expect(await viewOf(w)).toMatchObject({ of: 4, refusal: 'UNKNOWN' });
  });

  it('S6 an adoption hands the host what the consult saw go back', async () => {
    const w = await openedOn(KEY);
    w.gateway.refreshCharge.mockResolvedValueOnce({ status: 'REFUNDED', providerChargeId: 'CHAR_1', amount: { amountCents: 3990, currency: 'BRL' } });
    w.at(T0 + 5 * MIN);
    await w.retrier.runDue!();
    expect(w.host.refunded.mock.calls[0]![1]).toMatchObject({ adopted: true, refundedCents: 3990 });
  });

  it('S1 the undo ends a series over the store; it keeps the claim while an attempt is in flight or unconsulted', async () => {
    const endRefundSeriesFor = await load<(store: unknown, match: unknown, now: Date) => Promise<{ ended: boolean; clearClaim: boolean }>>(
      '../core/refund-series-end',
      'endRefundSeriesFor',
    );
    const createMemoryRefundRetryStore = await load<() => Record<string, Fn>>('../memory', 'createMemoryRefundRetryStore');
    const match = { merchant: TENANT, reference: 'order-1', subject: 'order', boundTo: KEY.boundTo };
    const row = (state: Record<string, unknown>) => ({
      merchant: TENANT, provider: 'pagbank', providerChargeId: 'CHAR_1', reference: 'order-1', subject: 'order', boundTo: KEY.boundTo,
      amountCents: null, cause: 'order.cancel', series: 1, exhausted: false, reported: false, settledAt: null, settledHow: null, ...state,
    });
    const answered = createMemoryRefundRetryStore();
    await answered.insert!(row({ attempt: 1, refusal: 'NOT_YET', nextAt: null, claimedAt: null }) as never);
    expect(await endRefundSeriesFor(answered, match, new Date(T0))).toEqual({ ended: true, clearClaim: true });
    const inFlight = createMemoryRefundRetryStore();
    await inFlight.insert!(row({ attempt: 2, refusal: 'NOT_YET', nextAt: null, claimedAt: new Date(T0).toISOString() }) as never);
    expect(await endRefundSeriesFor(inFlight, match, new Date(T0 + 60_000))).toEqual({ ended: true, clearClaim: false });
    const unconsulted = createMemoryRefundRetryStore();
    await unconsulted.insert!(row({ attempt: 1, refusal: 'UNKNOWN', nextAt: null, claimedAt: null }) as never);
    expect(await endRefundSeriesFor(unconsulted, match, new Date(T0))).toEqual({ ended: true, clearClaim: false });
  });
});

describe('round-2 review: a series an undo ENDED is restartable by the press (R2)', () => {
  it('R2 an ENDED series of the same claim restarts on the press; a BY_HAND one stays final', async () => {
    const w = await world();
    w.gateway.refund.mockRejectedValueOnce(notYet());
    await w.retrier.firstAttempt!(KEY as never, {} as never);
    await w.retrier.end!(KEY as never);
    w.gateway.refund.mockClear();
    w.at(T0 + 10 * MIN);
    await w.retrier.press!(KEY as never);
    expect(w.gateway.refund).toHaveBeenCalledTimes(1);
    expect(w.host.refunded).toHaveBeenCalledTimes(1);
  });
});

describe('the evidence run\'s card refunds hold a new run, by name (C34, review R3)', () => {
  it('R3 a card cancel out of attempts holds the run until it is done; the refusal names the card', async () => {
    const { cardHoldsMoney, cardRefundViewsOf } = (await import('../platform/evidence/card-refund-state')) as Mod as {
      cardHoldsMoney: (record: unknown) => boolean;
      cardRefundViewsOf: (record: unknown) => unknown[];
    };
    const { EvidenceCardRefundOpenError, EvidencePixOpenError } = (await import('../platform/evidence/run')) as Mod as {
      EvidenceCardRefundOpenError: new (runId: string) => Error;
      EvidencePixOpenError: new (runId: string) => Error;
    };
    const refund = { series: 1, attempt: 3, nextAt: null, exhausted: true, refusal: 'NOT_YET', claimedAt: null, reported: true };
    const failed = { id: 'run-1', steps: [{ key: 'card.cancel', status: 'FAILED', ids: { charge_id: 'CHAR_C' }, refund }] };
    const done = { id: 'run-1', steps: [{ key: 'card.cancel', status: 'EXECUTED', ids: { charge_id: 'CHAR_C' }, refund }] };
    expect(cardHoldsMoney(failed)).toBe(true);
    expect(cardRefundViewsOf(failed)).toEqual([{ scenario: 'credit', attempt: 3, of: 3, nextAt: null, exhausted: true, refusal: 'NOT_YET' }]);
    expect(cardHoldsMoney(done)).toBe(false);
    const refusal = new EvidenceCardRefundOpenError('run-1');
    expect(refusal).toBeInstanceOf(EvidencePixOpenError);
    expect(refusal.name).toBe('EvidenceCardRefundOpenError');
    expect(refusal.message).toMatch(/card/u);
  });
});

describe('the evidence run\'s card cancels: one attempt, the rest in the background (C32)', () => {
  it('S18 a card cancel answered 40008 sends ONE cancel in the run and leaves attempt 2 due at +5 min', async () => {
    const orders = (await import('../platform/evidence/orders')) as Mod;
    const cancelCharge = orders['cancelCharge'] as (deps: EvidenceRunDeps, key: string, chargeId: string, orderId: string | null) => Promise<{ refund?: unknown }>;
    const posts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const post = init.method === 'POST';
        if (post) posts.push(String(url));
        const status = post ? 400 : 200;
        const body = post
          ? { error_messages: [{ code: '40008', message: 'refund_temporarily_unavailable', description: 'Transaction is not found.' }] }
          : { id: 'CHAR_C', status: 'PAID', amount: { value: 100 }, payment_method: { type: 'CREDIT_CARD' } };
        // A real Response, so the evidence traffic recorder can clone it (the run records every call).
        return new Response(JSON.stringify(body), { status, statusText: post ? 'Bad Request' : 'OK', headers: { 'content-type': 'application/json' } });
      }),
    );
    const credentials = createMemoryCredentialStore();
    const gateway = createPaymentsGateway({
      providers: defineProviders({ pagbank: pagbankProvider(PT_BR_PAGBANK_COPY) } as const),
      credentials,
      charges: createMemoryChargeStore(),
      webhooks: createMemoryWebhookInbox(),
      attempts: createMemoryAttemptLedger(),
      onWebhookEvent: async () => undefined,
    });
    const merchant: MerchantRef = { kind: 'PLATFORM', id: 'evidence' } as MerchantRef;
    credentials.set(merchant, 'pagbank', CREDS);
    const sleep = vi.fn(async () => undefined);
    const deps = { gateway, merchant, copy: PROD.outcome, now: () => new Date(T0), sleep } as unknown as EvidenceRunDeps;

    const step = await cancelCharge(deps, 'card.cancel', 'CHAR_C', null);

    expect(posts).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(step.refund).toMatchObject({ attempt: 1, refusal: 'NOT_YET', exhausted: false, nextAt: new Date(T0 + 5 * MIN).toISOString() });
  });
});
