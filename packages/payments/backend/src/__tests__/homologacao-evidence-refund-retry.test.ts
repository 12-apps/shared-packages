import { afterEach, describe, expect, it, vi } from 'vitest';

import { credentialStoreFrom } from '../config/service';
import { createPaymentsGateway } from '../core/gateway';
import type { ProviderFailureReport } from '../core/provider-failure';
import { defineProviders } from '../core/registry';
import { createMemoryAttemptLedger, createMemoryChargeStore } from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import * as Evidence from '../platform/evidence/index';
import {
  buildHomologacaoEvidenceJson,
  completeEvidenceRun,
  confirmEvidencePix,
  EvidencePixOpenError,
  pixViewOf,
  prepareEvidenceRun,
  PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY,
  type EvidenceRecord,
  type EvidenceRunDeps,
} from '../platform/evidence/index';
import { productionDebitTest } from '../platform/evidence/sandbox-buyer';
import { pagbankProvider } from '../providers/pagbank';
import { PT_BR_PAGBANK_COPY } from '../providers/pt-BR';
import { BUYER, cards, connected, wallets, world } from './homologacao-evidence-world';

/**
 * PG1 (FUT-4360): the production evidence Pix refund on PagBank's "not yet"
 * (40008), retried in the BACKGROUND — at most 3 automatic attempts per series,
 * exponential backoff (5 min, then 10 min), never inside the card's CHECK
 * request — and the operator's "Tentar estornar o Pix de novo" once they ran
 * out. The cases are the contract's table (agent-pg1-contract/contract.md, B1–B12).
 *
 * New surface these tests name (the contract's "API" section):
 *  - `retryDueEvidenceRefund(deps)` — the sweep's body: runs the one attempt
 *    that is due, if any, behind the fence;
 *  - `PixConfirmAction` `'RETRY_REFUND'` — the operator's press;
 *  - `EvidencePixView.refund` — `{ attempt, of, nextAt, exhausted, refusal }`;
 *  - `EvidenceRunDeps.onProviderFailure` — the reporter the retry tells ONCE per
 *    charge (the gateway itself no longer reports a 40008 refund).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const PROD = PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY;
const SKIPPED = PROD.outcome.pixSkipped;
const T0 = new Date('2026-11-11T15:00:00.000Z');
const MIN = 60_000;
const CANCEL = 'POST /charges/CHAR_PIX/cancel';
const CONSULT = 'GET /orders/ORDE_PIX';

/** What PagBank answers to one Pix cancel. */
type Answer = 'NOT_YET' | 'OK' | 'REFUSED' | 'DOWN' | 'TRANSPORT' | 'LOST' | { hold: Promise<'OK' | 'NOT_YET'> };

const json = (body: unknown, status: number, statusText: string): Response =>
  new Response(JSON.stringify(body), { status, statusText, headers: { 'Content-Type': 'application/json' } });

const NOT_YET = () =>
  json({ error_messages: [{ code: '40008', message: 'refund_temporarily_unavailable', description: 'Transaction is not found.' }] }, 400, 'Bad Request');
const REFUNDED_CHARGE = () =>
  json({ id: 'CHAR_PIX', status: 'CANCELED', amount: { value: 100, summary: { refunded: 100 } } }, 201, 'Created');

/**
 * The world's PagBank, with the Pix cancel scripted answer by answer and the
 * Pix consult answering CANCELED once PagBank refunded it (by a cancel, or by
 * hand in its panel). The first consult answers WAITING, every later one PAID,
 * as in the world.
 */
