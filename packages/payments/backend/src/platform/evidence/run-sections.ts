import { cardSteps, pixSteps } from './orders';
import { debitSteps } from './orders-debit';
import { walletSectionSteps } from './orders-wallet';
import { evidenceSectionOutcomes, type EvidenceRunProgress } from './outcomes';
import type { EvidenceRunDeps } from './run';
import { withStep } from './steps';
import type {
  BrowserCardResult,
  BrowserWalletResult,
  EvidenceRecord,
  EvidenceRunSection,
  EvidenceStep,
  EvidenceStepKey,
} from './types';

/** Every section, in the order the evidence file prints them. */
export const ALL_SECTIONS: readonly EvidenceRunSection[] = ['PIX', 'CARD', 'DEBIT', 'GOOGLE_PAY', 'APPLE_PAY'];

/**
 * The sections that need nothing from the browser's card encryption (FUT-5519,
 * the owner: "google pay, pix e apple pay nao precisa esperar criptografar,
 * dispara imediato"): raised as soon as the run is prepared.
 */
export const IMMEDIATE_SECTIONS: readonly EvidenceRunSection[] = ['PIX', 'GOOGLE_PAY', 'APPLE_PAY'];

const PREFIX: Readonly<Record<EvidenceRunSection, string>> = {
  PIX: 'pix.',
  CARD: 'card.',
  DEBIT: 'debit.',
  GOOGLE_PAY: 'gpay.',
  APPLE_PAY: 'apay.',
};

/** Phase 1's steps: they prepare the cards, they raise no order. */
const PREPARE_KEYS: ReadonlySet<EvidenceStepKey> = new Set<EvidenceStepKey>(['card.publicKey', 'debit.session']);

/** The section a step belongs to, or null for the run's own steps (connect, usage, the prepared key and 3DS session). */
function sectionOf(key: EvidenceStepKey): EvidenceRunSection | null {
  if (PREPARE_KEYS.has(key)) return null;
  return ALL_SECTIONS.find((section) => key.startsWith(PREFIX[section])) ?? null;
}

/** Whether a step key belongs to a section (`card.encrypt` is the credit card's). */
export function sectionHolds(section: EvidenceRunSection, key: EvidenceStepKey): boolean {
  return key.startsWith(PREFIX[section]);
}

/** The sections whose orders this record already holds. */
export function raisedSections(record: EvidenceRecord): Set<EvidenceRunSection> {
  const raised = new Set<EvidenceRunSection>();
  for (const step of record.steps) {
    const section = sectionOf(step.key);
    if (section) raised.add(section);
  }
  return raised;
}

/** The orders one section raises, from what the browser gave the run. */
function sectionSteps(
  deps: EvidenceRunDeps,
  runId: string,
  section: EvidenceRunSection,
  input: { cards: readonly BrowserCardResult[]; wallets: readonly BrowserWalletResult[] },
): Promise<EvidenceStep[]> {
  if (section === 'PIX') return pixSteps(deps, runId);
  if (section === 'CARD') return cardSteps(deps, runId, input.cards);
  if (section === 'DEBIT') return debitSteps(deps, runId, input.cards);
  return walletSectionSteps(deps, runId, input.wallets, () => undefined, [section]);
}

/**
 * Raise the given sections ALL AT ONCE (FUT-5519, the owner: "tudo em
 * paralelo"): each section charges, consults and refunds on its own, so a
 * paid order is refunded without waiting for any other section. `onSection`
 * is told each section as it FINISHES, with the outcomes of every section
 * finished so far. Answers every raised step, in the file's order.
 */
export async function raiseOrderSections(
  deps: EvidenceRunDeps,
  runId: string,
  input: { cards: readonly BrowserCardResult[]; wallets: readonly BrowserWalletResult[] },
  sections: readonly EvidenceRunSection[],
  onSection: EvidenceRunProgress = () => undefined,
): Promise<EvidenceStep[]> {
  const finished: EvidenceRunSection[] = [];
  let sofar: EvidenceStep[] = [];
  const raised = await Promise.all(
    sections.map(async (section) => {
      const steps = await sectionSteps(deps, runId, section, input);
      finished.push(section);
      sofar = [...sofar, ...steps];
      onSection(section, evidenceSectionOutcomes([...finished], sofar));
      return { section, steps };
    }),
  );
  return ALL_SECTIONS.flatMap((section) => raised.find((entry) => entry.section === section)?.steps ?? []);
}

/** One save at a time per run: two sections finishing together must not overwrite each other's steps. */
const saving = new Map<string, Promise<unknown>>();

/**
 * Merge steps into the run as it stands NOW and save it. Sections run in
 * parallel requests (the immediate ones while the browser still encrypts the
 * cards), so each save re-reads the record rather than writing a copy it read
 * before its orders went out.
 */
export function saveIntoRun(
  deps: EvidenceRunDeps,
  read: () => Promise<EvidenceRecord>,
  steps: readonly EvidenceStep[],
  finish: (merged: EvidenceStep[]) => Promise<EvidenceStep[]> = async (merged) => merged,
  now: () => string,
): Promise<EvidenceRecord> {
  const key = 'run';
  const previous = saving.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const record = await read();
      let merged = record.steps;
      for (const step of steps) merged = withStep(merged, step);
      return deps.store.save({ ...record, steps: await finish(merged), updatedAt: now() });
    });
  saving.set(key, next);
  return next;
}

/** Sections a request is raising right now, per run: a second request for one of them is refused. */
const inFlight = new Map<string, Set<EvidenceRunSection>>();

/** Claim sections for this request, or null when one is already being raised. */
export function claimSections(runId: string, sections: readonly EvidenceRunSection[]): (() => void) | null {
  const claimed = inFlight.get(runId) ?? new Set<EvidenceRunSection>();
  if (sections.some((section) => claimed.has(section))) return null;
  for (const section of sections) claimed.add(section);
  inFlight.set(runId, claimed);
  return () => {
    for (const section of sections) claimed.delete(section);
    if (claimed.size === 0) inFlight.delete(runId);
  };
}
