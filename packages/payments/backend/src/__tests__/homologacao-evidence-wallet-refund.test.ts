import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildHomologacaoEvidenceFile,
  buildHomologacaoEvidenceJson,
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
import { BUYER, cards, connected, wallets, world } from './homologacao-evidence-world';

/**
 * FUT-5371: the production evidence run of 2026-11-19 charged Google Pay and
 * Apple Pay R$ 1,00 each and PagBank answered both cancels
 * `40008 refund_temporarily_unavailable — Transaction is not found`. The
 * wallets' cancels are retried in the background like the cards' (FUT-4740),
 * and these cases pin what the run left wrong:
 *
 *  - the refund press was unreachable while the run's Pix still held money
 *    (its QR up, or its own refund retrying): RETRY_REFUND pressed only the Pix,
 *    or nothing, and the screen offered no card press;
 *  - one press refunded only the FIRST card out of attempts;
 *  - a cancel PagBank has not taken yet read as a plain failure in the file,
 *    and one that went back after refusals said nothing of them.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const PROD = PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY;
const SKIPPED = PROD.outcome.pixSkipped;
const T0_MS = Date.parse('2026-11-19T18:24:00.000Z');
const MIN = 60_000;
const GP = 'POST /charges/CHAR_GP/cancel';
const AP = 'POST /charges/CHAR_AP/cancel';
const PIX = 'POST /charges/CHAR_PIX/cancel';

type Answer = 'NOT_YET' | 'OK';

const json = (body: unknown, status: number, statusText: string): Response =>
  new Response(JSON.stringify(body), { status, statusText, headers: { 'Content-Type': 'application/json' } });

const NOT_YET = () =>
  json({ error_messages: [{ code: '40008', message: 'refund_temporarily_unavailable', description: 'Transaction is not found.' }] }, 400, 'Bad Request');

const CHARGES = { CHAR_GP: { order: 'ORDE_G1', value: 1200 }, CHAR_AP: { order: 'ORDE_A1', value: 1200 }, CHAR_PIX: { order: 'ORDE_PIX', value: 100 } } as const;
type ChargeId = keyof typeof CHARGES;

/**
 * The production world with both wallets on, each charge's cancel scripted
 * answer by answer, and every read of a charge PagBank refunded answering
 * CANCELED — so an attempt that consults first adopts it instead of cancelling twice.
 */
function walletWorld(script: Partial<Record<ChargeId, Answer[]>>) {
  const w = world({ environment: 'PRODUCTION', applePayConfigured: true });
  const answers = Object.fromEntries(Object.entries(script).map(([id, list]) => [id, [...list]])) as Partial<Record<ChargeId, Answer[]>>;
  const refunded = new Set<ChargeId>();
  const inner = w.pagbank.handler;
  const canceled = (id: ChargeId) => ({ id, status: 'CANCELED', amount: { value: CHARGES[id].value, summary: { refunded: CHARGES[id].value } } });
  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const route = `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`;
    for (const id of Object.keys(CHARGES) as ChargeId[]) {
      const read = route === `GET /orders/${CHARGES[id].order}` || route === `GET /charges/${id}`;
      if (read && refunded.has(id)) {
        w.pagbank.seen.push({ path: route, authorization: new Headers(init?.headers).get('authorization') });
        return route.startsWith('GET /orders') ? json({ id: CHARGES[id].order, charges: [canceled(id)] }, 200, 'OK') : json(canceled(id), 200, 'OK');
      }
      if (route === `POST /charges/${id}/cancel` && answers[id]) {
        w.pagbank.seen.push({ path: route, authorization: new Headers(init?.headers).get('authorization') });
        if ((answers[id]!.shift() ?? 'OK') === 'NOT_YET') return NOT_YET();
        refunded.add(id);
        return json(canceled(id), 201, 'Created');
      }
    }
    return inner(input, init);
  };
  vi.stubGlobal('fetch', vi.fn(handler));
  const clock = { now: new Date(T0_MS) };
  const runDeps = {
    ...w.runDeps,
    copy: PROD.outcome,
    now: () => clock.now,
    // Production draws the Google Pay button only with the platform's Google merchant id (FUT-4895).
    googlePayMerchant: async () => ({ merchantId: 'BCR2DN-TEST', merchantName: 'Paladira' }),
  } as unknown as EvidenceRunDeps;
  return { w, runDeps, fileDeps: { ...w.fileDeps, copy: PROD }, clock, refunded };
}

type WalletWorld = ReturnType<typeof walletWorld>;

