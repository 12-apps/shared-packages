/**
 * `@12-apps/billing` — subscription billing, minus every opinion.
 *
 * This entry is the ISOMORPHIC half: period arithmetic, the lifecycle
 * vocabulary and its ageing, and the seam that turns a subscription row into
 * an entitlement layer. Zero runtime dependencies, so a browser bundle that
 * needs to say "this account is past due" pays nothing for the money path.
 *
 * Everything that touches a payment provider — the retry policy, the cycle
 * collector, the card-on-file surface — lives behind `./server`, because
 * `@12-apps/payments-backend` is server code and an import of it from a
 * shared entry would drag `node:crypto` into every SPA that ever read a
 * billing status.
 *
 * The wiring manifests live behind `./manifest` and `./manifest/server`.
 */
export { BillingConfigError } from "./errors";
export {
  anchorDayOf,
  isBillingInterval,
  nextPeriod,
  periodEnd,
  trialEnd,
  type BillingInterval,
} from "./periods";
export {
  BILLING_STATUSES,
  createBillingLifecycle,
  isBillingStatus,
  type BillingLifecycle,
  type BillingLifecyclePolicy,
  type BillingStatus,
  type SubscriptionTiming,
} from "./status";
export {
  createBillingLayer,
  type BillingLayer,
  type BillingLayerPolicy,
  type SubscriptionBillingRow,
} from "./layer";
