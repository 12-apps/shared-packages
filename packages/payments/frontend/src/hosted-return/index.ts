/**
 * `@12-apps/payments-frontend/hosted-return` — "is this document a buyer
 * coming back from a hosted checkout?", asked at boot (FUT-556, FUT-1055).
 *
 * Its own entry rather than the root barrel's: a host asks this before it
 * knows whether any checkout screen will be drawn, so the answer must not
 * reach one. Everything here is plain functions over `sessionStorage` and
 * the URL, plus the basket signature a parked order is matched against; the
 * module graph is pinned by `__tests__/hosted-return-entry.test.ts`, which
 * fails if it ever reaches React, MUI or a component file.
 */
export {
  HOSTED_ORDER_STORAGE_KEY,
  hostedCheckoutReturnPending,
} from '../components/checkout/hosted-return';
export {
  basketSignature,
  type CheckoutBasketIdentity,
  type CheckoutBasketLine,
} from '../components/checkout/basket';