const sent = (p: WalletWorld, path: string): number => p.w.pagbank.seen.filter((call) => call.path === path).length;
const at = (p: WalletWorld, minutes: number): void => {
  p.clock.now = new Date(T0_MS + minutes * MIN);
};
const stepOf = (record: EvidenceRecord, key: string) => record.steps.find((step) => step.key === key)!;
const sweep = (p: WalletWorld) => retryDueEvidenceRefund(p.runDeps);
const latest = async (p: WalletWorld): Promise<EvidenceRecord> => (await p.runDeps.store.latest('pagbank', 'RUN'))!;
const press = (p: WalletWorld, runId: string) => confirmEvidencePix(p.runDeps, runId, 'RETRY_REFUND');

/** Connect and run with both wallets; the Pix QR stays up, unpaid, as on 2026-11-19. */
async function ran(p: WalletWorld): Promise<{ runId: string; record: EvidenceRecord }> {
  await connected(p.w);
  const prepared = await prepareEvidenceRun(p.runDeps, productionDebitTest(BUYER));
  await completeEvidenceRun(p.runDeps, prepared.runId, cards(), wallets());
  return { runId: prepared.runId, record: await latest(p) };
}

/** Both wallets' series run out: attempts 2 and 3 of each, at +5 and +15 min. */
async function exhaust(p: WalletWorld): Promise<void> {
  for (const minutes of [5, 5, 15, 15]) {
    at(p, minutes);
    await sweep(p);
  }
}

