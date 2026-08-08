/**
 * `@12-apps/payments-e2e` — the buyer journeys, shipped (FUT-561).
 *
 * A host that mounts the payments checkout inherits its end-to-end coverage by
 * implementing one port and adding two globs. Nothing is copied, so a scenario
 * added to the library later runs in every consumer on the next version bump.
 *
 * ```ts
 * // <your app>/tests/e2e/steps/payments-world.ts  — inside your `steps` glob
 * import { definePaymentsWorld } from '@12-apps/payments-e2e';
 *
 * definePaymentsWorld({
 *   open: async (page, store) => { ... },
 *   raiseHostedPayable: async (page) => { ... },
 *   returnFromProvider: async (page) => { ... },
 *   hostedReturnStatus: (page) => page.getByTestId('...'),
 *   fixtures: { ... },
 *   wire: { ... },
 * });
 * ```
 *
 * ```ts
 * // playwright.config.ts
 * defineBddConfig({
 *   features: ['tests/e2e/features/**\/*.feature', paymentsFeatures],
 *   steps: ['tests/e2e/steps/**\/*.ts', paymentsSteps],
 * });
 * ```
 *
 * The globs are exported rather than documented as strings so a consumer never
 * has to know this package's internal layout — and cannot be broken by it
 * moving.
 */
export {
  definePaymentsWorld,
  paymentsWorld,
  type PaymentsFixtures,
  type PaymentsStore,
  type PaymentsWireProbe,
  type PaymentsWorld,
} from './world.js';

export { paymentsFeatures, paymentsFeaturesRoot, paymentsSteps } from './globs.js';

/**
 * The PLATFORM-OPERATIONS journeys (FUT-479 / FUT-483, packaged by FUT-573):
 * the Connect-application consult and the platform homologação, for the app
 * that operates the platform. A separate OPT-IN port and glob triple — see
 * `platform-world.ts` for why folding them into `PaymentsWorld` would have
 * broken every checkout-only consumer.
 */
export {
  definePaymentsPlatformWorld,
  paymentsPlatformWorld,
  type ConnectApplicationShape,
  type PaymentsPlatformWorld,
  type PlatformHomologacaoShape,
} from './platform-world.js';
export {
  paymentsPlatformFeatures,
  paymentsPlatformFeaturesRoot,
  paymentsPlatformSteps,
} from './globs.js';

/**
 * The buyer gestures the packaged steps are built from, exported so a host can
 * write its OWN specs in the same vocabulary. Every one drives a test id the
 * payments components render, so they are as portable as the journeys.
 */
export {
  chooseCard,
  DECLINE_PAN,
  fillCard,
  fillCpf,
  GOOD_PAN,
  payCard,
  reachPayment,
  VALID_CPF,
} from './helpers/checkout.js';
