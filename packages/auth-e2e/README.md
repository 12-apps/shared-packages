# `@12-apps/auth-e2e`

The e-mail + password journeys, as Gherkin you run **against your own app**.

Mounting `createEmailCredentials` and `createEmailAuthScreens` gives you
sign-up, confirmation, password reset, and the card that adds a password to a
social-only account. This gives you their end-to-end coverage: **nine scenarios
across three features** — signing up and confirming, a confirmation link that
works exactly once, a taken address answering identically to a free one,
sign-up with confirmation switched off, forgetting and resetting, a reset link
that dies on use, an unknown address giving nothing away, a Google account
adding a password and keeping both, and changing a password you already have.

You implement one port and add three lines of config. Nothing is copied, so a
scenario added here later runs in your app on the next version bump.

## Why a port at all

The scenarios are portable because every assertion in them reads a test id the
auth screens themselves render — `forgot-password-form`, `reset-submit`,
`verify-failed`, `save-password`, `password-security-card[data-mode]` and
`auth-failure[data-reason]` mean the same thing in every consumer.

Nothing here matches user-facing TEXT. Your copy is yours: a step asserting
`"E-mail ou senha incorretos."` would only ever run in a pt-BR app, which is
exactly what stops journeys shipping with a library. Refusals are read off
`data-reason`, which is a code and identical everywhere.

What is **not** portable is everything around them: how a user comes to exist,
how the two platform switches flip, how you read what your mailer sent, and
where your app puts its login and account pages. That, and only that, is
`AuthWorld`.

## Wiring it up

**1. Implement the port**, in a module inside your own `steps` glob:

```ts
// tests/e2e/steps/auth-world.ts
import { defineAuthWorld } from '@12-apps/auth-e2e';

defineAuthWorld({
  seedUser: async (page, user) => { /* however you seed */ },
  setEmailAuthEnabled: async (page, on) => { /* your platform switch */ },
  setRequireVerification: async (page, on) => { /* the other one */ },
  lastMail: (email, subject) => { /* what your mailer actually sent */ },
  signInAs: async (context, email) => { /* mint your session */ },
  signOut: async (context) => { await context.clearCookies(); },
  paths: { login: '/login', signup: '/signup', forgotPassword: '/forgot-password', account: '/account' },
  subjects: { verify: 'Confirme', reset: 'Redefinir', alreadyRegistered: 'Você já tem uma conta' },
});
```

It must live in the `steps` glob because playwright-bdd imports every step file
before the first `Given` runs — that is what registers the world in every
worker.

**2. Point your bdd config at the package:**

```ts
import { authFeatures, authFeaturesRoot, authSteps } from '@12-apps/auth-e2e';

const journeys = defineBddConfig({
  features: [authFeatures, 'tests/e2e/features/**/*.feature'],
  featuresRoot: authFeaturesRoot,
  steps: [authSteps, 'tests/e2e/steps/**/*.ts'],
  outputDir: '.features-gen',
});
```

Keep your own `steps` glob in the list — that is where your `defineAuthWorld`
call lives.

### Three things that fail SILENTLY if you get them wrong

Each one produces a **green run with zero journeys**, which is worse than a red
one.

- **Use the exported globs, not hand-written `node_modules/…` paths.** pnpm's
  store is nested and a workspace link is not a directory you can guess. A glob
  that matches nothing makes bddgen compile what it found — nothing — and the
  run passes.
- **Set `featuresRoot`.** Unset, it defaults to your config's directory, and a
  packaged feature compiles to a spec under `.features-gen/node_modules/…`,
  which Playwright's default `testIgnore` excludes. bddgen reports three
  features compiled and Playwright collects zero.
- **The steps glob points at `dist`, not `src`.** Node refuses to strip types
  under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), and
  Playwright's own transform skips `node_modules` by design.

## What the scenarios assume about your app

- The auth screens are mounted at the paths you declare, and render this
  package's components (that is where the test ids come from).
- `POST /api/auth/email/{signup,forgot-password,reset-password}` exist — the
  standard routes for `createEmailCredentials`. Two `Given`s use them to set up
  state without driving the UI.
- Your sign-up screen has a terms checkbox with the test id `accept-terms`.
  That one is the host's, because whether you gate sign-up on consent is your
  product's decision, not the library's.