describe('a wallet cancel PagBank answers 40008 (FUT-5371)', () => {
  it('W1 given 40008 then success, the run sends ONE cancel each, the sweep refunds both, and the file keeps the refusals as context', async () => {
    const p = walletWorld({ CHAR_GP: ['NOT_YET', 'OK'], CHAR_AP: ['NOT_YET', 'OK'] });
    const { record } = await ran(p);

    expect([sent(p, GP), sent(p, AP)]).toEqual([1, 1]);
    for (const key of ['gpay.cancel', 'apay.cancel']) {
      expect(stepOf(record, key).refund).toMatchObject({ attempt: 1, refusal: 'NOT_YET', exhausted: false, nextAt: new Date(T0_MS + 5 * MIN).toISOString() });
      // The money is still out and the sweep owns it: "estorno pendente", never a bare failure.
      expect(stepOf(record, key).observed).toMatch(/^Estorno pendente: a tentativa 1 de 3 não foi aceita pelo PagBank \(.*refund_temporarily_unavailable.*\)\. O sistema tenta de novo sozinho/u);
    }
    const pendingFile = (await buildHomologacaoEvidenceFile(p.fileDeps)).content;
    expect(pendingFile).toMatch(/\[6\.4\][^\n]*: Estorno pendente/u);

    at(p, 5);
    await sweep(p);
    await sweep(p);
    const done = await latest(p);

    expect([sent(p, GP), sent(p, AP)]).toEqual([2, 2]);
    expect(pixViewOf(done, SKIPPED).cards).toBeUndefined();
    const file = JSON.parse((await buildHomologacaoEvidenceJson(p.fileDeps)).content) as {
      scenarios: { key: string; status: string; observed: string; notes: string[]; calls: { request: { method: string; url: string }; response: { status: number } | null }[] }[];
    };
    for (const key of ['gpay.cancel', 'apay.cancel']) {
      const scenario = file.scenarios.find((candidate) => candidate.key === key)!;
      expect(scenario.status).toBe('EXECUTED');
      expect(scenario.observed).toBe(PROD.outcome.canceled('CANCELED'));
      expect(scenario.notes).toEqual([PROD.outcome.refundAfterRetries(1)]);
      const cancels = scenario.calls.filter((call) => call.request.method === 'POST').map((call) => call.response?.status);
      expect(cancels).toEqual([400, 201]);
    }
  });

  it('W2 given 40008 forever, the series runs out, the refund stays pending, and the press is offered with the Pix QR still up', async () => {
    const forever = Array<Answer>(20).fill('NOT_YET');
    const p = walletWorld({ CHAR_GP: [...forever], CHAR_AP: [...forever] });
    await ran(p);
    await exhaust(p);

    at(p, 120);
    await sweep(p);
    expect([sent(p, GP), sent(p, AP)]).toEqual([3, 3]);
    const record = await latest(p);
    const view = pixViewOf(record, SKIPPED);
    expect(view.state).toBe('AWAITING_PAYMENT');
    expect(view.cards).toEqual([
      { scenario: 'googlePay', attempt: 3, of: 3, nextAt: null, exhausted: true, refusal: 'NOT_YET' },
      { scenario: 'applePay', attempt: 3, of: 3, nextAt: null, exhausted: true, refusal: 'NOT_YET' },
    ]);
    expect(stepOf(record, 'gpay.cancel').observed).toMatch(/^Estorno pendente: a tentativa 3 de 3 .* As tentativas automáticas acabaram/u);
  });

  it('W3 the press retries EVERY wallet out of attempts, whatever the Pix is doing, and each refunds once', async () => {
    const p = walletWorld({ CHAR_GP: ['NOT_YET', 'NOT_YET', 'NOT_YET', 'OK'], CHAR_AP: ['NOT_YET', 'NOT_YET', 'NOT_YET', 'OK'] });
    const { runId } = await ran(p);
    await exhaust(p);

    at(p, 60);
    const pressed = await press(p, runId);

    expect([sent(p, GP), sent(p, AP)]).toEqual([4, 4]);
    expect(stepOf(pressed, 'gpay.cancel').status).toBe('EXECUTED');
    expect(stepOf(pressed, 'apay.cancel').status).toBe('EXECUTED');
    expect(stepOf(pressed, 'gpay.cancel').notes).toEqual([PROD.outcome.refundAfterRetries(3)]);
    expect(pixViewOf(pressed, SKIPPED).cards).toBeUndefined();
  });

  it('W4 no double refund: two presses at once, then more presses and sweeps, send ONE cancel per wallet', async () => {
    const forever = Array<Answer>(3).fill('NOT_YET');
    const p = walletWorld({ CHAR_GP: [...forever, 'OK', 'OK'], CHAR_AP: [...forever, 'OK', 'OK'] });
    const { runId } = await ran(p);
    await exhaust(p);

    at(p, 60);
    await Promise.all([press(p, runId), press(p, runId)]);
    at(p, 61);
    await press(p, runId);
    at(p, 90);
    await sweep(p);

    expect([sent(p, GP), sent(p, AP)]).toEqual([4, 4]);
    expect(p.refunded.has('CHAR_GP') && p.refunded.has('CHAR_AP')).toBe(true);
  });

  it('W5 a record as 4.68.1 stored it (plain failure text, no series length) still surfaces and takes the press', async () => {
    const forever = Array<Answer>(3).fill('NOT_YET');
    const p = walletWorld({ CHAR_GP: [...forever, 'OK'], CHAR_AP: [...forever, 'OK'] });
    const { runId } = await ran(p);
    await exhaust(p);
    const current = await latest(p);
    const legacy = {
      ...current,
      steps: current.steps.map((step) => {
        if (step.key !== 'gpay.cancel' && step.key !== 'apay.cancel') return step;
        const refund = { ...step.refund! };
        delete refund.of;
        return { ...step, observed: PROD.outcome.callError('PagBank 400 refund_temporarily_unavailable'), refund };
      }),
    } as EvidenceRecord;
    await p.runDeps.store.save(legacy);

    expect(pixViewOf(legacy, SKIPPED).cards?.map((card) => [card.scenario, card.exhausted])).toEqual([
      ['googlePay', true],
      ['applePay', true],
    ]);
    at(p, 60);
    const pressed = await press(p, runId);
    expect(['gpay.cancel', 'apay.cancel'].map((key) => stepOf(pressed, key).status)).toEqual(['EXECUTED', 'EXECUTED']);
  });

  it('W6 with the Pix refund AND both wallets out of attempts, ONE press retries all three', async () => {
    const forever = Array<Answer>(3).fill('NOT_YET');
    const p = walletWorld({ CHAR_GP: [...forever, 'OK'], CHAR_AP: [...forever, 'OK'], CHAR_PIX: [...forever, 'OK'] });
    const { runId } = await ran(p);
    // The operator's checks find the Pix paid: its attempt 1 runs in that CHECK, refused.
    await confirmEvidencePix(p.runDeps, runId, 'CHECK');
    await confirmEvidencePix(p.runDeps, runId, 'CHECK');
    for (const minutes of [5, 5, 5, 15, 15, 15]) {
      at(p, minutes);
      await sweep(p);
    }
    const out = await latest(p);
    expect(pixViewOf(out, SKIPPED).refund).toMatchObject({ exhausted: true });
    expect(pixViewOf(out, SKIPPED).cards?.every((card) => card.exhausted)).toBe(true);

    at(p, 60);
    const pressed = await press(p, runId);

    expect([sent(p, PIX), sent(p, GP), sent(p, AP)]).toEqual([4, 4, 4]);
    expect(pixViewOf(pressed, SKIPPED).state).toBe('REFUNDED');
    expect(pixViewOf(pressed, SKIPPED).cards).toBeUndefined();
  });
});
