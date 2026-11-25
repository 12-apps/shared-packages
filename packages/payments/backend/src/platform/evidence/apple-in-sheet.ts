import { evidenceSectionOutcomes, type EvidenceScenarioOutcome } from './outcomes';
import { raiseOrderSections, raisedSections, claimSections, saveIntoRun } from './run-sections';
import { blockedBecause, EvidenceRunNotFoundError, openRun, readRun, sandboxSeller, type EvidenceRunDeps } from './run';
import { EvidenceSectionNotRetryableError, retryTodo, withoutSections } from './retry';
import { clockOf } from './steps';
import type { BrowserWalletResult, EvidenceRunSection, EvidenceWallet } from './types';

const PROVIDER = 'pagbank';

/** What the sections fired at once answered: each wallet charged or not, and every section's outcome. */
export interface ImmediateCharge {
  paid: Partial<Record<EvidenceWallet, boolean>>;
  outcomes: EvidenceScenarioOutcome[];
}

/**
 * The sections that need no card encryption, fired as soon as the run is
 * prepared (FUT-5519, the owner: "google pay, pix e apple pay nao precisa
 * esperar criptografar, dispara imediato"): the Pix, and each wallet whose
 * sheet gave a token — Apple's while its sheet is still open, since its
 * token lives minutes and the sheet waits 30 s. All at once, each refunded as
 * soon as it is paid; the browser's phase 2 then raises the cards. Refused
 * for a section already raised or being raised.
 */
export async function chargeImmediateSections(
  deps: EvidenceRunDeps,
  runId: string,
  input: { pix: boolean; wallets: readonly BrowserWalletResult[]; retry?: boolean },
): Promise<ImmediateCharge> {
  const sections: EvidenceRunSection[] = [...(input.pix ? (['PIX'] as const) : []), ...input.wallets.map((wallet) => wallet.type)];
  const record = openRun(await deps.store.latest(PROVIDER, 'RUN'), runId);
  if (input.retry) {
    // A retry (FUT-5584): only sections that did not pass and took no money.
    retryTodo(deps, record, sections);
  } else if (sections.some((section) => raisedSections(record).has(section))) {
    throw new EvidenceRunNotFoundError(runId);
  }
  const release = claimSections(runId, sections);
  if (!release) throw input.retry ? new EvidenceSectionNotRetryableError(runId, sections) : new EvidenceRunNotFoundError(runId);
  try {
    const seller = await sandboxSeller(deps);
    const blocked = blockedBecause(deps, record, seller);
    if (blocked !== null || typeof seller !== 'object') throw new Error(blocked ?? deps.copy.notRun);
    const steps = await raiseOrderSections(deps, runId, { cards: [], wallets: input.wallets }, sections);
    const read = input.retry ? async () => withoutSections(await readRun(deps, runId)(), sections) : readRun(deps, runId);
    await saveIntoRun(deps, read, steps, undefined, () => clockOf(deps)().toISOString());
    const paid = (wallet: EvidenceWallet): boolean =>
      steps.some((step) => step.key === `${wallet === 'GOOGLE_PAY' ? 'gpay' : 'apay'}.approved` && step.status === 'EXECUTED');
    return {
      paid: Object.fromEntries(input.wallets.map((wallet) => [wallet.type, paid(wallet.type)])),
      outcomes: evidenceSectionOutcomes(sections, steps),
    };
  } finally {
    release();
  }
}

/** Apple Pay alone, charged while its sheet is still open (FUT-5519). */
export async function chargeApplePayInSheet(
  deps: EvidenceRunDeps,
  runId: string,
  result: BrowserWalletResult,
  retry = false,
): Promise<{ paid: boolean }> {
  const { paid } = await chargeImmediateSections(deps, runId, { pix: false, wallets: [result], retry });
  return { paid: paid.APPLE_PAY === true };
}
