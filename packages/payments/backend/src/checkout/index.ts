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
export type { CheckoutCopy } from './copy';
/**
 * THE REFUSAL PIPELINE, reachable by a host at last (FUT-760).
 *
 * `checkoutRefusalFor` has always been the library's answer to "a charge
 * failed — what is the buyer told, with what status, in what order", and that
 * order is itself a money-safety rule (see `failure.ts`). It was simply never
 * exported, so every adopting host wrote the pipeline again. One of them
 * carries a 352-line `charge-failure.ts` — 162 lines of logic under 190 of
 * comment — re-deriving this one decision for decision, and drifted from it.
 * That is the duplication a host's payment LOC budget can measure but cannot
 * fix on its own.
 *
 * Exporting it is what makes that host code deletable rather than merely over
 * budget.
 */
export {
  checkoutRefusalFor,
  chargeMismatchRefusal,
  type CheckoutRefusal,
  type FailureContext,
} from './failure';
export {
  buyerCheckoutConfig,
  usesHostedCheckout,
  type CheckoutConfigDeps,
} from './config';
/**
 * The Apple Pay vocabulary (FUT-3686), TYPE-ONLY on the root: the port
 * `buyerCheckoutConfig` gates the `APPLE_PAY` declaration on, and the wire
 * shapes of the validation route. The route itself is server-only, at
 * `@12-apps/payments-backend/apple-pay`.
 */
export type {
  ApplePayIdentityPort,
  ApplePayMerchantIdentity,
  ApplePayMerchantSession,
  ApplePayValidationFailureCode,
  ApplePayValidationRefusalCode,
  ApplePayValidationResult,
} from '../apple-pay/types';
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
/** What a buyer's charge may carry of a card (FUT-3754: debit's funding and 3DS id included). */
export type { CheckoutCard } from './reuse';
/**
 * The charge-body normalizer, exported so a host can assert what its OWN
 * client's request turns into. Which two wire shapes it accepts, and which of
 * them is canonical, is the module's own doc.
 */
export { chargeDraftOf } from './draft';

export { platformGooglePayMerchant } from './google-pay-merchant';
