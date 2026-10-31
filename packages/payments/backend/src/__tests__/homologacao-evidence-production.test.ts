import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildHomologacaoEvidenceFile,
  buildHomologacaoEvidenceJson,
  completeEvidenceRun,
  confirmEvidencePix,
  EvidenceRunNotFoundError,
  evidenceStepKeys,
  prepareEvidenceRun,
  PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY,
} from '../platform/evidence/index';
import { productionDebitTest } from '../platform/evidence/sandbox-buyer';
import { BUYER, cards, connected, SECRETS, wallets, world } from './homologacao-evidence-world';

/**
 * The PRODUCTION homologação evidence (FUT-4198), in the same world the
 * sandbox suites use, with the run pinned to PRODUCTION. Pinned:
 *
 *  - every order is R$ 1,00 and the run refunds what it charged;
 *  - the Pix waits for a person: phase 2 shows the QR, phase 3 checks it and
 *    refunds it once paid, or records that it was skipped;
 *  - no card is declined on purpose, and the file says why;
 *  - the cardholder's CPF/CNPJ and phone never reach the file whole;
 *  - a sandbox seller cannot run the production evidence.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const PROD = PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY;

function production(options: Parameters<typeof world>[0] = {}) {
  const w = world({ ...options, environment: 'PRODUCTION', applePayConfigured: true });
  const runDeps = { ...w.runDeps, copy: PROD.outcome };
  return { ...w, runDeps, fileDeps: { ...w.fileDeps, copy: PROD } };
}

async function raised(w: ReturnType<typeof production>) {
  await connected(w);
  const prepared = await prepareEvidenceRun(w.runDeps, productionDebitTest(BUYER));
  await completeEvidenceRun(w.runDeps, prepared.runId, cards(), wallets());
  return prepared;
}

function orderAmounts(w: ReturnType<typeof production>): number[] {
  return w.pagbank.seen
    .filter((call) => call.path === 'POST /orders')
    .map((call) => (call.body?.['charges'] as { amount: { value: number } }[])[0]!.amount.value);
}

describe('homologação evidence in production', () => {
  it('given a production seller, then the authorization and its webhook URL are pinned to PRODUCTION', async () => {
    const w = production();
    expect((await connected(w)).ok).toBe(true);

    const row = await w.configs.get({ kind: 'PLATFORM', id: 'homologacao-seller' }, 'pagbank');
    expect(row?.environment).toBe('PRODUCTION');
    expect(row?.environments.PRODUCTION?.['notificationUrl']).toBe(
      'https://example.test/api/webhooks/platform-homologacao/pagbank',
    );
    expect(row?.environments.SANDBOX?.['token']).toBeUndefined();
  });

  it('given a full run, then every order is R$ 1,00, nothing is declined on purpose and each paid charge is refunded', async () => {
    const w = production();
    const prepared = await raised(w);

    expect(prepared.debitTest.amountCents).toBe(100);
    expect(prepared.debitTest.billingAddress.city).toBe('Belo Horizonte');
    // Pix, approved credit, debit, Google Pay, Apple Pay — and no declined card.
    expect(orderAmounts(w)).toEqual([100, 100, 100, 100, 100]);
    expect(w.pagbank.seen.filter((call) => /^POST \/charges\/CHAR_(OK|DEB|GP|AP)\/cancel$/.test(call.path))).toHaveLength(4);

    const file = await buildHomologacaoEvidenceFile(w.fileDeps);
    expect(file.content).toContain('— PRODUÇÃO');
    expect(file.content).toContain('Ambiente: PRODUCTION (https://api.pagseguro.com)');
    expect(file.content).toContain(PROD.outcome.declinedNotInProduction);
    expect(file.filename).toMatch(/^pagbank-homologacao-evidencias-producao-.*\.txt$/);
  });

  it("given the cardholder's real data, then the file carries their CPF/CNPJ and phone masked, never whole", async () => {
    const w = production();
    await raised(w);
    const file = await buildHomologacaoEvidenceFile(w.fileDeps);

    expect(file.content).not.toContain(BUYER.taxId);
    expect(file.content).not.toContain('994494408');
    expect(file.content).toContain('"tax_id": "************59"');
    expect(file.content).toContain('*****4408');
    for (const secret of SECRETS) expect(file.content).not.toContain(secret);
  });

  it('given phase 2, then the Pix QR is shown and nothing polls it — a person has not paid yet', async () => {
    const w = production();
    await raised(w);
    const file = await buildHomologacaoEvidenceFile(w.fileDeps);

    expect(w.pagbank.seen.filter((call) => call.path === 'GET /orders/ORDE_PIX')).toHaveLength(0);
    // Section 3 is Pix: the QR (3.1) is up, the payment (3.3) and its refund (3.4) wait.
    expect(file.content).toMatch(/\[3\.1\][^\n]*— EXECUTADO/);
    expect(file.content).toMatch(/\[3\.3\][^\n]*— PENDENTE/);
    expect(file.content).toMatch(/\[3\.4\][^\n]*Estorno do Pix[^\n]*— PENDENTE/);
    expect(file.content).toContain(PROD.outcome.pixAwaitingPayment);
  });

  it('given the operator checks the Pix before and after paying it, then it is consulted, refunded once paid, and left alone after', async () => {
    const w = production();
    const prepared = await raised(w);

    // The fake answers WAITING to the first consult and PAID after it.
    const waiting = await confirmEvidencePix(w.runDeps, prepared.runId, 'CHECK');
    expect(waiting.steps.find((step) => step.key === 'pix.paid')?.status).toBe('PENDING');
    expect(waiting.steps.find((step) => step.key === 'pix.consult')?.status).toBe('EXECUTED');

    const paid = await confirmEvidencePix(w.runDeps, prepared.runId, 'CHECK');
    expect(paid.steps.find((step) => step.key === 'pix.paid')?.status).toBe('EXECUTED');
    expect(paid.steps.find((step) => step.key === 'pix.refund')?.status).toBe('EXECUTED');
    expect(paid.steps.find((step) => step.key === 'connect.usage')?.status).toBe('EXECUTED');

    // Settled: a further check makes no call at all.
    const callsBefore = w.pagbank.seen.length;
    await confirmEvidencePix(w.runDeps, prepared.runId, 'CHECK');
    expect(w.pagbank.seen).toHaveLength(callsBefore);
    expect(w.pagbank.seen.filter((call) => call.path === 'POST /charges/CHAR_PIX/cancel')).toHaveLength(1);
  });

  it('given the operator skips the Pix, then it is recorded as never paid and nothing is refunded', async () => {
    const w = production();
    const prepared = await raised(w);

    const skipped = await confirmEvidencePix(w.runDeps, prepared.runId, 'SKIP');

    expect(skipped.steps.find((step) => step.key === 'pix.paid')?.observed).toBe(PROD.outcome.pixSkipped);
    expect(skipped.steps.find((step) => step.key === 'pix.refund')?.observed).toBe(PROD.outcome.pixSkipped);
    expect(w.pagbank.seen.filter((call) => call.path.startsWith('GET /orders/ORDE_PIX'))).toHaveLength(0);
  });

  it('given a run id that is not the latest, then confirming the Pix is refused', async () => {
    const w = production();
    await raised(w);

    await expect(confirmEvidencePix(w.runDeps, 'some-other-run', 'CHECK')).rejects.toBeInstanceOf(EvidenceRunNotFoundError);
  });

  it('given no cardholder, then no order is raised and every scenario says why', async () => {
    const w = production();
    await connected(w);
    const runDeps = { ...w.runDeps, customer: null };
    const prepared = await prepareEvidenceRun(runDeps, productionDebitTest(BUYER));
    const record = await completeEvidenceRun(runDeps, prepared.runId, cards());

    expect(orderAmounts(w)).toEqual([]);
    expect(record.steps.find((step) => step.key === 'card.approved')?.observed).toBe(PROD.outcome.buyerMissing);
  });

  it('given a seller connected in SANDBOX, then the production run refuses and says so', async () => {
    const w = production({ sellerEnvironment: 'SANDBOX' });
    await connected(w);
    const prepared = await prepareEvidenceRun(w.runDeps, productionDebitTest(BUYER));

    expect(prepared.publicKey).toBeNull();
    const json = JSON.parse((await buildHomologacaoEvidenceJson(w.fileDeps)).content) as {
      environment: { name: string };
      scenarios: { key: string; observed: string }[];
    };
    expect(json.environment.name).toBe('PRODUCTION');
    expect(json.scenarios.find((scenario) => scenario.key === 'connect.usage')?.observed).toBe(PROD.outcome.notSandbox);
  });

  it('given the two environments, then only production lists the Pix refund', () => {
    expect(evidenceStepKeys('PRODUCTION')).toContain('pix.refund');
    expect(evidenceStepKeys('SANDBOX')).not.toContain('pix.refund');
    expect(evidenceStepKeys('SANDBOX')).toHaveLength(evidenceStepKeys('PRODUCTION').length - 1);
  });
});
