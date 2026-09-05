/**
 * THE FACTORY'S PUBLIC SURFACE — `createPaymentFlows` (FUT-741) and the
 * checkout pipeline it can now run (FUT-1240).
 *
 * Listed here rather than inline in `src/index.ts` for the reason
 * `./activation/public.ts` already gives: the root barrel is at its size gate,
 * and a surface that grows with every plugin type is one that will keep
 * growing. Everything below is re-exported verbatim by the root.
 */

// ---------------------------------------------------------------------------
// The MOUNTED buyer checkout (FUT-741) — `createPaymentFlows` returns every
// screen pre-bound to one transport, one scope, one slot table and one set of
// host ports. Additive: the hand-composing path is unchanged.
// ---------------------------------------------------------------------------
export { createPaymentFlows } from './create-payment-flows';
// A type and nothing else now: `DEFAULT_CHECKOUT_COPY_FE` used to sit beside it
// and was the only value this module ever published (FUT-760).
export type { CheckoutCopyFE } from './copy';
export {
  type BoundCheckoutClient,
  type BuyerDetailsProps,
  type CheckoutAvailability,
  type CheckoutConfigState,
  type CheckoutController,
  type CheckoutPorts,
  type CheckoutScreens,
  type PaymentFlows,
  type PaymentFlowsConfig,
} from './types';

// ---------------------------------------------------------------------------
// The checkout PIPELINE (FUT-1240) — steps, gates and settlement methods as
// registered plugins, with the current step DERIVED from the server's own
// facts rather than held in a `useState` a reload forgets.
//
// ADDITIVE: a host that registers none of these gets exactly the flat
// three-step `CheckoutFlow`, unchanged, down to its test ids. What the types
// below buy is the ability to say "this store has a step of its own", "this
// shopper may not check out yet", and "this settlement raises no charge" — the
// last of which the package had no seam for at all, so every in-person payment
// path was written beside the checkout instead of inside it.
// ---------------------------------------------------------------------------
export type {
  AnyCheckoutGate,
  AnyCheckoutStep,
  AnySettlementMethod,
  CheckoutContext,
  CheckoutExit,
  CheckoutGate,
  CheckoutPipelineConfig,
  CheckoutStep,
  CheckoutStepPhase,
  CheckoutStepRender,
  GateVerdict,
  SettlementMethodDescriptor,
  StepSlice,
} from './pipeline/types';
/**
 * The step ids the PACKAGE registers, so a host ordering its own steps around
 * them names a constant instead of retyping a string that can change.
 */
export {
  DADOS_STEP_ID,
  HANDOFF_STEP_ID,
  METHOD_STEP_ID,
  RESUME_STEP_ID,
  STATUS_STEP_ID,
} from './pipeline/steps';
export { CARD_PANE_STEP, PIX_PANE_STEP } from './pipeline/methods';
/**
 * Where a step's parked slice lives — `payments.checkout.<slug>.<stepId>`.
 * Public for the same reason `HOSTED_ORDER_STORAGE_KEY` is: a host clearing
 * storage on sign-out, or a spec asserting a resume, otherwise retypes it.
 */
export { sliceKey } from './pipeline/slices';
/** Whose plugin answers a refusal code — the routing, without the renderer. */
export { refusalOwner, type RefusalOwner } from './pipeline/refusal-routing';
