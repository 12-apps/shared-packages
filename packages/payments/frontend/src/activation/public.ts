/**
 * The ACTIVATION step's whole public surface — the two protocols, and the
 * screens that render them (FUT-463, FUT-763, FUT-764).
 *
 * A file of its own rather than another block on the root barrel, which is at
 * its size cap: a barrel that has to be trimmed to accept a new capability is
 * one that starts hiding capabilities to stay small. Every name below is
 * re-exported from the root unchanged, so nothing an adopter imports moves.
 */
// ---------------------------------------------------------------------------
// The REDIRECT ACTIVATION protocol (FUT-463, packaged by FUT-763) — proving a
// connection can charge, for a provider whose payer pays on its own page.
//
// `renderVerification` above stays what it was: the package decides where the
// step appears and the host owns the screen. What moved is the protocol behind
// it — resume-on-mount, the return trip's ids, the refusal/expiry/transport
// distinctions, the bounded wait. Every one of those was learned from a payment
// that went wrong, and no second host should have to learn them again.
// ---------------------------------------------------------------------------
export {
  useRedirectActivation,
  type RedirectActivation,
  type RedirectActivationOptions,
} from './use-redirect-activation';
export { type RedirectActivationCopy } from './copy';
export {
  creationFailure,
  postActivation,
  refusedByProvider,
  settleActivationPoll,
  type ActivationClock,
  type ActivationPendingBody,
  type ActivationPollBody,
  type RedirectActivationState,
  type SettlePollIo,
} from './redirect-state';
export {
  clearReturnedSettlement,
  takeReturnedSettlement,
  RETURNED_SETTLEMENT_KEY,
} from './returned-settlement';

// ---------------------------------------------------------------------------
// The ACTIVATION CHARGE (FUT-463, packaged by FUT-763) — proving a connection
// can charge, for a provider whose payer pays HERE.
//
// A connection is not a capability: a completed grant says the owner authorized
// us, not that the account can take money. The owner's own card goes through
// the SAME path a shopper's does — same fields, same validation, same
// browser-side encryption — for one cent, refunded immediately.
//
// The sibling of `useRedirectActivation` for the other half of the same step.
// As there, the SCREEN stays the host's.
// ---------------------------------------------------------------------------
export {
  useActivationCharge,
  type ActivationCharge,
  type ActivationChargeOptions,
  type ActivationChargeState,
} from './use-activation-charge';
export { type ActivationChargeCopy } from './charge-copy';

// ---------------------------------------------------------------------------
// The ACTIVATION STEP's SCREENS (FUT-764) — the six settled outcomes, the
// outstanding-payment panel with its link fallback, the two flows and the
// router between them.
//
// The protocol hooks above shipped without them, leaving `renderVerification`
// as "the host owns the screen". That reads as a boundary and is not one: the
// screens are a rendering of THIS package's state machines, and the origin
// host's copies carried a paragraph each about a real payment that went wrong —
// an owner who paid four times, a dead end blaming a store for a key that was
// never going to exist, a refusal wearing another failure's clothes. None of
// that is host knowledge, and a second adopter deriving it again would be
// deriving it from the same payments.
//
// The SENTENCES stay the host's, required and defaultless, as everywhere here.
// ---------------------------------------------------------------------------
export {
  createActivationStep,
  type ActivationStepConfig,
  type ActivationStepProps,
  type CardSurface,
  type ActivationActionCopy,
  type ActivationAwaitingCopy,
  type ActivationIntroCopy,
  type ActivationOutcomeCopy,
  type ActivationStepCopy,
  type ActivationTaxIdCopy,
} from './screens';
