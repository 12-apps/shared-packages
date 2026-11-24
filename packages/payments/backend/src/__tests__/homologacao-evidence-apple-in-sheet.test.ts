import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildHomologacaoEvidenceJson,
  chargeApplePayInSheet,
  completeEvidenceRun,
  prepareEvidenceRun,
} from '../platform/evidence/index';
import { cards, connected, wallets, world } from './homologacao-evidence-world';

/**
 * FUT-5519 — Apple Pay is charged while Apple's sheet is still open. Its
 * token lives minutes and the sheet waits at most 30 s, so a token held for
 * the length of a run came back EXPIRED_PAYMENT_TOKEN. Pinned:
 *
 *  - the in-sheet charge raises the Apple Pay order on the prepared run and
 *    answers whether it was paid;
 *  - the run that follows raises every other section and leaves Apple Pay's
 *    as the sheet recorded it, with no second Apple Pay order;
 *  - a second in-sheet charge on the same run is refused.
 */

type JsonScenario = { key: string; status: string };

async function statuses(w: ReturnType<typeof world>, prefix: string): Promise<string[]> {
  const { scenarios } = JSON.parse((await buildHomologacaoEvidenceJson(w.fileDeps)).content) as { scenarios: JsonScenario[] };
  return scenarios.filter((scenario) => scenario.key.startsWith(`${prefix}.`)).map((scenario) => scenario.status);
}

const appleOrders = (w: ReturnType<typeof world>) =>
  w.pagbank.seen.filter((call) => call.path === 'POST /orders' && String(call.body?.['reference_id']).endsWith('-apay'));

const apple = () => wallets().find((wallet) => wallet.type === 'APPLE_PAY')!;
const google = () => wallets().filter((wallet) => wallet.type === 'GOOGLE_PAY');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('homologação evidence — Apple Pay charged in its sheet', () => {
  it('given an authorized sheet, then the Apple Pay order is raised at once and the run leaves it alone', async () => {
    const w = world({ applePayConfigured: true });
    await connected(w);
    const { runId } = await prepareEvidenceRun(w.runDeps);

    await expect(chargeApplePayInSheet(w.runDeps, runId, apple())).resolves.toEqual({ paid: true });
    expect(appleOrders(w)).toHaveLength(1);
    expect(await statuses(w, 'apay')).toEqual(['EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED']);

    await completeEvidenceRun(w.runDeps, runId, cards(), google());

    expect(appleOrders(w)).toHaveLength(1);
    expect(await statuses(w, 'apay')).toEqual(['EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED']);
    expect(await statuses(w, 'gpay')).toEqual(['EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED']);
    expect(await statuses(w, 'card')).toContain('EXECUTED');
  });

  it('given the sheet already charged on this run, then a second charge is refused', async () => {
    const w = world({ applePayConfigured: true });
    await connected(w);
    const { runId } = await prepareEvidenceRun(w.runDeps);
    await chargeApplePayInSheet(w.runDeps, runId, apple());

    await expect(chargeApplePayInSheet(w.runDeps, runId, apple())).rejects.toThrow();
    expect(appleOrders(w)).toHaveLength(1);
  });

  it('given a run whose orders were raised, then the sheet cannot charge into it', async () => {
    const w = world({ applePayConfigured: true });
    await connected(w);
    const { runId } = await prepareEvidenceRun(w.runDeps);
    await completeEvidenceRun(w.runDeps, runId, cards(), google());

    await expect(chargeApplePayInSheet(w.runDeps, runId, apple())).rejects.toThrow();
    expect(appleOrders(w)).toHaveLength(0);
  });
});
