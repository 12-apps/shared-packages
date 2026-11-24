import type {
  EvidenceFailureReason,
  EvidenceRecord,
  EvidenceRunSection,
  EvidenceStatus,
  EvidenceStep,
  EvidenceStepKey,
} from './types';

/**
 * Each production scenario's REAL outcome (FUT-4322), read off the run record so
 * the card can say "falhou" instead of "registrado no arquivo". The reason is
 * the CODE stored on the failed step when it was recorded; the screen maps it
 * to words, and the file never prints it.
 */

export type EvidenceScenario = 'credit' | 'debit' | 'pix' | 'googlePay' | 'applePay';

export interface EvidenceScenarioOutcome {
  scenario: EvidenceScenario;
  status: EvidenceStatus;
  reason: EvidenceFailureReason | null;
}

/** A scenario's steps, and the one whose PENDING means the scenario did not run. */
const SCENARIOS: readonly { scenario: EvidenceScenario; charge: EvidenceStepKey; keys: readonly EvidenceStepKey[] }[] = [
  { scenario: 'credit', charge: 'card.approved', keys: ['card.approved', 'card.approvedConsult', 'card.cancel'] },
  { scenario: 'debit', charge: 'debit.approved', keys: ['debit.authenticate', 'debit.approved', 'debit.consult', 'debit.cancel'] },
  { scenario: 'pix', charge: 'pix.paid', keys: ['pix.create', 'pix.consult', 'pix.paid', 'pix.refund'] },
  { scenario: 'googlePay', charge: 'gpay.approved', keys: ['gpay.approved', 'gpay.consult', 'gpay.cancel'] },
  { scenario: 'applePay', charge: 'apay.approved', keys: ['apay.approved', 'apay.consult', 'apay.cancel'] },
];

function statusOf(steps: readonly EvidenceStep[], charge: EvidenceStepKey): EvidenceStatus {
  if (steps.some((step) => step.status === 'FAILED')) return 'FAILED';
  // A scenario the run never reached has nothing recorded, or its charge PENDING.
  const charged = steps.find((step) => step.key === charge);
  return !charged || charged.status === 'PENDING' ? 'PENDING' : 'EXECUTED';
}

function outcomeOf({ scenario, charge, keys }: (typeof SCENARIOS)[number], all: readonly EvidenceStep[]): EvidenceScenarioOutcome {
  const steps = all.filter((step) => keys.includes(step.key));
  const status = statusOf(steps, charge);
  const reason = status === 'FAILED' ? (steps.find((step) => step.status === 'FAILED' && step.reason)?.reason ?? null) : null;
  return { scenario, status, reason };
}

/** The outcome of each scenario, in the order the card lists them. */
export function evidenceScenarioOutcomes(record: EvidenceRecord): EvidenceScenarioOutcome[] {
  return SCENARIOS.map((entry) => outcomeOf(entry, record.steps));
}

/** Which scenario each part of phase 2 raises. */
const SCENARIO_OF_SECTION: Readonly<Record<EvidenceRunSection, EvidenceScenario>> = {
  PIX: 'pix',
  CARD: 'credit',
  DEBIT: 'debit',
  GOOGLE_PAY: 'googlePay',
  APPLE_PAY: 'applePay',
};

/**
 * The outcomes of the parts of phase 2 that already ran (FUT-5519), from the
 * steps they raised, in the order they ran: what a host shows on each step of
 * the progress while the run is still going.
 */
export function evidenceSectionOutcomes(
  sections: readonly EvidenceRunSection[],
  steps: readonly EvidenceStep[],
): EvidenceScenarioOutcome[] {
  return sections.map((section) => {
    const scenario = SCENARIO_OF_SECTION[section];
    return outcomeOf(SCENARIOS.find((entry) => entry.scenario === scenario)!, steps);
  });
}

/**
 * Told each part of phase 2 as it starts (FUT-3755), with the outcomes of the
 * parts already done (FUT-5519).
 */
export type EvidenceRunProgress = (section: EvidenceRunSection, done: readonly EvidenceScenarioOutcome[]) => void;
