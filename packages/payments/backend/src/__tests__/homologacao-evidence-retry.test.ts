import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  chargeImmediateSections,
  completeEvidenceRun,
  EvidenceSectionNotRetryableError,
  evidenceScenarioOutcomes,
  prepareEvidenceRetry,
  prepareEvidenceRun,
  PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY,
  retryableSections,
} from '../platform/evidence/index';
import { productionDebitTest } from '../platform/evidence/sandbox-buyer';
import type { BrowserCardResult, EvidenceRecord } from '../platform/evidence/types';
import { BUYER, cards, connected, wallets, world } from './homologacao-evidence-world';

/**
 * Retrying only what failed (FUT-5584, the owner: "quero conseguir retentar
 * só o que nao passou"). Pinned:
 *
 *  - a retry stays in the same run and raises only the named sections;
 *  - a section that passed, or whose charge took money, is never raised again;
 *  - the retry's steps replace the failed attempt's, and nothing else moves;
 *  - the retry re-mints the card key and the 3DS session for the same run.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const PROD = PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY;

/** A fixed moment for the retryable read: the Pix QR's payability is judged against it. */
const NOW = new Date('2026-11-25T00:00:00Z');

function production() {
  const w = world({ environment: 'PRODUCTION', applePayConfigured: true });
  return { ...w, runDeps: { ...w.runDeps, copy: PROD.outcome } };
}

/** The debit card the browser could not authenticate: the first run's debit fails. */
function cardsWithUnauthenticatedDebit(): BrowserCardResult[] {
  return cards().map((card) =>
    card.scenario === 'debit' ? { ...card, authenticationId: undefined, authenticated: undefined, failure: 'THREEDS_FAILED' } : card,
  );
}

const debitOnly = (): BrowserCardResult[] => cards().filter((card) => card.scenario === 'debit');

async function latest(w: ReturnType<typeof production>): Promise<EvidenceRecord> {
  return (await w.runDeps.store.latest('pagbank', 'RUN'))!;
}

const orders = (w: ReturnType<typeof production>) => w.pagbank.seen.filter((call) => call.path === 'POST /orders').length;

async function runWithFailedDebit(w: ReturnType<typeof production>) {
  await connected(w);
  const prepared = await prepareEvidenceRun(w.runDeps, productionDebitTest(BUYER));
  await completeEvidenceRun(w.runDeps, prepared.runId, cardsWithUnauthenticatedDebit(), wallets());
  return prepared;
}

describe('homologação evidence: retry only what failed', () => {
  it('given a run whose debit failed, then only the debit is retryable', async () => {
    const w = production();
    await runWithFailedDebit(w);
    const record = await latest(w);

    expect(evidenceScenarioOutcomes(record).find((outcome) => outcome.scenario === 'debit')?.status).not.toBe('EXECUTED');
    // The credit card, Google Pay and Apple Pay passed; the Pix waits for a person, so it may still move money.
    expect(retryableSections(record, PROD.outcome.pixSkipped, NOW)).toEqual(['DEBIT']);
  });

  it('given a debit-only retry, then the same run raises one debit order and keeps every other section as it was', async () => {
    const w = production();
    const prepared = await runWithFailedDebit(w);
    const before = await latest(w);
    const ordersBefore = orders(w);

    const again = await prepareEvidenceRetry(w.runDeps, prepared.runId, productionDebitTest(BUYER));
    expect(again.runId).toBe(prepared.runId);
    expect(again.threeDSSession).not.toBeNull();
    await completeEvidenceRun(w.runDeps, prepared.runId, debitOnly(), [], undefined, ['DEBIT'], { retry: true });

    const after = await latest(w);
    expect(after.id).toBe(prepared.runId);
    expect(orders(w)).toBe(ordersBefore + 1);
    expect(evidenceScenarioOutcomes(after).find((outcome) => outcome.scenario === 'debit')?.status).toBe('EXECUTED');
    const untouched = (record: EvidenceRecord) =>
      record.steps.filter((step) => !step.key.startsWith('debit.') && step.key !== 'card.publicKey');
    expect(untouched(after)).toEqual(untouched(before));
    // One step per key: the failed attempt's debit steps were replaced, not kept beside the retry's.
    const keys = after.steps.map((step) => step.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(retryableSections(after, PROD.outcome.pixSkipped, NOW)).toEqual([]);
  });

  it('given a section that passed, then a retry of it is refused and nothing is charged', async () => {
    const w = production();
    const prepared = await runWithFailedDebit(w);
    const ordersBefore = orders(w);

    await expect(
      completeEvidenceRun(w.runDeps, prepared.runId, cards(), [], undefined, ['CARD'], { retry: true }),
    ).rejects.toBeInstanceOf(EvidenceSectionNotRetryableError);
    await expect(
      chargeImmediateSections(w.runDeps, prepared.runId, { pix: false, wallets: wallets().slice(0, 1), retry: true }),
    ).rejects.toBeInstanceOf(EvidenceSectionNotRetryableError);
    expect(orders(w)).toBe(ordersBefore);
  });

  it('given a Pix still payable, then it is not retryable', async () => {
    const w = production();
    const prepared = await runWithFailedDebit(w);

    await expect(
      chargeImmediateSections(w.runDeps, prepared.runId, { pix: true, wallets: [], retry: true }),
    ).rejects.toBeInstanceOf(EvidenceSectionNotRetryableError);
  });

  it('given a run with the debit left blank, then a debit-only retry completes it', async () => {
    const w = production();
    await connected(w);
    const prepared = await prepareEvidenceRun(w.runDeps, productionDebitTest(BUYER));
    await completeEvidenceRun(
      w.runDeps,
      prepared.runId,
      cards().filter((card) => card.scenario !== 'debit'),
      wallets(),
    );
    expect(retryableSections(await latest(w), PROD.outcome.pixSkipped, NOW)).toEqual(['DEBIT']);

    await prepareEvidenceRetry(w.runDeps, prepared.runId, productionDebitTest(BUYER));
    await completeEvidenceRun(w.runDeps, prepared.runId, debitOnly(), [], undefined, ['DEBIT'], { retry: true });

    expect(evidenceScenarioOutcomes(await latest(w)).find((outcome) => outcome.scenario === 'debit')?.status).toBe('EXECUTED');
  });
});
