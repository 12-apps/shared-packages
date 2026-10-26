/**
 * THE FACTORY'S PUBLIC SURFACE — `createPaymentFlows` (FUT-741).
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
  type CheckoutAvailability,
  type CheckoutConfigState,
  type CheckoutController,
  type CheckoutPorts,
  type CheckoutScreens,
  type PaymentFlows,
  type PaymentFlowsConfig,
} from './types';
