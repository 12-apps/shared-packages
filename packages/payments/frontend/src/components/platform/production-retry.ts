import type { EvidenceRunSection } from '@12-apps/payments-backend';

/**
 * Retrying only what failed (FUT-5584, the owner: "Se falhar só uma coisa,
 * quero poder tentar só aquela coisa"). The server names the latest run's
 * sections a retry may raise again — the ones that did not pass and took no
 * money — and this splits them by what the screen holds right now: those that
 * can be retried with one press, and those still waiting for the operator (a
 * card to type, a wallet button to press).
 */

/** What the screen holds for a retry right now. */
export interface RetryInputs {
  /** The credit card is typed and valid. */
  credit: boolean;
  /** The debit card is typed and valid. */
  debit: boolean;
  /** Google Pay's sheet gave a token. */
  googlePay: boolean;
  /** Apple Pay is included: its sheet opens on the confirm. */
  applePay: boolean;
}

export interface RetryPlan {
  /** What the retry raises when pressed now, in the file's order. */
  now: EvidenceRunSection[];
  /** What a retry could raise once the operator gives it what it needs. */
  waiting: EvidenceRunSection[];
}

const ORDER: readonly EvidenceRunSection[] = ['PIX', 'CARD', 'DEBIT', 'GOOGLE_PAY', 'APPLE_PAY'];

function ready(section: EvidenceRunSection, inputs: RetryInputs): boolean {
  if (section === 'PIX') return true;
  if (section === 'CARD') return inputs.credit;
  if (section === 'DEBIT') return inputs.debit;
  return section === 'GOOGLE_PAY' ? inputs.googlePay : inputs.applePay;
}

export function retryPlanOf(retryable: readonly EvidenceRunSection[] | null | undefined, inputs: RetryInputs): RetryPlan {
  const sections = ORDER.filter((section) => retryable?.includes(section) === true);
  return {
    now: sections.filter((section) => ready(section, inputs)),
    waiting: sections.filter((section) => !ready(section, inputs)),
  };
}
