import type { EvidenceFailureReason, EvidenceRecord, EvidenceStatus, EvidenceStep, EvidenceStepKey } from './types';

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

/** The outcome of each scenario, in the order the card lists them. */
export function evidenceScenarioOutcomes(record: EvidenceRecord): EvidenceScenarioOutcome[] {
  return SCENARIOS.map(({ scenario, charge, keys }) => {
    const steps = record.steps.filter((step) => keys.includes(step.key));
    const status = statusOf(steps, charge);
    const reason = status === 'FAILED' ? (steps.find((step) => step.status === 'FAILED' && step.reason)?.reason ?? null) : null;
    return { scenario, status, reason };
  });
}
