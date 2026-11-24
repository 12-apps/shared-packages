import { describe, expect, it, vi } from 'vitest';

import { allocateExcess, judgeCapture } from '../core/capture-judgement';
import {
  createCaptureRecompose,
  overCaptureKey,
  type CaptureRecomposeRef,
  type CaptureRecomposeStores,
  type OverCaptureFacts,
  type RecomposeCapture,
} from '../core/capture-recompose';
import { SHORT_CAPTURE_REFUND_SUBJECT, type CaptureRefundClaim, type CaptureRefundOutcome } from '../core/refund-on-request';
import type { FirstAttemptResult } from '../core/refund-series';
import type { RefundSeriesKey, RefundSeriesRow } from '../core/refund-series-store';
import type { RefundSnapshot } from '../core/types';

/**
 * A sale recomposed after its Pix landed (FUT-1262): the verdict, the predicated
 * rewrite, the over-capture recorded and alerted once, and the whole-capture
 * refund under the one claim per charge with its fallback. The fixture is the
 * contract's: two dishes of 3200 plus a 10 % fee, raised at 7040; one written
 * off leaves 3520, both leave 0.
 */

const FROZEN = 7040;
const LIVE = 3520;
const CHARGE = 'CHAR_1';
const REF: CaptureRecomposeRef = { merchant: { kind: 'TENANT', id: 'acme' }, reference: 'ord_1', frozenTotalCents: FROZEN };

describe('judgeCapture', () => {
  const base = { method: 'PIX', capturedCents: FROZEN, refundedCents: 0, frozenTotalCents: FROZEN };

  it.each([
    ['nothing written off (C5)', { ...base, liveTotalCents: FROZEN }, { kind: 'NONE' }],
    ['one line written off (C1)', { ...base, liveTotalCents: LIVE }, { kind: 'OVER', excessCents: FROZEN - LIVE }],
    ['every line written off (C4)', { ...base, liveTotalCents: 0 }, { kind: 'REFUND_ALL' }],
    ['a card (C10)', { ...base, method: 'CARD', liveTotalCents: LIVE }, { kind: 'NONE' }],
    ['an in-person payment (C9)', { ...base, method: 'WAITER', liveTotalCents: 0 }, { kind: 'NONE' }],
    ['a capture already refunded in full', { ...base, refundedCents: FROZEN, liveTotalCents: 0 }, { kind: 'NONE' }],
    ['a net capture already below the live total', { ...base, refundedCents: 5000, liveTotalCents: LIVE }, { kind: 'NONE' }],
    ['a net capture between the live and the frozen total', { ...base, refundedCents: 1000, liveTotalCents: LIVE }, { kind: 'OVER', excessCents: 6040 - LIVE }],
    ['a live total above the frozen one', { ...base, liveTotalCents: FROZEN + 1 }, { kind: 'NONE' }],
    ['nothing captured', { ...base, capturedCents: 0, liveTotalCents: 0 }, { kind: 'NONE' }],
  ])('%s', (_what, input, verdict) => {
    expect(judgeCapture(input)).toEqual(verdict);
  });

  it('measures the excess against the FROZEN total: money captured above it is another lane’s (C14, FUT-714)', () => {
    expect(judgeCapture({ ...base, capturedCents: FROZEN + 5000, liveTotalCents: LIVE })).toEqual({ kind: 'OVER', excessCents: FROZEN - LIVE });
  });

  it.each([
    ['capturedCents', { capturedCents: -1 }],
    ['refundedCents', { refundedCents: 1.5 }],
    ['liveTotalCents', { liveTotalCents: Number.NaN }],
    ['frozenTotalCents', { frozenTotalCents: Number.POSITIVE_INFINITY }],
  ])('refuses an amount that is not whole cents (%s)', (name, patch) => {
    expect(() => judgeCapture({ ...base, liveTotalCents: LIVE, ...patch })).toThrow(new RegExp(`^${name}`));
  });
});

