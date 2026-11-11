import { afterEach, describe, expect, it, vi } from 'vitest';

import { credentialStoreFrom } from '../config/service';
import { createPaymentsGateway } from '../core/gateway';
import type { ProviderFailureReport } from '../core/provider-failure';
import { defineProviders } from '../core/registry';
import { createMemoryAttemptLedger, createMemoryChargeStore } from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import {
  completeEvidenceRun,
  confirmEvidencePix,
  pixViewOf,
  prepareEvidenceRun,
  PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY,
  retryDueEvidenceRefund,
  type EvidenceRecord,
  type EvidenceRunDeps,
} from '../platform/evidence/index';
import { productionDebitTest } from '../platform/evidence/sandbox-buyer';
import { pagbankProvider } from '../providers/pagbank';
import { PT_BR_PAGBANK_COPY } from '../providers/pt-BR';
import { BUYER, cards, connected, wallets, world } from './homologacao-evidence-world';

/**
 * PG1 fix round 1 (FUT-4360, FUT-4322): the gateway's REFUND report stays as it
 * was for every caller that does not own a retry; an attempt's provider calls
 * run under a deadline shorter than its claim; a CANCELED read-back is already
 * refunded; a dead claimant on the last attempt is read back before the series
 * is closed.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const PROD = PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY;
const SKIPPED = PROD.outcome.pixSkipped;
const T0_MS = Date.parse('2026-11-11T15:00:00.000Z');
const MIN = 60_000;
const CANCEL = 'POST /charges/CHAR_PIX/cancel';

const json = (body: unknown, status: number, statusText: string): Response =>
  new Response(JSON.stringify(body), { status, statusText, headers: { 'Content-Type': 'application/json' } });
const NOT_YET = () =>
  json({ error_messages: [{ code: '40008', message: 'refund_temporarily_unavailable' }] }, 400, 'Bad Request');

interface Behaviour {
  /** What each cancel answers, in order; 'HANG' never answers until its signal aborts. */
  cancels: ('NOT_YET' | 'HANG')[];
  /** What the order read-back says once the charge is refunded. */
  readBack?: 'SUMMARY' | 'CANCELED_ONLY';
}

function pixWorld(behaviour: Behaviour, options: { reporter?: (report: ProviderFailureReport) => void } = {}) {
  const w = world({ environment: 'PRODUCTION', applePayConfigured: true });
  const inner = w.pagbank.handler;
  const state = { refunded: false, aborted: 0 };
  const script = [...behaviour.cancels];
  const seenAt = (path: string): number => w.pagbank.seen.filter((call) => call.path === path).length;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const route = `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`;
      if (route === 'GET /orders/ORDE_PIX' && state.refunded) {
        w.pagbank.seen.push({ path: route, authorization: null });
        const charge =
          behaviour.readBack === 'CANCELED_ONLY'
            ? { id: 'CHAR_PIX', status: 'CANCELED', amount: { value: 100 } }
            : { id: 'CHAR_PIX', status: 'CANCELED', amount: { value: 100, summary: { refunded: 100 } } };
        return json({ id: 'ORDE_PIX', charges: [charge] }, 200, 'OK');
      }
      if (route !== CANCEL) return inner(input, init);
      w.pagbank.seen.push({ path: route, authorization: null });
      const next = script.shift() ?? 'NOT_YET';
      if (next === 'HANG') {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            state.aborted += 1;
            reject(init.signal?.reason ?? new Error('aborted'));
          });
        });
      }
      return NOT_YET();
    }),
  );
  const clock = { ms: T0_MS };
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
  const deps = {
    ...w.runDeps,
    gateway,
    copy: PROD.outcome,
    now: () => new Date(clock.ms),
    ...(options.reporter ? { onProviderFailure: options.reporter } : {}),
  } as EvidenceRunDeps;
  return { w, deps, clock, state, seenAt };
}

type PixWorld = ReturnType<typeof pixWorld>;

const view = (record: EvidenceRecord) => pixViewOf(record, SKIPPED);
const at = (p: PixWorld, minutes: number, seconds = 0): void => {
  p.clock.ms = T0_MS + minutes * MIN + seconds * 1000;
};

async function paid(p: PixWorld): Promise<string> {
  await connected(p.w);
  const prepared = await prepareEvidenceRun(p.deps, productionDebitTest(BUYER));
  await completeEvidenceRun(p.deps, prepared.runId, cards(), wallets());
  await confirmEvidencePix(p.deps, prepared.runId, 'CHECK');
  await confirmEvidencePix(p.deps, prepared.runId, 'CHECK');
  return prepared.runId;
}

describe('the gateway report of a refused refund (round 1, item 1)', () => {
  it('given a refund nobody retries (a store, a card cancel), when PagBank answers 40008, then it is still reported at error', async () => {
    const reports: ProviderFailureReport[] = [];
    const p = pixWorld({ cancels: ['NOT_YET', 'NOT_YET'] }, { reporter: (report) => void reports.push(report) });
    await connected(p.w);

    await expect(p.deps.gateway.refund(p.deps.merchant, 'pagbank', { providerChargeId: 'CHAR_PIX' })).rejects.toBeDefined();

    expect(reports.filter((report) => report.path === 'REFUND')).toHaveLength(1);
    expect(reports[0]).toMatchObject({ path: 'REFUND', severity: 'error', providerCodes: ['40008'] });
  });

  it('given the caller owns the retry, when PagBank answers 40008, then the gateway reports nothing for that call', async () => {
    const reports: ProviderFailureReport[] = [];
    const p = pixWorld({ cancels: ['NOT_YET'] }, { reporter: (report) => void reports.push(report) });
    await connected(p.w);

    await expect(
      p.deps.gateway.refund(p.deps.merchant, 'pagbank', { providerChargeId: 'CHAR_PIX', retriedByCaller: true }),
    ).rejects.toBeDefined();

    expect(reports).toHaveLength(0);
  });
});

