import { cardSteps, pixSteps } from './orders';
import { debitSteps } from './orders-debit';
import { walletSectionSteps } from './orders-wallet';
import { evidenceSectionOutcomes, type EvidenceRunProgress } from './outcomes';
import type { EvidenceRunDeps } from './run';
import type { BrowserCardResult, BrowserWalletResult, EvidenceStep } from './types';

/**
 * Phase 2's orders, section by section — Pix, card, debit, then the wallets —
 * telling `onSection` each part as it starts with the outcomes of the parts
 * already done (FUT-5519), so a host marks each step with its own result.
 */
export async function raiseOrderSections(
  deps: EvidenceRunDeps,
  runId: string,
  cards: readonly BrowserCardResult[],
  wallets: readonly BrowserWalletResult[],
  onSection: EvidenceRunProgress,
): Promise<EvidenceStep[]> {
  onSection('PIX', []);
  const pix = await pixSteps(deps, runId);
  onSection('CARD', evidenceSectionOutcomes(['PIX'], pix));
  const card = await cardSteps(deps, runId, cards);
  onSection('DEBIT', evidenceSectionOutcomes(['PIX', 'CARD'], [...pix, ...card]));
  const debit = await debitSteps(deps, runId, cards);
  const before = [...pix, ...card, ...debit];
  const walletSteps = await walletSectionSteps(deps, runId, wallets, (wallet, sofar) =>
    onSection(
      wallet,
      evidenceSectionOutcomes(wallet === 'GOOGLE_PAY' ? ['PIX', 'CARD', 'DEBIT'] : ['PIX', 'CARD', 'DEBIT', 'GOOGLE_PAY'], [
        ...before,
        ...sofar,
      ]),
    ),
  );
  return [...before, ...walletSteps];
}