describe('allocateExcess', () => {
  const capture = (id: string, captured: number, refunded = 0) => ({ providerChargeId: id, capturedCents: captured, refundedCents: refunded });

  it('takes the excess from the last capture backwards, each giving at most what it holds', () => {
    const captures = [capture('A', 3000), capture('B', 2000)];
    expect(allocateExcess(captures, 2500, 5000)).toEqual([
      { capture: captures[0], excessCents: 500 },
      { capture: captures[1], excessCents: 2000 },
    ]);
  });

  it('leaves out a capture that holds nothing (refunded already)', () => {
    const captures = [capture('A', 7040), capture('B', 5000, 5000)];
    expect(allocateExcess(captures, 3520, FROZEN)).toEqual([{ capture: captures[0], excessCents: 3520 }]);
  });

  it('B1: a Pix paid twice (FUT-714) puts the excess on the capture that FUNDS the frozen total, never on the second', () => {
    const captures = [capture('C1', 7040), capture('C2', 7040)];
    expect(allocateExcess(captures, 3520, FROZEN)).toEqual([{ capture: captures[0], excessCents: 3520 }]);
  });

  it('a capture funding the frozen total only in part gives at most that part', () => {
    const captures = [capture('A', 5000), capture('B', 5000)];
    // Frozen 7040: A funds 5000, B funds 2040 and holds 2960 beyond it.
    expect(allocateExcess(captures, 3520, FROZEN)).toEqual([
      { capture: captures[0], excessCents: 1480 },
      { capture: captures[1], excessCents: 2040 },
    ]);
  });

  it('R2-1: beside a FUT-612 excess whose refund was refused, the whole excess lands on the capture FUT-612 did not record', () => {
    // FUT-612 parked S short, the old full code F settled, `payment.over` {S, 5000} was written and its
    // refund refused: S still holds 5000, all of it already recorded. Live 3520 after a write-off.
    const captures = [
      { providerChargeId: 'S', capturedCents: 5000, refundedCents: 0, excessRecordedCents: 5000 },
      { providerChargeId: 'F', capturedCents: 7040, refundedCents: 0 },
    ];
    const verdict = judgeCapture({ method: 'PIX', capturedCents: 12040, refundedCents: 0, liveTotalCents: 3520, frozenTotalCents: 7040 });
    expect(verdict).toEqual({ kind: 'OVER', excessCents: 3520 });
    const shares = allocateExcess(captures, 3520, 7040).map((share) => [share.capture.providerChargeId, share.excessCents]);
    expect(shares).toEqual([['F', 3520]]);
  });

  it('B1 whatever the order: a FUT-714 second capture recorded as excess funds nothing, even listed first', () => {
    const captures = [{ ...capture('C2', 7040), excessRecordedCents: 7040 }, capture('C1', 7040)];
    expect(allocateExcess(captures, 3520, FROZEN)).toEqual([{ capture: captures[1], excessCents: 3520 }]);
  });

  it('a short capture refunded first, then the full code (C14): the full code funds it all', () => {
    const captures = [capture('SHORT', 5000, 5000), capture('FULL', 7040)];
    expect(allocateExcess(captures, 3520, FROZEN)).toEqual([{ capture: captures[1], excessCents: 3520 }]);
  });
});

// ── the host, faked: its order, its records, its claim per charge ──────────────

interface FakeHost {
  stores: CaptureRecomposeStores;
  state: {
    totalCents: number;
    liveCents: number;
    method: string;
    paid: boolean;
    captures: RecomposeCapture[];
    records: Map<string, OverCaptureFacts>;
    alerts: OverCaptureFacts[];
    rewrites: { fromTotalCents: number; toTotalCents: number }[];
    claims: Map<string, { held: boolean; refunded: boolean }>;
    answered: { providerChargeId: string; outcome: CaptureRefundOutcome }[];
  };
  firstAttempt: ReturnType<typeof vi.fn<(key: RefundSeriesKey, input?: { reason?: string }) => Promise<FirstAttemptResult>>>;
}

const refunded = (chargeId: string, cents: number, status: RefundSnapshot['status'] = 'REFUNDED'): FirstAttemptResult => ({
  kind: 'REFUNDED',
  snapshot: { provider: 'pagbank', providerChargeId: chargeId, providerRefundId: `RE_${chargeId}`, status, amount: { amountCents: cents, currency: 'BRL' } },
});

