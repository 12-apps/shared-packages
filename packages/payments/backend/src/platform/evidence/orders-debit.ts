import type { ThreeDSecureSession } from '../../core/types';
import { createPagbankThreeDSecureSession } from '../../providers/pagbank-3ds';
import { cancelCharge, consultCharge, encryptFailure, paidRefs, raiseCardOrder } from './orders';
import { recordTraffic } from './record';
import { PAGBANK_SANDBOX_DEBIT_CENTS } from './sandbox-buyer';
import { answered, clockOf, failureOf, pendingStep, stepOf } from './steps';
import type { BrowserCardResult, EvidenceStep, EvidenceStepKey } from './types';
import type { EvidenceRunDeps } from './run';

/**
 * The DEBIT section of an evidence run (FUT-3755): a debit card authenticated
 * with PagBank's own 3-D Secure, then charged as `DEBIT_CARD` through the
 * host's gateway, consulted and canceled — recorded call by call like the
 * credit card section, through the same helpers.
 *
 * Three halves, because the authentication has to happen in a browser:
 * {@link threeDSSessionStep} mints the 3DS session server-side with the
 * seller's token (phase 1); the browser runs `authenticate3DS` with it on
 * PagBank's 3DS test card and reports the id; {@link debitSteps} raises the
 * order with that id (phase 2). Nothing here charges a debit card that was
 * not authenticated: without an id, every order step stays PENDING with why.
 */

/** The phase-2 debit scenarios, in the order the file prints them. */
export const DEBIT_ORDER_KEYS = ['debit.authenticate', 'debit.approved', 'debit.consult', 'debit.cancel'] as const;

/** Phase 1: the 3DS session the browser's SDK is set up with, minted with the seller's token. */
export async function threeDSSessionStep(
  deps: EvidenceRunDeps,
  token: string,
): Promise<{ step: EvidenceStep; session: ThreeDSecureSession | null }> {
  const minted = await recordTraffic(() =>
    createPagbankThreeDSecureSession({ environment: 'SANDBOX', fields: { token } }),
  );
  const session = minted.ok && answered(minted.calls) ? minted.value : null;
  const observed = session
    ? deps.copy.threeDSSessionMinted
    : minted.ok
      ? deps.copy.threeDSSessionMissing
      : failureOf(deps.copy, minted);
  return {
    session,
    step: stepOf('debit.session', session ? 'EXECUTED' : 'FAILED', clockOf(deps)(), { calls: minted.calls, observed }),
  };
}

/** Why the debit card cannot be charged, or null when the browser authenticated it. */
function blockedBecause(deps: EvidenceRunDeps, card: BrowserCardResult | undefined): string | null {
  if (!card) return deps.copy.debitNotReported;
  if (!card.encrypted) return encryptFailure(deps, card);
  if (card.authenticationId) return null;
  return deps.copy.threeDSFailed(deps.copy.browserFailures[card.failure ?? 'THREEDS_FAILED']);
}

/** The browser's 3DS answer, as evidence: a note, since no call of ours made it. */
function authenticateStep(deps: EvidenceRunDeps, card: BrowserCardResult, notes: string[]): EvidenceStep {
  const authenticated = card.authenticated === true;
  return stepOf('debit.authenticate', authenticated ? 'EXECUTED' : 'FAILED', clockOf(deps)(), {
    notes,
    ids: { authentication_id: card.authenticationId ?? '' },
    observed: deps.copy.threeDSAuthenticated(authenticated),
  });
}

/** Phase 2: charge the authenticated debit card, consult it, cancel it. */
export async function debitSteps(
  deps: EvidenceRunDeps,
  runId: string,
  cards: readonly BrowserCardResult[],
): Promise<EvidenceStep[]> {
  const card = cards.find((candidate) => candidate.scenario === 'debit');
  const notes = card ? [`${card.brand} ${card.masked}`] : [];
  const blocked = blockedBecause(deps, card);
  if (blocked !== null || !card?.encrypted || !card.authenticationId) {
    const why = blocked ?? deps.copy.notRun;
    return DEBIT_ORDER_KEYS.map((key: EvidenceStepKey) => ({ ...pendingStep(key, deps.copy, why), notes }));
  }
  const authenticate = authenticateStep(deps, card, notes);
  const approved = await raiseCardOrder(deps, {
    key: 'debit.approved',
    expected: 'PAID',
    reference: `homolog-${runId.slice(0, 8)}-card-debit`,
    amountCents: PAGBANK_SANDBOX_DEBIT_CENTS,
    card: { token: card.encrypted, funding: 'DEBIT', authenticationId: card.authenticationId, installments: 1 },
    notes,
  });
  const { chargeId, orderId } = paidRefs(approved);
  const consult = chargeId ? await consultCharge(deps, 'debit.consult', chargeId, orderId) : pendingStep('debit.consult', deps.copy);
  const cancel = chargeId ? await cancelCharge(deps, 'debit.cancel', chargeId, orderId) : pendingStep('debit.cancel', deps.copy);
  return [authenticate, approved.step, consult, cancel];
}
