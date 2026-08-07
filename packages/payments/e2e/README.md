# `@12-apps/payments-e2e`

The buyer journeys for the payments checkout, as Gherkin you run **against your
own app**.

Mounting `createPaymentFlows` gives you a checkout. This gives you its
end-to-end coverage: twenty scenarios across seven features — PIX, card, hosted
hand-off and return, provider failover, issuer declines, an unresolved charge, a
store that cannot charge at all, and per-provider screens. You implement one
port and add three lines of config. Nothing is copied, so a scenario added here
later runs in your app on the next version bump.

## Why a port at all

The scenarios are portable because every assertion in them reads a test id the
payments components themselves render — `card-number`, `checkout-method-CARD`,
`pix-code`, `payment-paid` mean the same thing in every consumer.

What is **not** portable is everything around them: how your app routes to a
checkout, how a merchant of a given shape comes to exist, and where you record
what crossed the wire. That, and only that, is `PaymentsWorld`.

## Wiring it up

**1. Implement the port**, in a module inside your own `steps` glob:

```ts
// tests/e2e/steps/payments-world.ts
import { definePaymentsWorld } from '@12-apps/payments-e2e';

definePaymentsWorld({
  // Put the browser on a checkout for a store of this shape.
  open: async (page, store) => { /* route + seed however you do */ },
  raiseHostedPayable: async (page) => { /* …and wait for the interstitial */ },
  returnFromProvider: async (page) => { /* a real return trip */ },
  hostedReturnStatus: (page) => page.getByTestId('…'),
  fixtures: { headProvider, tailProvider, hostedUrlFragment, payableRef, taxId },
  wire: { paths, chargeKeys, chargeBody, tokensByProvider, providerCharges, providerChargeCount, navigated },
});
```

It must live in the `steps` glob because playwright-bdd imports every step file
before the first `Given` runs — that is what registers the world in every
worker.

**2. Point your bdd config at the package:**

```ts
import { paymentsFeatures, paymentsFeaturesRoot, paymentsSteps } from '@12-apps/payments-e2e';

const journeys = defineBddConfig({
  features: [paymentsFeatures, 'tests/e2e/features/**/*.feature'],
  featuresRoot: paymentsFeaturesRoot,
  steps: [paymentsSteps, 'tests/e2e/steps/**/*.ts'],
  outputDir: '.features-gen',
});
```

Keep your own `steps` glob in the list — that is where your
`definePaymentsWorld` call lives.

### Three things that fail SILENTLY if you get them wrong

These are not style notes. Each one produces a **green run with zero journeys**,
which is worse than a red one.

- **Use the exported globs, not hand-written `node_modules/…` paths.** pnpm's
  store is nested and a workspace link is not a directory you can guess. A glob
  that matches nothing makes bddgen compile what it found — nothing — and the
  run passes.
- **Set `featuresRoot`.** bddgen mirrors each feature's path relative to it. Left
  unset, specs compile to `.features-gen/node_modules/@12-apps/payments-e2e/…`,
  and Playwright's default `testIgnore` drops every path containing
  `node_modules`. Seven features compiled, zero collected, green.
- **Assert your journey count.** Whatever the mechanism, put a check somewhere
  that the number of scenarios you expect actually ran.

## `PaymentsStore` — the shapes a scenario asks for

A scenario names a kind of merchant; you decide how to produce one. A harness
declares a provider chain in-page; a real storefront seeds a tenant. The feature
files do not change either way.

`pix-only` · `card` · `both-methods` · `hosted` · `awaiting` · `settles` ·
`declined` · `unresolved` · `unavailable` · `no-provider` ·
`no-provider-remedy` · `payments-off` · `two-mintable` · `redirect-head` ·
`screen-on-page` · `screen-handoff` · `screen-undeclared` · `screen-unknown`

Adding a member is a breaking change for hosts, deliberately: a scenario needing
a store nobody can build is a scenario that silently never runs.

## Why this package ships compiled JavaScript

Its siblings export raw `.ts` through their `exports` map, because an
application's **bundler** consumes them and transpiles whatever it is pointed
at. These files are loaded by **Node** — your `playwright.config.ts` imports
this module and bddgen imports the step files — and Node refuses to strip types
from anything under `node_modules`
(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). Playwright's own TS transform
does not rescue them either; it skips `node_modules` by design.

Shipping source here would produce a package that type-checks, publishes,
installs, and then throws on your first test run.

## Writing your own specs in the same vocabulary

The buyer gestures are exported too, so hand-written specs beside the journeys
read the same way:

```ts
import { fillCard, payCard, reachPayment, VALID_CPF } from '@12-apps/payments-e2e';
```