function fakeHost(options: {
  live: number;
  captures?: RecomposeCapture[];
  answer?: (key: RefundSeriesKey) => Promise<FirstAttemptResult>;
  /** Read a capture whose claim is held (or refunded) as refunded, as the host's binding does (H3). */
  heldClaimIsRefunded?: boolean;
}): FakeHost {
  const state: FakeHost['state'] = {
    totalCents: FROZEN,
    liveCents: options.live,
    method: 'PIX',
    paid: true,
    captures: options.captures ?? [{ provider: 'pagbank', providerChargeId: CHARGE, capturedCents: FROZEN, refundedCents: 0 }],
    records: new Map(),
    alerts: [],
    rewrites: [],
    claims: new Map(),
    answered: [],
  };
  const firstAttempt = vi.fn(options.answer ?? (async (key: RefundSeriesKey) => refunded(key.providerChargeId, captureOf(key.providerChargeId).capturedCents)));
  const captureOf = (chargeId: string) => state.captures.find((c) => c.providerChargeId === chargeId) as RecomposeCapture;
  // As the host's `short_capture_refunds`: one row per charge; a released row may be taken again, a refunded one never.
  const claimOf = (chargeId: string): CaptureRefundClaim => ({
    claim: async () => {
      const row = state.claims.get(chargeId);
      if (row && (row.held || row.refunded)) return false;
      state.claims.set(chargeId, { held: true, refunded: false });
      return true;
    },
    release: async () => {
      state.claims.set(chargeId, { held: false, refunded: false });
    },
  });
  const stores: CaptureRecomposeStores = {
    readSettlement: async () => ({
      method: state.method,
      paid: state.paid,
      totalCents: state.totalCents,
      captures: state.captures.map((c) => {
        const claim = state.claims.get(c.providerChargeId);
        const going = options.heldClaimIsRefunded === true && (claim?.held === true || claim?.refunded === true);
        return { ...c, refundedCents: going ? c.capturedCents : c.refundedCents };
      }),
    }),
    composeLiveTotal: async () => state.liveCents,
    rewriteTotal: async ({ fromTotalCents, toTotalCents }) => {
      if (state.totalCents !== fromTotalCents) return false;
      state.totalCents = toTotalCents;
      state.rewrites.push({ fromTotalCents, toTotalCents });
      return true;
    },
    recordOverCapture: async (facts) => {
      if (state.records.has(facts.key)) return false;
      state.records.set(facts.key, facts);
      return true;
    },
    isOverCaptureRecorded: async (key) => state.records.has(key),
    alert: (facts) => {
      state.alerts.push(facts);
    },
    refundClaim: (_ref, capture) => claimOf(capture.providerChargeId),
    retrier: { firstAttempt, failedAnswer: vi.fn(async () => ({ kind: 'REFUSED' as const, error: new Error('failed') })) },
    refundAnswered: async (_ref, capture, outcome) => {
      state.answered.push({ providerChargeId: capture.providerChargeId, outcome });
      if (outcome.kind === 'REFUNDED') {
        captureOf(capture.providerChargeId).refundedCents = capture.capturedCents;
        state.claims.set(capture.providerChargeId, { held: false, refunded: true });
      }
    },
  };
  return { stores, state, firstAttempt };
}

