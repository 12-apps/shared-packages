import { attemptsOf, type RefundRefusal } from '../../core/refund-retry';
import type { EvidenceRefundState } from './refund-state';
import type { EvidenceRecord, EvidenceStep, EvidenceStepKey } from './types';

/**
 * The evidence run's card cancels whose refund did not go back (FUT-4740,
 * C32–C34): which step is which card scenario, what a screen shows of each,
 * and whether one still holds a card charge's money. Pure: no PagBank call.
 */

/** The card cancels a run makes ONE attempt of; the sweep sends the rest. */
export const CARD_CANCEL_KEYS: readonly EvidenceStepKey[] = ['card.cancel', 'debit.cancel', 'gpay.cancel', 'apay.cancel'];

/** The screen's scenario each cancel step belongs to. */
const SCENARIO_OF: Readonly<Record<string, EvidenceCardRefundView['scenario']>> = {
  'card.cancel': 'credit',
  'debit.cancel': 'debit',
  'gpay.cancel': 'googlePay',
  'apay.cancel': 'applePay',
};

/** A card cancel's refund as a screen shows it: the T-18 row and, once out of attempts, the press. */
export interface EvidenceCardRefundView {
  scenario: 'credit' | 'debit' | 'googlePay' | 'applePay';
  attempt: number;
  of: number;
  nextAt: string | null;
  exhausted: boolean;
  refusal: RefundRefusal | null;
}

/** A card cancel step still owed a refund (FAILED, with a retry state), or null. */
export function cardRefundStep(record: EvidenceRecord, key: EvidenceStepKey): (EvidenceStep & { refund: EvidenceRefundState }) | null {
  const step = record.steps.find((candidate) => candidate.key === key);
  return step?.status === 'FAILED' && step.refund ? (step as EvidenceStep & { refund: EvidenceRefundState }) : null;
}

/** Every card cancel of the run whose refund did not go back, as a screen shows it. */
export function cardRefundViewsOf(record: EvidenceRecord): EvidenceCardRefundView[] {
  return CARD_CANCEL_KEYS.flatMap((key) => {
    const step = cardRefundStep(record, key);
    if (!step) return [];
    const state = step.refund;
    return [{ scenario: SCENARIO_OF[key]!, attempt: state.attempt, of: attemptsOf(state), nextAt: state.nextAt, exhausted: state.exhausted, refusal: state.refusal }];
  });
}

/** A card charge of the run is paid and its cancel has not gone back (C34): a new run would charge again. */
export function cardHoldsMoney(record: EvidenceRecord): boolean {
  return CARD_CANCEL_KEYS.some((key) => cardRefundStep(record, key) !== null);
}
