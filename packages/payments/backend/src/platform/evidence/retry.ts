import { evidenceSectionOutcomes } from './outcomes';
import { pixHoldsMoney } from './orders-pix-production';
import type { EvidenceRunDeps } from './run';
import { EvidenceRunNotFoundError, readRun } from './run-guards';
import { ALL_SECTIONS, IMMEDIATE_SECTIONS, raisedSections } from './run-sections';
import { clockOf } from './steps';
import type { EvidenceRecord, EvidenceRunSection, EvidenceStep, EvidenceStepKey } from './types';

/**
 * Retrying only what failed (FUT-5584, the owner: "Se falhar só uma coisa,
 * quero poder tentar só aquela coisa ... quero conseguir retentar só o que nao
 * passou"). A retry stays in the SAME run: the sections it raises replace
 * their own steps, and every section that passed keeps its recording, so the
 * file still holds one run with every scenario.
 *
 * A section is retried only when doing so cannot lose track of money: its
 * charge never went through (a paid charge, refunded or not, is never raised
 * twice — a second charge would overwrite the steps the refund sweep reads),
 * and for the Pix, a QR nobody can pay any more.
 */

/** The step that says a section's money moved. */
const CHARGE_KEY: Readonly<Record<EvidenceRunSection, EvidenceStepKey>> = {
  PIX: 'pix.paid',
  CARD: 'card.approved',
  DEBIT: 'debit.approved',
  GOOGLE_PAY: 'gpay.approved',
  APPLE_PAY: 'apay.approved',
};

/** The run's own steps: never dropped by a retry (the key and the 3DS session are re-minted in place). */
const RUN_KEYS: ReadonlySet<EvidenceStepKey> = new Set<EvidenceStepKey>(['card.publicKey', 'debit.session']);

const PREFIX: Readonly<Record<EvidenceRunSection, string>> = {
  PIX: 'pix.',
  CARD: 'card.',
  DEBIT: 'debit.',
  GOOGLE_PAY: 'gpay.',
  APPLE_PAY: 'apay.',
};

/** Whether a step is one of these sections' own orders (never the run's key or 3DS session). */
function ownedBy(sections: readonly EvidenceRunSection[], key: EvidenceStepKey): boolean {
  return !RUN_KEYS.has(key) && sections.some((section) => key.startsWith(PREFIX[section]));
}

/**
 * The sections of this run a retry may raise again: every one that did not
 * pass — failed, or never raised (a debit card left blank, a wallet not
 * pressed) — whose charge never went through, and, for the Pix, whose QR can
 * no longer be paid.
 */
export function retryableSections(record: EvidenceRecord, skippedNote: string, now: Date): EvidenceRunSection[] {
  return ALL_SECTIONS.filter((section) => {
    const [outcome] = evidenceSectionOutcomes([section], record.steps);
    if (outcome?.status === 'EXECUTED') return false;
    if (record.steps.some((step) => step.key === CHARGE_KEY[section] && step.status === 'EXECUTED')) return false;
    return section !== 'PIX' || !pixHoldsMoney(record, skippedNote, now);
  });
}

/** The run without these sections' orders, so a retry's steps replace them whole (a step it no longer raises included). */
export function withoutSections(record: EvidenceRecord, sections: readonly EvidenceRunSection[]): EvidenceRecord {
  return { ...record, steps: record.steps.filter((step: EvidenceStep) => !ownedBy(sections, step.key)) };
}

/** Thrown when a retry names a section that passed, took money, or is still being raised. */
export class EvidenceSectionNotRetryableError extends Error {
  constructor(
    readonly runId: string,
    readonly sections: readonly EvidenceRunSection[],
  ) {
    super(`Sections ${sections.join(', ')} of homologation evidence run ${runId} cannot be retried`);
    this.name = 'EvidenceSectionNotRetryableError';
  }
}

/** A first phase 2: a card section already raised refuses the run; an immediate one already raised is skipped. */
function firstTodo(record: EvidenceRecord, sections: readonly EvidenceRunSection[]): EvidenceRunSection[] {
  const raised = raisedSections(record);
  if (sections.some((section) => raised.has(section) && !IMMEDIATE_SECTIONS.includes(section))) {
    throw new EvidenceRunNotFoundError(record.id);
  }
  return sections.filter((section) => !raised.has(section));
}

/** A retry (FUT-5584): every named section must be one that did not pass and took no money. */
export function retryTodo(deps: EvidenceRunDeps, record: EvidenceRecord, sections: readonly EvidenceRunSection[]): EvidenceRunSection[] {
  const allowed = retryableSections(record, deps.copy.pixSkipped, clockOf(deps)());
  const refused = sections.filter((section) => !allowed.includes(section));
  if (refused.length > 0) throw new EvidenceSectionNotRetryableError(record.id, refused);
  return [...new Set(sections)];
}

/** The sections this phase 2 raises: a first run's, or a retry's (FUT-5584). */
export function todoOf(
  deps: EvidenceRunDeps,
  record: EvidenceRecord,
  sections: readonly EvidenceRunSection[],
  retry: boolean,
): EvidenceRunSection[] {
  return retry ? retryTodo(deps, record, sections) : firstTodo(record, sections);
}

/** Why sections being raised by another request cannot be raised by this one. */
export function notRaisable(runId: string, sections: readonly EvidenceRunSection[], retry: boolean): Error {
  return retry ? new EvidenceSectionNotRetryableError(runId, sections) : new EvidenceRunNotFoundError(runId);
}

/** The run a save merges into: on a retry, without the failed attempt's steps of the retried sections. */
export function readFor(
  deps: EvidenceRunDeps,
  runId: string,
  sections: readonly EvidenceRunSection[],
  retry: boolean,
): () => Promise<EvidenceRecord> {
  const read = readRun(deps, runId);
  return retry ? async () => withoutSections(await read(), sections) : read;
}