describe('createCaptureRecompose — one line written off (decision 5: recorded, alerted, never refunded)', () => {
  it('C1: rewrites the frozen total to the live one, records the excess once and alerts once, refunds nothing', async () => {
    const host = fakeHost({ live: LIVE });
    const result = await createCaptureRecompose({ stores: host.stores }).recompose(REF);

    expect(host.state.rewrites).toEqual([{ fromTotalCents: FROZEN, toTotalCents: LIVE }]);
    const facts: OverCaptureFacts = {
      key: overCaptureKey('ord_1', CHARGE),
      merchant: REF.merchant,
      reference: 'ord_1',
      provider: 'pagbank',
      providerChargeId: CHARGE,
      capturedCents: FROZEN,
      excessCents: FROZEN - LIVE,
      liveTotalCents: LIVE,
      frozenTotalCents: FROZEN,
      cause: 'PARTIAL_WRITE_OFF',
      refund: null,
    };
    expect([...host.state.records.values()]).toEqual([facts]);
    expect(host.state.alerts).toEqual([facts]);
    expect(host.firstAttempt).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: null, verdict: { kind: 'OVER', excessCents: 3520 }, rewritten: true, recorded: [facts], refunds: [] });
  });

  it('C11: a retried job finds the total rewritten and the record written: nothing twice', async () => {
    const host = fakeHost({ live: LIVE });
    const recompose = createCaptureRecompose({ stores: host.stores });
    await recompose.recompose(REF);
    const again = await recompose.recompose(REF);

    expect(again).toMatchObject({ skipped: null, rewritten: false, recorded: [] });
    expect(host.state.rewrites).toHaveLength(1);
    expect(host.state.records.size).toBe(1);
    expect(host.state.alerts).toHaveLength(1);
  });

  it('C11: two runs at once write one record and one alert', async () => {
    const host = fakeHost({ live: LIVE });
    const recompose = createCaptureRecompose({ stores: host.stores });
    await Promise.all([recompose.recompose(REF), recompose.recompose(REF)]);

    expect(host.state.records.size).toBe(1);
    expect(host.state.alerts).toHaveLength(1);
    expect(host.state.totalCents).toBe(LIVE);
  });

  it('C11: a run that crashed after the rewrite records on the retry', async () => {
    const host = fakeHost({ live: LIVE });
    host.state.totalCents = LIVE;
    const result = await createCaptureRecompose({ stores: host.stores }).recompose(REF);

    expect(result).toMatchObject({ rewritten: false, recorded: [{ excessCents: FROZEN - LIVE }] });
    expect(host.state.alerts).toHaveLength(1);
  });

  it('B1: a Pix paid twice (FUT-714): the record names the capture that funds the frozen total', async () => {
    const host = fakeHost({
      live: LIVE,
      captures: [
        { provider: 'pagbank', providerChargeId: 'C1', capturedCents: FROZEN, refundedCents: 0 },
        { provider: 'pagbank', providerChargeId: 'C2', capturedCents: FROZEN, refundedCents: 0 },
      ],
    });
    await createCaptureRecompose({ stores: host.stores }).recompose(REF);

    expect([...host.state.records.values()].map((f) => [f.providerChargeId, f.excessCents, f.capturedCents])).toEqual([['C1', FROZEN - LIVE, FROZEN]]);
    expect(host.state.alerts.map((f) => f.providerChargeId)).toEqual(['C1']);
  });

  it('R2-1: beside a FUT-612 excess whose refund was refused, the record names the full code, never the parked capture', async () => {
    const host = fakeHost({
      live: LIVE,
      captures: [
        { provider: 'pagbank', providerChargeId: 'S', capturedCents: 5000, refundedCents: 0, excessRecordedCents: 5000 },
        { provider: 'pagbank', providerChargeId: 'F', capturedCents: FROZEN, refundedCents: 0 },
      ],
    });
    await createCaptureRecompose({ stores: host.stores }).recompose(REF);

    expect([...host.state.records.values()].map((f) => [f.providerChargeId, f.excessCents])).toEqual([['F', FROZEN - LIVE]]);
    expect(host.state.alerts.map((f) => f.providerChargeId)).toEqual(['F']);
  });

  it('a Pix sale whose difference was paid by card (ADR 0352): the excess sits on the funding captures, newest first', async () => {
    const host = fakeHost({
      live: LIVE,
      captures: [
        { provider: 'pagbank', providerChargeId: 'PIX_SHORT', capturedCents: 5000, refundedCents: 0 },
        { provider: 'pagbank', providerChargeId: 'CARD_DIFF', capturedCents: 2040, refundedCents: 0 },
      ],
    });
    await createCaptureRecompose({ stores: host.stores }).recompose(REF);

    expect([...host.state.records.values()].map((f) => [f.providerChargeId, f.excessCents])).toEqual([
      ['PIX_SHORT', 1480],
      ['CARD_DIFF', 2040],
    ]);
  });

  it('a total somebody else moved is left alone: no rewrite, no record, a warning', async () => {
    const host = fakeHost({ live: LIVE });
    host.state.totalCents = 5000;
    const log = { warn: vi.fn(), error: vi.fn() };
    const result = await createCaptureRecompose({ stores: host.stores, log }).recompose(REF);

    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/ord_1: the total moved \(5000, frozen 7040, live 3520\)/));
    expect(result.skipped).toBe('TOTAL_MOVED');
    expect(host.state.rewrites).toEqual([]);
    expect(host.state.records.size).toBe(0);
  });

  it('a rewrite that loses its predicate stops there', async () => {
    const host = fakeHost({ live: LIVE });
    host.stores.rewriteTotal = vi.fn(async () => false);
    const result = await createCaptureRecompose({ stores: host.stores }).recompose(REF);

    expect(result.skipped).toBe('TOTAL_MOVED');
    expect(host.state.records.size).toBe(0);
  });

  it('beside a short capture already refunded (C14): only the capture still holding money is recorded', async () => {
    const host = fakeHost({
      live: LIVE,
      captures: [
        { provider: 'pagbank', providerChargeId: 'SHORT', capturedCents: 5000, refundedCents: 5000 },
        { provider: 'pagbank', providerChargeId: CHARGE, capturedCents: FROZEN, refundedCents: 0 },
      ],
    });
    await createCaptureRecompose({ stores: host.stores }).recompose(REF);

    expect([...host.state.records.values()].map((f) => [f.providerChargeId, f.excessCents])).toEqual([[CHARGE, FROZEN - LIVE]]);
  });

  it('an alert that throws is logged; the record stays and is not alerted again', async () => {
    const host = fakeHost({ live: LIVE });
    host.stores.alert = () => {
      throw new Error('push down');
    };
    const log = { warn: vi.fn(), error: vi.fn() };
    const result = await createCaptureRecompose({ stores: host.stores, log }).recompose(REF);

    expect(result.recorded).toHaveLength(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('push down'));
  });
});