function pixWorld(script: Answer[], options: { reporter?: (report: ProviderFailureReport) => void } = {}) {
  const w = world({ environment: 'PRODUCTION', applePayConfigured: true });
  const answers = [...script];
  const pagbank = { refunded: false };
  const inner = w.pagbank.handler;
  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const route = `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`;
    if (route === CONSULT && pagbank.refunded) {
      w.pagbank.seen.push({ path: route, authorization: new Headers(init?.headers).get('authorization') });
      return json({ id: 'ORDE_PIX', charges: [{ id: 'CHAR_PIX', status: 'CANCELED', amount: { value: 100, summary: { refunded: 100 } } }] }, 200, 'OK');
    }
    if (route !== CANCEL) return inner(input, init);
    w.pagbank.seen.push({ path: route, authorization: new Headers(init?.headers).get('authorization') });
    const answer = answers.shift() ?? 'OK';
    const settle = async (a: Answer): Promise<Response> => {
      if (typeof a === 'object') return settle(await a.hold);
      if (a === 'NOT_YET') return NOT_YET();
      if (a === 'REFUSED') {
        return json({ error_messages: [{ code: '40002', description: 'invalid_parameter', parameter_name: 'amount.value' }] }, 400, 'Bad Request');
      }
      if (a === 'DOWN') return json({ error_messages: [{ code: 'SERVICE_UNAVAILABLE' }] }, 503, 'Service Unavailable');
      if (a === 'TRANSPORT') throw new TypeError('fetch failed');
      if (a === 'LOST') {
        pagbank.refunded = true;
        return json({ error_messages: [{ code: 'GATEWAY_TIMEOUT' }] }, 504, 'Gateway Timeout');
      }
      pagbank.refunded = true;
      return REFUNDED_CHARGE();
    };
    return settle(answer);
  };
  vi.stubGlobal('fetch', vi.fn(handler));
  const clock = { now: T0 };
  const gateway = options.reporter
    ? createPaymentsGateway({
        providers: defineProviders({ pagbank: pagbankProvider(PT_BR_PAGBANK_COPY) }),
        credentials: credentialStoreFrom(w.configs),
        charges: createMemoryChargeStore(),
        webhooks: createMemoryWebhookInbox(),
        attempts: createMemoryAttemptLedger(),
        onProviderFailure: options.reporter,
      })
    : w.runDeps.gateway;
  const runDeps = {
    ...w.runDeps,
    gateway,
    copy: PROD.outcome,
    now: () => clock.now,
    ...(options.reporter ? { onProviderFailure: options.reporter } : {}),
  } as EvidenceRunDeps;
  const fileDeps = { ...w.fileDeps, copy: PROD };
  return { w, pagbank, runDeps, fileDeps, clock, answers };
}

type PixWorld = ReturnType<typeof pixWorld>;

const calls = (p: PixWorld, path: string): number => p.w.pagbank.seen.filter((call) => call.path === path).length;
const at = (p: PixWorld, minutes: number): void => {
  p.clock.now = new Date(T0.getTime() + minutes * MIN);
};
const refundStep = (record: EvidenceRecord) => record.steps.find((step) => step.key === 'pix.refund');
const view = (record: EvidenceRecord) => pixViewOf(record, SKIPPED) as ReturnType<typeof pixViewOf> & {
  refund: { attempt: number; of: number; nextAt: string | null; exhausted: boolean; refusal: string | null } | null;
};

/** The background sweep's body (new in PG1). */
const sweep = (deps: EvidenceRunDeps): Promise<EvidenceRecord | null> =>
  (Evidence as unknown as { retryDueEvidenceRefund: (d: EvidenceRunDeps) => Promise<EvidenceRecord | null> }).retryDueEvidenceRefund(deps);

/** The operator's "Tentar estornar o Pix de novo" (new action in PG1). */
const press = (deps: EvidenceRunDeps, runId: string): Promise<EvidenceRecord> =>
  confirmEvidencePix(deps, runId, 'RETRY_REFUND' as never);

/** Connect, raise the run, and have the operator's checks find the Pix PAID: attempt 1 runs in that CHECK. */
async function paid(p: PixWorld): Promise<{ runId: string; record: EvidenceRecord }> {
  await connected(p.w);
  const prepared = await prepareEvidenceRun(p.runDeps, productionDebitTest(BUYER));
  await completeEvidenceRun(p.runDeps, prepared.runId, cards(), wallets());
  await confirmEvidencePix(p.runDeps, prepared.runId, 'CHECK'); // WAITING
  const record = await confirmEvidencePix(p.runDeps, prepared.runId, 'CHECK'); // PAID → attempt 1
  return { runId: prepared.runId, record };
}

