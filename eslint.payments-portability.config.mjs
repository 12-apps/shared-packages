import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import testFlakiness from "eslint-plugin-test-flakiness";

import { paymentsPortabilityPlugin } from "./eslint.payments-portability.rules.mjs";
import { GLOBAL_IGNORES, TEST_GLOBS } from "./eslint.quality.shared.mjs";

/**
 * PORTABILITY gate for `packages/payments/**` — run via
 * `pnpm quality:portability`. Makes the rules in `packages/payments/ADOPTING.md`
 * §6 EXECUTABLE (FUT-562).
 *
 * That section used to end with "(enforced by review)". Review is what let the
 * host repo grow a PagBank-shaped checkout and a 1,165-line fork of the
 * settings page without anyone noticing, and what let `order_nsu` — one
 * vendor's payload field — survive in code whose commit message said it had
 * "removed provider names". Three rules, checked mechanically:
 *
 *   1. `payments/no-host-imports` — nothing under `packages/payments/**` may
 *      import from the harness or from a sibling workspace package. The point
 *      of the package is that it can be lifted into any repo; an import of
 *      `@12-apps/shared-helpers` is a dependency that repo does not have.
 *   2. `payments/no-provider-name-literal` — no provider-name string literal
 *      OUTSIDE `packages/payments/**`. A vendor name in a consumer is the
 *      first line of a provider-shaped fork.
 *   3. `payments/frontend-types-only` — `packages/payments/frontend` may
 *      import only TYPES from `@12-apps/payments-backend`. A runtime value
 *      drags server code (and its `node:crypto` imports) into a browser
 *      bundle.
 *
 * Like the complexity/flakiness gates this runs in ISOLATION from the everyday
 * `pnpm lint` and deliberately omits `@12-apps/eslint-config` — that config
 * loads eslint-plugin-only-warn, which downgrades every rule to a warning, and
 * a GATE needs hard errors.
 *
 * PROVING IT BITES: `pnpm quality:portability:selftest` lints a deliberate
 * violation of each rule through this exact config and fails if any of them
 * comes back clean. A portability gate whose globs match nothing reports a
 * safety it is not providing, which is worse than no gate at all — so the
 * proof ships with the gate and runs in CI beside it.
 *
 * The rule bodies and the derived provider list live in
 * `eslint.payments-portability.rules.mjs`; this file is scope only.
 */

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

const SOURCE_GLOB = "**/*.{js,mjs,cjs,jsx,ts,tsx}";

/**
 * Where rule 2 does NOT apply, each entry earning its place:
 *
 * - TEST_GLOBS — the ticket's own allowlist. A test that asserts the pagbank
 *   adapter behaves has to be able to say "pagbank". This also covers
 *   `**​/*.stories.*`, which is how `packages/ui`'s SectionOnboarding demo copy
 *   ("Conectar conta PagBank") stays legal: the component itself takes title
 *   and description as props and knows nothing about any vendor — only the
 *   story's sample text names one.
 * - migrations and `*.prisma` — SQL and schema describe rows that already
 *   exist. Deliberately NOT `**​/prisma/**`: that would excuse ordinary
 *   TypeScript living under a `prisma/` folder, which is precisely where a
 *   provider-shaped store would be written.
 * - `harness/frontend/src/pages/payments-provider-settings.tsx` and
 *   `harness/**​/registry.ts` — the consumer harness's whole job is mounting
 *   every published adapter in a browser and proving it renders, so enumerating
 *   the catalog by name is the fixture's PURPOSE, not drift. The rest of
 *   `harness/**` stays covered, so a provider-shaped checkout page appearing
 *   next door still fails.
 */
const PROVIDER_NAME_EXEMPT_GLOBS = [
  ...TEST_GLOBS,
  "**/migrations/**",
  // Schema files and the SQL under them describe rows that already exist. NOT
  // `**/prisma/**`, which was the first shape of this entry: that excuses any
  // TypeScript anyone puts in a folder called `prisma/`, which is exactly where
  // a provider-shaped store would go.
  "**/*.prisma",
  "harness/frontend/src/pages/payments-provider-settings.tsx",
  "harness/*/src/pages/registry.ts",
  // The gate itself. Its `VENDOR_ALIASES` map has to spell `pagseguro` for the
  // rule to know about it, and its self-test asserts the list derived from
  // catalog.ts still contains all five names — also by spelling them.
  "eslint.payments-portability.rules.mjs",
  "scripts/payments-portability-selftest.mjs",
];

export default [
  {
    ignores: [
      ...GLOBAL_IGNORES,
      // The gate's own proof material: deliberate violations, linted through
      // this config by scripts/payments-portability-selftest.mjs under a
      // pretend file path. Linting them in place would fail the real run.
      "scripts/payments-portability-fixtures/**",
    ],
  },

  // Source and test files carry inline `eslint-disable` comments for rules this
  // config does not enable. Register those plugins (rules stay off) so the
  // directives resolve instead of erroring "definition not found", and stop
  // reporting the now-unused directives as problems. Unlike the complexity
  // gate, this one lints test files too — rule 2 skips them, but rule 1 does
  // not, so `test-flakiness` has to be registered here as well.
  {
    plugins: { "@typescript-eslint": tsPlugin, "test-flakiness": testFlakiness },
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },

  {
    files: [SOURCE_GLOB],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { payments: paymentsPortabilityPlugin },
    rules: {},
  },

  // Rule 1 — inside the package only.
  {
    files: [`packages/payments/${SOURCE_GLOB}`],
    rules: { "payments/no-host-imports": "error" },
  },

  // Rule 3 — the frontend half only.
  //
  // Tests are out of scope here, and the reason is in the manifest rather than
  // convenience: `packages/payments/frontend/package.json` ships `files` with
  // `!**/__tests__/**`, so a test file cannot reach a browser bundle — which is
  // the entire harm this rule prevents. One file relies on it today,
  // `src/components/checkout/__tests__/charge-wire.contract.test.ts`, which
  // deliberately stands up the real `createPaymentFlowsBE` and drives it with
  // this package's own `chargeCard` to pin the wire from both ends (FUT-740).
  // That test is the reason the rule can be trusted at all; it must not be the
  // thing the rule forbids.
  //
  // `src/stories/**` is out for the SAME manifest reason, not as a courtesy:
  // `files` carries `!src/stories/**` and `!**/*.stories.*`, so nothing under
  // it reaches a consumer either. TEST_GLOBS alone does not cover it — that
  // matches `*.stories.*`, while the story HELPERS (`store.ts`, `host.tsx`)
  // are ordinary filenames in that folder. Those helpers stand up the real
  // `createPaymentFlowsBE` behind the stories on purpose: a story driving a
  // stubbed component would go green while the real screen was broken, which
  // is the failure the Storybook exists to prevent (FUT-742).
  {
    files: [`packages/payments/frontend/${SOURCE_GLOB}`],
    ignores: [...TEST_GLOBS, "packages/payments/frontend/src/stories/**"],
    rules: { "payments/frontend-types-only": "error" },
  },

  // Rule 2 — everywhere the package is not.
  {
    files: [SOURCE_GLOB],
    ignores: ["packages/payments/**", ...PROVIDER_NAME_EXEMPT_GLOBS],
    rules: { "payments/no-provider-name-literal": "error" },
  },
];
