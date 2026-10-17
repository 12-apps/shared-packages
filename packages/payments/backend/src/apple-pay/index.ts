/**
 * `@12-apps/payments-backend/apple-pay` — Apple Pay merchant validation
 * (FUT-3686), server-only.
 *
 * A subpath rather than the root entry because validation goes over
 * `node:https` (a client certificate cannot ride global `fetch`), and the root
 * entry must stay reachable from a browser bundle — see `../index.ts`.
 *
 * The vocabulary (`ApplePayIdentityPort`, the session and refusal-code types)
 * is ALSO on the root, type-only, so a host passing the port to
 * `buyerCheckoutConfig` and the frontend package naming the wire shapes need
 * not reach in here.
 */
export {
  createApplePayMerchantValidation,
  type ApplePayMerchantValidationOptions,
  type ApplePayMerchantValidationRoute,
} from './route';
export {
  ApplePayValidationError,
  applePayDomain,
  validateApplePayMerchant,
  type ApplePayValidationDeps,
  type ApplePayValidationInput,
} from './validate';
export { APPLE_PAY_GATEWAY_HOSTS, applePayValidationUrl } from './gateway-hosts';
export type {
  ApplePayIdentityPort,
  ApplePayMerchantIdentity,
  ApplePayMerchantSession,
  ApplePayValidationFailureCode,
  ApplePayValidationRefusalCode,
  ApplePayValidationResult,
} from './types';