describe('an attempt under its deadline (round 1, item 2)', () => {
  it('given a cancel that never answers, then the attempt is aborted at its deadline, records UNKNOWN, and nobody sends a second cancel meanwhile', async () => {
    const p = pixWorld({ cancels: ['NOT_YET', 'HANG'] });
    const runId = await paid(p);
    const deps = { ...p.deps, refundAttemptMs: 40 } as EvidenceRunDeps;

    // Attempt 2 is claimed at +5 min and its cancel hangs.
    at(p, 5);
    const slow = retryDueEvidenceRefund(deps);
    await vi.waitFor(() => expect(p.seenAt(CANCEL)).toBe(2));

    // Another process, inside the claim: nothing is sent while the first is in flight.
    at(p, 5, 60);
    await retryDueEvidenceRefund(deps);
    await confirmEvidencePix(deps, runId, 'RETRY_REFUND');
    expect(p.seenAt(CANCEL)).toBe(2);

    // The deadline aborts the call; the claimant still answers, once, and its answer is written.
    const settled = await slow;
    expect(p.state.aborted).toBe(1);
    expect(view(settled!).refund).toMatchObject({ attempt: 2, exhausted: false, refusal: 'UNKNOWN' });
    expect(p.seenAt(CANCEL)).toBe(2);
  });

  it('given the aborted attempt was written, when the claim age passes the TTL, then no cancel is sent early: the schedule decides', async () => {
    const p = pixWorld({ cancels: ['NOT_YET', 'HANG'] });
    await paid(p);
    const deps = { ...p.deps, refundAttemptMs: 40 } as EvidenceRunDeps;
    at(p, 5);
    await retryDueEvidenceRefund(deps);

    at(p, 5, 130);
    await retryDueEvidenceRefund(deps);

    expect(p.seenAt(CANCEL)).toBe(2);
  });
});

describe('what counts as already refunded (round 1, items 3 and 7)', () => {
  it('given the read-back says CANCELED without a refunded summary, then the attempt adopts it and sends no cancel', async () => {
    const p = pixWorld({ cancels: ['NOT_YET'], readBack: 'CANCELED_ONLY' });
    await paid(p);
    p.state.refunded = true;

    at(p, 5);
    const adopted = await retryDueEvidenceRefund(p.deps);

    expect(p.seenAt(CANCEL)).toBe(1);
    expect(view(adopted!).state).toBe('REFUNDED');
  });

  it('given the claimant of attempt 3 died after its cancel landed, then the sweep reads the charge back and adopts it instead of closing it as not refunded', async () => {
    const p = pixWorld({ cancels: ['NOT_YET', 'NOT_YET', 'HANG'] });
    await paid(p);
    at(p, 5);
    await retryDueEvidenceRefund(p.deps);
    at(p, 15);
    // Attempt 3 claims, sends, and its process dies: the call is left hanging (its deadline is far away).
    void retryDueEvidenceRefund(p.deps).catch(() => undefined);
    await vi.waitFor(() => expect(p.seenAt(CANCEL)).toBe(3));
    p.state.refunded = true; // the cancel had landed

    at(p, 15, 130);
    const closed = await retryDueEvidenceRefund(p.deps);

    expect(p.seenAt(CANCEL)).toBe(3);
    expect(view(closed!).state).toBe('REFUNDED');
  });

  it('given the claimant of attempt 3 died and the charge is still PAID, then the series closes exhausted with no new cancel', async () => {
    const p = pixWorld({ cancels: ['NOT_YET', 'NOT_YET', 'HANG'] });
    await paid(p);
    at(p, 5);
    await retryDueEvidenceRefund(p.deps);
    at(p, 15);
    void retryDueEvidenceRefund(p.deps).catch(() => undefined);
    await vi.waitFor(() => expect(p.seenAt(CANCEL)).toBe(3));

    at(p, 15, 130);
    const closed = await retryDueEvidenceRefund(p.deps);

    expect(p.seenAt(CANCEL)).toBe(3);
    expect(view(closed!).refund).toMatchObject({ attempt: 3, exhausted: true });
  });
});

describe('who reports a stuck refund (round 1, item 4)', () => {
  it('given 40008 on every attempt, then the gateway reports none of them and the evidence reports once, at warning', async () => {
    const reports: ProviderFailureReport[] = [];
    const p = pixWorld({ cancels: ['NOT_YET', 'NOT_YET', 'NOT_YET'] }, { reporter: (report) => void reports.push(report) });
    await paid(p);
    at(p, 5);
    await retryDueEvidenceRefund(p.deps);
    at(p, 15);
    await retryDueEvidenceRefund(p.deps);

    expect(reports.filter((report) => report.path === 'REFUND')).toHaveLength(1);
    expect(reports[0]).toMatchObject({ severity: 'warning', reference: 'CHAR_PIX' });
  });
});
