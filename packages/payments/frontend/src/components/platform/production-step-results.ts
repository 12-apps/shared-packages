import { useRef, useState } from 'react';

import type { BrowserCardFailure, BrowserCardResult, EvidenceRunSection } from '@12-apps/payments-backend';

import type { HomologacaoProductionEvidenceCopy } from './copy';
import type { EvidenceRunStep, EvidenceStepResult } from './HomologacaoEvidenceProgress';
import { reasonOf, type ProductionScenarioOutcome } from './ProductionScenarioList';

/**
 * Each step of a production run, marked with its own result (FUT-5519, the
 * owner's option B): the server tells each section's outcome as the next one
 * starts, the browser knows whether it prepared the cards, and a step that
 * failed never reads as done.
 */

type Scenario = ProductionScenarioOutcome['scenario'];

const SECTION_SCENARIO: Readonly<Record<EvidenceRunSection, Scenario>> = {
  PIX: 'pix',
  CARD: 'credit',
  DEBIT: 'debit',
  GOOGLE_PAY: 'googlePay',
  APPLE_PAY: 'applePay',
};

type Copy = HomologacaoProductionEvidenceCopy['scenarios'];

function resultOf(outcome: ProductionScenarioOutcome, copy: Copy): EvidenceStepResult {
  if (outcome.status === 'EXECUTED') return { kind: 'executed', label: copy.status.executed, reason: null };
  if (outcome.status === 'PENDING') return { kind: 'pending', label: copy.status.pending, reason: null };
  return { kind: 'failed', label: copy.status.failed, reason: reasonOf(outcome, copy) };
}

/** The results the progress marks its steps with, from what is known so far. */
export function stepResultsOf(
  outcomes: readonly ProductionScenarioOutcome[],
  cardFailure: BrowserCardFailure | null,
  copy: Copy,
): Partial<Record<EvidenceRunStep, EvidenceStepResult>> {
  const results: Partial<Record<EvidenceRunStep, EvidenceStepResult>> = {};
  if (cardFailure) results.encrypt = { kind: 'pending', label: copy.status.pending, reason: copy.cardFailures[cardFailure] };
  for (const [section, scenario] of Object.entries(SECTION_SCENARIO) as [EvidenceRunSection, Scenario][]) {
    const outcome = outcomes.find((candidate) => candidate.scenario === scenario);
    if (outcome) results[section] = resultOf(outcome, copy);
  }
  return results;
}

/** The first reason the browser could not prepare a card, if any. */
const cardFailureOf = (cards: readonly BrowserCardResult[]): BrowserCardFailure | null =>
  cards.find((card) => card.failure)?.failure ?? null;

/**
 * One run's progress in this tab: the outcomes told so far, whether a card
 * could not be prepared, and whether the run is over — its steps then stay on
 * screen with their results until the next run starts.
 */
export function useRunProgress() {
  const [section, setSection] = useState<EvidenceRunSection | null>(null);
  const [told, setTold] = useState<readonly ProductionScenarioOutcome[]>([]);
  const [cardFailure, setCardFailure] = useState<BrowserCardFailure | null>(null);
  const [finished, setFinished] = useState(false);
  // One run at a time, whatever a double click on the confirmation does.
  const inFlight = useRef(false);
  return {
    section,
    told,
    cardFailure,
    finished,
    /** Starts a run: false, and nothing changes, while another is still going. */
    begin: (): boolean => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setSection(null);
      setTold([]);
      setCardFailure(null);
      setFinished(false);
      return true;
    },
    /** The host's `onSection`: the part the run is on, and the outcomes of the parts already done. */
    onSection: (next: EvidenceRunSection, done?: readonly ProductionScenarioOutcome[]): void => {
      setSection(next);
      if (done) setTold(done);
    },
    prepared: (cards: readonly BrowserCardResult[]): void => setCardFailure(cardFailureOf(cards)),
    /** The run ended; `ran` when the server held one, whose steps then stay on screen. */
    end: (ran: boolean): void => {
      inFlight.current = false;
      if (ran) setFinished(true);
    },
  };
}
