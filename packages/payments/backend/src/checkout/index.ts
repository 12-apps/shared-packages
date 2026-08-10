/**
 * The buyer-checkout surface's public exports.
 *
 * They live here rather than in the package barrel for the same reason
 * `activation/index.ts` and `platform/index.ts` do: `../index.ts` is at the
 * 400-line size gate, and an explicit list is what keeps `export *` from
 * widening the package's public surface by accident (FUT-761).
 */
/**
 * The BUYER-CHECKOUT mount (FUT-740) — `mountPayments`' counterpart for the
 * other side of the till. See `checkout/factory.ts` for what moves into the
 * library and why, and `checkout/types.ts` for the ports that keep "what an
 * order is" outside it.
 */
export {
  createPaymentFlowsBE,
  type PaymentFlowsBE,
  type PaymentFlowsBEConfig,
} from './factory';
export { CHECKOUT_ROUTES } from './route-table';
export { defaultCheckoutCopyPtBR, type CheckoutCopy } from './copy';
export {
  buyerCheckoutConfig,
  usesHostedCheckout,
  type CheckoutConfigDeps,
} from './config';
export type {
  AttachedCharge,
  BrowserKeyPort,
  BuyerCheckoutConfig,
  BuyerProviderLink,
  ChargeCorrelationPort,
  CheckoutChargeDraft,
  CheckoutErrorBody,
  CheckoutIntentKind,
  CheckoutLogger,
  CheckoutPrincipal,
  CheckoutResponder,
  CheckoutRouteIntent,
  CheckoutRouteSpec,
  InstrumentScope,
  Payable,
  PayableLoadContext,
  PayablePort,
  SavedInstrumentPort,
} from './types';
/**
 * The buyer-vault vocabulary (FUT-478): the ownership port `/cards/begin` +
 * `/cards/complete` run under, and the two browser-safe answer shapes.
 */
export type {
  BuyerVaultPort,
  BuyerVaultSession,
  VaultedCardDisplay,
} from './vault-port';
/**
 * The charge-body normalizer, exported so a host can assert what its OWN
 * client's request turns into. Which two wire shapes it accepts, and which of
 * them is canonical, is the module's own doc.
 */
export { chargeDraftOf } from './draft';