describe('createCaptureRecompose — nothing to recompose', () => {
  it.each([
    ['C5: nothing written off', (h: FakeHost) => void (h.state.liveCents = FROZEN), null],
    ['C10: a card', (h: FakeHost) => void (h.state.method = 'CARD'), null],
    ['an unsettled sale', (h: FakeHost) => void (h.state.paid = false), 'NOT_PAID'],
  ])('%s: no rewrite, no record, no refund', async (_what, arrange, skipped) => {
    const host = fakeHost({ live: 0 });
    arrange(host);
    const result = await createCaptureRecompose({ stores: host.stores }).recompose(REF);

    expect(result.skipped).toBe(skipped);
    expect(result.verdict).toEqual({ kind: 'NONE' });
    expect(host.state.rewrites).toEqual([]);
    expect(host.state.records.size).toBe(0);
    expect(host.firstAttempt).not.toHaveBeenCalled();
  });

  it('a reference the host has no settlement for', async () => {
    const host = fakeHost({ live: 0 });
    host.stores.readSettlement = async () => null;
    expect((await createCaptureRecompose({ stores: host.stores }).recompose(REF)).skipped).toBe('NO_SETTLEMENT');
  });

  it('a store that fails propagates, so the host’s job keeps the error and retries', async () => {
    const host = fakeHost({ live: LIVE });
    host.stores.composeLiveTotal = async () => Promise.reject(new Error('db down'));
    await expect(createCaptureRecompose({ stores: host.stores }).recompose(REF)).rejects.toThrow('db down');
    expect(host.state.rewrites).toEqual([]);
  });
});

