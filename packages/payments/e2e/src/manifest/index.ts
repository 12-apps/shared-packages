/**
 * `@12-apps/payments-e2e/manifest` — the SHARED wiring manifest.
 *
 * ## Why this package has one at all
 *
 * `@12-apps/payments-backend`'s manifest narrows `e2e` away, correctly: the
 * journeys ship HERE, and a manifest must not declare an entry another package
 * exports. But the narrowing left the journeys declared by nobody. Hosts adopt
 * them the way the README describes — implement the port, add two globs — which
 * works and is invisible to `assemble()`: a host that never adopts them looks
 * exactly like a host that did, and a scenario added in a later release reaches
 * a consumer only if someone thinks to look.
 *
 * That is precisely the failure the `e2e` capability exists to convert into a
 * refusal. The contract's own note on `world` records both silent modes, and
 * both have happened in this estate: a blank `featuresRoot` compiles every
 * spec under `node_modules`, where the runner's `testIgnore` skips them and the
 * suite passes GREEN with zero tests; and a shipped world nobody adopts is a
 * few hundred lines of journeys re-derived by hand in the host, undiscovered —
 * the documented fate of `defineAuthWorld` on its first host adoption.
 *
 * Declaring makes a host BIND the world (with the `featuresRoot` its compiled
 * specs land under) or decline it in writing. Either way the wiring report
 * answers "does this host run the payment journeys?", which is a question
 * nothing could answer before.
 *
 * ## Two manifests, matching the two OPT-IN worlds
 *
 * The checkout journeys and the PLATFORM-OPERATIONS journeys are a separate
 * port and a separate glob triple on purpose — `platform-world.ts` records
 * that folding them into `PaymentsWorld` would have broken every
 * checkout-only consumer. Two manifests keep that split expressible: a host
 * running checkout journeys and not platform ones binds the first and declines
 * the second, in writing, rather than silently getting neither.
 *
 * ## Untyped pure data, like its sibling
 *
 * `payments/no-host-imports` forbids a `@12-apps/wiring` import anywhere in
 * this package tree, type-only included — the payments packages must vendor
 * into a repo that has no wiring contract at all. The producer assertions run
 * along the dependency edge that DOES exist, in the wiring suite's
 * `payments-manifest.test.ts`, exactly as payments-backend's do.
 *
 * There is no `observability` here and none is owed: the capability is
 * mandatory only for manifests with a RUNTIME half, and journeys ship no
 * running code into a host — they are compiled and executed by the host's own
 * Playwright.
 */

/** The buyer's checkout journeys. */
export const paymentsE2eManifest = {
  name: '@12-apps/payments-e2e',
  contract: 1,
  e2e: {
    entry: '@12-apps/payments-e2e',
    world: { factory: 'definePaymentsWorld' },
  },
} as const;

/** The platform-operations journeys: the Connect consult and the homologação. */
export const paymentsPlatformE2eManifest = {
  name: '@12-apps/payments-platform-e2e',
  contract: 1,
  e2e: {
    entry: '@12-apps/payments-e2e',
    world: { factory: 'definePaymentsPlatformWorld' },
  },
} as const;