describe('the production evidence Pix refund on PagBank 40008 (PG1)', () => {
  it('B1 given 40008 then success, then the CHECK sends ONE cancel, schedules attempt 2 at +5 min, and the sweep refunds it then', async () => {
    const p = pixWorld(['NOT_YET', 'OK']);
    const { runId, record } = await paid(p);

    // One cancel inside the request — never the in-request backoff loop.
    expect(calls(p, CANCEL)).toBe(1);
    expect(view(record).state).toBe('REFUND_PENDING');
    expect(view(record).refund).toEqual({
      attempt: 1,
      of: 3,
      nextAt: new Date(T0.getTime() + 5 * MIN).toISOString(),
      exhausted: false,
      refusal: 'NOT_YET',
    });

    // A CHECK of a paid Pix calls nothing: the background owns the refund.
    const seenBefore = p.w.pagbank.seen.length;
    await confirmEvidencePix(p.runDeps, runId, 'CHECK');
    expect(p.w.pagbank.seen).toHaveLength(seenBefore);

    // Not due yet: the sweep calls nothing.
    at(p, 4);
    await sweep(p.runDeps);
    expect(p.w.pagbank.seen).toHaveLength(seenBefore);

    // Due: consult first, then one cancel.
    at(p, 5);
    const refunded = await sweep(p.runDeps);
    expect(calls(p, CANCEL)).toBe(2);
    expect(p.w.pagbank.seen.slice(seenBefore).map((call) => call.path)).toEqual([CONSULT, CANCEL]);
    expect(view(refunded!).state).toBe('REFUNDED');
    expect(refundStep(refunded!)?.status).toBe('EXECUTED');

    // (c) the file keeps every attempt of the refund step, in order, and nothing else of the retry.
    const file = JSON.parse((await buildHomologacaoEvidenceJson(p.fileDeps)).content) as {
      scenarios: { key: string; status: string; calls: { request: { method: string; url: string }; response: { status: number } | null }[] }[];
    };
    const scenario = file.scenarios.find((s) => s.key === 'pix.refund')!;
    expect(scenario.status).toBe('EXECUTED');
    expect(scenario.calls.map((call) => `${call.request.method} ${new URL(call.request.url).pathname} ${call.response?.status}`)).toEqual([
      `${CANCEL} 400`,
      `${CONSULT} 200`,
      `${CANCEL} 201`,
    ]);
    expect(Object.keys(scenario).sort()).toEqual(['at', 'calls', 'expected', 'ids', 'key', 'notes', 'number', 'observed', 'scenario', 'status']);

    // Settled: the run no longer blocks a new one.
    await expect(prepareEvidenceRun(p.runDeps, productionDebitTest(BUYER))).resolves.toMatchObject({ publicKey: 'PUBKEY' });
  });

  it('B2 given 40008 on all 3, then attempts run at T0, +5 and +15 min, then stop: exhausted, still open, nothing more is sent', async () => {
    const p = pixWorld(['NOT_YET', 'NOT_YET', 'NOT_YET', 'NOT_YET']);
    await paid(p);

    at(p, 5);
    const second = await sweep(p.runDeps);
    expect(calls(p, CANCEL)).toBe(2);
    expect(view(second!).refund).toMatchObject({ attempt: 2, of: 3, nextAt: new Date(T0.getTime() + 15 * MIN).toISOString(), exhausted: false });

    at(p, 14);
    await sweep(p.runDeps);
    expect(calls(p, CANCEL)).toBe(2);

    at(p, 15);
    const third = await sweep(p.runDeps);
    expect(calls(p, CANCEL)).toBe(3);
    expect(view(third!).state).toBe('REFUND_PENDING');
    expect(view(third!).refund).toEqual({ attempt: 3, of: 3, nextAt: null, exhausted: true, refusal: 'NOT_YET' });
    expect(refundStep(third!)?.status).toBe('FAILED');

    // Out of attempts: no sweep sends anything, ever, until a person presses.
    at(p, 120);
    const seen = p.w.pagbank.seen.length;
    await sweep(p.runDeps);
    expect(p.w.pagbank.seen).toHaveLength(seen);
    // The real money is still out: a new run stays refused.
    await expect(prepareEvidenceRun(p.runDeps, productionDebitTest(BUYER))).rejects.toBeInstanceOf(EvidencePixOpenError);
  });

  it('B2b given the attempts ran out, when the operator presses "Tentar de novo", then a new series of 3 starts at once with a consult first', async () => {
    const p = pixWorld(['NOT_YET', 'NOT_YET', 'NOT_YET', 'NOT_YET']);
    const { runId } = await paid(p);
    at(p, 5);
    await sweep(p.runDeps);
    at(p, 15);
    await sweep(p.runDeps);

    at(p, 30);
    const seen = p.w.pagbank.seen.length;
    const retried = await press(p.runDeps, runId);

    expect(p.w.pagbank.seen.slice(seen).map((call) => call.path)).toEqual([CONSULT, CANCEL]);
    expect(view(retried).refund).toEqual({
      attempt: 1,
      of: 3,
      nextAt: new Date(T0.getTime() + 35 * MIN).toISOString(),
      exhausted: false,
      refusal: 'NOT_YET',
    });
  });

  it('B3 given the charge was refunded by hand in the PagBank panel, then the next attempt consults, adopts REFUNDED and cancels nothing', async () => {
    const p = pixWorld(['NOT_YET']);
    await paid(p);
    p.pagbank.refunded = true; // the owner refunded it in PagBank's panel

    at(p, 5);
    const adopted = await sweep(p.runDeps);

    expect(calls(p, CANCEL)).toBe(1);
    expect(view(adopted!).state).toBe('REFUNDED');
    expect(refundStep(adopted!)).toMatchObject({ status: 'EXECUTED', observed: PROD.outcome.canceled('REFUNDED') });
  });

  it('B3b given the attempts ran out and the owner refunded it in the panel, when "Tentar de novo" is pressed, then it is adopted with no cancel', async () => {
    const p = pixWorld(['NOT_YET', 'NOT_YET', 'NOT_YET']);
    const { runId } = await paid(p);
    at(p, 5);
    await sweep(p.runDeps);
    at(p, 15);
    await sweep(p.runDeps);
    p.pagbank.refunded = true;

    at(p, 40);
    const adopted = await press(p.runDeps, runId);

    expect(calls(p, CANCEL)).toBe(3);
    expect(view(adopted).state).toBe('REFUNDED');
  });

  it('B4 given a non-40008 refusal (4xx), then no automatic attempt follows: stopped with the refusal, and "Tentar de novo" is offered', async () => {
    const p = pixWorld(['REFUSED']);
    const { runId, record } = await paid(p);

    expect(calls(p, CANCEL)).toBe(1);
    expect(view(record).refund).toEqual({ attempt: 1, of: 3, nextAt: null, exhausted: true, refusal: 'REFUSED' });

    // Neither a CHECK nor the sweep sends it again.
    await confirmEvidencePix(p.runDeps, runId, 'CHECK');
    at(p, 60);
    await sweep(p.runDeps);
    expect(calls(p, CANCEL)).toBe(1);
  });

  it('B5 given a timeout whose refund actually landed (504, answer lost), then the next attempt consults first and adopts REFUNDED', async () => {
    const p = pixWorld(['LOST']);
    const { record } = await paid(p);
    expect(view(record).refund).toMatchObject({ attempt: 1, exhausted: false, refusal: 'UNKNOWN' });

    at(p, 5);
    const adopted = await sweep(p.runDeps);

    expect(calls(p, CANCEL)).toBe(1);
    expect(view(adopted!).state).toBe('REFUNDED');
  });

  it('B5b given a transport error, then it is retried in the background like a "not yet", on the same schedule, consult first', async () => {
    const p = pixWorld(['TRANSPORT', 'OK']);
    const { runId, record } = await paid(p);
    expect(view(record).refund).toMatchObject({ attempt: 1, nextAt: new Date(T0.getTime() + 5 * MIN).toISOString(), refusal: 'UNKNOWN' });

    const seen = p.w.pagbank.seen.length;
    await confirmEvidencePix(p.runDeps, runId, 'CHECK');
    expect(p.w.pagbank.seen).toHaveLength(seen);

    at(p, 5);
    const refunded = await sweep(p.runDeps);
    expect(p.w.pagbank.seen.slice(seen).map((call) => call.path)).toEqual([CONSULT, CANCEL]);
    expect(view(refunded!).state).toBe('REFUNDED');
  });

  it('B6 given an attempt due, when two sweeps and a stale press arrive together, then exactly ONE cancel is in flight and the counter is 2', async () => {
    let release: (answer: 'NOT_YET') => void = () => undefined;
    const hold = new Promise<'NOT_YET'>((resolve) => {
      release = resolve;
    });
    const p = pixWorld(['NOT_YET', { hold }]);
    const { runId } = await paid(p);

    at(p, 5);
    const racing = Promise.allSettled([sweep(p.runDeps), press(p.runDeps, runId), sweep(p.runDeps)]);
    await vi.waitFor(() => expect(calls(p, CANCEL)).toBe(2));
    release('NOT_YET');
    await racing;

    expect(calls(p, CANCEL)).toBe(2);
    const latest = await p.runDeps.store.latest('pagbank', 'RUN');
    expect(view(latest!).refund).toMatchObject({ attempt: 2, of: 3, exhausted: false });
    const cancels = refundStep(latest!)!.calls.filter((call) => call.method === 'POST');
    expect(cancels).toHaveLength(2);
  });

  it('B6b given the attempts ran out, when "Tentar de novo" is pressed twice at once, then one series starts and one cancel is sent', async () => {
    const p = pixWorld(['NOT_YET', 'NOT_YET', 'NOT_YET', 'NOT_YET', 'NOT_YET']);
    const { runId } = await paid(p);
    at(p, 5);
    await sweep(p.runDeps);
    at(p, 15);
    await sweep(p.runDeps);

    at(p, 20);
    await Promise.allSettled([press(p.runDeps, runId), press(p.runDeps, runId)]);

    expect(calls(p, CANCEL)).toBe(4);
    expect(view((await p.runDeps.store.latest('pagbank', 'RUN'))!).refund).toMatchObject({ attempt: 1, exhausted: false });
  });

  it('B8 given a process restart mid-schedule, then a fresh process resumes from the stored attempt count and nextAt', async () => {
    const p = pixWorld(['NOT_YET', 'NOT_YET', 'OK']);
    await paid(p);

    // A new process: new deps object over the same durable store, nothing in memory carried over.
    const restarted = { ...p.runDeps, now: () => new Date(T0.getTime() + 5 * MIN) } as EvidenceRunDeps;
    const second = await sweep(restarted);
    expect(view(second!).refund).toMatchObject({ attempt: 2, nextAt: new Date(T0.getTime() + 15 * MIN).toISOString() });

    const again = { ...p.runDeps, now: () => new Date(T0.getTime() + 15 * MIN) } as EvidenceRunDeps;
    expect(view((await sweep(again))!).state).toBe('REFUNDED');
    expect(calls(p, CANCEL)).toBe(3);
  });

  it('B8b given a process that died holding the claim, then nothing is sent before the claim expires (120 s), and its late answer writes nothing', async () => {
    let release: (answer: 'OK') => void = () => undefined;
    const hold = new Promise<'OK'>((resolve) => {
      release = resolve;
    });
    const p = pixWorld(['NOT_YET', { hold }, 'NOT_YET']);
    await paid(p);

    // Process A claims attempt 2 at +5 min and never comes back.
    at(p, 5);
    void sweep({ ...p.runDeps, now: () => new Date(T0.getTime() + 5 * MIN) } as EvidenceRunDeps).catch(() => undefined);
    await vi.waitFor(() => expect(calls(p, CANCEL)).toBe(2));

    // Process B, inside the claim: nothing.
    await sweep({ ...p.runDeps, now: () => new Date(T0.getTime() + 5 * MIN + 60_000) } as EvidenceRunDeps);
    expect(calls(p, CANCEL)).toBe(2);

    // Past it: consult first (still PAID), then attempt 3 — the dead one counted.
    const b = await sweep({ ...p.runDeps, now: () => new Date(T0.getTime() + 5 * MIN + 121_000) } as EvidenceRunDeps);
    expect(calls(p, CANCEL)).toBe(3);
    expect(view(b!).refund).toMatchObject({ attempt: 3, exhausted: true, refusal: 'NOT_YET' });

    // A's late answer arrives: the stale attempt may not overwrite B's record.
    release('OK');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const latest = await p.runDeps.store.latest('pagbank', 'RUN');
    expect(view(latest!).refund).toMatchObject({ attempt: 3 });
  });

  it('B9 given SKIP on a paid Pix whose refund is pending, then nothing is skipped and nothing is sent', async () => {
    const p = pixWorld(['NOT_YET']);
    const { runId } = await paid(p);
    const seen = p.w.pagbank.seen.length;

    const answered = await confirmEvidencePix(p.runDeps, runId, 'SKIP');

    expect(p.w.pagbank.seen).toHaveLength(seen);
    expect(view(answered).state).toBe('REFUND_PENDING');
    expect(view(answered).refund).toMatchObject({ attempt: 1, exhausted: false });
  });

  it('B10 given 40008 on every attempt of two series, then Sentry hears of it ONCE for the charge, not once per attempt', async () => {
    const reports: ProviderFailureReport[] = [];
    const p = pixWorld(Array.from({ length: 6 }, () => 'NOT_YET' as const), { reporter: (report) => void reports.push(report) });
    const { runId } = await paid(p);
    at(p, 5);
    await sweep(p.runDeps);
    at(p, 15);
    await sweep(p.runDeps);
    at(p, 20);
    await press(p.runDeps, runId);
    at(p, 25);
    await sweep(p.runDeps);
    at(p, 35);
    await sweep(p.runDeps);

    expect(calls(p, CANCEL)).toBe(6);
    const refunds = reports.filter((report) => report.path === 'REFUND');
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ reference: 'CHAR_PIX', providerCodes: ['40008'] });
  });

  it('B11 given a record written before PG1 (refund FAILED, no retry state), then the sweep treats it as due now, consult first', async () => {
    const p = pixWorld(['NOT_YET', 'OK']);
    await paid(p);
    // Strip the retry state, as a pre-PG1 row has none.
    const stored = (await p.runDeps.store.latest('pagbank', 'RUN'))!;
    const legacy = {
      ...stored,
      steps: stored.steps.map((step) => {
        if (step.key !== 'pix.refund') return step;
        const rest: Record<string, unknown> = { ...step, status: 'FAILED' };
        delete rest['refund'];
        return rest as unknown as typeof step;
      }),
    };
    await p.runDeps.store.save(legacy);

    at(p, 1);
    const seen = p.w.pagbank.seen.length;
    const settled = await sweep(p.runDeps);

    expect(p.w.pagbank.seen.slice(seen).map((call) => call.path)).toEqual([CONSULT, CANCEL]);
    expect(view(settled!).state).toBe('REFUNDED');
  });

  it('B12 given a PAID Pix with no 40008, then the CHECK refunds it at once, as today, and the view has no retry to show', async () => {
    const p = pixWorld(['OK']);
    const { record } = await paid(p);

    expect(calls(p, CANCEL)).toBe(1);
    expect(view(record).state).toBe('REFUNDED');
    expect(view(record).refund).toBeNull();
  });
});