describe('createCaptureRecompose — every line written off (decision 3: refunded in full)', () => {
  it('C4: rewrites to zero and sends ONE whole-charge refund under the short-capture subject; nothing recorded', async () => {
    const host = fakeHost({ live: 0 });
    const result = await createCaptureRecompose({ stores: host.stores, refundCause: 'written-off', refundReason: 'line written off' }).recompose(REF);

    expect(host.state.rewrites).toEqual([{ fromTotalCents: FROZEN, toTotalCents: 0 }]);
    expect(host.firstAttempt).toHaveBeenCalledTimes(1);
    expect(host.firstAttempt).toHaveBeenCalledWith(
      { merchant: REF.merchant, provider: 'pagbank', providerChargeId: CHARGE, reference: 'ord_1', boundTo: CHARGE, cause: 'written-off', subject: SHORT_CAPTURE_REFUND_SUBJECT },
      { reason: 'line written off' },
    );
    expect(host.state.answered).toEqual([{ providerChargeId: CHARGE, outcome: { kind: 'REFUNDED', refundedCents: FROZEN } }]);
    expect(host.state.records.size).toBe(0);
    expect(host.state.alerts).toEqual([]);
    expect(result).toMatchObject({ verdict: { kind: 'REFUND_ALL' }, rewritten: true, refunds: [{ providerChargeId: CHARGE, outcome: { kind: 'REFUNDED' } }] });
  });

  it('C11c: the capture is refunded ONCE however often the job runs, at once or in turn', async () => {
    const host = fakeHost({ live: 0 });
    const recompose = createCaptureRecompose({ stores: host.stores });
    await Promise.all([recompose.recompose(REF), recompose.recompose(REF)]);
    await recompose.recompose(REF);

    expect(host.firstAttempt).toHaveBeenCalledTimes(1);
    expect(host.state.records.size).toBe(0);
  });

  it('an accepted refund (the provider completes it later) is no over-capture', async () => {
    const host = fakeHost({
      live: 0,
      answer: async (key) => refunded(key.providerChargeId, FROZEN, 'PENDING'),
    });
    await createCaptureRecompose({ stores: host.stores }).recompose(REF);

    expect(host.state.answered[0]?.outcome).toEqual({ kind: 'ACCEPTED' });
    expect(host.state.records.size).toBe(0);
  });

  it('C12: a refused refund records the whole capture and alerts; a retry never sends again', async () => {
    const host = fakeHost({ live: 0, answer: async () => ({ kind: 'REFUSED', error: new Error('no') }) });
    const recompose = createCaptureRecompose({ stores: host.stores });
    const result = await recompose.recompose(REF);
    const again = await recompose.recompose(REF);

    expect(host.firstAttempt).toHaveBeenCalledTimes(1);
    expect(host.state.alerts).toEqual([
      expect.objectContaining({
        providerChargeId: CHARGE,
        capturedCents: FROZEN,
        excessCents: FROZEN,
        liveTotalCents: 0,
        cause: 'REFUND_NOT_MADE',
        refund: { refusal: 'REFUSED', retrying: false, error: null },
      }),
    ]);
    expect(result.recorded).toHaveLength(1);
    expect(again.refunds).toEqual([{ providerChargeId: CHARGE, outcome: { kind: 'ALREADY_RECORDED' } }]);
    expect(host.state.records.size).toBe(1);
    // The claim went back: the store's own "pending refund" act may take it.
    expect(host.state.claims.get(CHARGE)?.held).toBe(false);
  });

  it('C13: a provider that cannot refund (the call throws) records the whole capture and alerts, once', async () => {
    const host = fakeHost({ live: 0, answer: async () => Promise.reject(new Error('refunds are not supported')) });
    const log = { warn: vi.fn(), error: vi.fn() };
    const recompose = createCaptureRecompose({ stores: host.stores, log });
    const result = await recompose.recompose(REF);
    await recompose.recompose(REF);

    expect(host.firstAttempt).toHaveBeenCalledTimes(1);
    expect(result.refunds).toEqual([{ providerChargeId: CHARGE, outcome: { kind: 'UNAVAILABLE', error: expect.any(Error) } }]);
    expect(host.state.alerts).toEqual([
      expect.objectContaining({ excessCents: FROZEN, cause: 'REFUND_NOT_MADE', refund: { refusal: 'UNAVAILABLE', retrying: false, error: 'refunds are not supported' } }),
    ]);
    expect(host.state.answered).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('could not be sent'));
  });

  it('a "not yet" leaves a retrying series: recorded and alerted as such, never sent again by a retry', async () => {
    const host = fakeHost({ live: 0, answer: async () => ({ kind: 'NOT_YET', error: new Error('40008'), row: {} as RefundSeriesRow }) });
    const recompose = createCaptureRecompose({ stores: host.stores });
    await recompose.recompose(REF);
    await recompose.recompose(REF);

    expect(host.firstAttempt).toHaveBeenCalledTimes(1);
    expect(host.state.alerts).toEqual([expect.objectContaining({ refund: { refusal: 'NOT_YET', retrying: true, error: null } })]);
  });

  it('C14: beside a short capture whose refund another lane holds, each capture goes back once', async () => {
    const host = fakeHost({
      live: 0,
      captures: [
        { provider: 'pagbank', providerChargeId: 'SHORT', capturedCents: 5000, refundedCents: 0 },
        { provider: 'pagbank', providerChargeId: CHARGE, capturedCents: FROZEN, refundedCents: 0 },
      ],
    });
    // The shortfall lane claimed the short capture first.
    host.state.claims.set('SHORT', { held: true, refunded: false });
    const result = await createCaptureRecompose({ stores: host.stores }).recompose(REF);

    expect(host.firstAttempt.mock.calls.map(([key]) => key.providerChargeId)).toEqual([CHARGE]);
    expect(result.refunds).toEqual([
      { providerChargeId: 'SHORT', outcome: { kind: 'ALREADY_ASKED' } },
      { providerChargeId: CHARGE, outcome: { kind: 'REFUNDED', refundedCents: FROZEN } },
    ]);
    expect(host.state.records.size).toBe(0);
  });

  it('a Pix sale whose difference was paid by card (ADR 0352): each capture goes back once, under its own claim', async () => {
    const host = fakeHost({
      live: 0,
      captures: [
        { provider: 'pagbank', providerChargeId: 'PIX_SHORT', capturedCents: 5000, refundedCents: 0 },
        { provider: 'pagbank', providerChargeId: 'CARD_DIFF', capturedCents: 2040, refundedCents: 0 },
      ],
    });
    const recompose = createCaptureRecompose({ stores: host.stores });
    await recompose.recompose(REF);
    await recompose.recompose(REF);

    expect(host.firstAttempt.mock.calls.map(([key]) => key.providerChargeId)).toEqual(['PIX_SHORT', 'CARD_DIFF']);
    expect(host.state.records.size).toBe(0);
  });

  it('a held claim read as refunded (the host binding, H3): two runs at once send one refund, and a retry judges NONE', async () => {
    const opened: { release: () => void } = { release: () => undefined };
    const gate = new Promise<void>((resolve) => {
      opened.release = resolve;
    });
    const host = fakeHost({
      live: 0,
      heldClaimIsRefunded: true,
      answer: async (key) => {
        await gate;
        return refunded(key.providerChargeId, FROZEN);
      },
    });
    const recompose = createCaptureRecompose({ stores: host.stores });
    const first = recompose.recompose(REF);
    await vi.waitFor(() => expect(host.firstAttempt).toHaveBeenCalledTimes(1));
    // The second run reads the claim held: the capture is going back, nothing is owed.
    const second = await recompose.recompose(REF);
    opened.release();
    await first;
    const third = await recompose.recompose(REF);

    expect(second.verdict).toEqual({ kind: 'NONE' });
    expect(third.verdict).toEqual({ kind: 'NONE' });
    expect(host.firstAttempt).toHaveBeenCalledTimes(1);
    expect(host.state.records.size).toBe(0);
  });

  it('a record that fails after a refused refund propagates; the retry re-claims and sends attempt 2, then records once', async () => {
    const host = fakeHost({ live: 0, answer: async () => ({ kind: 'REFUSED', error: new Error('no') }) });
    const write = host.stores.recordOverCapture;
    host.stores.recordOverCapture = vi.fn(async () => Promise.reject(new Error('db down')));
    const recompose = createCaptureRecompose({ stores: host.stores });
    await expect(recompose.recompose(REF)).rejects.toThrow('db down');
    host.stores.recordOverCapture = write;
    await recompose.recompose(REF);

    // Accepted: the first attempt moved no money, and the claim it released is the store's to take as well.
    expect(host.firstAttempt).toHaveBeenCalledTimes(2);
    expect(host.state.records.size).toBe(1);
    expect(host.state.alerts).toHaveLength(1);
  });

  it('C14: a capture already refunded by the other lane is not sent again', async () => {
    const host = fakeHost({
      live: 0,
      captures: [
        { provider: 'pagbank', providerChargeId: 'SHORT', capturedCents: 5000, refundedCents: 5000 },
        { provider: 'pagbank', providerChargeId: CHARGE, capturedCents: FROZEN, refundedCents: 0 },
      ],
    });
    await createCaptureRecompose({ stores: host.stores }).recompose(REF);

    expect(host.firstAttempt.mock.calls.map(([key]) => key.providerChargeId)).toEqual([CHARGE]);
  });
});
