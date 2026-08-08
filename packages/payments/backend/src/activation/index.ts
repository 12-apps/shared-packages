/**
 * The activation surface's public exports, listed here rather than in the
 * package root because that file sits at the 400-line size gate — the same
 * reason `platform/index.ts` exists. Paths are relative to this folder.
 */
export type { ActivationContext } from './context';
export {
  ownsVerificationReference,
  parseVerificationReference,
  verificationAmountCents,
  verificationAttemptId,
  verificationReference,
} from './reference';
export {
  failureFor,
  unreachableReason,
  type PollFlags,
  type PollOutcome,
  type VerificationFailure,
  type VerifyChargeResult,
} from './failure';
export {
  credentialsForVerification,
  verificationCardPublicKey,
  verifyProviderCharge,
  type VerifyChargeInput,
} from './verify-charge';
export {
  discardPendingVerification,
  getPendingVerification,
  pollRedirectVerification,
  startRedirectVerification,
  type RedirectStart,
} from './verify-redirect';
export {
  healStrandedActivation,
  reconcileActivationCharges,
  type ActivationLogger,
  type ActivationProofStore,
  type ActivationReconcileContext,
  type ActivationReport,
  type OutstandingActivation,
} from './reconcile';
export { settleActivationCharge } from './webhook';
// Public-API seam for the FRONTEND half of FUT-558: `<ProviderActivation>`
// will pick the CARD-vs-REDIRECT branch from capabilities through this,
// retiring the admin's provider-name table (`tokenizerFor`). No host consumer
// yet, on purpose — pinned by `activation-contract.test.ts` until it lands.
export { activationFlowOf } from './flow';
