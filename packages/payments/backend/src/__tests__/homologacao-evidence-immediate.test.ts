import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildHomologacaoEvidenceJson,
  chargeImmediateSections,
  completeEvidenceRun,
  prepareEvidenceRun,
} from '../platform/evidence/index';
import { cards, connected, wallets, world } from './homologacao-evidence-world';

/**
 * FUT-5519, the owner: "google pay, pix e apple pay nao precisa esperar
 * criptografar, dispara imediato" and "tudo em paralelo". The sections that
 * need no card encryption are fired as soon as the run is prepared; phase 2
 * then raises only the cards, and nothing is raised twice.
 */

type JsonScenario = { key: string; status: string };

async function statuses(w: ReturnType<typeof world>, prefix: string): Promise<string[]> {
  const { scenarios } = JSON.parse((await buildHomologacaoEvidenceJson(w.fileDeps)).content) as { scenarios: JsonScenario[] };
  return scenarios.filter((scenario) => scenario.key.startsWith(`${prefix}.`)).map((scenario) => scenario.status);
}

const orders = (w: ReturnType<typeof world>, suffix: string) =>
  w.pagbank.seen.filter((call) => call.path === 'POST /orders' && String(call.body?.['reference_id']).endsWith(suffix));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('homologação evidence — the sections fired at once', () => {
  it('given a prepared run, then Pix and both wallets are raised at once and phase 2 raises only the cards', async () => {
    const w = world({ applePayConfigured: true });
    await connected(w);
    const { runId } = await prepareEvidenceRun(w.runDeps);

    const charged = await chargeImmediateSections(w.runDeps, runId, { pix: true, wallets: wallets() });

    expect(charged.paid).toEqual({ GOOGLE_PAY: true, APPLE_PAY: true });
    expect(charged.outcomes.map((outcome) => outcome.scenario)).toEqual(['pix', 'googlePay', 'applePay']);
    expect(await statuses(w, 'gpay')).toEqual(['EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED']);

    await completeEvidenceRun(w.runDeps, runId, cards(), [], undefined, ['CARD', 'DEBIT']);

    expect(orders(w, '-gpay')).toHaveLength(1);
    expect(orders(w, '-apay')).toHaveLength(1);
    expect(await statuses(w, 'apay')).toEqual(['EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED']);
    expect(await statuses(w, 'card')).toContain('EXECUTED');
    expect(await statuses(w, 'debit')).toContain('EXECUTED');
  });

  it('given the immediate sections and phase 2 at the same time, then neither loses the steps the other saved', async () => {
    const w = world({ applePayConfigured: true });
    await connected(w);
    const { runId } = await prepareEvidenceRun(w.runDeps);

    await Promise.all([
      chargeImmediateSections(w.runDeps, runId, { pix: true, wallets: wallets() }),
      completeEvidenceRun(w.runDeps, runId, cards(), [], undefined, ['CARD', 'DEBIT']),
    ]);

    expect(await statuses(w, 'gpay')).toEqual(['EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED']);
    expect(await statuses(w, 'card')).toContain('EXECUTED');
    expect(await statuses(w, 'debit')).toContain('EXECUTED');
  });

  it('given a section already raised, then firing it again is refused and nothing is charged twice', async () => {
    const w = world({ applePayConfigured: true });
    await connected(w);
    const { runId } = await prepareEvidenceRun(w.runDeps);
    await chargeImmediateSections(w.runDeps, runId, { pix: true, wallets: wallets() });

    await expect(chargeImmediateSections(w.runDeps, runId, { pix: false, wallets: wallets() })).rejects.toThrow();
    expect(orders(w, '-gpay')).toHaveLength(1);
  });
});
