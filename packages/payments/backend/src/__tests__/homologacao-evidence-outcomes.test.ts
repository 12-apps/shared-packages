import { afterEach, describe, expect, it, vi } from 'vitest';

import * as Evidence from '../platform/evidence/index';
import {
  buildHomologacaoEvidenceFile,
  completeEvidenceRun,
  prepareEvidenceRun,
  PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY,
  type EvidenceRecord,
} from '../platform/evidence/index';
import { productionDebitTest } from '../platform/evidence/sandbox-buyer';
import { BUYER, cards, connected, wallets, world } from './homologacao-evidence-world';

/**
 * PG1 (FUT-4322): each production scenario's REAL outcome, exposed by the
 * server so the card can show it — executed, failed with a reason CODE, or
 * pending. The reasons come from structured data, never from a message:
 * `classifyPagBankRejection` → EMAIL_EQUALS_MERCHANT for PagBank's 40002 on
 * `customer.email`, and the charge's own DECLINED status → ISSUER_DECLINED.
 *
 * New surface named here (contract, "API"): `evidenceScenarioOutcomes(record)`
 * and `HomologacaoSellerConnection.scenarios` (same list, on the seller view).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const PROD = PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY;

type Outcome = { scenario: string; status: string; reason: string | null };
const outcomesOf = (record: EvidenceRecord): Outcome[] =>
  (Evidence as unknown as { evidenceScenarioOutcomes: (r: EvidenceRecord) => Outcome[] }).evidenceScenarioOutcomes(record);

const json = (body: unknown, status: number, statusText: string): Response =>
  new Response(JSON.stringify(body), { status, statusText, headers: { 'Content-Type': 'application/json' } });

/**
 * The owner's 2026-11-03 runs, as PagBank answered them: the credit order
 * refused 40002 (buyer e-mail = merchant e-mail), the debit order created with
 * its charge DECLINED by the issuer (20001, reason_code 05).
 */
function ownersRun(answers: { credit: 'EMAIL' | 'OK'; debit: 'EMAIL' | 'DECLINED' | 'OK' }) {
  const w = world({ environment: 'PRODUCTION', applePayConfigured: true });
  const inner = w.pagbank.handler;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const route = `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`;
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { charges?: { payment_method?: { type?: string; card?: { encrypted?: string } } }[] }) : {};
      const method = body.charges?.[0]?.payment_method;
      const email = () => {
        w.pagbank.seen.push({ path: route, authorization: null });
        return json(
          { error_messages: [{ code: '40002', description: 'buyer email must not be equals to merchant email', parameter_name: 'customer.email' }] },
          400,
          'Bad Request',
        );
      };
      if (route === 'POST /orders' && method?.type === 'CREDIT_CARD' && method.card?.encrypted === 'enc-approved-blob' && answers.credit === 'EMAIL') return email();
      if (route === 'POST /orders' && method?.type === 'DEBIT_CARD' && answers.debit === 'EMAIL') return email();
      if (route === 'POST /orders' && method?.type === 'DEBIT_CARD' && answers.debit === 'DECLINED') {
        w.pagbank.seen.push({ path: route, authorization: null });
        const declined = {
          id: 'CHAR_DEB',
          status: 'DECLINED',
          amount: { value: 100, currency: 'BRL' },
          payment_response: { code: '20001', message: 'CONTATE A CENTRAL DO SEU CARTAO', raw_data: { reason_code: '05' } },
          payment_method: { type: 'DEBIT_CARD', card: { brand: 'visa', first_digits: '400000', last_digits: '2701' } },
        };
        return json({ id: 'ORDE_D1', charges: [declined] }, 201, 'Created');
      }
      return inner(input, init);
    }),
  );
  const runDeps = { ...w.runDeps, copy: PROD.outcome };
  return { w, runDeps, fileDeps: { ...w.fileDeps, copy: PROD } };
}

async function run(r: ReturnType<typeof ownersRun>, browserCards = cards()): Promise<EvidenceRecord> {
  await connected(r.w);
  const prepared = await prepareEvidenceRun(r.runDeps, productionDebitTest(BUYER));
  return completeEvidenceRun(r.runDeps, prepared.runId, browserCards, wallets());
}

describe('each production scenario’s real outcome (PG1, FUT-4322)', () => {
  it('A1 given the 16:16 run (both cards refused 40002 on the e-mail), then credit and debit are FAILED · EMAIL_EQUALS_MERCHANT and the Pix is pending', async () => {
    const r = ownersRun({ credit: 'EMAIL', debit: 'EMAIL' });
    const record = await run(r);

    expect(outcomesOf(record)).toEqual([
      { scenario: 'credit', status: 'FAILED', reason: 'EMAIL_EQUALS_MERCHANT' },
      { scenario: 'debit', status: 'FAILED', reason: 'EMAIL_EQUALS_MERCHANT' },
      { scenario: 'pix', status: 'PENDING', reason: null },
      { scenario: 'googlePay', status: 'EXECUTED', reason: null },
      { scenario: 'applePay', status: 'EXECUTED', reason: null },
    ]);
  });

  it('A2 given the 16:20 run (credit charged and refunded, debit DECLINED by the issuer), then credit EXECUTED and debit FAILED · ISSUER_DECLINED', async () => {
    const r = ownersRun({ credit: 'OK', debit: 'DECLINED' });
    const record = await run(r);
    const outcomes = outcomesOf(record);

    expect(outcomes.find((o) => o.scenario === 'credit')).toEqual({ scenario: 'credit', status: 'EXECUTED', reason: null });
    expect(outcomes.find((o) => o.scenario === 'debit')).toEqual({ scenario: 'debit', status: 'FAILED', reason: 'ISSUER_DECLINED' });
  });

  it('A3 given no debit card was sent, then the debit scenario is PENDING with no reason — never a guess', async () => {
    const r = ownersRun({ credit: 'OK', debit: 'OK' });
    const record = await run(r, cards().filter((card) => card.scenario !== 'debit'));

    expect(outcomesOf(record).find((o) => o.scenario === 'debit')).toEqual({ scenario: 'debit', status: 'PENDING', reason: null });
  });

  it('A4 given a failure with no known reason code, then FAILED with reason null — the message is never parsed for one', async () => {
    const r = ownersRun({ credit: 'OK', debit: 'OK' });
    const record = await run(r);
    // A card charged but its cancel failed: the scenario failed, for no coded reason.
    const broken = {
      ...record,
      steps: record.steps.map((step) =>
        step.key === 'card.cancel' ? { ...step, status: 'FAILED' as const, observed: 'buyer email must not be equals to merchant email' } : step,
      ),
    };

    expect(outcomesOf(broken).find((o) => o.scenario === 'credit')).toEqual({ scenario: 'credit', status: 'FAILED', reason: null });
  });

  it('A5 given the outcomes are exposed, then the evidence FILE is byte-for-byte what it was (no reason code is printed)', async () => {
    const r = ownersRun({ credit: 'EMAIL', debit: 'DECLINED' });
    await run(r);
    const file = await buildHomologacaoEvidenceFile(r.fileDeps);

    expect(file.content).not.toContain('EMAIL_EQUALS_MERCHANT');
    expect(file.content).not.toContain('ISSUER_DECLINED');
    // And the outcome is still the file's to say, as today.
    expect(file.content).toMatch(/\[4\.3\][^\n]*— FALHOU/);
  });
});
